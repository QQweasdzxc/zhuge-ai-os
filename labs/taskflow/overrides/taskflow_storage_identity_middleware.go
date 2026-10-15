package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/multica-ai/multica/server/internal/storage"
)

// RequireTaskFlowSupabaseStorageIdentity is applied only to attachment APIs
// in the TaskFlow build. Auth has already authenticated the TaskFlow JWT and
// stamped X-User-ID. A separate Zhuge Supabase access token is then verified
// server-side and must resolve to that same UUID before the token is put into
// the storage request context.
func RequireTaskFlowSupabaseStorageIdentity(next http.Handler) http.Handler {
	return requireTaskFlowSupabaseStorageIdentity(next, storage.VerifyTaskFlowSupabaseIdentity)
}

type taskFlowStorageIdentityVerifier func(context.Context, string) (string, error)

func requireTaskFlowSupabaseStorageIdentity(next http.Handler, verify taskFlowStorageIdentityVerifier) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		taskFlowUserID, err := uuid.Parse(strings.TrimSpace(r.Header.Get("X-User-ID")))
		if err != nil {
			writeTaskFlowStorageIdentityError(w, http.StatusForbidden, "TaskFlow identity is required")
			return
		}
		storageToken := strings.TrimSpace(r.Header.Get("X-Zhuge-Storage-Token"))
		if storageToken == "" {
			// Existing Render-local objects remain readable for a previously
			// established TaskFlow session. Uploads and deletes must carry the
			// Zhuge JWT; Supabase-backed reads without it fail closed in Storage.
			if r.Method == http.MethodGet {
				next.ServeHTTP(w, r)
				return
			}
			writeTaskFlowStorageIdentityError(w, http.StatusForbidden, "Zhuge Storage session is missing; re-enter TaskFlow from Zhuge AI OS")
			return
		}
		verifiedUserID, err := verify(r.Context(), storageToken)
		if err != nil {
			var verificationError interface{ HTTPStatusCode() int }
			if errors.As(err, &verificationError) {
				status := verificationError.HTTPStatusCode()
				if status < 400 || status > 599 {
					status = http.StatusBadGateway
				}
				message := "Zhuge Storage identity could not be verified"
				if status == http.StatusForbidden {
					message = "Zhuge Storage session is invalid; re-enter TaskFlow from Zhuge AI OS"
				}
				writeTaskFlowStorageIdentityError(w, status, message)
				return
			}
			writeTaskFlowStorageIdentityError(w, http.StatusBadGateway, "Zhuge Storage identity could not be verified")
			return
		}
		zhugeUserID, err := uuid.Parse(strings.TrimSpace(verifiedUserID))
		if err != nil || zhugeUserID != taskFlowUserID {
			writeTaskFlowStorageIdentityError(w, http.StatusForbidden, "Zhuge and TaskFlow identities do not match")
			return
		}
		ctx := storage.WithTaskFlowSupabaseJWT(r.Context(), storageToken)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func writeTaskFlowStorageIdentityError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
