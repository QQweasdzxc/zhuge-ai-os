package handler

import (
	"errors"
	"net/http"
	"os"
)

// writeTaskFlowStorageError translates only the TaskFlow Supabase adapter's
// typed errors. It never reflects provider response bodies or credentials.
func writeTaskFlowStorageError(w http.ResponseWriter, err error, fallback int, message string) bool {
	if os.Getenv("TASKFLOW_STORAGE_PROVIDER") != "supabase" {
		return false
	}
	var statusError interface{ HTTPStatusCode() int }
	if !errors.As(err, &statusError) {
		return false
	}
	status := statusError.HTTPStatusCode()
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		status = http.StatusForbidden
	case http.StatusNotFound, http.StatusRequestEntityTooLarge, http.StatusTooManyRequests:
		// Preserve a meaningful object miss, size rejection or provider throttle.
	case 0:
		status = http.StatusBadGateway
	default:
		if status >= 500 || status < 400 || status > 499 {
			status = http.StatusBadGateway
		}
	}
	if status < 400 {
		status = fallback
	}
	writeError(w, status, message)
	return true
}
