package auth

import (
	"context"
	"time"
)

// completedAuthContextError observes an elapsed deadline even in the narrow
// window before the context timer publishes cancellation on Done.
func completedAuthContextError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	return nil
}
