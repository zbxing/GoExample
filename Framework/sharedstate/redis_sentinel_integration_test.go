package sharedstate

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestRedisSentinelFailoverReconnectsSharedStateClients(t *testing.T) {
	rawAddresses := strings.TrimSpace(os.Getenv("REDIS_SENTINEL_TEST_ADDRESSES"))
	if rawAddresses == "" {
		t.Skip("REDIS_SENTINEL_TEST_ADDRESSES is not set; real Redis Sentinel integration is opt-in")
	}
	addresses := splitRedisSentinelTestAddresses(rawAddresses)
	masterName := requiredRedisSentinelTestEnvironment(t, "REDIS_SENTINEL_TEST_MASTER_NAME")
	dataUsername := requiredRedisSentinelTestEnvironment(t, "REDIS_SENTINEL_TEST_USERNAME")
	dataPassword := requiredRedisSentinelTestEnvironment(t, "REDIS_SENTINEL_TEST_PASSWORD")
	sentinelUsername := requiredRedisSentinelTestEnvironment(t, "REDIS_SENTINEL_TEST_SENTINEL_USERNAME")
	sentinelPassword := requiredRedisSentinelTestEnvironment(t, "REDIS_SENTINEL_TEST_SENTINEL_PASSWORD")

	testContext, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	prefix := fmt.Sprintf("goexample:sentinel-contract:%d:", time.Now().UTC().UnixNano())
	config := RedisConfig{
		Topology:           RedisTopologySentinel,
		SentinelAddresses:  addresses,
		SentinelMasterName: masterName,
		Username:           dataUsername,
		Password:           dataPassword,
		SentinelUsername:   sentinelUsername,
		SentinelPassword:   sentinelPassword,
		KeyPrefix:          prefix,
		OperationTimeout:   time.Second,
		LockTTL:            10 * time.Second,
		LockWaitTimeout:    2 * time.Second,
		LockRetryInterval:  25 * time.Millisecond,
		PoolSize:           4,
	}
	first := newRedisSentinelIntegrationClient(t, testContext, config)
	second := newRedisSentinelIntegrationClient(t, testContext, config)
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cleanupCancel()
		_ = first.ResetWithContext(cleanupContext)
	})

	sentinel := redis.NewSentinelClient(&redis.Options{
		Addr:                  addresses[0],
		Username:              sentinelUsername,
		Password:              sentinelPassword,
		DialTimeout:           time.Second,
		ReadTimeout:           time.Second,
		WriteTimeout:          time.Second,
		ContextTimeoutEnabled: true,
	})
	t.Cleanup(func() { _ = sentinel.Close() })
	oldMaster, err := sentinel.GetMasterAddrByName(testContext, masterName).Result()
	if err != nil || len(oldMaster) != 2 {
		t.Fatalf("read original Sentinel master: address parts=%d, error=%v", len(oldMaster), err)
	}

	if err := first.SetWithContext(testContext, "replicated", []byte("before-failover"), time.Minute); err != nil {
		t.Fatalf("write state before failover: %v", err)
	}
	if _, err := first.client.Do(testContext, "WAIT", 1, 5000).Result(); err != nil {
		t.Fatalf("wait for replica before failover: %v", err)
	}
	if err := sentinel.Failover(testContext, masterName).Err(); err != nil {
		t.Fatalf("request Sentinel failover: %v", err)
	}
	newMaster := waitForRedisSentinelMasterChange(t, testContext, sentinel, masterName, oldMaster)
	if strings.Join(newMaster, ":") == strings.Join(oldMaster, ":") {
		t.Fatalf("Sentinel master did not change from %s", strings.Join(oldMaster, ":"))
	}

	waitForRedisSentinelClients(t, testContext, first, second)
	value, err := second.GetWithContext(testContext, "replicated")
	if err != nil || string(value) != "before-failover" {
		t.Fatalf("read replicated state after failover: value=%q, error=%v", value, err)
	}
	if err := second.SetWithContext(testContext, "reconnected", []byte("after-failover"), time.Minute); err != nil {
		t.Fatalf("write through reconnected client: %v", err)
	}
	if value, err = first.GetWithContext(testContext, "reconnected"); err != nil || string(value) != "after-failover" {
		t.Fatalf("cross-client read after failover: value=%q, error=%v", value, err)
	}

	allowed, err := first.Take(testContext, "limit", 1, time.Minute)
	if err != nil || !allowed.Allowed {
		t.Fatalf("first rate-limit take after failover: result=%#v, error=%v", allowed, err)
	}
	denied, err := second.Take(testContext, "limit", 1, time.Minute)
	if err != nil || denied.Allowed {
		t.Fatalf("second rate-limit take after failover: result=%#v, error=%v", denied, err)
	}
	if err := first.Lock("lease"); err != nil {
		t.Fatalf("first lock after failover: %v", err)
	}
	if err := second.Lock("lease"); err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("competing lock after failover: %v", err)
	}
	if err := first.Unlock("lease"); err != nil {
		t.Fatalf("release first lock after failover: %v", err)
	}
	if err := second.Lock("lease"); err != nil {
		t.Fatalf("reacquire lock after failover: %v", err)
	}
	if err := second.Unlock("lease"); err != nil {
		t.Fatalf("release second lock after failover: %v", err)
	}
}

func newRedisSentinelIntegrationClient(t *testing.T, ctx context.Context, config RedisConfig) *Redis {
	t.Helper()
	client, err := NewRedis(ctx, config)
	if err != nil {
		t.Fatalf("create Sentinel-backed Redis client: %v", err)
	}
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("close Sentinel-backed Redis client: %v", err)
		}
	})
	return client
}

func splitRedisSentinelTestAddresses(raw string) []string {
	items := strings.Split(raw, ",")
	addresses := make([]string, 0, len(items))
	for _, item := range items {
		if address := strings.TrimSpace(item); address != "" {
			addresses = append(addresses, address)
		}
	}
	return addresses
}

func requiredRedisSentinelTestEnvironment(t *testing.T, name string) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		t.Fatalf("%s must be set when REDIS_SENTINEL_TEST_ADDRESSES is set", name)
	}
	return value
}

func waitForRedisSentinelMasterChange(
	t *testing.T,
	ctx context.Context,
	sentinel *redis.SentinelClient,
	masterName string,
	oldMaster []string,
) []string {
	t.Helper()
	var lastAddress []string
	for ctx.Err() == nil {
		address, err := sentinel.GetMasterAddrByName(ctx, masterName).Result()
		if err == nil {
			lastAddress = address
			if len(address) == 2 && strings.Join(address, ":") != strings.Join(oldMaster, ":") {
				return address
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatalf("wait for Sentinel master change: last address parts=%d, error=%v", len(lastAddress), ctx.Err())
	return nil
}

func waitForRedisSentinelClients(t *testing.T, ctx context.Context, clients ...*Redis) {
	t.Helper()
	var lastError error
	for ctx.Err() == nil {
		ready := true
		for index, client := range clients {
			if err := client.Check(ctx); err != nil {
				lastError = err
				ready = false
				break
			}
			if err := client.SetWithContext(
				ctx,
				fmt.Sprintf("reconnect-probe-%d", index),
				[]byte("ok"),
				time.Minute,
			); err != nil {
				lastError = err
				ready = false
				break
			}
		}
		if ready {
			return
		}
		select {
		case <-ctx.Done():
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatalf("wait for Sentinel client reconnection: %v", lastError)
}
