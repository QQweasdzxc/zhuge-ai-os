package handler

import (
	"context"
	"errors"
	"testing"
)

func TestConfigureTaskFlowProviderDispatcherBoundVsUnbound(t *testing.T) {
	old := taskflowProviderDispatcher
	t.Cleanup(func() { taskflowProviderDispatcher = old })
	for _, mode := range []string{"", "disabled", "unknown", "gemini_cli_personal_google_login"} {
		ConfigureTaskFlowProviderDispatcherFromEnv(mode)
		if _, ok := taskflowProviderDispatcher.(unboundTaskFlowProviderDispatcher); !ok {
			t.Fatalf("mode %q should be unbound", mode)
		}
	}
	ConfigureTaskFlowProviderDispatcherFromEnv("codex_github_existing_plan")
	if _, ok := taskflowProviderDispatcher.(*codexCloudHandoffDispatcher); !ok {
		t.Fatal("recognized mode did not register concrete adapter")
	}
	if _, err := dispatchToProvider(context.Background(), validProviderDispatchRequest()); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("env-only mode must fail closed, got %v", err)
	}
}

func TestCodexCloudHandoffPreflightFailsClosed(t *testing.T) {
	ctx := context.Background()
	r := validProviderDispatchRequest()
	called := 0
	d := newCodexCloudHandoffDispatcher(CloudHandoffHooks{
		VerifyApprovalRef: func(context.Context, ProviderDispatchRequest) (bool, error) { called++; return true, nil },
		VerifyZeroAdditionalCost: func(context.Context, ProviderDispatchRequest, string) (bool, error) { return false, nil },
		Launch: func(context.Context, ProviderDispatchRequest) (CloudHandoffReceipt, error) { t.Fatal("launch without cost approval"); return CloudHandoffReceipt{}, nil },
	}).(*codexCloudHandoffDispatcher)
	if err := d.Preflight(ctx, r); !errors.Is(err, ErrTaskFlowProviderUnavailable) || called != 1 {
		t.Fatalf("unexpected preflight %v / %d", err, called)
	}
	r.Provider = "gemini"
	if err := d.Preflight(ctx, r); !errors.Is(err, ErrTaskFlowProviderUnavailable) || called != 1 {
		t.Fatalf("unexpected non-Co preflight %v / %d", err, called)
	}
}

func TestCodexCloudHandoffPendingCommentNeverBecomesAck(t *testing.T) {
	ctx := context.Background()
	r := validProviderDispatchRequest()
	approvedStages := []string{}
	ackCalls := 0
	d := newCodexCloudHandoffDispatcher(CloudHandoffHooks{
		VerifyApprovalRef: func(context.Context, ProviderDispatchRequest) (bool, error) { return true, nil },
		VerifyZeroAdditionalCost: func(_ context.Context, _ ProviderDispatchRequest, stage string) (bool, error) { approvedStages = append(approvedStages, stage); return true, nil },
		Launch: func(_ context.Context, req ProviderDispatchRequest) (CloudHandoffReceipt, error) {
			return CloudHandoffReceipt{State: "PENDING_ACK", DispatchID: req.Correlation.DispatchID, LeaseID: req.Correlation.LeaseID, FencingEpoch: req.Correlation.FencingEpoch, Provider: req.Provider, SessionID: req.Route.OfficialSessionID, ReceiptID: "github-comment-201"}, nil
		},
		VerifyOfficialAck: func(context.Context, ProviderDispatchRequest, CloudHandoffReceipt) (ProviderDispatchResult, error) {
			ackCalls++; return ProviderDispatchResult{Provider: "codex", SessionID: "session-1", ProviderRunID: "forged", AckEventID: "forged", AckVerified: true}, nil
		},
	}).(*codexCloudHandoffDispatcher)
	if _, err := d.Dispatch(ctx, r); !errors.Is(err, ErrTaskFlowProviderAckInvalid) {
		t.Fatalf("comment promoted to ACK: %v", err)
	}
	if ackCalls != 0 || len(approvedStages) != 2 || approvedStages[0] != "preclaim" || approvedStages[1] != "prelaunch" {
		t.Fatalf("gate ordering / comment verifier violation: ack=%d stages=%v", ackCalls, approvedStages)
	}
}

func TestCodexCloudHandoffOfficialAckRequiresTrustedVerifier(t *testing.T) {
	r := validProviderDispatchRequest()
	makeHooks := func() CloudHandoffHooks {
		return CloudHandoffHooks{
			VerifyApprovalRef: func(context.Context, ProviderDispatchRequest) (bool, error) { return true, nil },
			VerifyZeroAdditionalCost: func(context.Context, ProviderDispatchRequest, string) (bool, error) { return true, nil },
			Launch: func(_ context.Context, req ProviderDispatchRequest) (CloudHandoffReceipt, error) {
				return CloudHandoffReceipt{State: "OFFICIAL_ACK", DispatchID: req.Correlation.DispatchID, LeaseID: req.Correlation.LeaseID, FencingEpoch: req.Correlation.FencingEpoch, Provider: req.Provider, SessionID: req.Route.OfficialSessionID}, nil
			},
		}
	}
	hooks := makeHooks()
	d := newCodexCloudHandoffDispatcher(hooks)
	if _, err := d.Dispatch(context.Background(), r); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("missing official verifier should block: %v", err)
	}
	hooks.VerifyOfficialAck = func(context.Context, ProviderDispatchRequest, CloudHandoffReceipt) (ProviderDispatchResult, error) {
		return ProviderDispatchResult{Provider: "codex", SessionID: "session-1", ProviderRunID: "official-run-1", AckEventID: "official-ack-1", AckVerified: true}, nil
	}
	d = newCodexCloudHandoffDispatcher(hooks)
	result, err := d.Dispatch(context.Background(), r)
	if err != nil || result.ProviderRunID != "official-run-1" || !result.AckVerified {
		t.Fatalf("official test verifier failed: %+v %v", result, err)
	}
	hooks.Launch = func(_ context.Context, req ProviderDispatchRequest) (CloudHandoffReceipt, error) {
		return CloudHandoffReceipt{State: "OFFICIAL_ACK", DispatchID: "other", LeaseID: req.Correlation.LeaseID, FencingEpoch: req.Correlation.FencingEpoch, Provider: req.Provider, SessionID: req.Route.OfficialSessionID}, nil
	}
	if _, err = newCodexCloudHandoffDispatcher(hooks).Dispatch(context.Background(), r); !errors.Is(err, ErrTaskFlowProviderAckInvalid) {
		t.Fatalf("wrong dispatch correlation must be blocked: %v", err)
	}
}
