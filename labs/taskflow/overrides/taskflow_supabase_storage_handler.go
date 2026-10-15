package handler

import (
	"errors"
	"net/http"
	"os"
)

// writeTaskFlowStorageError handles every Supabase-backed attachment failure.
// Returning true even for an untyped transport error is essential: callers
// must not fall through to a local/public attachment path. Provider details,
// response bodies, object paths, and credentials are never reflected.
func writeTaskFlowStorageError(w http.ResponseWriter, err error, fallback int, message string) bool {
	if os.Getenv("TASKFLOW_STORAGE_PROVIDER") != "supabase" {
		return false
	}
	var statusError interface{ HTTPStatusCode() int }
	status := fallback
	if errors.As(err, &statusError) {
		status = statusError.HTTPStatusCode()
	}
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		status = http.StatusForbidden
	case http.StatusNotFound, http.StatusRequestEntityTooLarge, http.StatusTooManyRequests:
		// Preserve a meaningful object miss, size rejection or provider throttle.
	default:
		if status < 400 || status > 499 {
			status = http.StatusBadGateway
		}
	}
	if status < 400 || status > 499 {
		status = http.StatusBadGateway
	}
	writeError(w, status, message)
	return true
}
