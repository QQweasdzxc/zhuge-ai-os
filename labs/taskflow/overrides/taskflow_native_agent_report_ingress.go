package handler

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
)

const nativeAgentReportIngressPath = "/api/provider/taskflow/native-agent-reports"
const maxNativeAgentReportBodyBytes = 64 << 10

var errNativeReportVerifierUnavailable = errors.New("native report provider verifier is unavailable")

// NativeAgentReportAttestation contains only the bounded fields needed by the
// TaskFlow native writer. Provider implementations must verify the provider's
// official request signature, timestamp/replay window, event schema and
// provider/run identity before returning claims. Unknown event fields and raw
// free text must never be copied into the attestation. Protected text is
// represented only by HasProtectedDetails and remains fail-closed until a
// protected detail store is wired.
type NativeAgentReportAttestation struct {
	EventID, DispatchID, IssueID, WorkspaceID string
	ExecutorID, Provider, ProviderRunID       string
	SessionID, ProviderAckEventID             string
	LeaseID, EventType                        string
	FencingEpoch, Sequence                    int64
	ProgressPercent                           int32
	HasProgress                               bool
	HasProtectedDetails                       bool
}

// NativeAgentReportProviderVerifier is a server-owned capability. The HTTP
// request cannot set the private verification bit used by the native writer.
// A production implementation must be bound only to a supported provider
// ingress and verify the official signature over body plus relevant headers.
type NativeAgentReportProviderVerifier interface {
	VerifyNativeAgentReport(context.Context, http.Header, []byte) (NativeAgentReportAttestation, error)
}

// ReceiveNativeAgentReport is the TaskFlow server-side provider ingress. It
// never trusts request JSON as an attestation and never returns or logs the raw
// body. With no official provider verifier configured it fails closed.
func (h *Handler) ReceiveNativeAgentReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "application/json is required")
		return
	}
	if encoding := strings.TrimSpace(r.Header.Get("Content-Encoding")); encoding != "" && !strings.EqualFold(encoding, "identity") {
		writeError(w, http.StatusUnsupportedMediaType, "content encoding is not supported")
		return
	}
	if h == nil || h.NativeAgentReportVerifier == nil {
		writeError(w, http.StatusServiceUnavailable, "provider ingress is not configured")
		return
	}
	if r.ContentLength > maxNativeAgentReportBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "provider report is too large")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxNativeAgentReportBodyBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "provider report is too large")
		return
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "provider report body is required")
		return
	}
	attestation, err := h.NativeAgentReportVerifier.VerifyNativeAgentReport(r.Context(), r.Header.Clone(), body)
	for index := range body {
		body[index] = 0
	}
	if err != nil {
		if errors.Is(err, errNativeReportVerifierUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "provider verification is unavailable")
			return
		}
		writeError(w, http.StatusUnauthorized, "provider report authentication failed")
		return
	}
	event := nativeAgentReportEvent{
		EventID: attestation.EventID, DispatchID: attestation.DispatchID,
		IssueID: attestation.IssueID, WorkspaceID: attestation.WorkspaceID,
		ExecutorID: attestation.ExecutorID, Provider: attestation.Provider,
		ProviderRunID: attestation.ProviderRunID, SessionID: attestation.SessionID,
		ProviderAckEventID: attestation.ProviderAckEventID, LeaseID: attestation.LeaseID,
		EventType: attestation.EventType, FencingEpoch: attestation.FencingEpoch,
		Sequence: attestation.Sequence, ProgressPercent: attestation.ProgressPercent,
		HasProgress: attestation.HasProgress, HasProtectedDetails: attestation.HasProtectedDetails,
		providerAttestationVerified: true,
	}
	result, err := h.applyVerifiedNativeAgentReport(r.Context(), event)
	if err != nil {
		switch {
		case errors.Is(err, errNativeReportScope), errors.Is(err, errNativeReportReplay),
			errors.Is(err, errNativeReportVersionConflict), errors.Is(err, errNativeReportProjection),
			errors.Is(err, errNativeReportProtectedDetail):
			writeError(w, http.StatusConflict, "provider report rejected by TaskFlow authority")
		default:
			writeError(w, http.StatusServiceUnavailable, "native report write is unavailable")
		}
		return
	}
	status := http.StatusCreated
	if result.Replay {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{
		"accepted": true, "replay": result.Replay, "issue_id": result.IssueID,
		"status": result.Status, "revision": result.Revision,
	})
}
