package billingapp

import (
	"context"
	"time"
)

// Service owns the Billing use case without depending on Fiber or HTTP types.
type Service struct {
	name        string
	environment string
	version     string
	now         func() time.Time
}

type Summary struct {
	Service     string
	Environment string
	Version     string
	Status      string
	GeneratedAt time.Time
}

func NewService(name, environment, version string, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{name: name, environment: environment, version: version, now: now}
}

func (s *Service) Summary(ctx context.Context) (Summary, error) {
	if err := ctx.Err(); err != nil {
		return Summary{}, err
	}
	return Summary{
		Service:     s.name,
		Environment: s.environment,
		Version:     s.version,
		Status:      "billing-ready",
		GeneratedAt: s.now().UTC(),
	}, nil
}
