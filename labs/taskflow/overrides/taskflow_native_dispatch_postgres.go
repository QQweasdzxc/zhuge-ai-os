package handler

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// postgresNativeDispatchAuthority uses the Handler's existing TaskFlow DB
// pool. The reviewed SQL functions remain the only persistence authority;
// this adapter does not create tables or fall back to in-memory state.
type postgresNativeDispatchAuthority struct{ db dbExecutor }

func nativeDispatchAuthorityForHandler(h *Handler) NativeDispatchAuthority {
	if h == nil || h.DB == nil {
		return unboundNativeDispatchAuthority{}
	}
	return postgresNativeDispatchAuthority{db: h.DB}
}

func (a postgresNativeDispatchAuthority) unavailable() error {
	return ErrTaskFlowProviderUnavailable
}

func (a postgresNativeDispatchAuthority) Claim(ctx context.Context, request NativeDispatchClaimRequest) (ProviderDispatchClaim, error) {
	if a.db == nil || strings.TrimSpace(request.RequestKey) == "" || strings.TrimSpace(request.CTOPrincipal) == "" ||
		strings.TrimSpace(request.IssueID) == "" || strings.TrimSpace(request.WorkspaceID) == "" ||
		strings.TrimSpace(request.ExecutorID) == "" || strings.TrimSpace(request.Provider) == "" ||
		request.LeaseSeconds <= 0 || request.LeaseSeconds > 3600 {
		return ProviderDispatchClaim{}, a.unavailable()
	}
	const query = `
		SELECT c.id::text, c.lease_id::text, c.fencing_epoch,
		       c.workspace_id::text, c.issue_id::text, c.executor_id, c.provider,
		       c.state IN ('claimed', 'provider_start_requested', 'provider_acknowledged', 'provider_started', 'reconcile_required')
	         AND c.lease_expires_at > now()
		  FROM taskflow.claim_dispatch_intent($1::text, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::integer) AS c`
	var claim ProviderDispatchClaim
	if err := a.db.QueryRow(ctx, query,
		request.RequestKey, request.IssueID, request.WorkspaceID, request.ExecutorID,
		request.Provider, request.CTOPrincipal, request.LeaseSeconds,
	).Scan(&claim.DispatchID, &claim.LeaseID, &claim.FencingEpoch, &claim.WorkspaceID,
		&claim.IssueID, &claim.ExecutorID, &claim.Provider, &claim.Active); err != nil {
		return ProviderDispatchClaim{}, fmt.Errorf("%w: native claim unavailable", ErrTaskFlowProviderUnavailable)
	}
	if !claim.Active || claim.DispatchID == "" || claim.LeaseID == "" || claim.FencingEpoch <= 0 ||
		claim.WorkspaceID != request.WorkspaceID || claim.IssueID != request.IssueID ||
		claim.ExecutorID != request.ExecutorID || claim.Provider != request.Provider {
		return ProviderDispatchClaim{}, a.unavailable()
	}
	return claim, nil
}

func (a postgresNativeDispatchAuthority) BeginProvider(ctx context.Context, request NativeDispatchProviderStartRequest) (bool, error) {
	if a.db == nil || request.DispatchID == "" || request.LeaseID == "" || request.FencingEpoch <= 0 || request.Provider == "" || request.SessionID == "" {
		return false, a.unavailable()
	}
	var started bool
	if err := a.db.QueryRow(ctx, `SELECT taskflow.begin_dispatch_provider($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text)`,
		request.DispatchID, request.LeaseID, request.FencingEpoch, request.Provider, request.SessionID,
	).Scan(&started); err != nil {
		return false, fmt.Errorf("%w: native provider-start authorization unavailable", ErrTaskFlowProviderUnavailable)
	}
	return started, nil
}

func (a postgresNativeDispatchAuthority) BindProviderRoute(ctx context.Context, request NativeDispatchProviderStartRequest) (bool, error) {
	if a.db == nil || request.DispatchID == "" || request.LeaseID == "" || request.FencingEpoch <= 0 || request.Provider == "" || request.SessionID == "" {
		return false, a.unavailable()
	}
	var bound bool
	if err := a.db.QueryRow(ctx, `SELECT taskflow.bind_dispatch_provider_route($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text)`,
		request.DispatchID, request.LeaseID, request.FencingEpoch, request.Provider, request.SessionID,
	).Scan(&bound); err != nil {
		return false, fmt.Errorf("%w: provider route binding unavailable", ErrTaskFlowProviderUnavailable)
	}
	return bound, nil
}

func (a postgresNativeDispatchAuthority) RecordProviderAck(ctx context.Context, request NativeDispatchProviderAckRequest) (bool, error) {
	if a.db == nil || request.DispatchID == "" || request.LeaseID == "" || request.FencingEpoch <= 0 ||
		strings.TrimSpace(request.Provider) == "" || strings.TrimSpace(request.SessionID) == "" ||
		strings.TrimSpace(request.ProviderRunID) == "" || strings.TrimSpace(request.AckEventID) == "" {
		return false, a.unavailable()
	}
	var recorded bool
	if err := a.db.QueryRow(ctx, `SELECT taskflow.record_dispatch_provider_ack($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text)`,
		request.DispatchID, request.LeaseID, request.FencingEpoch, request.Provider, request.SessionID, request.ProviderRunID, request.AckEventID,
	).Scan(&recorded); err != nil {
		return false, fmt.Errorf("%w: provider ACK persistence unavailable", ErrTaskFlowProviderUnavailable)
	}
	return recorded, nil
}

func (a postgresNativeDispatchAuthority) Renew(ctx context.Context, request NativeDispatchLeaseRequest) (bool, error) {
	if a.db == nil || request.DispatchID == "" || request.LeaseID == "" || request.FencingEpoch <= 0 || request.LeaseSeconds <= 0 || request.LeaseSeconds > 3600 {
		return false, a.unavailable()
	}
	var renewed bool
	if err := a.db.QueryRow(ctx, `SELECT taskflow.renew_dispatch_lease($1::uuid, $2::uuid, $3::bigint, $4::integer)`, request.DispatchID, request.LeaseID, request.FencingEpoch, request.LeaseSeconds).Scan(&renewed); err != nil {
		return false, fmt.Errorf("%w: native lease renewal unavailable", ErrTaskFlowProviderUnavailable)
	}
	return renewed, nil
}

func (a postgresNativeDispatchAuthority) RequestStop(ctx context.Context, request NativeDispatchStopRequest) (bool, error) {
	if a.db == nil || request.DispatchID == "" || request.FencingEpoch <= 0 || strings.TrimSpace(request.Reason) == "" {
		return false, a.unavailable()
	}
	var stopped bool
	if err := a.db.QueryRow(ctx, `SELECT taskflow.stop_dispatch_intent($1::uuid, $2::bigint, $3::text)`, request.DispatchID, request.FencingEpoch, request.Reason).Scan(&stopped); err != nil {
		return false, fmt.Errorf("%w: native stop request unavailable", ErrTaskFlowProviderUnavailable)
	}
	return stopped, nil
}

func (a postgresNativeDispatchAuthority) ConfirmProviderStop(ctx context.Context, request NativeProviderStopAttestation) (bool, error) {
	if a.db == nil || request.DispatchID == "" || request.FencingEpoch <= 0 || request.ProviderRunID == "" || request.EventID == "" {
		return false, a.unavailable()
	}
	var verified bool
	if err := a.db.QueryRow(ctx, `SELECT taskflow.confirm_dispatch_stop($1::uuid, $2::bigint, $3::text, $4::text)`, request.DispatchID, request.FencingEpoch, request.ProviderRunID, request.EventID).Scan(&verified); err != nil {
		return false, fmt.Errorf("%w: provider STOP verification unavailable", ErrTaskFlowProviderUnavailable)
	}
	return verified, nil
}

func (a postgresNativeDispatchAuthority) Reconcile(ctx context.Context, request NativeDispatchReconciliation) (bool, error) {
	if a.db == nil || request.DispatchID == "" || request.LeaseID == "" || request.FencingEpoch <= 0 || strings.TrimSpace(request.Reason) == "" {
		return false, a.unavailable()
	}
	var reconciled bool
	if err := a.db.QueryRow(ctx, `SELECT taskflow.record_dispatch_reconciliation($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text)`, request.DispatchID, request.LeaseID, request.FencingEpoch, request.Reason, request.NativeWriteState).Scan(&reconciled); err != nil {
		return false, fmt.Errorf("%w: dispatch reconciliation unavailable", ErrTaskFlowProviderUnavailable)
	}
	return reconciled, nil
}

func providerClaimCorrelation(claim ProviderDispatchClaim) ProviderDispatchCorrelation {
	return ProviderDispatchCorrelation{DispatchID: claim.DispatchID, LeaseID: claim.LeaseID, FencingEpoch: claim.FencingEpoch}
}

func validateResolvedProviderRoute(request ProviderDispatchRequest) error {
	route := request.Route
	if strings.TrimSpace(route.EngineerID) == "" || route.EngineerID != request.ExecutorID ||
		strings.TrimSpace(route.ProviderAccountPoolID) == "" || strings.TrimSpace(route.ConversationReference) == "" ||
		strings.TrimSpace(route.OfficialSessionID) == "" || route.VerificationStatus != ProviderRouteVerified ||
		route.WorkspaceScope != request.WorkspaceID {
		return ErrTaskFlowProviderUnavailable
	}
	return nil
}

func dispatchWithNativeAuthority(ctx context.Context, authority NativeDispatchAuthority, claimRequest NativeDispatchClaimRequest, request ProviderDispatchRequest) (ProviderDispatchClaim, ProviderDispatchResult, error) {
	if authority == nil {
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
	}
	if err := validateResolvedProviderRoute(request); err != nil {
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, err
	}
	claim, err := authority.Claim(ctx, claimRequest)
	if err != nil {
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, err
	}
	request.DispatchClaim = claim
	request.Correlation = providerClaimCorrelation(claim)
	if err := validateProviderDispatchContract(request); err != nil {
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, err
	}
	startRequest := NativeDispatchProviderStartRequest{DispatchID: claim.DispatchID, LeaseID: claim.LeaseID, FencingEpoch: claim.FencingEpoch, Provider: request.Provider, SessionID: request.Route.OfficialSessionID}
	bound, err := authority.BindProviderRoute(ctx, startRequest)
	if err != nil || !bound {
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
	}
	started, err := authority.BeginProvider(ctx, startRequest)
	if err != nil || !started {
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
	}
	result, err := dispatchToProvider(ctx, request)
	if err != nil {
		_, _ = authority.Reconcile(ctx, NativeDispatchReconciliation{DispatchID: claim.DispatchID, LeaseID: claim.LeaseID, FencingEpoch: claim.FencingEpoch, Reason: "provider_dispatch_or_ack_failed", NativeWriteState: "failed"})
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, err
	}
	recorded, err := authority.RecordProviderAck(ctx, NativeDispatchProviderAckRequest{DispatchID: claim.DispatchID, LeaseID: claim.LeaseID, FencingEpoch: claim.FencingEpoch, Provider: result.Provider, SessionID: result.SessionID, ProviderRunID: result.ProviderRunID, AckEventID: result.AckEventID})
	if err != nil || !recorded {
		_, _ = authority.Reconcile(ctx, NativeDispatchReconciliation{DispatchID: claim.DispatchID, LeaseID: claim.LeaseID, FencingEpoch: claim.FencingEpoch, Reason: "provider_ack_native_persistence_failed", NativeWriteState: "failed"})
		if err != nil {
			return ProviderDispatchClaim{}, ProviderDispatchResult{}, err
		}
		return ProviderDispatchClaim{}, ProviderDispatchResult{}, errors.New("verified provider ACK was not durably recorded")
	}
	return claim, result, nil
}
