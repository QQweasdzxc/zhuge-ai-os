package handler

import (
	"context"
	"strings"
)

// The existing Cloud Handoff Co pathway is Codex via an approved GitHub PR
// mention. A GitHub comment is only PENDING_ACK, never an official Provider Run.
// This bridge does not start Node, issue GitHub comments, or read credentials.
const taskflowCodexExistingPlanMode = "codex_github_existing_plan"

// CloudHandoffReceipt is server-owned correlation, not client/UI evidence.
// A launch receipt cannot attest its own Provider Run or ACK.
type CloudHandoffReceipt struct {
	State        string // PENDING_ACK or OFFICIAL_ACK
	DispatchID   string
	LeaseID      string
	FencingEpoch int64
	Provider     string
	SessionID    string
	ReceiptID    string
}

// CloudHandoffHooks are ONLY for trusted server composition. Every callback
// remains unconfigured in the default and env-only configurations.
// VerifyApprovalRef corresponds to labs/cloud-handoff/taskflow-codex-dispatch.mjs
// verifyApprovalRef; VerifyZeroAdditionalCost is required twice, at preclaim
// and prelaunch. Neither a browser flag nor a GitHub comment is proof.
type CloudHandoffHooks struct {
	VerifyApprovalRef        func(context.Context, ProviderDispatchRequest) (bool, error)
	VerifyZeroAdditionalCost func(context.Context, ProviderDispatchRequest, string) (bool, error)
	Launch                   func(context.Context, ProviderDispatchRequest) (CloudHandoffReceipt, error)
	VerifyOfficialAck        func(context.Context, ProviderDispatchRequest, CloudHandoffReceipt) (ProviderDispatchResult, error)
}

type codexCloudHandoffDispatcher struct{ hooks CloudHandoffHooks }

func newCodexCloudHandoffDispatcher(hooks CloudHandoffHooks) TaskFlowProviderDispatcher {
	return &codexCloudHandoffDispatcher{hooks: hooks}
}

// RegisterTrustedCodexCloudHandoffHooks is a server-only capability injection
// point for the existing labs/cloud-handoff orchestration. It requires ALL
// authorities, including an independent official ACK verifier; tests may
// supply isolated fixtures, while runtime remains unbound without them.
func RegisterTrustedCodexCloudHandoffHooks(hooks CloudHandoffHooks) error {
	if hooks.VerifyApprovalRef == nil || hooks.VerifyZeroAdditionalCost == nil ||
		hooks.Launch == nil || hooks.VerifyOfficialAck == nil {
		return ErrTaskFlowProviderUnavailable
	}
	taskflowProviderDispatcher = newCodexCloudHandoffDispatcher(hooks)
	return nil
}

// ConfigureTaskFlowProviderDispatcherFromEnv must run once at Handler/router
// assembly, not from a request or UI input. An unsupported mode is unbound.
// Selecting the recognized mode wires a concrete adapter with DENYING gates:
// it does not enable any provider without separately wired trusted callbacks.
func ConfigureTaskFlowProviderDispatcherFromEnv(mode string) {
	taskflowProviderDispatcher = unboundTaskFlowProviderDispatcher{}
	if strings.TrimSpace(mode) == taskflowCodexExistingPlanMode {
		taskflowProviderDispatcher = newCodexCloudHandoffDispatcher(CloudHandoffHooks{})
	}
}

// Preflight runs before the durable claim. This avoids claiming a writer for
// requests with unverified PM approval or cost/quota authority.
func (d *codexCloudHandoffDispatcher) Preflight(ctx context.Context, request ProviderDispatchRequest) error {
	if d == nil || request.Provider != "codex" || strings.TrimSpace(request.IssueID) == "" ||
		strings.TrimSpace(request.WorkspaceID) == "" || strings.TrimSpace(request.AuthenticatedUserID) == "" ||
		strings.TrimSpace(request.ExecutorID) == "" ||
		request.Route.EngineerID != request.ExecutorID || request.Route.WorkspaceScope != request.WorkspaceID ||
		request.Route.VerificationStatus != ProviderRouteVerified ||
		strings.TrimSpace(request.Route.ProviderAccountPoolID) == "" ||
		strings.TrimSpace(request.Route.ConversationReference) == "" ||
		strings.TrimSpace(request.Route.OfficialSessionID) == "" {
		return ErrTaskFlowProviderUnavailable
	}
	if d.hooks.VerifyApprovalRef == nil || d.hooks.VerifyZeroAdditionalCost == nil {
		return ErrTaskFlowProviderUnavailable
	}
	approved, err := d.hooks.VerifyApprovalRef(ctx, request)
	if err != nil || !approved {
		return ErrTaskFlowProviderUnavailable
	}
	allowed, err := d.hooks.VerifyZeroAdditionalCost(ctx, request, "preclaim")
	if err != nil || !allowed {
		return ErrTaskFlowProviderUnavailable
	}
	return nil
}

// Dispatch is the concrete Co adapter contract. The existing @codex PR
// transport can return PENDING_ACK only. A separately authenticated official
// Run/ACK verifier is necessary before any ProviderDispatchResult is accepted.
func (d *codexCloudHandoffDispatcher) Dispatch(ctx context.Context, request ProviderDispatchRequest) (ProviderDispatchResult, error) {
	if err := d.Preflight(ctx, request); err != nil {
		return ProviderDispatchResult{}, err
	}
	if err := validateProviderDispatchContract(request); err != nil {
		return ProviderDispatchResult{}, err
	}
	if d.hooks.Launch == nil || d.hooks.VerifyOfficialAck == nil {
		return ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
	}
	allowed, err := d.hooks.VerifyZeroAdditionalCost(ctx, request, "prelaunch")
	if err != nil || !allowed {
		return ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
	}
	response, err := d.hooks.Launch(ctx, request)
	if err != nil {
		return ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
	}
	if response.DispatchID != request.Correlation.DispatchID || response.LeaseID != request.Correlation.LeaseID ||
		response.FencingEpoch != request.Correlation.FencingEpoch || response.Provider != request.Provider ||
		response.SessionID != request.Route.OfficialSessionID {
		return ProviderDispatchResult{}, ErrTaskFlowProviderAckInvalid
	}
	// No claim of ACK is permitted from GitHub 201/comment ID, even when an
	// injected caller falsely labels it verified. STOP/RUN authority is separate.
	if response.State != "OFFICIAL_ACK" {
		return ProviderDispatchResult{}, ErrTaskFlowProviderAckInvalid
	}
	result, err := d.hooks.VerifyOfficialAck(ctx, request, response)
	if err != nil || !result.AckVerified || result.Provider != request.Provider ||
		result.SessionID != request.Route.OfficialSessionID ||
		strings.TrimSpace(result.ProviderRunID) == "" || strings.TrimSpace(result.AckEventID) == "" {
		return ProviderDispatchResult{}, ErrTaskFlowProviderAckInvalid
	}
	return result, nil
}
