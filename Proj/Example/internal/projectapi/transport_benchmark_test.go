package projectapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/http/httputil"
	"net/url"
	"os"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Proj/Example/internal/projectapp"
)

type transportServer struct {
	baseURL string
}

type projectEnvelope struct {
	Code int             `json:"code"`
	Data projectResponse `json:"data"`
	Msg  string          `json:"msg"`
}

type transportLatencyMeasurement struct {
	SchemaVersion int     `json:"schemaVersion"`
	Transport     string  `json:"transport"`
	Requests      int     `json:"requests"`
	Concurrency   int     `json:"concurrency"`
	PayloadBytes  int64   `json:"payloadBytes"`
	ThroughputRPS float64 `json:"throughputRps"`
	P50Nanos      int64   `json:"p50Nanos"`
	P95Nanos      int64   `json:"p95Nanos"`
	P99Nanos      int64   `json:"p99Nanos"`
	ErrorRate     float64 `json:"errorRate"`
}

type transportCapacityWorkload struct {
	Name              string
	Requests          int
	Concurrency       int
	DisableKeepAlives bool
}

type transportCapacityMeasurement struct {
	SchemaVersion             int     `json:"schemaVersion"`
	Transport                 string  `json:"transport"`
	Workload                  string  `json:"workload"`
	Requests                  int     `json:"requests"`
	Concurrency               int     `json:"concurrency"`
	KeepAlive                 bool    `json:"keepAlive"`
	PayloadBytes              int64   `json:"payloadBytes"`
	ThroughputRPS             float64 `json:"throughputRps"`
	P50Nanos                  int64   `json:"p50Nanos"`
	P95Nanos                  int64   `json:"p95Nanos"`
	P99Nanos                  int64   `json:"p99Nanos"`
	ConnectionWaitP95Nanos    int64   `json:"connectionWaitP95Nanos"`
	ErrorCount                int64   `json:"errorCount"`
	ErrorRate                 float64 `json:"errorRate"`
	ConnectionDials           int64   `json:"connectionDials"`
	MaxInFlight               int64   `json:"maxInFlight"`
	TotalAllocBytes           uint64  `json:"totalAllocBytes"`
	Mallocs                   uint64  `json:"mallocs"`
	GCCycles                  uint32  `json:"gcCycles"`
	GCPauseNanos              uint64  `json:"gcPauseNanos"`
	GoroutinesBefore          int     `json:"goroutinesBefore"`
	GoroutinesAfter           int     `json:"goroutinesAfter"`
	OpenFileDescriptorsBefore int     `json:"openFileDescriptorsBefore"`
	OpenFileDescriptorsAfter  int     `json:"openFileDescriptorsAfter"`
}

type transportSoakWindow struct {
	Index         int     `json:"index"`
	DurationNanos int64   `json:"durationNanos"`
	Requests      int64   `json:"requests"`
	ErrorCount    int64   `json:"errorCount"`
	ThroughputRPS float64 `json:"throughputRps"`
}

type transportSoakMeasurement struct {
	SchemaVersion              int                   `json:"schemaVersion"`
	Transport                  string                `json:"transport"`
	TargetDurationNanos        int64                 `json:"targetDurationNanos"`
	ElapsedNanos               int64                 `json:"elapsedNanos"`
	Requests                   int64                 `json:"requests"`
	Concurrency                int                   `json:"concurrency"`
	PayloadBytes               int64                 `json:"payloadBytes"`
	ThroughputRPS              float64               `json:"throughputRps"`
	P95Nanos                   int64                 `json:"p95Nanos"`
	P99Nanos                   int64                 `json:"p99Nanos"`
	ErrorCount                 int64                 `json:"errorCount"`
	ErrorRate                  float64               `json:"errorRate"`
	ConnectionDials            int64                 `json:"connectionDials"`
	GCCycles                   uint32                `json:"gcCycles"`
	GCPauseNanos               uint64                `json:"gcPauseNanos"`
	GoroutinesBefore           int                   `json:"goroutinesBefore"`
	GoroutinesAfter            int                   `json:"goroutinesAfter"`
	GoroutinesSettled          int                   `json:"goroutinesSettled"`
	HeapInUseBytesBefore       uint64                `json:"heapInUseBytesBefore"`
	HeapInUseBytesAfter        uint64                `json:"heapInUseBytesAfter"`
	HeapInUseBytesSettled      uint64                `json:"heapInUseBytesSettled"`
	OpenFileDescriptorsBefore  int                   `json:"openFileDescriptorsBefore"`
	OpenFileDescriptorsAfter   int                   `json:"openFileDescriptorsAfter"`
	OpenFileDescriptorsSettled int                   `json:"openFileDescriptorsSettled"`
	Windows                    []transportSoakWindow `json:"windows"`
}

type transportSoakWindowCounters struct {
	requests   atomic.Int64
	errorCount atomic.Int64
}

func TestProjectTransportsReturnTheSameEnvelopeOverTCP(t *testing.T) {
	project := projectapp.Project{Name: "Example", Environment: "benchmark", Version: "v1"}
	service := projectapp.NewService(project)
	servers := []struct {
		name  string
		start func(testing.TB, *projectapp.Service) transportServer
	}{
		{name: "fiber", start: startFiberTransport},
		{name: "net-http", start: startNetHTTPTransport},
	}

	for _, candidate := range servers {
		t.Run(candidate.name, func(t *testing.T) {
			server := candidate.start(t, service)
			response, err := newTransportClient(t).Get(server.baseURL + "/api/v1/project")
			if err != nil {
				t.Fatalf("GET project: %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d", response.StatusCode)
			}
			var envelope projectEnvelope
			if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if envelope.Code != 0 || envelope.Msg != "success" || envelope.Data != (projectResponse{
				Name:        project.Name,
				Environment: project.Environment,
				Version:     project.Version,
			}) {
				t.Fatalf("response = %#v", envelope)
			}
		})
	}
}

func TestNetHTTPTransportSupportsHTTP2(t *testing.T) {
	project := projectapp.Project{Name: "Example", Environment: "h2", Version: "v1"}
	server := httptest.NewUnstartedServer(newNetHTTPHandler(projectapp.NewService(project)))
	server.EnableHTTP2 = true
	server.StartTLS()
	t.Cleanup(server.Close)

	response, err := server.Client().Get(server.URL + "/api/v1/project")
	if err != nil {
		t.Fatalf("GET project over HTTP/2: %v", err)
	}
	defer response.Body.Close()
	if response.ProtoMajor != 2 || response.StatusCode != http.StatusOK {
		t.Fatalf("response protocol/status = HTTP/%d.%d %d", response.ProtoMajor, response.ProtoMinor, response.StatusCode)
	}
	var envelope projectEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode HTTP/2 response: %v", err)
	}
	if envelope.Code != 0 || envelope.Msg != "success" || envelope.Data != (projectResponse{
		Name:        project.Name,
		Environment: project.Environment,
		Version:     project.Version,
	}) {
		t.Fatalf("HTTP/2 response = %#v", envelope)
	}
}

func TestHTTP2EdgeToFiberHTTP1Contract(t *testing.T) {
	project := projectapp.Project{Name: "Example", Environment: "edge", Version: "v1"}
	upstream := startFiberTransport(t, projectapp.NewService(project))
	upstreamURL, err := url.Parse(upstream.baseURL)
	if err != nil {
		t.Fatalf("parse Fiber upstream URL: %v", err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstreamURL)
	proxy.Transport = &http.Transport{
		MaxIdleConns:        16,
		MaxIdleConnsPerHost: 16,
		DisableCompression:  true,
	}
	edge := httptest.NewUnstartedServer(proxy)
	edge.EnableHTTP2 = true
	edge.StartTLS()
	t.Cleanup(func() {
		edge.CloseClientConnections()
		edge.Close()
		proxy.Transport.(*http.Transport).CloseIdleConnections()
	})

	response, err := edge.Client().Get(edge.URL + "/api/v1/project")
	if err != nil {
		t.Fatalf("GET project through HTTP/2 edge: %v", err)
	}
	defer response.Body.Close()
	if response.ProtoMajor != 2 || response.StatusCode != http.StatusOK {
		t.Fatalf("edge response protocol/status = HTTP/%d.%d %d", response.ProtoMajor, response.ProtoMinor, response.StatusCode)
	}
	var envelope projectEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode edge response: %v", err)
	}
	if envelope.Code != 0 || envelope.Msg != "success" || envelope.Data != (projectResponse{
		Name:        project.Name,
		Environment: project.Environment,
		Version:     project.Version,
	}) {
		t.Fatalf("edge response = %#v", envelope)
	}
}

func TestProjectTransportLatencyTCP(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("comparable transport latency measurements run only on the fixed Linux target")
	}

	const (
		requestCount = 2000
		concurrency  = 16
	)
	project := projectapp.Project{Name: "Example", Environment: "benchmark", Version: "v1"}
	servers := []struct {
		name  string
		start func(testing.TB, *projectapp.Service) transportServer
	}{
		{name: "fiber", start: startFiberTransport},
		{name: "net-http", start: startNetHTTPTransport},
	}

	for _, candidate := range servers {
		t.Run(candidate.name, func(t *testing.T) {
			server := candidate.start(t, projectapp.NewService(project))
			client := newTransportClient(t)
			url := server.baseURL + "/api/v1/project"
			payloadBytes, _, err := requestProjectMeasurement(client, url)
			if err != nil {
				t.Fatalf("measure project payload: %v", err)
			}
			for range 100 {
				if err := requestProject(client, url); err != nil {
					t.Fatalf("warm project request: %v", err)
				}
			}

			jobs := make(chan int, requestCount)
			for index := range requestCount {
				jobs <- index
			}
			close(jobs)
			latencies := make([]time.Duration, requestCount)
			var errorCount atomic.Int64
			firstError := make(chan error, 1)
			var workers sync.WaitGroup
			started := time.Now()
			for range concurrency {
				workers.Add(1)
				go func() {
					defer workers.Done()
					for index := range jobs {
						requestStarted := time.Now()
						err := requestProject(client, url)
						latencies[index] = time.Since(requestStarted)
						if err != nil {
							errorCount.Add(1)
							select {
							case firstError <- err:
							default:
							}
						}
					}
				}()
			}
			workers.Wait()
			elapsed := time.Since(started)
			failures := errorCount.Load()
			if failures > 0 {
				t.Fatalf("%d transport requests failed; first error: %v", failures, <-firstError)
			}

			sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
			measurement := transportLatencyMeasurement{
				SchemaVersion: 1,
				Transport:     candidate.name,
				Requests:      requestCount,
				Concurrency:   concurrency,
				PayloadBytes:  payloadBytes,
				ThroughputRPS: float64(requestCount) / elapsed.Seconds(),
				P50Nanos:      percentileNanos(latencies, 50),
				P95Nanos:      percentileNanos(latencies, 95),
				P99Nanos:      percentileNanos(latencies, 99),
				ErrorRate:     float64(failures) / requestCount,
			}
			encoded, err := json.Marshal(measurement)
			if err != nil {
				t.Fatalf("encode latency measurement: %v", err)
			}
			t.Logf("TRANSPORT_LATENCY %s", encoded)
		})
	}
}

func TestProjectTransportCapacityMatrixTCP(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("comparable transport capacity measurements run only on the fixed Linux target")
	}

	workloads := []transportCapacityWorkload{
		{Name: "steady-c1", Requests: 600, Concurrency: 1},
		{Name: "steady-c16", Requests: 2000, Concurrency: 16},
		{Name: "steady-c64", Requests: 4000, Concurrency: 64},
		{Name: "connection-churn-c16", Requests: 800, Concurrency: 16, DisableKeepAlives: true},
	}
	project := projectapp.Project{Name: "Example", Environment: "capacity", Version: "v1"}
	servers := []struct {
		name  string
		start func(testing.TB, *projectapp.Service) transportServer
	}{
		{name: "fiber", start: startFiberTransport},
		{name: "net-http", start: startNetHTTPTransport},
	}

	for _, workload := range workloads {
		for _, candidate := range servers {
			t.Run(workload.Name+"/"+candidate.name, func(t *testing.T) {
				server := candidate.start(t, projectapp.NewService(project))
				client, connectionDials := newCapacityTransportClient(t, workload.DisableKeepAlives)
				url := server.baseURL + "/api/v1/project"
				payloadBytes, _, err := requestProjectMeasurement(client, url)
				if err != nil {
					t.Fatalf("measure project payload: %v", err)
				}
				for range 50 {
					bytes, _, err := requestProjectMeasurement(client, url)
					if err != nil {
						t.Fatalf("warm project request: %v", err)
					}
					if bytes != payloadBytes {
						t.Fatalf("warm payload bytes = %d, want %d", bytes, payloadBytes)
					}
				}
				connectionDials.Store(0)
				runtime.GC()
				var before runtime.MemStats
				runtime.ReadMemStats(&before)
				goroutinesBefore := runtime.NumGoroutine()
				openFileDescriptorsBefore := openFileDescriptorCount()

				jobs := make(chan int, workload.Requests)
				for index := range workload.Requests {
					jobs <- index
				}
				close(jobs)
				latencies := make([]time.Duration, workload.Requests)
				connectionWaits := make([]time.Duration, workload.Requests)
				var errorCount atomic.Int64
				var inFlight atomic.Int64
				var maxInFlight atomic.Int64
				firstError := make(chan error, 1)
				var workers sync.WaitGroup
				started := time.Now()
				for range workload.Concurrency {
					workers.Add(1)
					go func() {
						defer workers.Done()
						for index := range jobs {
							currentInFlight := inFlight.Add(1)
							updateAtomicMaximum(&maxInFlight, currentInFlight)
							requestStarted := time.Now()
							bytes, connectionWait, err := requestProjectMeasurement(client, url)
							latencies[index] = time.Since(requestStarted)
							connectionWaits[index] = connectionWait
							inFlight.Add(-1)
							if err == nil && bytes != payloadBytes {
								err = fmt.Errorf("payload bytes = %d, want %d", bytes, payloadBytes)
							}
							if err != nil {
								errorCount.Add(1)
								select {
								case firstError <- err:
								default:
								}
							}
						}
					}()
				}
				workers.Wait()
				elapsed := time.Since(started)
				var after runtime.MemStats
				runtime.ReadMemStats(&after)
				goroutinesAfter := runtime.NumGoroutine()
				openFileDescriptorsAfter := openFileDescriptorCount()
				failures := errorCount.Load()
				if failures > 0 {
					t.Fatalf("%d capacity requests failed; first error: %v", failures, <-firstError)
				}

				sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
				sort.Slice(connectionWaits, func(i, j int) bool { return connectionWaits[i] < connectionWaits[j] })
				measurement := transportCapacityMeasurement{
					SchemaVersion:             1,
					Transport:                 candidate.name,
					Workload:                  workload.Name,
					Requests:                  workload.Requests,
					Concurrency:               workload.Concurrency,
					KeepAlive:                 !workload.DisableKeepAlives,
					PayloadBytes:              payloadBytes,
					ThroughputRPS:             float64(workload.Requests) / elapsed.Seconds(),
					P50Nanos:                  percentileNanos(latencies, 50),
					P95Nanos:                  percentileNanos(latencies, 95),
					P99Nanos:                  percentileNanos(latencies, 99),
					ConnectionWaitP95Nanos:    percentileNanos(connectionWaits, 95),
					ErrorCount:                failures,
					ErrorRate:                 float64(failures) / float64(workload.Requests),
					ConnectionDials:           connectionDials.Load(),
					MaxInFlight:               maxInFlight.Load(),
					TotalAllocBytes:           after.TotalAlloc - before.TotalAlloc,
					Mallocs:                   after.Mallocs - before.Mallocs,
					GCCycles:                  after.NumGC - before.NumGC,
					GCPauseNanos:              after.PauseTotalNs - before.PauseTotalNs,
					GoroutinesBefore:          goroutinesBefore,
					GoroutinesAfter:           goroutinesAfter,
					OpenFileDescriptorsBefore: openFileDescriptorsBefore,
					OpenFileDescriptorsAfter:  openFileDescriptorsAfter,
				}
				encoded, err := json.Marshal(measurement)
				if err != nil {
					t.Fatalf("encode capacity measurement: %v", err)
				}
				t.Logf("TRANSPORT_CAPACITY %s", encoded)
			})
		}
	}
}

func TestTransportSoakDurationConfiguration(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		enabled bool
		want    time.Duration
		wantErr bool
	}{
		{name: "disabled", value: ""},
		{name: "valid", value: "30s", enabled: true, want: 30 * time.Second},
		{name: "too-short", value: "999ms", wantErr: true},
		{name: "too-long", value: "11m", wantErr: true},
		{name: "invalid", value: "thirty-seconds", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("TRANSPORT_SOAK_DURATION", test.value)
			got, enabled, err := configuredTransportSoakDuration()
			if (err != nil) != test.wantErr {
				t.Fatalf("configuredTransportSoakDuration() error = %v, wantErr %v", err, test.wantErr)
			}
			if enabled != test.enabled || got != test.want {
				t.Fatalf("configuredTransportSoakDuration() = (%s, %v), want (%s, %v)", got, enabled, test.want, test.enabled)
			}
		})
	}
}

func TestProjectTransportSoakTCP(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("transport soak runs only on the fixed Linux target")
	}
	duration, enabled, err := configuredTransportSoakDuration()
	if err != nil {
		t.Fatal(err)
	}
	if !enabled {
		t.Skip("set TRANSPORT_SOAK_DURATION to opt in to the bounded transport soak")
	}

	const (
		concurrency       = 32
		windowDuration    = 5 * time.Second
		latencySampleRate = 64
		settleDuration    = 250 * time.Millisecond
	)
	project := projectapp.Project{Name: "Example", Environment: "soak", Version: "v1"}
	servers := []struct {
		name  string
		start func(testing.TB, *projectapp.Service) transportServer
	}{
		{name: "fiber", start: startFiberTransport},
		{name: "net-http", start: startNetHTTPTransport},
	}

	for _, candidate := range servers {
		t.Run(candidate.name, func(t *testing.T) {
			server := candidate.start(t, projectapp.NewService(project))
			client, connectionDials := newCapacityTransportClient(t, false)
			url := server.baseURL + "/api/v1/project"
			payloadBytes, _, err := requestProjectMeasurement(client, url)
			if err != nil {
				t.Fatalf("measure soak payload: %v", err)
			}
			for range 100 {
				bytes, _, err := requestProjectMeasurement(client, url)
				if err != nil {
					t.Fatalf("warm soak request: %v", err)
				}
				if bytes != payloadBytes {
					t.Fatalf("warm soak payload bytes = %d, want %d", bytes, payloadBytes)
				}
			}
			connectionDials.Store(0)
			runtime.GC()
			var before runtime.MemStats
			runtime.ReadMemStats(&before)
			goroutinesBefore := runtime.NumGoroutine()
			openFileDescriptorsBefore := openFileDescriptorCount()

			windowCount := int((duration + windowDuration - 1) / windowDuration)
			windowCounters := make([]transportSoakWindowCounters, windowCount)
			workerSamples := make([][]time.Duration, concurrency)
			var requestSequence atomic.Int64
			var errorCount atomic.Int64
			firstError := make(chan error, 1)
			started := time.Now()
			deadline := started.Add(duration)
			var workers sync.WaitGroup
			for workerIndex := range concurrency {
				workers.Add(1)
				go func() {
					defer workers.Done()
					for time.Now().Before(deadline) {
						requestStarted := time.Now()
						bytes, _, err := requestProjectMeasurement(client, url)
						latency := time.Since(requestStarted)
						sequence := requestSequence.Add(1)
						windowIndex := int(time.Since(started) / windowDuration)
						if windowIndex >= len(windowCounters) {
							windowIndex = len(windowCounters) - 1
						}
						windowCounters[windowIndex].requests.Add(1)
						if sequence%latencySampleRate == 0 {
							workerSamples[workerIndex] = append(workerSamples[workerIndex], latency)
						}
						if err == nil && bytes != payloadBytes {
							err = fmt.Errorf("payload bytes = %d, want %d", bytes, payloadBytes)
						}
						if err != nil {
							errorCount.Add(1)
							windowCounters[windowIndex].errorCount.Add(1)
							select {
							case firstError <- err:
							default:
							}
						}
					}
				}()
			}
			workers.Wait()
			elapsed := time.Since(started)
			requests := requestSequence.Load()
			if requests == 0 {
				t.Fatal("transport soak completed without requests")
			}
			latencySamples := make([]time.Duration, 0)
			for _, samples := range workerSamples {
				latencySamples = append(latencySamples, samples...)
			}
			if len(latencySamples) == 0 {
				t.Fatal("transport soak completed without latency samples")
			}
			sort.Slice(latencySamples, func(i, j int) bool { return latencySamples[i] < latencySamples[j] })

			var after runtime.MemStats
			runtime.ReadMemStats(&after)
			goroutinesAfter := runtime.NumGoroutine()
			openFileDescriptorsAfter := openFileDescriptorCount()
			client.CloseIdleConnections()
			runtime.GC()
			time.Sleep(settleDuration)
			var settled runtime.MemStats
			runtime.ReadMemStats(&settled)
			goroutinesSettled := runtime.NumGoroutine()
			openFileDescriptorsSettled := openFileDescriptorCount()

			windows := make([]transportSoakWindow, 0, windowCount)
			for index := range windowCount {
				currentDuration := min(windowDuration, duration-time.Duration(index)*windowDuration)
				windowRequests := windowCounters[index].requests.Load()
				windows = append(windows, transportSoakWindow{
					Index:         index,
					DurationNanos: currentDuration.Nanoseconds(),
					Requests:      windowRequests,
					ErrorCount:    windowCounters[index].errorCount.Load(),
					ThroughputRPS: float64(windowRequests) / currentDuration.Seconds(),
				})
			}
			failures := errorCount.Load()
			measurement := transportSoakMeasurement{
				SchemaVersion:              1,
				Transport:                  candidate.name,
				TargetDurationNanos:        duration.Nanoseconds(),
				ElapsedNanos:               elapsed.Nanoseconds(),
				Requests:                   requests,
				Concurrency:                concurrency,
				PayloadBytes:               payloadBytes,
				ThroughputRPS:              float64(requests) / elapsed.Seconds(),
				P95Nanos:                   percentileNanos(latencySamples, 95),
				P99Nanos:                   percentileNanos(latencySamples, 99),
				ErrorCount:                 failures,
				ErrorRate:                  float64(failures) / float64(requests),
				ConnectionDials:            connectionDials.Load(),
				GCCycles:                   after.NumGC - before.NumGC,
				GCPauseNanos:               after.PauseTotalNs - before.PauseTotalNs,
				GoroutinesBefore:           goroutinesBefore,
				GoroutinesAfter:            goroutinesAfter,
				GoroutinesSettled:          goroutinesSettled,
				HeapInUseBytesBefore:       before.HeapInuse,
				HeapInUseBytesAfter:        after.HeapInuse,
				HeapInUseBytesSettled:      settled.HeapInuse,
				OpenFileDescriptorsBefore:  openFileDescriptorsBefore,
				OpenFileDescriptorsAfter:   openFileDescriptorsAfter,
				OpenFileDescriptorsSettled: openFileDescriptorsSettled,
				Windows:                    windows,
			}
			encoded, err := json.Marshal(measurement)
			if err != nil {
				t.Fatalf("encode soak measurement: %v", err)
			}
			t.Logf("TRANSPORT_SOAK %s", encoded)
			if failures > 0 {
				t.Fatalf("%d soak requests failed; first error: %v", failures, <-firstError)
			}
		})
	}
}

func BenchmarkProjectTransportTCP(b *testing.B) {
	runProjectTransportBenchmarks(b, false)
}

func BenchmarkProjectTransportTCPParallel(b *testing.B) {
	runProjectTransportBenchmarks(b, true)
}

func runProjectTransportBenchmarks(b *testing.B, parallel bool) {
	b.Helper()
	if runtime.GOOS != "linux" {
		b.Skip("comparable transport benchmarks run only on the fixed Linux target")
	}

	project := projectapp.Project{Name: "Example", Environment: "benchmark", Version: "v1"}
	servers := []struct {
		name  string
		start func(testing.TB, *projectapp.Service) transportServer
	}{
		{name: "fiber", start: startFiberTransport},
		{name: "net-http", start: startNetHTTPTransport},
	}

	for _, candidate := range servers {
		b.Run(candidate.name, func(b *testing.B) {
			server := candidate.start(b, projectapp.NewService(project))
			client := newTransportClient(b)
			url := server.baseURL + "/api/v1/project"
			for range 20 {
				if err := requestProject(client, url); err != nil {
					b.Fatalf("warm project request: %v", err)
				}
			}

			b.ReportAllocs()
			b.ResetTimer()
			if parallel {
				b.RunParallel(func(pb *testing.PB) {
					for pb.Next() {
						if err := requestProject(client, url); err != nil {
							b.Errorf("project request: %v", err)
							return
						}
					}
				})
				return
			}
			for range b.N {
				if err := requestProject(client, url); err != nil {
					b.Fatalf("project request: %v", err)
				}
			}
		})
	}
}

func startFiberTransport(tb testing.TB, service *projectapp.Service) transportServer {
	tb.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		tb.Fatalf("listen for Fiber transport: %v", err)
	}
	app := fiber.New()
	app.Get("/api/v1/project", func(c fiber.Ctx) error {
		project, err := service.GetProject(c.Context(), projectapp.GetProjectQuery{})
		if err != nil {
			return err
		}
		return httpapi.Success(c, projectResponse{
			Name:        project.Name,
			Environment: project.Environment,
			Version:     project.Version,
		})
	})
	serveErrors := make(chan error, 1)
	go func() {
		serveErrors <- app.Listener(listener, fiber.ListenConfig{DisableStartupMessage: true})
	}()
	registerServerCleanup(tb, func(ctx context.Context) error {
		return app.ShutdownWithContext(ctx)
	}, serveErrors)
	return transportServer{baseURL: "http://" + listener.Addr().String()}
}

func startNetHTTPTransport(tb testing.TB, service *projectapp.Service) transportServer {
	tb.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		tb.Fatalf("listen for net/http transport: %v", err)
	}
	server := &http.Server{
		Handler:           newNetHTTPHandler(service),
		ReadHeaderTimeout: time.Second,
	}
	serveErrors := make(chan error, 1)
	go func() {
		serveErrors <- server.Serve(listener)
	}()
	registerServerCleanup(tb, server.Shutdown, serveErrors)
	return transportServer{baseURL: "http://" + listener.Addr().String()}
}

func newNetHTTPHandler(service *projectapp.Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/project", func(writer http.ResponseWriter, request *http.Request) {
		project, err := service.GetProject(request.Context(), projectapp.GetProjectQuery{})
		if err != nil {
			http.Error(writer, http.StatusText(http.StatusRequestTimeout), http.StatusRequestTimeout)
			return
		}
		payload, err := json.Marshal(projectEnvelope{
			Code: 0,
			Data: projectResponse{
				Name:        project.Name,
				Environment: project.Environment,
				Version:     project.Version,
			},
			Msg: "success",
		})
		if err != nil {
			http.Error(writer, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write(payload)
	})
	return mux
}

func registerServerCleanup(
	tb testing.TB,
	shutdown func(context.Context) error,
	serveErrors <-chan error,
) {
	tb.Helper()
	var once sync.Once
	tb.Cleanup(func() {
		once.Do(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := shutdown(ctx); err != nil {
				tb.Errorf("shutdown transport server: %v", err)
			}
			select {
			case err := <-serveErrors:
				if err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, net.ErrClosed) {
					tb.Errorf("serve transport: %v", err)
				}
			case <-ctx.Done():
				tb.Errorf("transport server did not stop: %v", ctx.Err())
			}
		})
	})
}

func newTransportClient(tb testing.TB) *http.Client {
	tb.Helper()
	transport := &http.Transport{
		MaxIdleConns:        128,
		MaxIdleConnsPerHost: 128,
		DisableCompression:  true,
	}
	tb.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport, Timeout: 2 * time.Second}
}

func newCapacityTransportClient(
	tb testing.TB,
	disableKeepAlives bool,
) (*http.Client, *atomic.Int64) {
	tb.Helper()
	connectionDials := &atomic.Int64{}
	dialer := &net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			connectionDials.Add(1)
			return dialer.DialContext(ctx, network, address)
		},
		MaxIdleConns:        128,
		MaxIdleConnsPerHost: 128,
		DisableKeepAlives:   disableKeepAlives,
		DisableCompression:  true,
	}
	tb.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport, Timeout: 5 * time.Second}, connectionDials
}

func requestProject(client *http.Client, url string) error {
	response, err := client.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if _, err := io.Copy(io.Discard, response.Body); err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("status = %d", response.StatusCode)
	}
	return nil
}

func requestProjectMeasurement(client *http.Client, url string) (int64, time.Duration, error) {
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return 0, 0, err
	}
	var connectionRequestedAt time.Time
	var connectionWait time.Duration
	trace := &httptrace.ClientTrace{
		GetConn: func(string) {
			connectionRequestedAt = time.Now()
		},
		GotConn: func(httptrace.GotConnInfo) {
			if !connectionRequestedAt.IsZero() {
				connectionWait = time.Since(connectionRequestedAt)
			}
		},
	}
	response, err := client.Do(request.WithContext(httptrace.WithClientTrace(request.Context(), trace)))
	if err != nil {
		return 0, connectionWait, err
	}
	defer response.Body.Close()
	payloadBytes, err := io.Copy(io.Discard, response.Body)
	if err != nil {
		return payloadBytes, connectionWait, err
	}
	if response.StatusCode != http.StatusOK {
		return payloadBytes, connectionWait, fmt.Errorf("status = %d", response.StatusCode)
	}
	return payloadBytes, connectionWait, nil
}

func updateAtomicMaximum(maximum *atomic.Int64, candidate int64) {
	for current := maximum.Load(); candidate > current; current = maximum.Load() {
		if maximum.CompareAndSwap(current, candidate) {
			return
		}
	}
}

func openFileDescriptorCount() int {
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return -1
	}
	return len(entries)
}

func configuredTransportSoakDuration() (time.Duration, bool, error) {
	raw := os.Getenv("TRANSPORT_SOAK_DURATION")
	if raw == "" {
		return 0, false, nil
	}
	duration, err := time.ParseDuration(raw)
	if err != nil {
		return 0, false, fmt.Errorf("TRANSPORT_SOAK_DURATION must be a Go duration: %w", err)
	}
	if duration < time.Second || duration > 10*time.Minute {
		return 0, false, fmt.Errorf("TRANSPORT_SOAK_DURATION must be between 1s and 10m")
	}
	return duration, true, nil
}

func percentileNanos(sorted []time.Duration, percentile int) int64 {
	index := (len(sorted)*percentile+99)/100 - 1
	if index < 0 {
		index = 0
	}
	return sorted[index].Nanoseconds()
}
