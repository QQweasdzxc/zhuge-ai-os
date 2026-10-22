package handler

import "context"

// NativeDispatchAuthority is the TaskFlow-owned persistence seam for claims,
// leases and fencing. Implementations must execute the corresponding native
// transaction under server credentials; callers must never supply IDs or
// epochs as authority. The default implementation is intentionally unbound.
type NativeDispatchAuthority interface {
	Claim(context.Context, NativeDispatchClaimRequest) (ProviderDispatchClaim, error)
	Renew(context.Context, NativeDispatchLeaseRequest) (bool, error)
	RequestStop(context.Context, NativeDispatchStopRequest) (bool, error)
	ConfirmProviderStop(context.Context, NativeProviderStopAttestation) (bool, error)
	Reconcile(context.Context, NativeDispatchReconciliation) (bool, error)
}

type NativeDispatchClaimRequest struct {
	RequestKey, IssueID, WorkspaceID, ExecutorID, Provider, CTOPrincipal string
	LeaseSeconds int
}
type NativeDispatchLeaseRequest struct { DispatchID, LeaseID string; FencingEpoch int64; LeaseSeconds int }
type NativeDispatchStopRequest struct { DispatchID string; FencingEpoch int64; Reason string }
type NativeProviderStopAttestation struct { DispatchID, ProviderRunID, EventID string; FencingEpoch int64 }
type NativeDispatchReconciliation struct { DispatchID, LeaseID string; FencingEpoch int64; Reason, NativeWriteState string }

type unboundNativeDispatchAuthority struct{}
func (unboundNativeDispatchAuthority) Claim(context.Context, NativeDispatchClaimRequest) (ProviderDispatchClaim, error) { return ProviderDispatchClaim{}, ErrTaskFlowProviderUnavailable }
func (unboundNativeDispatchAuthority) Renew(context.Context, NativeDispatchLeaseRequest) (bool, error) { return false, ErrTaskFlowProviderUnavailable }
func (unboundNativeDispatchAuthority) RequestStop(context.Context, NativeDispatchStopRequest) (bool, error) { return false, ErrTaskFlowProviderUnavailable }
func (unboundNativeDispatchAuthority) ConfirmProviderStop(context.Context, NativeProviderStopAttestation) (bool, error) { return false, ErrTaskFlowProviderUnavailable }
func (unboundNativeDispatchAuthority) Reconcile(context.Context, NativeDispatchReconciliation) (bool, error) { return false, ErrTaskFlowProviderUnavailable }

// taskflowNativeDispatchAuthority is deliberately unbound until a reviewed
// native DB adapter is installed. This keeps the handler fail-closed.
var taskflowNativeDispatchAuthority NativeDispatchAuthority = unboundNativeDispatchAuthority{}
