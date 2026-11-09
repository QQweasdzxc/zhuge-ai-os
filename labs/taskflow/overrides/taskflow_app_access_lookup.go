package main

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/auth"
)

// installTaskflowAppAccessLookup wires the targeted App access decision
// (one boolean per user id, same resolver as the Supabase gates). It only
// matters when TASKFLOW_APP_ACCESS_ENFORCE=on.
func installTaskflowAppAccessLookup(pool *pgxpool.Pool) {
	auth.SetAppAccessLookup(func(ctx context.Context, userID string) (bool, error) {
		var allowed *bool
		if err := pool.QueryRow(ctx, "select taskflow_gate.taskflow_app_access_decision($1::uuid)", userID).Scan(&allowed); err != nil {
			return false, err
		}
		if allowed == nil {
			return false, errors.New("app access decision returned null")
		}
		return *allowed, nil
	})
}
