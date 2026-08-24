package natsjetstream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

func TestRealNATSJetStreamClusterLeaderFailover(t *testing.T) {
	serverBinary := strings.TrimSpace(os.Getenv("NATS_SERVER_BINARY"))
	if serverBinary == "" {
		t.Skip("NATS_SERVER_BINARY is not set; skipping real JetStream cluster failover contract")
	}
	serverBinary, err := filepath.Abs(serverBinary)
	if err != nil {
		t.Fatalf("resolve NATS_SERVER_BINARY: %v", err)
	}
	if info, err := os.Stat(serverBinary); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("NATS_SERVER_BINARY is not a regular file: %v", err)
	}

	evidenceDirectory := strings.TrimSpace(os.Getenv("NATS_CLUSTER_EVIDENCE_DIR"))
	if evidenceDirectory == "" {
		evidenceDirectory = t.TempDir()
	} else if evidenceDirectory, err = filepath.Abs(evidenceDirectory); err != nil {
		t.Fatalf("resolve NATS_CLUSTER_EVIDENCE_DIR: %v", err)
	}
	if err := os.MkdirAll(evidenceDirectory, 0o750); err != nil {
		t.Fatalf("create cluster evidence directory: %v", err)
	}
	reportPath := filepath.Join(evidenceDirectory, "cluster-failover-report.json")
	if err := os.Remove(reportPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("remove stale cluster failover report: %v", err)
	}

	testContext, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	ports := reserveClusterPorts(t, 9)
	servers := make(map[string]*clusterContractServer, 3)
	serverConfigs := make(map[string]clusterServerConfig, 3)
	serverURLs := make([]string, 0, 3)
	serverURLsByName := make(map[string]string, 3)
	clusterPorts := ports[3:6]
	routePorts := ports[6:]
	routeProxies := make([]*clusterRouteProxy, 0, 3)
	for index := 0; index < 3; index++ {
		proxy, proxyError := newClusterRouteProxy(routePorts[index], clusterPorts[index])
		if proxyError != nil {
			for _, opened := range routeProxies {
				_ = opened.close()
			}
			t.Fatalf("start NATS route proxy %d: %v", index+1, proxyError)
		}
		routeProxies = append(routeProxies, proxy)
	}
	t.Cleanup(func() {
		for _, proxy := range routeProxies {
			_ = proxy.close()
		}
	})
	for index := 0; index < 3; index++ {
		name := fmt.Sprintf("goexample-js-node-%d", index+1)
		serverURL := "nats://127.0.0.1:" + strconv.Itoa(ports[index])
		logPath := filepath.Join(evidenceDirectory, name+".log")
		if err := os.Remove(logPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("remove stale NATS cluster log %s: %v", name, err)
		}
		serverURLs = append(serverURLs, serverURL)
		serverURLsByName[name] = serverURL
		config := clusterServerConfig{
			Binary:           serverBinary,
			Name:             name,
			ClientPort:       ports[index],
			ClusterPort:      clusterPorts[index],
			RoutePort:        routePorts[index],
			AllRoutePorts:    routePorts,
			StorageDirectory: filepath.Join(t.TempDir(), name),
			LogPath:          logPath,
		}
		serverConfigs[name] = config
		servers[name] = startClusterServer(t, config)
	}
	t.Cleanup(func() {
		for _, server := range servers {
			_ = server.stop()
		}
	})

	controlConnection := connectClusterJetStream(t, testContext, serverURLs)
	t.Cleanup(func() {
		controlConnection.Close()
	})
	controlJS, err := jetstream.New(controlConnection)
	if err != nil {
		t.Fatalf("jetstream.New(cluster) error = %v", err)
	}
	const (
		sourceStream    = "GOEXAMPLE_FAILOVER_SOURCE"
		dlqStream       = "GOEXAMPLE_FAILOVER_DLQ"
		sourceSubject   = "goexample.failover.source"
		dlqSubject      = "goexample.failover.dlq"
		consumerName    = "GOEXAMPLE_FAILOVER_WORKER"
		dlqConsumerName = "GOEXAMPLE_FAILOVER_DLQ_READER"
	)
	source := createClusterStream(t, testContext, controlJS, sourceStream, sourceSubject)
	createClusterStream(t, testContext, controlJS, dlqStream, dlqSubject)
	initialStreamInfo := waitClusterStreamReady(t, testContext, source, 3)

	sourceConsumer := createClusterConsumer(t, testContext, controlJS, sourceStream, jetstream.ConsumerConfig{
		Name:              consumerName,
		Durable:           consumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		AckWait:           300 * time.Millisecond,
		MaxDeliver:        5,
		FilterSubject:     sourceSubject,
		ReplayPolicy:      jetstream.ReplayInstantPolicy,
		MaxAckPending:     1,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
		Replicas:          3,
	})
	dlqConsumer := createClusterConsumer(t, testContext, controlJS, dlqStream, jetstream.ConsumerConfig{
		Name:              dlqConsumerName,
		Durable:           dlqConsumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		FilterSubject:     dlqSubject,
		MaxAckPending:     1,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
		Replicas:          3,
	})
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)

	oldLeader := initialStreamInfo.Cluster.Leader
	leaderServer := servers[oldLeader]
	leaderURL := serverURLsByName[oldLeader]
	if leaderServer == nil || leaderURL == "" {
		t.Fatalf("stream leader %q does not match a contract server", oldLeader)
	}
	connectionEvents := newClusterConnectionEvents()
	connection := connectClusterJetStream(
		t,
		testContext,
		[]string{leaderURL},
		connectionEvents.options()...,
	)
	originalConnection := connection
	t.Cleanup(connection.Close)
	waitClusterDiscoveredServers(t, testContext, connection, 2)
	connectionServerBefore := connection.ConnectedServerName()
	if connectionServerBefore != oldLeader {
		t.Fatalf("business connection server before failover = %q, want stream leader %q", connectionServerBefore, oldLeader)
	}
	js, err := jetstream.New(connection)
	if err != nil {
		t.Fatalf("jetstream.New(business connection) error = %v", err)
	}
	source = openExistingClusterStream(t, testContext, js, sourceStream)
	dlq := openExistingClusterStream(t, testContext, js, dlqStream)
	sourceConsumer = openExistingClusterConsumer(t, testContext, js, sourceStream, consumerName)
	dlqConsumer = openExistingClusterConsumer(t, testContext, js, dlqStream, dlqConsumerName)

	adapter, client := newRestartContractClient(t, js, sourceConsumer, sourceSubject, dlqSubject)
	originalAdapter := adapter
	shortLeaseRejected := false
	if budget, err := PreflightConsumer(testContext, sourceConsumer, client, contractWorkerRetry, contractLeaseSafetyMargin); errors.Is(err, ErrAckWaitTooShort) && budget > 0 {
		shortLeaseRejected = true
	} else {
		t.Fatalf("PreflightConsumer(short cluster AckWait) = %s, %v", budget, err)
	}
	for _, message := range []struct {
		body   string
		tenant string
	}{
		{body: "failover-redelivery", tenant: "tenant-redelivery"},
		{body: "failover-acknowledge", tenant: "tenant-ack"},
		{body: "failover-dead-letter", tenant: "tenant-dlq"},
	} {
		publishContractMessage(t, testContext, client, adapter, message.body, message.tenant)
	}
	first, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(before leader stop) error = %v", err)
	}
	if string(first.Data()) != "failover-redelivery" || first.Headers().Get("Tenant") != "tenant-redelivery" {
		t.Fatalf("first message before leader stop = %q/%q", first.Data(), first.Headers().Get("Tenant"))
	}
	firstMetadata, err := first.Metadata()
	if err != nil {
		t.Fatalf("Metadata(before leader stop) error = %v", err)
	}
	if firstMetadata.NumDelivered != 1 {
		t.Fatalf("NumDelivered before leader stop = %d, want 1", firstMetadata.NumDelivered)
	}
	initialStreamInfo, err = source.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(before leader stop) error = %v", err)
	}
	if initialStreamInfo.State.Msgs != 3 {
		t.Fatalf("persisted source messages before leader stop = %d, want 3", initialStreamInfo.State.Msgs)
	}
	if err := leaderServer.stop(); err != nil {
		t.Fatalf("abruptly stop stream leader %s: %v", oldLeader, err)
	}
	disconnectedObserved, reconnectedObserved, connectionServerAfter := waitClusterConnectionRecovered(
		t,
		testContext,
		connection,
		connectionEvents,
		oldLeader,
	)
	failedOverInfo := waitClusterStreamLeaderChange(t, testContext, source, oldLeader, 3)
	newLeader := failedOverInfo.Cluster.Leader
	waitClusterStreamHandleAvailable(t, testContext, dlq, oldLeader)
	waitClusterConsumerHandleAvailable(t, testContext, sourceConsumer, oldLeader)
	waitClusterConsumerHandleAvailable(t, testContext, dlqConsumer, oldLeader)

	redelivered, err := sourceConsumer.Next(jetstream.FetchMaxWait(5 * time.Second))
	if err != nil {
		t.Fatalf("Next(after leader failover) error = %v", err)
	}
	redeliveryMetadata, err := redelivered.Metadata()
	if err != nil {
		t.Fatalf("Metadata(after leader failover) error = %v", err)
	}
	if string(redelivered.Data()) != "failover-redelivery" || redelivered.Headers().Get("Tenant") != "tenant-redelivery" {
		t.Fatalf("leader failover redelivery body/header = %q/%q", redelivered.Data(), redelivered.Headers().Get("Tenant"))
	}
	if redeliveryMetadata.Sequence.Stream != firstMetadata.Sequence.Stream {
		t.Fatalf("leader failover stream sequence = %d, want %d", redeliveryMetadata.Sequence.Stream, firstMetadata.Sequence.Stream)
	}
	if redeliveryMetadata.NumDelivered < 2 {
		t.Fatalf("leader failover delivery count = %d, want at least 2", redeliveryMetadata.NumDelivered)
	}
	if err := redelivered.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(leader failover redelivery) error = %v", err)
	}

	requiredLease := calibrateExistingContractConsumer(t, testContext, js, sourceStream, sourceConsumer, client)
	verifiedLease, err := PreflightConsumer(testContext, sourceConsumer, client, contractWorkerRetry, contractLeaseSafetyMargin)
	if err != nil || verifiedLease != requiredLease {
		t.Fatalf("PreflightConsumer(calibrated failover consumer) = %s, %v; want %s", verifiedLease, err, requiredLease)
	}
	publishContractMessage(t, testContext, client, adapter, "failover-published-after-election", "tenant-post-failover")
	observer := newFailoverDeliveryObserver()
	workerContext, cancelWorkers := context.WithCancel(testContext)
	defer cancelWorkers()
	workers, err := queueclient.NewWorkerGroup(client, queueclient.WorkerConfig{
		ReceiveDelivery:  adapter.ReceiveDelivery,
		DeliveryObserver: observer,
		Handle: func(_ context.Context, message queueclient.Message) error {
			switch string(message.Body) {
			case "failover-acknowledge", "failover-published-after-election":
				return nil
			case "failover-dead-letter":
				return queueclient.ErrDeliveryNotRetryable
			default:
				return errors.New("unexpected cluster failover contract message")
			}
		},
		Retry: contractWorkerRetry,
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup(after leader failover) error = %v", err)
	}
	if err := workers.Start(workerContext); err != nil {
		t.Fatalf("Start(after leader failover) error = %v", err)
	}
	workerDone := make(chan error, 1)
	go func() {
		workerDone <- workers.Wait()
	}()
	waitFailoverSettlements(t, testContext, observer, workerDone, 2, 1)
	cancelWorkers()
	if err := <-workerDone; err != nil {
		t.Fatalf("Wait(after leader failover) error = %v", err)
	}

	dlqMessage, err := dlqConsumer.Next(jetstream.FetchMaxWait(5 * time.Second))
	if err != nil {
		t.Fatalf("Next(DLQ after leader failover) error = %v", err)
	}
	if string(dlqMessage.Data()) != "failover-dead-letter" || dlqMessage.Headers().Get("Tenant") != "tenant-dlq" {
		t.Fatalf("leader failover DLQ body/header = %q/%q", dlqMessage.Data(), dlqMessage.Headers().Get("Tenant"))
	}
	if !strings.HasPrefix(dlqMessage.Headers().Get(jetstream.MsgIDHeader), "goexample-dlq-") {
		t.Fatalf("leader failover DLQ message ID = %q", dlqMessage.Headers().Get(jetstream.MsgIDHeader))
	}
	if err := dlqMessage.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(DLQ after leader failover) error = %v", err)
	}

	waitClusterConsumerDrained(t, testContext, sourceConsumer)
	firstFailoverStreamInfo, err := source.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(after settlement) error = %v", err)
	}
	if firstFailoverStreamInfo.State.Msgs != 4 {
		t.Fatalf("persisted source messages after leader failover = %d, want 4", firstFailoverStreamInfo.State.Msgs)
	}

	servers[oldLeader] = startClusterServer(t, serverConfigs[oldLeader])
	recoveredReplicaInfo := waitClusterStreamReady(t, testContext, source, 3)
	waitClusterStreamReady(t, testContext, dlq, 3)
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)
	if recoveredReplicaInfo.Cluster.Leader != newLeader {
		t.Fatalf("source leader after replica recovery = %q, want first failover leader %q", recoveredReplicaInfo.Cluster.Leader, newLeader)
	}

	publishContractMessage(t, testContext, client, adapter, "second-failover-redelivery", "tenant-second-redelivery")
	secondFirst, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(before second leader stop) error = %v", err)
	}
	if string(secondFirst.Data()) != "second-failover-redelivery" || secondFirst.Headers().Get("Tenant") != "tenant-second-redelivery" {
		t.Fatalf("first message before second leader stop = %q/%q", secondFirst.Data(), secondFirst.Headers().Get("Tenant"))
	}
	secondFirstMetadata, err := secondFirst.Metadata()
	if err != nil {
		t.Fatalf("Metadata(before second leader stop) error = %v", err)
	}
	if secondFirstMetadata.NumDelivered != 1 {
		t.Fatalf("NumDelivered before second leader stop = %d, want 1", secondFirstMetadata.NumDelivered)
	}
	secondPreFailoverInfo, err := source.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(before second leader stop) error = %v", err)
	}
	if secondPreFailoverInfo.State.Msgs != 5 {
		t.Fatalf("persisted source messages before second leader stop = %d, want 5", secondPreFailoverInfo.State.Msgs)
	}
	secondOldLeader := secondPreFailoverInfo.Cluster.Leader
	if secondOldLeader != newLeader || secondOldLeader == oldLeader {
		t.Fatalf("second stopped leader = %q, want distinct first failover leader %q", secondOldLeader, newLeader)
	}
	secondLeaderServer := servers[secondOldLeader]
	if secondLeaderServer == nil {
		t.Fatalf("second stream leader %q does not match a contract server", secondOldLeader)
	}
	connectionServerBeforeSecond := connection.ConnectedServerName()
	if err := secondLeaderServer.stop(); err != nil {
		t.Fatalf("abruptly stop second stream leader %s: %v", secondOldLeader, err)
	}
	connectionServerAfterSecond := waitClusterConnectionAvailable(t, testContext, connection, secondOldLeader)
	secondFailedOverInfo := waitClusterStreamLeaderChange(t, testContext, source, secondOldLeader, 5)
	secondNewLeader := secondFailedOverInfo.Cluster.Leader
	waitClusterStreamHandleAvailable(t, testContext, dlq, secondOldLeader)
	waitClusterConsumerHandleAvailable(t, testContext, sourceConsumer, secondOldLeader)
	waitClusterConsumerHandleAvailable(t, testContext, dlqConsumer, secondOldLeader)

	secondRedelivered := waitClusterMessage(t, testContext, sourceConsumer, "second leader failover redelivery")
	secondRedeliveryMetadata, err := secondRedelivered.Metadata()
	if err != nil {
		t.Fatalf("Metadata(after second leader failover) error = %v", err)
	}
	if string(secondRedelivered.Data()) != "second-failover-redelivery" || secondRedelivered.Headers().Get("Tenant") != "tenant-second-redelivery" {
		t.Fatalf("second leader failover redelivery body/header = %q/%q", secondRedelivered.Data(), secondRedelivered.Headers().Get("Tenant"))
	}
	if secondRedeliveryMetadata.Sequence.Stream != secondFirstMetadata.Sequence.Stream {
		t.Fatalf("second leader failover stream sequence = %d, want %d", secondRedeliveryMetadata.Sequence.Stream, secondFirstMetadata.Sequence.Stream)
	}
	if secondRedeliveryMetadata.NumDelivered < 2 {
		t.Fatalf("second leader failover delivery count = %d, want at least 2", secondRedeliveryMetadata.NumDelivered)
	}
	if err := secondRedelivered.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(second leader failover redelivery) error = %v", err)
	}
	requiredLeaseAfterSecond := calibrateExistingContractConsumer(t, testContext, js, sourceStream, sourceConsumer, client)
	if requiredLeaseAfterSecond != requiredLease {
		t.Fatalf("required lease after second failover = %s, want %s", requiredLeaseAfterSecond, requiredLease)
	}
	publishContractMessage(t, testContext, client, adapter, "published-after-second-failover", "tenant-second-post-failover")
	secondPostDelivery, err := adapter.ReceiveDelivery(testContext)
	if err != nil {
		t.Fatalf("ReceiveDelivery(after second leader failover) error = %v", err)
	}
	if string(secondPostDelivery.Message.Body) != "published-after-second-failover" || secondPostDelivery.Message.Headers["Tenant"] != "tenant-second-post-failover" {
		t.Fatalf("post-second-failover delivery = %#v", secondPostDelivery.Message)
	}
	if err := secondPostDelivery.Acknowledge(testContext); err != nil {
		t.Fatalf("Acknowledge(after second leader failover) error = %v", err)
	}

	waitClusterConsumerDrained(t, testContext, sourceConsumer)
	secondFinalStreamInfo, err := source.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(after second settlement) error = %v", err)
	}
	if secondFinalStreamInfo.State.Msgs != 6 {
		t.Fatalf("persisted source messages after second leader failover = %d, want 6", secondFinalStreamInfo.State.Msgs)
	}

	publishContractMessage(t, testContext, client, adapter, "quorum-loss-redelivery", "tenant-quorum-redelivery")
	quorumFirst, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(before quorum loss) error = %v", err)
	}
	if string(quorumFirst.Data()) != "quorum-loss-redelivery" || quorumFirst.Headers().Get("Tenant") != "tenant-quorum-redelivery" {
		t.Fatalf("first message before quorum loss = %q/%q", quorumFirst.Data(), quorumFirst.Headers().Get("Tenant"))
	}
	quorumFirstMetadata, err := quorumFirst.Metadata()
	if err != nil {
		t.Fatalf("Metadata(before quorum loss) error = %v", err)
	}
	if quorumFirstMetadata.Sequence.Stream != 7 || quorumFirstMetadata.NumDelivered != 1 {
		t.Fatalf("message before quorum loss sequence/delivery = %d/%d, want 7/1", quorumFirstMetadata.Sequence.Stream, quorumFirstMetadata.NumDelivered)
	}
	quorumPreFailureInfo, err := source.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(before quorum loss) error = %v", err)
	}
	if quorumPreFailureInfo.State.Msgs != 7 {
		t.Fatalf("persisted source messages before quorum loss = %d, want 7", quorumPreFailureInfo.State.Msgs)
	}
	quorumOldLeader := quorumPreFailureInfo.Cluster.Leader
	if quorumOldLeader != secondNewLeader || quorumOldLeader == secondOldLeader {
		t.Fatalf("quorum-loss stopped leader = %q, want second failover leader %q", quorumOldLeader, secondNewLeader)
	}
	quorumLeaderServer := servers[quorumOldLeader]
	if quorumLeaderServer == nil {
		t.Fatalf("quorum-loss stream leader %q does not match a contract server", quorumOldLeader)
	}
	connectionServerBeforeQuorumLoss := connection.ConnectedServerName()
	if err := quorumLeaderServer.stop(); err != nil {
		t.Fatalf("abruptly stop quorum-loss stream leader %s: %v", quorumOldLeader, err)
	}
	connectionServerDuringQuorumLoss := waitClusterConnectionAvailable(t, testContext, connection, quorumOldLeader)

	const quorumFailureBudget = 3 * time.Second
	quorumAttemptContext, cancelQuorumAttempt := context.WithTimeout(testContext, 2*time.Second)
	quorumFailureStarted := time.Now()
	quorumPublishError := client.Publish(quorumAttemptContext, queueclient.Message{
		Body:    []byte("must-not-commit-without-quorum"),
		Headers: map[string]string{"Tenant": "tenant-quorum-rejected"},
	}, adapter.Publish)
	quorumFailureElapsed := time.Since(quorumFailureStarted)
	cancelQuorumAttempt()
	if !errors.Is(quorumPublishError, ErrPublish) {
		t.Fatalf("Publish(without JetStream quorum) error = %v, want ErrPublish", quorumPublishError)
	}
	if quorumFailureElapsed > quorumFailureBudget {
		t.Fatalf("Publish(without JetStream quorum) elapsed = %s, want at most %s", quorumFailureElapsed, quorumFailureBudget)
	}

	servers[quorumOldLeader] = startClusterServer(t, serverConfigs[quorumOldLeader])
	quorumRecoveredInfo := waitClusterStreamQuorumRecovered(
		t,
		testContext,
		source,
		secondOldLeader,
		7,
	)
	quorumRecoveredLeader := quorumRecoveredInfo.Cluster.Leader
	waitClusterStreamHandleAvailable(t, testContext, dlq, secondOldLeader)
	waitClusterConsumerHandleAvailable(t, testContext, sourceConsumer, secondOldLeader)
	waitClusterConsumerHandleAvailable(t, testContext, dlqConsumer, secondOldLeader)
	connectionServerAfterQuorumRecovery := waitClusterConnectionAvailable(t, testContext, connection, secondOldLeader)

	quorumRedelivered := waitClusterMessage(t, testContext, sourceConsumer, "quorum recovery redelivery")
	quorumRedeliveryMetadata, err := quorumRedelivered.Metadata()
	if err != nil {
		t.Fatalf("Metadata(after quorum recovery) error = %v", err)
	}
	if string(quorumRedelivered.Data()) != "quorum-loss-redelivery" || quorumRedelivered.Headers().Get("Tenant") != "tenant-quorum-redelivery" {
		t.Fatalf("quorum recovery redelivery body/header = %q/%q", quorumRedelivered.Data(), quorumRedelivered.Headers().Get("Tenant"))
	}
	if quorumRedeliveryMetadata.Sequence.Stream != quorumFirstMetadata.Sequence.Stream {
		t.Fatalf("quorum recovery stream sequence = %d, want %d", quorumRedeliveryMetadata.Sequence.Stream, quorumFirstMetadata.Sequence.Stream)
	}
	if quorumRedeliveryMetadata.NumDelivered < 2 {
		t.Fatalf("quorum recovery delivery count = %d, want at least 2", quorumRedeliveryMetadata.NumDelivered)
	}
	if err := quorumRedelivered.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(quorum recovery redelivery) error = %v", err)
	}
	requiredLeaseAfterQuorum := calibrateExistingContractConsumer(t, testContext, js, sourceStream, sourceConsumer, client)
	if requiredLeaseAfterQuorum != requiredLease {
		t.Fatalf("required lease after quorum recovery = %s, want %s", requiredLeaseAfterQuorum, requiredLease)
	}
	publishContractMessage(t, testContext, client, adapter, "published-after-quorum-recovery", "tenant-quorum-recovery")
	quorumPostDelivery, err := adapter.ReceiveDelivery(testContext)
	if err != nil {
		t.Fatalf("ReceiveDelivery(after quorum recovery) error = %v", err)
	}
	if string(quorumPostDelivery.Message.Body) != "published-after-quorum-recovery" || quorumPostDelivery.Message.Headers["Tenant"] != "tenant-quorum-recovery" {
		t.Fatalf("post-quorum-recovery delivery = %#v", quorumPostDelivery.Message)
	}
	if err := quorumPostDelivery.Acknowledge(testContext); err != nil {
		t.Fatalf("Acknowledge(after quorum recovery) error = %v", err)
	}

	sourceInfo := waitClusterConsumerDrained(t, testContext, sourceConsumer)
	quorumFinalStreamInfo, err := source.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(after quorum recovery settlement) error = %v", err)
	}
	if quorumFinalStreamInfo.State.Msgs != 8 {
		t.Fatalf("persisted source messages after quorum recovery = %d, want 8", quorumFinalStreamInfo.State.Msgs)
	}

	servers[secondOldLeader] = startClusterServer(t, serverConfigs[secondOldLeader])
	finalReplicaInfo := waitClusterStreamReady(t, testContext, source, 3)
	waitClusterStreamReady(t, testContext, dlq, 3)
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)
	if finalReplicaInfo.State.Msgs != 8 {
		t.Fatalf("persisted source messages after final replica recovery = %d, want 8", finalReplicaInfo.State.Msgs)
	}

	publishContractMessage(t, testContext, client, adapter, "concurrent-failure-redelivery", "tenant-concurrent-redelivery")
	concurrentFirst, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(before concurrent failure) error = %v", err)
	}
	if string(concurrentFirst.Data()) != "concurrent-failure-redelivery" || concurrentFirst.Headers().Get("Tenant") != "tenant-concurrent-redelivery" {
		t.Fatalf("first message before concurrent failure = %q/%q", concurrentFirst.Data(), concurrentFirst.Headers().Get("Tenant"))
	}
	concurrentFirstMetadata, err := concurrentFirst.Metadata()
	if err != nil {
		t.Fatalf("Metadata(before concurrent failure) error = %v", err)
	}
	if concurrentFirstMetadata.Sequence.Stream != 9 || concurrentFirstMetadata.NumDelivered != 1 {
		t.Fatalf("message before concurrent failure sequence/delivery = %d/%d, want 9/1", concurrentFirstMetadata.Sequence.Stream, concurrentFirstMetadata.NumDelivered)
	}
	concurrentPreFailureInfo := waitClusterStreamReady(t, testContext, source, 3)
	waitClusterStreamReady(t, testContext, dlq, 3)
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)
	if concurrentPreFailureInfo.State.Msgs != 9 {
		t.Fatalf("persisted source messages before concurrent failure = %d, want 9", concurrentPreFailureInfo.State.Msgs)
	}
	concurrentOldLeader := concurrentPreFailureInfo.Cluster.Leader
	connectionServerBeforeConcurrentFailure := connection.ConnectedServerName()
	concurrentPeer, concurrentSurvivor := selectConcurrentFailurePeer(
		t,
		concurrentOldLeader,
		connectionServerBeforeConcurrentFailure,
	)
	concurrentLeaderServer := servers[concurrentOldLeader]
	concurrentPeerServer := servers[concurrentPeer]
	if concurrentLeaderServer == nil || concurrentPeerServer == nil {
		t.Fatalf("concurrent failure servers = %q/%q do not match contract servers", concurrentOldLeader, concurrentPeer)
	}
	const concurrentStopSkewBudget = 250 * time.Millisecond
	concurrentStopSkew, err := stopClusterServersConcurrently(
		concurrentOldLeader,
		concurrentLeaderServer,
		concurrentPeer,
		concurrentPeerServer,
	)
	if err != nil {
		t.Fatalf("concurrently stop cluster servers: %v", err)
	}
	if concurrentStopSkew > concurrentStopSkewBudget {
		t.Fatalf("concurrent stop initiation skew = %s, want at most %s", concurrentStopSkew, concurrentStopSkewBudget)
	}
	connectionServerDuringConcurrentFailure := waitClusterConnectionOnServer(
		t,
		testContext,
		connection,
		concurrentSurvivor,
	)

	const concurrentFailureBudget = 3 * time.Second
	concurrentAttemptContext, cancelConcurrentAttempt := context.WithTimeout(testContext, 2*time.Second)
	concurrentFailureStarted := time.Now()
	concurrentPublishError := client.Publish(concurrentAttemptContext, queueclient.Message{
		Body:    []byte("must-not-commit-during-concurrent-failure"),
		Headers: map[string]string{"Tenant": "tenant-concurrent-rejected"},
	}, adapter.Publish)
	concurrentFailureElapsed := time.Since(concurrentFailureStarted)
	cancelConcurrentAttempt()
	if !errors.Is(concurrentPublishError, ErrPublish) {
		t.Fatalf("Publish(during concurrent failure) error = %v, want ErrPublish", concurrentPublishError)
	}
	if concurrentFailureElapsed > concurrentFailureBudget {
		t.Fatalf("Publish(during concurrent failure) elapsed = %s, want at most %s", concurrentFailureElapsed, concurrentFailureBudget)
	}

	servers[concurrentOldLeader] = startClusterServer(t, serverConfigs[concurrentOldLeader])
	concurrentRecoveredInfo := waitClusterStreamQuorumRecovered(
		t,
		testContext,
		source,
		concurrentPeer,
		9,
	)
	concurrentRecoveredLeader := concurrentRecoveredInfo.Cluster.Leader
	waitClusterStreamHandleAvailable(t, testContext, dlq, concurrentPeer)
	waitClusterConsumerHandleAvailable(t, testContext, sourceConsumer, concurrentPeer)
	waitClusterConsumerHandleAvailable(t, testContext, dlqConsumer, concurrentPeer)
	connectionServerAfterConcurrentRecovery := waitClusterConnectionAvailable(t, testContext, connection, concurrentPeer)

	concurrentRedelivered := waitClusterMessage(t, testContext, sourceConsumer, "concurrent failure recovery redelivery")
	concurrentRedeliveryMetadata, err := concurrentRedelivered.Metadata()
	if err != nil {
		t.Fatalf("Metadata(after concurrent failure recovery) error = %v", err)
	}
	if string(concurrentRedelivered.Data()) != "concurrent-failure-redelivery" || concurrentRedelivered.Headers().Get("Tenant") != "tenant-concurrent-redelivery" {
		t.Fatalf("concurrent failure redelivery body/header = %q/%q", concurrentRedelivered.Data(), concurrentRedelivered.Headers().Get("Tenant"))
	}
	if concurrentRedeliveryMetadata.Sequence.Stream != concurrentFirstMetadata.Sequence.Stream {
		t.Fatalf("concurrent failure recovery stream sequence = %d, want %d", concurrentRedeliveryMetadata.Sequence.Stream, concurrentFirstMetadata.Sequence.Stream)
	}
	if concurrentRedeliveryMetadata.NumDelivered < 2 {
		t.Fatalf("concurrent failure recovery delivery count = %d, want at least 2", concurrentRedeliveryMetadata.NumDelivered)
	}
	if err := concurrentRedelivered.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(concurrent failure recovery redelivery) error = %v", err)
	}
	requiredLeaseAfterConcurrent := calibrateExistingContractConsumer(t, testContext, js, sourceStream, sourceConsumer, client)
	if requiredLeaseAfterConcurrent != requiredLease {
		t.Fatalf("required lease after concurrent failure recovery = %s, want %s", requiredLeaseAfterConcurrent, requiredLease)
	}
	publishContractMessage(t, testContext, client, adapter, "published-after-concurrent-recovery", "tenant-concurrent-recovery")
	concurrentPostDelivery, err := adapter.ReceiveDelivery(testContext)
	if err != nil {
		t.Fatalf("ReceiveDelivery(after concurrent failure recovery) error = %v", err)
	}
	if string(concurrentPostDelivery.Message.Body) != "published-after-concurrent-recovery" || concurrentPostDelivery.Message.Headers["Tenant"] != "tenant-concurrent-recovery" {
		t.Fatalf("post-concurrent-recovery delivery = %#v", concurrentPostDelivery.Message)
	}
	if err := concurrentPostDelivery.Acknowledge(testContext); err != nil {
		t.Fatalf("Acknowledge(after concurrent failure recovery) error = %v", err)
	}

	sourceInfo = waitClusterConsumerDrained(t, testContext, sourceConsumer)
	concurrentFinalStreamInfo, err := source.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(after concurrent failure settlement) error = %v", err)
	}
	if concurrentFinalStreamInfo.State.Msgs != 10 {
		t.Fatalf("persisted source messages after concurrent failure recovery = %d, want 10", concurrentFinalStreamInfo.State.Msgs)
	}

	servers[concurrentPeer] = startClusterServer(t, serverConfigs[concurrentPeer])
	concurrentFinalReplicaInfo := waitClusterStreamReady(t, testContext, source, 3)
	waitClusterStreamReady(t, testContext, dlq, 3)
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)
	if concurrentFinalReplicaInfo.State.Msgs != 10 {
		t.Fatalf("persisted source messages after concurrent replica recovery = %d, want 10", concurrentFinalReplicaInfo.State.Msgs)
	}

	publishContractMessage(t, testContext, client, adapter, "network-partition-redelivery", "tenant-network-partition")
	partitionFirst, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(before network partition) error = %v", err)
	}
	if string(partitionFirst.Data()) != "network-partition-redelivery" || partitionFirst.Headers().Get("Tenant") != "tenant-network-partition" {
		t.Fatalf("first message before network partition = %q/%q", partitionFirst.Data(), partitionFirst.Headers().Get("Tenant"))
	}
	partitionFirstMetadata, err := partitionFirst.Metadata()
	if err != nil {
		t.Fatalf("Metadata(before network partition) error = %v", err)
	}
	if partitionFirstMetadata.Sequence.Stream != 11 || partitionFirstMetadata.NumDelivered != 1 {
		t.Fatalf("message before network partition sequence/delivery = %d/%d, want 11/1", partitionFirstMetadata.Sequence.Stream, partitionFirstMetadata.NumDelivered)
	}
	partitionPreFailureInfo := waitClusterStreamReady(t, testContext, source, 3)
	waitClusterStreamReady(t, testContext, dlq, 3)
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)
	if partitionPreFailureInfo.State.Msgs != 11 {
		t.Fatalf("persisted source messages before network partition = %d, want 11", partitionPreFailureInfo.State.Msgs)
	}
	networkPartitionConnectionServer := connection.ConnectedServerName()
	if partitionPreFailureInfo.Cluster.Leader == networkPartitionConnectionServer {
		preferredPartitionLeader := selectClusterServerExcept(networkPartitionConnectionServer)
		partitionPreFailureInfo = moveClusterStreamLeader(
			t,
			testContext,
			connection,
			source,
			sourceStream,
			preferredPartitionLeader,
			11,
		)
	}
	networkPartitionLeader := partitionPreFailureInfo.Cluster.Leader
	if networkPartitionLeader == networkPartitionConnectionServer {
		t.Fatalf("network partition stream leader = business connection server %q", networkPartitionConnectionServer)
	}
	routeProxyConnectionsBefore := waitClusterRouteProxyConnections(t, testContext, routeProxies, 3)
	routeProxyConnectionsClosed := disableClusterRouteProxies(routeProxies)
	waitClusterRouteProxiesDrained(t, testContext, routeProxies)
	partitionedServers := verifyClusterCoreServersAvailable(t, testContext, serverURLs)
	if partitionedServers != 3 {
		t.Fatalf("Core servers available during network partition = %d, want 3", partitionedServers)
	}
	if serverName := connection.ConnectedServerName(); connection.Status() != nats.CONNECTED || serverName != networkPartitionConnectionServer {
		t.Fatalf("business Core connection during network partition = %s/%q, want CONNECTED/%q", connection.Status(), serverName, networkPartitionConnectionServer)
	}

	const partitionFailureBudget = 3 * time.Second
	partitionAttemptContext, cancelPartitionAttempt := context.WithTimeout(testContext, 2*time.Second)
	partitionFailureStarted := time.Now()
	partitionPublishError := client.Publish(partitionAttemptContext, queueclient.Message{
		Body:    []byte("must-not-commit-during-network-partition"),
		Headers: map[string]string{"Tenant": "tenant-network-partition-rejected"},
	}, adapter.Publish)
	partitionFailureElapsed := time.Since(partitionFailureStarted)
	cancelPartitionAttempt()
	if !errors.Is(partitionPublishError, ErrPublish) {
		t.Fatalf("Publish(during network partition) error = %v, want ErrPublish", partitionPublishError)
	}
	if partitionFailureElapsed > partitionFailureBudget {
		t.Fatalf("Publish(during network partition) elapsed = %s, want at most %s", partitionFailureElapsed, partitionFailureBudget)
	}

	for _, proxy := range routeProxies {
		proxy.setEnabled(true)
	}
	partitionRecoveredInfo := waitClusterStreamReady(t, testContext, source, 3)
	waitClusterStreamReady(t, testContext, dlq, 3)
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)
	if partitionRecoveredInfo.State.Msgs != 11 {
		t.Fatalf("persisted source messages before post-partition publish = %d, want 11", partitionRecoveredInfo.State.Msgs)
	}
	partitionRecoveredLeader := partitionRecoveredInfo.Cluster.Leader
	connectionServerAfterPartitionRecovery := connection.ConnectedServerName()
	if connection.Status() != nats.CONNECTED || connectionServerAfterPartitionRecovery != networkPartitionConnectionServer {
		t.Fatalf("business Core connection after network partition recovery = %s/%q, want CONNECTED/%q", connection.Status(), connectionServerAfterPartitionRecovery, networkPartitionConnectionServer)
	}

	partitionRedelivered := waitClusterMessage(t, testContext, sourceConsumer, "network partition recovery redelivery")
	partitionRedeliveryMetadata, err := partitionRedelivered.Metadata()
	if err != nil {
		t.Fatalf("Metadata(after network partition recovery) error = %v", err)
	}
	if string(partitionRedelivered.Data()) != "network-partition-redelivery" || partitionRedelivered.Headers().Get("Tenant") != "tenant-network-partition" {
		t.Fatalf("network partition redelivery body/header = %q/%q", partitionRedelivered.Data(), partitionRedelivered.Headers().Get("Tenant"))
	}
	if partitionRedeliveryMetadata.Sequence.Stream != partitionFirstMetadata.Sequence.Stream {
		t.Fatalf("network partition recovery stream sequence = %d, want %d", partitionRedeliveryMetadata.Sequence.Stream, partitionFirstMetadata.Sequence.Stream)
	}
	if partitionRedeliveryMetadata.NumDelivered < 2 {
		t.Fatalf("network partition recovery delivery count = %d, want at least 2", partitionRedeliveryMetadata.NumDelivered)
	}
	if err := partitionRedelivered.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(network partition recovery redelivery) error = %v", err)
	}
	requiredLeaseAfterPartition := calibrateExistingContractConsumer(t, testContext, js, sourceStream, sourceConsumer, client)
	if requiredLeaseAfterPartition != requiredLease {
		t.Fatalf("required lease after network partition recovery = %s, want %s", requiredLeaseAfterPartition, requiredLease)
	}
	publishContractMessage(t, testContext, client, adapter, "published-after-network-partition-recovery", "tenant-network-partition-recovery")
	partitionPostDelivery, err := adapter.ReceiveDelivery(testContext)
	if err != nil {
		t.Fatalf("ReceiveDelivery(after network partition recovery) error = %v", err)
	}
	if string(partitionPostDelivery.Message.Body) != "published-after-network-partition-recovery" || partitionPostDelivery.Message.Headers["Tenant"] != "tenant-network-partition-recovery" {
		t.Fatalf("post-network-partition-recovery delivery = %#v", partitionPostDelivery.Message)
	}
	if err := partitionPostDelivery.Acknowledge(testContext); err != nil {
		t.Fatalf("Acknowledge(after network partition recovery) error = %v", err)
	}

	sourceInfo = waitClusterConsumerDrained(t, testContext, sourceConsumer)
	partitionFinalReplicaInfo := waitClusterStreamReady(t, testContext, source, 3)
	waitClusterStreamReady(t, testContext, dlq, 3)
	waitClusterConsumerReady(t, testContext, sourceConsumer, 3)
	waitClusterConsumerReady(t, testContext, dlqConsumer, 3)
	if partitionFinalReplicaInfo.State.Msgs != 12 {
		t.Fatalf("persisted source messages after network partition recovery = %d, want 12", partitionFinalReplicaInfo.State.Msgs)
	}
	select {
	case <-connectionEvents.closed:
		t.Fatal("business connection closed before the failover contract completed")
	default:
	}
	connection.Close()
	controlConnection.Close()
	for name, server := range servers {
		if err := server.stop(); err != nil {
			t.Fatalf("stop cluster server %s: %v", name, err)
		}
	}
	for index, proxy := range routeProxies {
		if err := proxy.close(); err != nil {
			t.Fatalf("stop cluster route proxy %d: %v", index+1, err)
		}
	}

	writeClusterReport(t, reportPath, clusterFailoverReport{
		SchemaVersion:                   6,
		Status:                          "passed",
		Storage:                         "file",
		ClusterSize:                     3,
		StreamReplicas:                  3,
		ConsumerReplicas:                3,
		AbruptLeaderStops:               3,
		OldLeader:                       oldLeader,
		NewLeader:                       newLeader,
		LeaderChanged:                   oldLeader != newLeader,
		PersistedBeforeFailover:         initialStreamInfo.State.Msgs,
		PersistedAfterFailover:          firstFailoverStreamInfo.State.Msgs,
		RecoveredStreamSequence:         redeliveryMetadata.Sequence.Stream,
		DeliveryCountBefore:             firstMetadata.NumDelivered,
		DeliveryCountAfter:              redeliveryMetadata.NumDelivered,
		RedeliveryObserved:              true,
		PublishedAfterFailover:          1,
		WorkerAcknowledged:              2,
		DeadLettered:                    1,
		SourceAckPending:                sourceInfo.NumAckPending,
		SourceMessagesPending:           sourceInfo.NumPending,
		SurvivingServers:                2,
		ShortLeaseRejected:              shortLeaseRejected,
		LeasePreflightPassed:            true,
		RequiredLeaseNanos:              requiredLease.Nanoseconds(),
		WorkerAckWaitNanos:              contractWorkerAckWait.Nanoseconds(),
		SameConnectionSession:           connection == originalConnection,
		DisconnectedObserved:            disconnectedObserved,
		ReconnectedObserved:             reconnectedObserved,
		ConnectionServerBefore:          connectionServerBefore,
		ConnectionServerAfter:           connectionServerAfter,
		AdapterSessionRecovered:         adapter == originalAdapter,
		RestartedServers:                3,
		ReplicaRecoveryPassed:           true,
		SecondOldLeader:                 secondOldLeader,
		SecondNewLeader:                 secondNewLeader,
		SecondLeaderChanged:             secondOldLeader != secondNewLeader,
		DistinctLeadersStopped:          oldLeader != secondOldLeader,
		PersistedAfterSecond:            secondFinalStreamInfo.State.Msgs,
		SecondRecoveredSequence:         secondRedeliveryMetadata.Sequence.Stream,
		SecondDeliveryBefore:            secondFirstMetadata.NumDelivered,
		SecondDeliveryAfter:             secondRedeliveryMetadata.NumDelivered,
		SecondRedeliveryObserved:        true,
		PublishedAfterSecond:            1,
		AcknowledgedAfterSecond:         2,
		SecondLeasePreflight:            requiredLeaseAfterSecond == requiredLease,
		ConnectionBeforeSecond:          connectionServerBeforeSecond,
		ConnectionAfterSecond:           connectionServerAfterSecond,
		SameSessionAfterSecond:          connection == originalConnection,
		AdapterRecoveredSecond:          adapter == originalAdapter,
		OverlappingOfflineServers:       2,
		QuorumUnavailableObserved:       true,
		QuorumFailureBudgetNanos:        quorumFailureBudget.Nanoseconds(),
		QuorumFailureElapsedNanos:       quorumFailureElapsed.Nanoseconds(),
		QuorumOldLeader:                 quorumOldLeader,
		QuorumRecoveredLeader:           quorumRecoveredLeader,
		PersistedAfterQuorumRecovery:    quorumFinalStreamInfo.State.Msgs,
		QuorumRecoveredSequence:         quorumRedeliveryMetadata.Sequence.Stream,
		QuorumDeliveryBefore:            quorumFirstMetadata.NumDelivered,
		QuorumDeliveryAfter:             quorumRedeliveryMetadata.NumDelivered,
		QuorumRedeliveryObserved:        true,
		PublishedAfterQuorumRecovery:    1,
		AcknowledgedAfterQuorumRecovery: 2,
		QuorumLeasePreflight:            requiredLeaseAfterQuorum == requiredLease,
		ConnectionBeforeQuorumLoss:      connectionServerBeforeQuorumLoss,
		ConnectionDuringQuorumLoss:      connectionServerDuringQuorumLoss,
		ConnectionAfterQuorumRecovery:   connectionServerAfterQuorumRecovery,
		SameSessionAfterQuorumRecovery:  connection == originalConnection,
		AdapterRecoveredAfterQuorum:     adapter == originalAdapter,
		FinalReplicaRecoveryPassed:      true,
		ConcurrentFaultInjected:         true,
		ConcurrentStoppedServers:        2,
		ConcurrentOldLeader:             concurrentOldLeader,
		ConcurrentStoppedPeer:           concurrentPeer,
		ConcurrentSurvivor:              concurrentSurvivor,
		ConcurrentRecoveredLeader:       concurrentRecoveredLeader,
		ConcurrentStopSkewBudgetNanos:   concurrentStopSkewBudget.Nanoseconds(),
		ConcurrentStopSkewNanos:         concurrentStopSkew.Nanoseconds(),
		ConcurrentQuorumUnavailable:     true,
		ConcurrentFailureBudgetNanos:    concurrentFailureBudget.Nanoseconds(),
		ConcurrentFailureElapsedNanos:   concurrentFailureElapsed.Nanoseconds(),
		PersistedAfterConcurrent:        concurrentFinalStreamInfo.State.Msgs,
		ConcurrentRecoveredSequence:     concurrentRedeliveryMetadata.Sequence.Stream,
		ConcurrentDeliveryBefore:        concurrentFirstMetadata.NumDelivered,
		ConcurrentDeliveryAfter:         concurrentRedeliveryMetadata.NumDelivered,
		ConcurrentRedeliveryObserved:    true,
		PublishedAfterConcurrent:        1,
		AcknowledgedAfterConcurrent:     2,
		ConcurrentLeasePreflight:        requiredLeaseAfterConcurrent == requiredLease,
		ConnectionBeforeConcurrent:      connectionServerBeforeConcurrentFailure,
		ConnectionDuringConcurrent:      connectionServerDuringConcurrentFailure,
		ConnectionAfterConcurrent:       connectionServerAfterConcurrentRecovery,
		SameSessionAfterConcurrent:      connection == originalConnection,
		AdapterRecoveredConcurrent:      adapter == originalAdapter,
		ConcurrentReplicaRecoveryPassed: true,
		NetworkPartitionInjected:        true,
		NetworkPartitionedServers:       partitionedServers,
		NetworkPartitionLeader:          networkPartitionLeader,
		NetworkPartitionConnection:      networkPartitionConnectionServer,
		RouteProxyConnectionsBefore:     routeProxyConnectionsBefore,
		RouteProxyConnectionsClosed:     routeProxyConnectionsClosed,
		PartitionQuorumUnavailable:      true,
		PartitionFailureBudgetNanos:     partitionFailureBudget.Nanoseconds(),
		PartitionFailureElapsedNanos:    partitionFailureElapsed.Nanoseconds(),
		PartitionRecoveredLeader:        partitionRecoveredLeader,
		PersistedAfterPartition:         partitionFinalReplicaInfo.State.Msgs,
		PartitionRecoveredSequence:      partitionRedeliveryMetadata.Sequence.Stream,
		PartitionDeliveryBefore:         partitionFirstMetadata.NumDelivered,
		PartitionDeliveryAfter:          partitionRedeliveryMetadata.NumDelivered,
		PartitionRedeliveryObserved:     true,
		PublishedAfterPartition:         1,
		AcknowledgedAfterPartition:      2,
		PartitionLeasePreflight:         requiredLeaseAfterPartition == requiredLease,
		ConnectionAfterPartition:        connectionServerAfterPartitionRecovery,
		SameSessionAfterPartition:       connection == originalConnection,
		AdapterRecoveredPartition:       adapter == originalAdapter,
		PartitionReplicaRecoveryPassed:  true,
	})
}

type clusterServerConfig struct {
	Binary           string
	Name             string
	ClientPort       int
	ClusterPort      int
	RoutePort        int
	AllRoutePorts    []int
	StorageDirectory string
	LogPath          string
}

type clusterContractServer struct {
	command *exec.Cmd
	logFile *os.File
}

type clusterRouteProxy struct {
	listener   net.Listener
	upstream   string
	mutex      sync.Mutex
	enabled    bool
	closed     bool
	active     map[*clusterRouteProxyConnection]struct{}
	acceptDone chan struct{}
	handlers   sync.WaitGroup
	closeOnce  sync.Once
	closeError error
}

type clusterRouteProxyConnection struct {
	downstream net.Conn
	upstream   net.Conn
	closeOnce  sync.Once
}

type clusterStopResult struct {
	name    string
	started time.Time
	err     error
}

func newClusterRouteProxy(listenPort, upstreamPort int) (*clusterRouteProxy, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(listenPort))
	if err != nil {
		return nil, err
	}
	proxy := &clusterRouteProxy{
		listener:   listener,
		upstream:   "127.0.0.1:" + strconv.Itoa(upstreamPort),
		enabled:    true,
		active:     make(map[*clusterRouteProxyConnection]struct{}),
		acceptDone: make(chan struct{}),
	}
	go proxy.accept()
	return proxy, nil
}

func (proxy *clusterRouteProxy) accept() {
	defer close(proxy.acceptDone)
	for {
		downstream, err := proxy.listener.Accept()
		if err != nil {
			proxy.mutex.Lock()
			closed := proxy.closed
			proxy.mutex.Unlock()
			if closed {
				return
			}
			continue
		}
		proxy.handlers.Add(1)
		go proxy.forward(downstream)
	}
}

func (proxy *clusterRouteProxy) forward(downstream net.Conn) {
	defer proxy.handlers.Done()
	proxy.mutex.Lock()
	enabled := proxy.enabled && !proxy.closed
	proxy.mutex.Unlock()
	if !enabled {
		_ = downstream.Close()
		return
	}
	upstream, err := net.DialTimeout("tcp4", proxy.upstream, 500*time.Millisecond)
	if err != nil {
		_ = downstream.Close()
		return
	}
	connection := &clusterRouteProxyConnection{downstream: downstream, upstream: upstream}
	proxy.mutex.Lock()
	if !proxy.enabled || proxy.closed {
		proxy.mutex.Unlock()
		connection.close()
		return
	}
	proxy.active[connection] = struct{}{}
	proxy.mutex.Unlock()
	defer func() {
		connection.close()
		proxy.mutex.Lock()
		delete(proxy.active, connection)
		proxy.mutex.Unlock()
	}()

	upstreamCopyDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(connection.upstream, connection.downstream)
		connection.close()
		close(upstreamCopyDone)
	}()
	_, _ = io.Copy(connection.downstream, connection.upstream)
	connection.close()
	<-upstreamCopyDone
}

func (connection *clusterRouteProxyConnection) close() {
	connection.closeOnce.Do(func() {
		_ = connection.downstream.Close()
		_ = connection.upstream.Close()
	})
}

func (proxy *clusterRouteProxy) setEnabled(enabled bool) int {
	proxy.mutex.Lock()
	if proxy.closed {
		proxy.mutex.Unlock()
		return 0
	}
	proxy.enabled = enabled
	if enabled {
		proxy.mutex.Unlock()
		return 0
	}
	connections := make([]*clusterRouteProxyConnection, 0, len(proxy.active))
	for connection := range proxy.active {
		connections = append(connections, connection)
	}
	proxy.mutex.Unlock()
	for _, connection := range connections {
		connection.close()
	}
	return len(connections)
}

func (proxy *clusterRouteProxy) activeConnections() int {
	proxy.mutex.Lock()
	defer proxy.mutex.Unlock()
	return len(proxy.active)
}

func (proxy *clusterRouteProxy) close() error {
	proxy.closeOnce.Do(func() {
		proxy.mutex.Lock()
		proxy.closed = true
		proxy.enabled = false
		connections := make([]*clusterRouteProxyConnection, 0, len(proxy.active))
		for connection := range proxy.active {
			connections = append(connections, connection)
		}
		proxy.mutex.Unlock()
		proxy.closeError = proxy.listener.Close()
		for _, connection := range connections {
			connection.close()
		}
		<-proxy.acceptDone
		proxy.handlers.Wait()
	})
	if errors.Is(proxy.closeError, net.ErrClosed) {
		return nil
	}
	return proxy.closeError
}

func totalClusterRouteProxyConnections(proxies []*clusterRouteProxy) int {
	total := 0
	for _, proxy := range proxies {
		total += proxy.activeConnections()
	}
	return total
}

func waitClusterRouteProxyConnections(
	t *testing.T,
	ctx context.Context,
	proxies []*clusterRouteProxy,
	minimum int,
) int {
	t.Helper()
	for {
		active := totalClusterRouteProxyConnections(proxies)
		if active >= minimum {
			return active
		}
		select {
		case <-ctx.Done():
			t.Fatalf("NATS route proxies have %d active connections, want at least %d", active, minimum)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func waitClusterRouteProxiesDrained(t *testing.T, ctx context.Context, proxies []*clusterRouteProxy) {
	t.Helper()
	for {
		active := totalClusterRouteProxyConnections(proxies)
		if active == 0 {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("NATS route proxies retained %d active connections after partition", active)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func disableClusterRouteProxies(proxies []*clusterRouteProxy) int {
	release := make(chan struct{})
	closedCounts := make(chan int, len(proxies))
	var ready sync.WaitGroup
	ready.Add(len(proxies))
	for _, proxy := range proxies {
		go func(proxy *clusterRouteProxy) {
			ready.Done()
			<-release
			closedCounts <- proxy.setEnabled(false)
		}(proxy)
	}
	ready.Wait()
	close(release)
	closed := 0
	for range proxies {
		closed += <-closedCounts
	}
	return closed
}

func verifyClusterCoreServersAvailable(t *testing.T, ctx context.Context, serverURLs []string) int {
	t.Helper()
	verified := 0
	for _, serverURL := range serverURLs {
		select {
		case <-ctx.Done():
			t.Fatal("cluster contract deadline reached while checking partitioned Core servers")
		default:
		}
		connection, err := nats.Connect(
			serverURL,
			nats.Name("goexample-network-partition-core-probe"),
			nats.Timeout(time.Second),
			nats.NoReconnect(),
		)
		if err != nil {
			t.Fatalf("connect Core probe to partitioned server %s: %v", serverURL, err)
		}
		flushError := connection.FlushTimeout(time.Second)
		connection.Close()
		if flushError != nil {
			t.Fatalf("flush Core probe to partitioned server %s: %v", serverURL, flushError)
		}
		verified++
	}
	return verified
}

func startClusterServer(t *testing.T, config clusterServerConfig) *clusterContractServer {
	t.Helper()
	if err := os.MkdirAll(config.StorageDirectory, 0o750); err != nil {
		t.Fatalf("create JetStream cluster storage directory: %v", err)
	}
	logFile, err := os.OpenFile(config.LogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
	if err != nil {
		t.Fatalf("create NATS cluster log: %v", err)
	}
	routes := make([]string, 0, len(config.AllRoutePorts)-1)
	for _, port := range config.AllRoutePorts {
		if port != config.RoutePort {
			routes = append(routes, "nats://127.0.0.1:"+strconv.Itoa(port))
		}
	}
	command := exec.Command(
		config.Binary,
		"-js",
		"-sd", config.StorageDirectory,
		"-a", "127.0.0.1",
		"-p", strconv.Itoa(config.ClientPort),
		"-n", config.Name,
		"--cluster_name", "goexample-jetstream-failover-contract",
		"--cluster", "nats://127.0.0.1:"+strconv.Itoa(config.ClusterPort),
		"--cluster_advertise", "127.0.0.1:"+strconv.Itoa(config.RoutePort),
		"--routes", strings.Join(routes, ","),
	)
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		t.Fatalf("start NATS cluster server %s: %v", config.Name, err)
	}
	return &clusterContractServer{command: command, logFile: logFile}
}

func (server *clusterContractServer) stop() error {
	if server == nil || server.command == nil || server.command.Process == nil {
		return nil
	}
	killError := server.command.Process.Kill()
	_ = server.command.Wait()
	closeError := server.logFile.Close()
	server.command = nil
	server.logFile = nil
	if killError != nil && !errors.Is(killError, os.ErrProcessDone) {
		return killError
	}
	return closeError
}

type clusterLeaderStepdownRequest struct {
	Placement clusterLeaderPlacement `json:"placement"`
}

type clusterLeaderPlacement struct {
	Preferred string `json:"preferred"`
}

type clusterLeaderStepdownResponse struct {
	Error *clusterLeaderStepdownError `json:"error,omitempty"`
}

type clusterLeaderStepdownError struct {
	Code int `json:"code"`
}

func selectClusterServerExcept(excluded string) string {
	for _, name := range []string{"goexample-js-node-1", "goexample-js-node-2", "goexample-js-node-3"} {
		if name != excluded {
			return name
		}
	}
	return ""
}

func moveClusterStreamLeader(
	t *testing.T,
	ctx context.Context,
	connection *nats.Conn,
	stream jetstream.Stream,
	streamName string,
	preferred string,
	expectedMessages uint64,
) *jetstream.StreamInfo {
	t.Helper()
	payload, err := json.Marshal(clusterLeaderStepdownRequest{
		Placement: clusterLeaderPlacement{Preferred: preferred},
	})
	if err != nil {
		t.Fatalf("marshal stream leader stepdown request: %v", err)
	}
	attemptContext, cancel := clusterAttemptContext(ctx)
	responseMessage, err := connection.RequestWithContext(
		attemptContext,
		"$JS.API.STREAM.LEADER.STEPDOWN."+streamName,
		payload,
	)
	cancel()
	if err != nil {
		t.Fatalf("request preferred stream leader %q: %v", preferred, err)
	}
	var response clusterLeaderStepdownResponse
	if err := json.Unmarshal(responseMessage.Data, &response); err != nil {
		t.Fatalf("decode preferred stream leader response: %v", err)
	}
	if response.Error != nil {
		t.Fatalf("preferred stream leader %q rejected with API code %d", preferred, response.Error.Code)
	}
	var lastInfo *jetstream.StreamInfo
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, infoError := stream.Info(attemptContext)
		cancel()
		if infoError == nil {
			lastInfo = info
			if info.State.Msgs == expectedMessages && info.Cluster != nil &&
				info.Cluster.Leader == preferred && clusterReady(info.Cluster, 3) {
				return info
			}
		}
		select {
		case <-ctx.Done():
			t.Fatalf("stream leader did not move to %q before deadline: %#v", preferred, lastInfo)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func selectConcurrentFailurePeer(t *testing.T, leader, connectionServer string) (string, string) {
	t.Helper()
	names := []string{"goexample-js-node-1", "goexample-js-node-2", "goexample-js-node-3"}
	peer := ""
	for _, name := range names {
		if name != leader && name != connectionServer {
			peer = name
			break
		}
	}
	if peer == "" {
		for _, name := range names {
			if name != leader {
				peer = name
				break
			}
		}
	}
	for _, name := range names {
		if name != leader && name != peer {
			return peer, name
		}
	}
	t.Fatalf("cannot select concurrent failure peer for leader %q and connection server %q", leader, connectionServer)
	return "", ""
}

func stopClusterServersConcurrently(
	firstName string,
	first *clusterContractServer,
	secondName string,
	second *clusterContractServer,
) (time.Duration, error) {
	release := make(chan struct{})
	results := make(chan clusterStopResult, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	stop := func(name string, server *clusterContractServer) {
		ready.Done()
		<-release
		started := time.Now()
		results <- clusterStopResult{name: name, started: started, err: server.stop()}
	}
	go stop(firstName, first)
	go stop(secondName, second)
	ready.Wait()
	close(release)
	firstResult := <-results
	secondResult := <-results
	skew := firstResult.started.Sub(secondResult.started)
	if skew < 0 {
		skew = -skew
	}
	var stopErrors []error
	if firstResult.err != nil {
		stopErrors = append(stopErrors, fmt.Errorf("stop %s: %w", firstResult.name, firstResult.err))
	}
	if secondResult.err != nil {
		stopErrors = append(stopErrors, fmt.Errorf("stop %s: %w", secondResult.name, secondResult.err))
	}
	return skew, errors.Join(stopErrors...)
}

func reserveClusterPorts(t *testing.T, count int) []int {
	t.Helper()
	listeners := make([]net.Listener, 0, count)
	ports := make([]int, 0, count)
	for index := 0; index < count; index++ {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			for _, opened := range listeners {
				_ = opened.Close()
			}
			t.Fatalf("reserve NATS cluster port: %v", err)
		}
		listeners = append(listeners, listener)
		ports = append(ports, listener.Addr().(*net.TCPAddr).Port)
	}
	for _, listener := range listeners {
		if err := listener.Close(); err != nil {
			t.Fatalf("release NATS cluster port: %v", err)
		}
	}
	return ports
}

func connectClusterJetStream(
	t *testing.T,
	ctx context.Context,
	serverURLs []string,
	additionalOptions ...nats.Option,
) *nats.Conn {
	t.Helper()
	options := []nats.Option{
		nats.Name("goexample-jetstream-cluster-failover-contract"),
		nats.Timeout(500 * time.Millisecond),
		nats.DontRandomize(),
		nats.ReconnectWait(50 * time.Millisecond),
		nats.MaxReconnects(-1),
	}
	options = append(options, additionalOptions...)
	for {
		connection, err := nats.Connect(strings.Join(serverURLs, ","), options...)
		if err == nil {
			return connection
		}
		select {
		case <-ctx.Done():
			t.Fatal("real JetStream cluster did not become ready before the contract deadline")
		case <-time.After(100 * time.Millisecond):
		}
	}
}

type clusterConnectionEvents struct {
	disconnected chan struct{}
	reconnected  chan struct{}
	closed       chan struct{}
	disconnect   sync.Once
	reconnect    sync.Once
	close        sync.Once
}

func newClusterConnectionEvents() *clusterConnectionEvents {
	return &clusterConnectionEvents{
		disconnected: make(chan struct{}),
		reconnected:  make(chan struct{}),
		closed:       make(chan struct{}),
	}
}

func (events *clusterConnectionEvents) options() []nats.Option {
	return []nats.Option{
		nats.DisconnectErrHandler(func(_ *nats.Conn, _ error) {
			events.disconnect.Do(func() { close(events.disconnected) })
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			events.reconnect.Do(func() { close(events.reconnected) })
		}),
		nats.ClosedHandler(func(_ *nats.Conn) {
			events.close.Do(func() { close(events.closed) })
		}),
	}
}

func waitClusterDiscoveredServers(t *testing.T, ctx context.Context, connection *nats.Conn, want int) {
	t.Helper()
	for {
		if len(connection.DiscoveredServers()) >= want {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("business connection discovered %d cluster servers, want at least %d", len(connection.DiscoveredServers()), want)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func waitClusterConnectionRecovered(
	t *testing.T,
	ctx context.Context,
	connection *nats.Conn,
	events *clusterConnectionEvents,
	stoppedServer string,
) (bool, bool, string) {
	t.Helper()
	select {
	case <-events.disconnected:
	case <-events.closed:
		t.Fatal("business connection closed instead of entering reconnect after leader failure")
	case <-ctx.Done():
		t.Fatal("business connection did not report disconnect before the cluster deadline")
	}
	select {
	case <-events.reconnected:
	case <-events.closed:
		t.Fatal("business connection closed before reconnecting to a surviving node")
	case <-ctx.Done():
		t.Fatal("business connection did not report reconnect before the cluster deadline")
	}
	for {
		serverName := connection.ConnectedServerName()
		if connection.Status() == nats.CONNECTED && serverName != "" && serverName != stoppedServer {
			return true, true, serverName
		}
		select {
		case <-events.closed:
			t.Fatal("business connection closed while waiting for a surviving server identity")
		case <-ctx.Done():
			t.Fatalf("business connection did not recover from server %q before the cluster deadline", stoppedServer)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func waitClusterConnectionAvailable(
	t *testing.T,
	ctx context.Context,
	connection *nats.Conn,
	stoppedServer string,
) string {
	t.Helper()
	for {
		serverName := connection.ConnectedServerName()
		if connection.Status() == nats.CONNECTED && serverName != "" && serverName != stoppedServer {
			return serverName
		}
		select {
		case <-ctx.Done():
			t.Fatalf("business connection did not remain available after stopping server %q", stoppedServer)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func waitClusterConnectionOnServer(
	t *testing.T,
	ctx context.Context,
	connection *nats.Conn,
	expectedServer string,
) string {
	t.Helper()
	for {
		serverName := connection.ConnectedServerName()
		if connection.Status() == nats.CONNECTED && serverName == expectedServer {
			return serverName
		}
		select {
		case <-ctx.Done():
			t.Fatalf("business connection did not remain on concurrent-failure survivor %q; last server %q", expectedServer, serverName)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func clusterAttemptContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, time.Second)
}

func openExistingClusterStream(
	t *testing.T,
	ctx context.Context,
	js jetstream.JetStream,
	streamName string,
) jetstream.Stream {
	t.Helper()
	var lastError error
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		stream, err := js.Stream(attemptContext, streamName)
		cancel()
		if err == nil {
			return stream
		}
		lastError = err
		select {
		case <-ctx.Done():
			t.Fatalf("Stream(%s) on business connection before cluster deadline: %v", streamName, lastError)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func openExistingClusterConsumer(
	t *testing.T,
	ctx context.Context,
	js jetstream.JetStream,
	streamName string,
	consumerName string,
) jetstream.Consumer {
	t.Helper()
	var lastError error
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		consumer, err := js.Consumer(attemptContext, streamName, consumerName)
		cancel()
		if err == nil {
			return consumer
		}
		lastError = err
		select {
		case <-ctx.Done():
			t.Fatalf("Consumer(%s/%s) on business connection before cluster deadline: %v", streamName, consumerName, lastError)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func createClusterStream(t *testing.T, ctx context.Context, js jetstream.JetStream, name, subject string) jetstream.Stream {
	t.Helper()
	config := jetstream.StreamConfig{
		Name:       name,
		Subjects:   []string{subject},
		Retention:  jetstream.LimitsPolicy,
		MaxMsgs:    100,
		MaxBytes:   1 << 20,
		MaxAge:     time.Minute,
		Discard:    jetstream.DiscardNew,
		Storage:    jetstream.FileStorage,
		Replicas:   3,
		Duplicates: time.Minute,
	}
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		stream, err := js.CreateOrUpdateStream(attemptContext, config)
		cancel()
		if err == nil {
			return stream
		}
		select {
		case <-ctx.Done():
			t.Fatalf("CreateOrUpdateStream(%s) before cluster deadline: %v", name, err)
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func createClusterConsumer(
	t *testing.T,
	ctx context.Context,
	js jetstream.JetStream,
	streamName string,
	config jetstream.ConsumerConfig,
) jetstream.Consumer {
	t.Helper()
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		consumer, err := js.CreateOrUpdateConsumer(attemptContext, streamName, config)
		cancel()
		if err == nil {
			return consumer
		}
		select {
		case <-ctx.Done():
			t.Fatalf("CreateOrUpdateConsumer(%s/%s) before cluster deadline: %v", streamName, config.Name, err)
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func waitClusterStreamReady(t *testing.T, ctx context.Context, stream jetstream.Stream, replicas int) *jetstream.StreamInfo {
	t.Helper()
	var lastInfo *jetstream.StreamInfo
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, err := stream.Info(attemptContext)
		cancel()
		if err == nil {
			lastInfo = info
			if clusterReady(info.Cluster, replicas) {
				return info
			}
		}
		select {
		case <-ctx.Done():
			t.Fatalf("stream cluster did not reach %d current replicas: %#v", replicas, lastInfo)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func waitClusterConsumerReady(t *testing.T, ctx context.Context, consumer jetstream.Consumer, replicas int) *jetstream.ConsumerInfo {
	t.Helper()
	var lastInfo *jetstream.ConsumerInfo
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, err := consumer.Info(attemptContext)
		cancel()
		if err == nil {
			lastInfo = info
			if info.Config.Replicas == replicas && clusterReady(info.Cluster, replicas) {
				return info
			}
		}
		select {
		case <-ctx.Done():
			t.Fatalf("consumer cluster did not reach %d current replicas: %#v", replicas, lastInfo)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func clusterReady(info *jetstream.ClusterInfo, replicas int) bool {
	if info == nil || info.Leader == "" || len(info.Replicas) != replicas-1 {
		return false
	}
	for _, peer := range info.Replicas {
		if peer == nil || !peer.Current || peer.Offline || peer.Lag != 0 {
			return false
		}
	}
	return true
}

func waitClusterStreamLeaderChange(
	t *testing.T,
	ctx context.Context,
	stream jetstream.Stream,
	oldLeader string,
	expectedMessages uint64,
) *jetstream.StreamInfo {
	t.Helper()
	var lastLeader string
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, err := stream.Info(attemptContext)
		cancel()
		if err == nil {
			if info.Cluster != nil {
				lastLeader = info.Cluster.Leader
				if lastLeader != "" && lastLeader != oldLeader && info.State.Msgs == expectedMessages {
					return info
				}
			}
		}
		select {
		case <-ctx.Done():
			t.Fatalf("stream leader did not change from %q before deadline; last leader %q", oldLeader, lastLeader)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func waitClusterStreamQuorumRecovered(
	t *testing.T,
	ctx context.Context,
	stream jetstream.Stream,
	offlineServer string,
	expectedMessages uint64,
) *jetstream.StreamInfo {
	t.Helper()
	var lastInfo *jetstream.StreamInfo
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, err := stream.Info(attemptContext)
		cancel()
		if err == nil {
			lastInfo = info
			if info.State.Msgs == expectedMessages && clusterAvailable(info.Cluster, offlineServer) {
				return info
			}
		}
		select {
		case <-ctx.Done():
			t.Fatalf("stream quorum did not recover with %d messages: %#v", expectedMessages, lastInfo)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func waitClusterConsumerHandleAvailable(
	t *testing.T,
	ctx context.Context,
	consumer jetstream.Consumer,
	stoppedServer string,
) *jetstream.ConsumerInfo {
	t.Helper()
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, err := consumer.Info(attemptContext)
		cancel()
		if err == nil && clusterAvailable(info.Cluster, stoppedServer) {
			return info
		}
		select {
		case <-ctx.Done():
			t.Fatal("existing consumer handle did not recover before the cluster deadline")
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func waitClusterStreamHandleAvailable(
	t *testing.T,
	ctx context.Context,
	stream jetstream.Stream,
	stoppedServer string,
) *jetstream.StreamInfo {
	t.Helper()
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, err := stream.Info(attemptContext)
		cancel()
		if err == nil && clusterAvailable(info.Cluster, stoppedServer) {
			return info
		}
		select {
		case <-ctx.Done():
			t.Fatal("existing stream handle did not recover before the cluster deadline")
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func calibrateExistingContractConsumer(
	t *testing.T,
	ctx context.Context,
	js jetstream.JetStream,
	streamName string,
	consumer jetstream.Consumer,
	client *queueclient.Client,
) time.Duration {
	t.Helper()
	var (
		info      *jetstream.ConsumerInfo
		lastError error
	)
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, lastError = consumer.Info(attemptContext)
		cancel()
		if lastError == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("Info(existing consumer before lease calibration) did not recover: %v", lastError)
		case <-time.After(50 * time.Millisecond):
		}
	}
	config := info.Config
	config.AckWait = contractWorkerAckWait
	config.BackOff = nil
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		_, lastError = js.UpdateConsumer(attemptContext, streamName, config)
		cancel()
		if lastError == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("UpdateConsumer(existing delivery lease) did not recover: %v", lastError)
		case <-time.After(50 * time.Millisecond):
		}
	}
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		required, err := PreflightConsumer(
			attemptContext,
			consumer,
			client,
			contractWorkerRetry,
			contractLeaseSafetyMargin,
		)
		cancel()
		if err == nil {
			return required
		}
		lastError = err
		select {
		case <-ctx.Done():
			t.Fatalf("PreflightConsumer(existing consumer after lease calibration) did not recover: %v", lastError)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func clusterAvailable(info *jetstream.ClusterInfo, stoppedServer string) bool {
	if info == nil || info.Leader == "" || info.Leader == stoppedServer {
		return false
	}
	for _, peer := range info.Replicas {
		if peer != nil && peer.Name != stoppedServer && peer.Current && !peer.Offline && peer.Lag == 0 {
			return true
		}
	}
	return false
}

func waitClusterConsumerDrained(t *testing.T, ctx context.Context, consumer jetstream.Consumer) *jetstream.ConsumerInfo {
	t.Helper()
	for {
		attemptContext, cancel := clusterAttemptContext(ctx)
		info, err := consumer.Info(attemptContext)
		cancel()
		if err == nil && info.NumAckPending == 0 && info.NumPending == 0 {
			return info
		}
		select {
		case <-ctx.Done():
			t.Fatal("source consumer did not drain before cluster deadline")
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func waitClusterMessage(
	t *testing.T,
	ctx context.Context,
	consumer jetstream.Consumer,
	description string,
) jetstream.Msg {
	t.Helper()
	var lastError error
	for {
		message, err := consumer.Next(jetstream.FetchMaxWait(5 * time.Second))
		if err == nil {
			return message
		}
		lastError = err
		select {
		case <-ctx.Done():
			t.Fatalf("timed out waiting for %s: %v", description, lastError)
		default:
		}
	}
}

type failoverDeliveryObserver struct {
	acknowledged     chan struct{}
	deadLettered     chan struct{}
	settlementFailed chan struct{}
}

func newFailoverDeliveryObserver() *failoverDeliveryObserver {
	return &failoverDeliveryObserver{
		acknowledged:     make(chan struct{}, 2),
		deadLettered:     make(chan struct{}, 1),
		settlementFailed: make(chan struct{}, 1),
	}
}

func (observer *failoverDeliveryObserver) DeliveryAcknowledged() {
	observer.acknowledged <- struct{}{}
}

func (*failoverDeliveryObserver) DeliveryRetried() {}

func (observer *failoverDeliveryObserver) DeliveryDeadLettered() {
	observer.deadLettered <- struct{}{}
}

func (observer *failoverDeliveryObserver) DeliverySettlementFailed() {
	observer.settlementFailed <- struct{}{}
}

func waitFailoverSettlements(
	t *testing.T,
	ctx context.Context,
	observer *failoverDeliveryObserver,
	workerDone <-chan error,
	wantAcknowledged int,
	wantDeadLettered int,
) {
	t.Helper()
	acknowledged := 0
	deadLettered := 0
	for acknowledged < wantAcknowledged || deadLettered < wantDeadLettered {
		select {
		case <-observer.acknowledged:
			acknowledged++
		case <-observer.deadLettered:
			deadLettered++
		case <-observer.settlementFailed:
			t.Fatalf("JetStream settlement failed after leader failover (acknowledged=%d deadLettered=%d)", acknowledged, deadLettered)
		case err := <-workerDone:
			t.Fatalf("WorkerGroup stopped before post-failover settlement converged (acknowledged=%d deadLettered=%d): %v", acknowledged, deadLettered, err)
		case <-ctx.Done():
			t.Fatalf("timed out waiting for post-failover settlement (acknowledged=%d deadLettered=%d)", acknowledged, deadLettered)
		}
	}
}

type clusterFailoverReport struct {
	SchemaVersion                   int    `json:"schemaVersion"`
	Status                          string `json:"status"`
	Storage                         string `json:"storage"`
	ClusterSize                     int    `json:"clusterSize"`
	StreamReplicas                  int    `json:"streamReplicas"`
	ConsumerReplicas                int    `json:"consumerReplicas"`
	AbruptLeaderStops               int    `json:"abruptLeaderStops"`
	OldLeader                       string `json:"oldLeader"`
	NewLeader                       string `json:"newLeader"`
	LeaderChanged                   bool   `json:"leaderChanged"`
	PersistedBeforeFailover         uint64 `json:"persistedBeforeFailover"`
	PersistedAfterFailover          uint64 `json:"persistedAfterFailover"`
	RecoveredStreamSequence         uint64 `json:"recoveredStreamSequence"`
	DeliveryCountBefore             uint64 `json:"deliveryCountBefore"`
	DeliveryCountAfter              uint64 `json:"deliveryCountAfter"`
	RedeliveryObserved              bool   `json:"redeliveryObserved"`
	PublishedAfterFailover          int    `json:"publishedAfterFailover"`
	WorkerAcknowledged              int    `json:"workerAcknowledged"`
	DeadLettered                    int    `json:"deadLettered"`
	SourceAckPending                int    `json:"sourceAckPending"`
	SourceMessagesPending           uint64 `json:"sourceMessagesPending"`
	SurvivingServers                int    `json:"survivingServers"`
	ShortLeaseRejected              bool   `json:"shortLeaseRejected"`
	LeasePreflightPassed            bool   `json:"leasePreflightPassed"`
	RequiredLeaseNanos              int64  `json:"requiredLeaseNanos"`
	WorkerAckWaitNanos              int64  `json:"workerAckWaitNanos"`
	SameConnectionSession           bool   `json:"sameConnectionSession"`
	DisconnectedObserved            bool   `json:"disconnectedObserved"`
	ReconnectedObserved             bool   `json:"reconnectedObserved"`
	ConnectionServerBefore          string `json:"connectionServerBefore"`
	ConnectionServerAfter           string `json:"connectionServerAfter"`
	AdapterSessionRecovered         bool   `json:"adapterSessionRecovered"`
	RestartedServers                int    `json:"restartedServers"`
	ReplicaRecoveryPassed           bool   `json:"replicaRecoveryPassed"`
	SecondOldLeader                 string `json:"secondOldLeader"`
	SecondNewLeader                 string `json:"secondNewLeader"`
	SecondLeaderChanged             bool   `json:"secondLeaderChanged"`
	DistinctLeadersStopped          bool   `json:"distinctLeadersStopped"`
	PersistedAfterSecond            uint64 `json:"persistedAfterSecondFailover"`
	SecondRecoveredSequence         uint64 `json:"secondRecoveredStreamSequence"`
	SecondDeliveryBefore            uint64 `json:"secondDeliveryCountBefore"`
	SecondDeliveryAfter             uint64 `json:"secondDeliveryCountAfter"`
	SecondRedeliveryObserved        bool   `json:"secondRedeliveryObserved"`
	PublishedAfterSecond            int    `json:"publishedAfterSecondFailover"`
	AcknowledgedAfterSecond         int    `json:"acknowledgedAfterSecondFailover"`
	SecondLeasePreflight            bool   `json:"secondLeasePreflightPassed"`
	ConnectionBeforeSecond          string `json:"connectionServerBeforeSecondFailover"`
	ConnectionAfterSecond           string `json:"connectionServerAfterSecondFailover"`
	SameSessionAfterSecond          bool   `json:"sameConnectionSessionAfterSecondFailover"`
	AdapterRecoveredSecond          bool   `json:"adapterSessionRecoveredAfterSecondFailover"`
	OverlappingOfflineServers       int    `json:"overlappingOfflineServers"`
	QuorumUnavailableObserved       bool   `json:"quorumUnavailableObserved"`
	QuorumFailureBudgetNanos        int64  `json:"quorumFailureBudgetNanos"`
	QuorumFailureElapsedNanos       int64  `json:"quorumFailureElapsedNanos"`
	QuorumOldLeader                 string `json:"quorumOldLeader"`
	QuorumRecoveredLeader           string `json:"quorumRecoveredLeader"`
	PersistedAfterQuorumRecovery    uint64 `json:"persistedAfterQuorumRecovery"`
	QuorumRecoveredSequence         uint64 `json:"quorumRecoveredStreamSequence"`
	QuorumDeliveryBefore            uint64 `json:"quorumDeliveryCountBefore"`
	QuorumDeliveryAfter             uint64 `json:"quorumDeliveryCountAfter"`
	QuorumRedeliveryObserved        bool   `json:"quorumRedeliveryObserved"`
	PublishedAfterQuorumRecovery    int    `json:"publishedAfterQuorumRecovery"`
	AcknowledgedAfterQuorumRecovery int    `json:"acknowledgedAfterQuorumRecovery"`
	QuorumLeasePreflight            bool   `json:"quorumLeasePreflightPassed"`
	ConnectionBeforeQuorumLoss      string `json:"connectionServerBeforeQuorumLoss"`
	ConnectionDuringQuorumLoss      string `json:"connectionServerDuringQuorumLoss"`
	ConnectionAfterQuorumRecovery   string `json:"connectionServerAfterQuorumRecovery"`
	SameSessionAfterQuorumRecovery  bool   `json:"sameConnectionSessionAfterQuorumRecovery"`
	AdapterRecoveredAfterQuorum     bool   `json:"adapterSessionRecoveredAfterQuorumRecovery"`
	FinalReplicaRecoveryPassed      bool   `json:"finalReplicaRecoveryPassed"`
	ConcurrentFaultInjected         bool   `json:"concurrentFaultInjected"`
	ConcurrentStoppedServers        int    `json:"concurrentStoppedServers"`
	ConcurrentOldLeader             string `json:"concurrentOldLeader"`
	ConcurrentStoppedPeer           string `json:"concurrentStoppedPeer"`
	ConcurrentSurvivor              string `json:"concurrentSurvivor"`
	ConcurrentRecoveredLeader       string `json:"concurrentRecoveredLeader"`
	ConcurrentStopSkewBudgetNanos   int64  `json:"concurrentStopSkewBudgetNanos"`
	ConcurrentStopSkewNanos         int64  `json:"concurrentStopSkewNanos"`
	ConcurrentQuorumUnavailable     bool   `json:"concurrentQuorumUnavailableObserved"`
	ConcurrentFailureBudgetNanos    int64  `json:"concurrentFailureBudgetNanos"`
	ConcurrentFailureElapsedNanos   int64  `json:"concurrentFailureElapsedNanos"`
	PersistedAfterConcurrent        uint64 `json:"persistedAfterConcurrentRecovery"`
	ConcurrentRecoveredSequence     uint64 `json:"concurrentRecoveredStreamSequence"`
	ConcurrentDeliveryBefore        uint64 `json:"concurrentDeliveryCountBefore"`
	ConcurrentDeliveryAfter         uint64 `json:"concurrentDeliveryCountAfter"`
	ConcurrentRedeliveryObserved    bool   `json:"concurrentRedeliveryObserved"`
	PublishedAfterConcurrent        int    `json:"publishedAfterConcurrentRecovery"`
	AcknowledgedAfterConcurrent     int    `json:"acknowledgedAfterConcurrentRecovery"`
	ConcurrentLeasePreflight        bool   `json:"concurrentLeasePreflightPassed"`
	ConnectionBeforeConcurrent      string `json:"connectionServerBeforeConcurrentFailure"`
	ConnectionDuringConcurrent      string `json:"connectionServerDuringConcurrentFailure"`
	ConnectionAfterConcurrent       string `json:"connectionServerAfterConcurrentRecovery"`
	SameSessionAfterConcurrent      bool   `json:"sameConnectionSessionAfterConcurrentRecovery"`
	AdapterRecoveredConcurrent      bool   `json:"adapterSessionRecoveredAfterConcurrentRecovery"`
	ConcurrentReplicaRecoveryPassed bool   `json:"concurrentReplicaRecoveryPassed"`
	NetworkPartitionInjected        bool   `json:"networkPartitionInjected"`
	NetworkPartitionedServers       int    `json:"networkPartitionedServers"`
	NetworkPartitionLeader          string `json:"networkPartitionLeader"`
	NetworkPartitionConnection      string `json:"networkPartitionConnectionServer"`
	RouteProxyConnectionsBefore     int    `json:"routeProxyConnectionsBefore"`
	RouteProxyConnectionsClosed     int    `json:"routeProxyConnectionsClosed"`
	PartitionQuorumUnavailable      bool   `json:"partitionQuorumUnavailableObserved"`
	PartitionFailureBudgetNanos     int64  `json:"partitionFailureBudgetNanos"`
	PartitionFailureElapsedNanos    int64  `json:"partitionFailureElapsedNanos"`
	PartitionRecoveredLeader        string `json:"partitionRecoveredLeader"`
	PersistedAfterPartition         uint64 `json:"persistedAfterPartitionRecovery"`
	PartitionRecoveredSequence      uint64 `json:"partitionRecoveredStreamSequence"`
	PartitionDeliveryBefore         uint64 `json:"partitionDeliveryCountBefore"`
	PartitionDeliveryAfter          uint64 `json:"partitionDeliveryCountAfter"`
	PartitionRedeliveryObserved     bool   `json:"partitionRedeliveryObserved"`
	PublishedAfterPartition         int    `json:"publishedAfterPartitionRecovery"`
	AcknowledgedAfterPartition      int    `json:"acknowledgedAfterPartitionRecovery"`
	PartitionLeasePreflight         bool   `json:"partitionLeasePreflightPassed"`
	ConnectionAfterPartition        string `json:"connectionServerAfterPartitionRecovery"`
	SameSessionAfterPartition       bool   `json:"sameConnectionSessionAfterPartitionRecovery"`
	AdapterRecoveredPartition       bool   `json:"adapterSessionRecoveredAfterPartitionRecovery"`
	PartitionReplicaRecoveryPassed  bool   `json:"partitionReplicaRecoveryPassed"`
}

func writeClusterReport(t *testing.T, path string, report clusterFailoverReport) {
	t.Helper()
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("marshal cluster failover report: %v", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o640); err != nil {
		t.Fatalf("write cluster failover report: %v", err)
	}
}
