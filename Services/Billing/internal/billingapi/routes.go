package billingapi

import (
	"context"

	"github.com/zbxing/goexample/Framework/httpapi"
	"github.com/zbxing/goexample/Services/Billing/internal/billingapp"
)

type summaryResponse struct {
	Service     string `json:"service"`
	Environment string `json:"environment"`
	Version     string `json:"version"`
	Status      string `json:"status"`
	GeneratedAt string `json:"generatedAt"`
}

func Queries(service *billingapp.Service) []httpapi.ApplicationQuery {
	return []httpapi.ApplicationQuery{
		{
			Path: "/billing/summary",
			Handler: func(ctx context.Context) (any, error) {
				summary, err := service.Summary(ctx)
				if err != nil {
					return nil, err
				}
				return summaryResponse{
					Service:     summary.Service,
					Environment: summary.Environment,
					Version:     summary.Version,
					Status:      summary.Status,
					GeneratedAt: summary.GeneratedAt.Format("2006-01-02T15:04:05Z07:00"),
				}, nil
			},
		},
	}
}
