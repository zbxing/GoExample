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
	"net/http/httputil"
	"net/url"
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
	Transport     string  `json:"transport"`
	Requests      int     `json:"requests"`
	Concurrency   int     `json:"concurrency"`
	ThroughputRPS float64 `json:"throughputRps"`
	P50Nanos      int64   `json:"p50Nanos"`
	P95Nanos      int64   `json:"p95Nanos"`
	P99Nanos      int64   `json:"p99Nanos"`
	ErrorRate     float64 `json:"errorRate"`
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
				Transport:     candidate.name,
				Requests:      requestCount,
				Concurrency:   concurrency,
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
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(projectEnvelope{
			Code: 0,
			Data: projectResponse{
				Name:        project.Name,
				Environment: project.Environment,
				Version:     project.Version,
			},
			Msg: "success",
		})
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

func percentileNanos(sorted []time.Duration, percentile int) int64 {
	index := (len(sorted)*percentile+99)/100 - 1
	if index < 0 {
		index = 0
	}
	return sorted[index].Nanoseconds()
}
