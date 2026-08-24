package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	goexample "github.com/zbxing/goexample/SDK/GoExample"
)

const (
	defaultBaseURL = "http://localhost:3001"
	probeTimeout   = 5 * time.Second
)

func main() {
	baseURL := strings.TrimSpace(os.Getenv("GOEXAMPLE_BASE_URL"))
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	if err := checkReadiness(ctx, baseURL, nil); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("ready")
}

func checkReadiness(ctx context.Context, baseURL string, httpClient goexample.HTTPClient) error {
	options := make([]goexample.ClientOption, 0, 1)
	if httpClient != nil {
		options = append(options, goexample.WithHTTPClient(httpClient))
	}
	client, err := goexample.NewClient(baseURL, options...)
	if err != nil {
		return fmt.Errorf("configure readiness client: %w", err)
	}
	response, err := client.GetReadiness(ctx)
	if err != nil {
		return fmt.Errorf("request readiness: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("readiness returned HTTP %d", response.StatusCode)
	}
	envelope, err := response.DecodeEnvelope()
	if err != nil {
		return errors.New("readiness returned an invalid JSON envelope")
	}
	if envelope.Code != 0 {
		return fmt.Errorf("readiness returned application code %d", envelope.Code)
	}
	return nil
}
