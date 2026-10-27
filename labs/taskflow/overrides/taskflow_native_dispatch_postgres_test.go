package handler

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type nativeDispatchTestDB struct {
	calls       []string
	events      *[]string
	startResult bool
	ackResult   bool
}

func (db *nativeDispatchTestDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected Exec in native dispatch adapter test")
}
func (db *nativeDispatchTestDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query in native dispatch adapter test")
}
func (db *nativeDispatchTestDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	switch {
	case strings.Contains(query, "claim_dispatch_intent"):
		db.calls = append(db.calls, "claim")
		*db.events = append(*db.events, "claim")
		if len(args) != 7 || !strings.Contains(query, "$7::integer)") || strings.Contains(query, "$8") {
			return nativeDispatchTestRow{err: errors.New("claim adapter did not bind all request fields")}
		}
	case strings.Contains(query, "begin_dispatch_provider"):
		db.calls = append(db.calls, "begin")
		*db.events = append(*db.events, "begin")
	case strings.Contains(query, "bind_dispatch_provider_route"):
		db.calls = append(db.calls, "bind")
		*db.events = append(*db.events, "bind")
	case strings.Contains(query, "record_dispatch_provider_ack"):
		db.calls = append(db.calls, "ack")
		*db.events = append(*db.events, "ack")
	case strings.Contains(query, "record_dispatch_reconciliation"):
		db.calls = append(db.calls, "reconcile")
		*db.events = append(*db.events, "reconcile")
	default:
		return nativeDispatchTestRow{err: errors.New("unexpected SQL function in adapter test")}
	}
	return nativeDispatchTestRow{db: db, query: query}
}

type nativeDispatchTestRow struct {
	db    *nativeDispatchTestDB
	query string
	err   error
}

func (row nativeDispatchTestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if strings.Contains(row.query, "claim_dispatch_intent") {
		values := []any{"dispatch-1", "lease-1", int64(7), "workspace-1", "issue-1", "CO-01", "codex", true}
		if len(dest) != len(values) {
			return errors.New("unexpected claim result scan shape")
		}
		for index := range dest {
			switch target := dest[index].(type) {
			case *string:
				*target = values[index].(string)
			case *int64:
				*target = values[index].(int64)
			case *bool:
				*target = values[index].(bool)
			default:
				return errors.New("unsupported claim result type")
			}
		}
		return nil
	}
	if len(dest) != 1 {
		return errors.New("unexpected boolean result scan shape")
	}
	value := true
	if strings.Contains(row.query, "bind_dispatch_provider_route") {
		value = true
	}
	if strings.Contains(row.query, "begin_dispatch_provider") {
		value = row.db.startResult
	}
	if strings.Contains(row.query, "record_dispatch_provider_ack") {
		value = row.db.ackResult
	}
	target, ok := dest[0].(*bool)
	if !ok {
		return errors.New("expected boolean scan target")
	}
	*target = value
	return nil
}

type orderedProviderDispatcher struct {
	calls  *[]string
	events *[]string
	result ProviderDispatchResult
	err    error
}

func (dispatcher orderedProviderDispatcher) Dispatch(_ context.Context, _ ProviderDispatchRequest) (ProviderDispatchResult, error) {
	*dispatcher.calls = append(*dispatcher.calls, "provider")
	*dispatcher.events = append(*dispatcher.events, "provider")
	return dispatcher.result, dispatcher.err
}

func TestNativePostgresAdapterClaimsThenStartsThenPersistsVerifiedAck(t *testing.T) {
	events := []string{}
	db := &nativeDispatchTestDB{startResult: true, ackResult: true, events: &events}
	providerCalls := []string{}
	original := taskflowProviderDispatcher
	taskflowProviderDispatcher = orderedProviderDispatcher{
		calls: &providerCalls, events: &events,
		result: ProviderDispatchResult{Provider: "codex", SessionID: "session-1", ProviderRunID: "official-run-1", AckEventID: "official-ack-1", AckVerified: true},
	}
	t.Cleanup(func() { taskflowProviderDispatcher = original })

	request := validProviderDispatchRequest()
	claim, result, err := dispatchWithNativeAuthority(context.Background(), postgresNativeDispatchAuthority{db: db}, NativeDispatchClaimRequest{
		RequestKey: "request-1", IssueID: request.IssueID, WorkspaceID: request.WorkspaceID,
		ExecutorID: request.ExecutorID, Provider: request.Provider, CTOPrincipal: request.AuthenticatedUserID, LeaseSeconds: 300,
	}, request)
	if err != nil {
		t.Fatalf("dispatch with native authority: %v", err)
	}
	if claim.DispatchID != "dispatch-1" || result.ProviderRunID != "official-run-1" || result.AckEventID != "official-ack-1" || result.SessionID != "session-1" {
		t.Fatalf("unexpected durable result: claim=%+v result=%+v", claim, result)
	}
	if strings.Join(db.calls, ",") != "claim,bind,begin,ack" || strings.Join(providerCalls, ",") != "provider" || strings.Join(events, ",") != "claim,bind,begin,provider,ack" {
		t.Fatalf("unexpected call order: database=%v provider=%v", db.calls, providerCalls)
	}
}

func TestNativePostgresAdapterDoesNotCallProviderWhenStartCASRefuses(t *testing.T) {
	events := []string{}
	db := &nativeDispatchTestDB{startResult: false, ackResult: true, events: &events}
	providerCalls := []string{}
	original := taskflowProviderDispatcher
	taskflowProviderDispatcher = orderedProviderDispatcher{calls: &providerCalls, events: &events, result: ProviderDispatchResult{Provider: "codex", SessionID: "session-1", ProviderRunID: "run", AckEventID: "ack", AckVerified: true}}
	t.Cleanup(func() { taskflowProviderDispatcher = original })
	request := validProviderDispatchRequest()
	_, _, err := dispatchWithNativeAuthority(context.Background(), postgresNativeDispatchAuthority{db: db}, NativeDispatchClaimRequest{
		RequestKey: "request-1", IssueID: request.IssueID, WorkspaceID: request.WorkspaceID, ExecutorID: request.ExecutorID,
		Provider: request.Provider, CTOPrincipal: request.AuthenticatedUserID, LeaseSeconds: 300,
	}, request)
	if !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("start refusal error = %v", err)
	}
	if strings.Join(db.calls, ",") != "claim,bind,begin" || len(providerCalls) != 0 {
		t.Fatalf("provider called after start CAS refusal: db=%v provider=%v", db.calls, providerCalls)
	}
}

func TestNativePostgresAdapterKeepsReconciliationWhenProviderDoesNotAck(t *testing.T) {
	events := []string{}
	db := &nativeDispatchTestDB{startResult: true, ackResult: true, events: &events}
	providerCalls := []string{}
	original := taskflowProviderDispatcher
	taskflowProviderDispatcher = orderedProviderDispatcher{calls: &providerCalls, events: &events, err: ErrTaskFlowProviderUnavailable}
	t.Cleanup(func() { taskflowProviderDispatcher = original })
	request := validProviderDispatchRequest()
	_, _, err := dispatchWithNativeAuthority(context.Background(), postgresNativeDispatchAuthority{db: db}, NativeDispatchClaimRequest{
		RequestKey: "request-1", IssueID: request.IssueID, WorkspaceID: request.WorkspaceID, ExecutorID: request.ExecutorID,
		Provider: request.Provider, CTOPrincipal: request.AuthenticatedUserID, LeaseSeconds: 300,
	}, request)
	if !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("unbound provider error = %v", err)
	}
	if strings.Join(db.calls, ",") != "claim,bind,begin,reconcile" || strings.Join(providerCalls, ",") != "provider" {
		t.Fatalf("provider failure was not reconciled: db=%v provider=%v", db.calls, providerCalls)
	}
}

func TestNativeDispatchAuthorityRequiresDatabaseAndIdempotencyKey(t *testing.T) {
	if _, err := (postgresNativeDispatchAuthority{}).Claim(context.Background(), NativeDispatchClaimRequest{RequestKey: "request"}); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("nil database error = %v", err)
	}
	if _, err := dispatchIdempotencyKey(nil); err == nil {
		t.Fatal("nil request unexpectedly produced an idempotency key")
	}
}

type preflightVetoDispatcher struct{ calls int }

var errPreflightVetoForTest = errors.New("preflight veto for test")

func (d *preflightVetoDispatcher) Preflight(context.Context, ProviderDispatchRequest) error {
	d.calls++
	return errPreflightVetoForTest
}

func (d *preflightVetoDispatcher) Dispatch(context.Context, ProviderDispatchRequest) (ProviderDispatchResult, error) {
	return ProviderDispatchResult{}, errors.New("dispatch must not run after preflight veto")
}

type claimCountingAuthority struct{ claims int }

func (a *claimCountingAuthority) Claim(context.Context, NativeDispatchClaimRequest) (ProviderDispatchClaim, error) {
	a.claims++
	return ProviderDispatchClaim{}, errors.New("claim must not run after preflight veto")
}
func (a *claimCountingAuthority) BindProviderRoute(context.Context, NativeDispatchProviderStartRequest) (bool, error) {
	return false, errors.New("bind must not run after preflight veto")
}
func (a *claimCountingAuthority) BeginProvider(context.Context, NativeDispatchProviderStartRequest) (bool, error) {
	return false, errors.New("begin must not run after preflight veto")
}
func (a *claimCountingAuthority) RecordProviderAck(context.Context, NativeDispatchProviderAckRequest) (bool, error) {
	return false, errors.New("ack must not run after preflight veto")
}
func (a *claimCountingAuthority) Renew(context.Context, NativeDispatchLeaseRequest) (bool, error) {
	return false, errors.New("renew must not run after preflight veto")
}
func (a *claimCountingAuthority) RequestStop(context.Context, NativeDispatchStopRequest) (bool, error) {
	return false, errors.New("stop must not run after preflight veto")
}
func (a *claimCountingAuthority) ConfirmProviderStop(context.Context, NativeProviderStopAttestation) (bool, error) {
	return false, errors.New("stop attestation must not run after preflight veto")
}
func (a *claimCountingAuthority) Reconcile(context.Context, NativeDispatchReconciliation) (bool, error) {
	return false, errors.New("reconcile must not run after preflight veto")
}

func TestNativeDispatchPreflightVetoBlocksClaim(t *testing.T) {
	previous := taskflowProviderDispatcher
	t.Cleanup(func() { taskflowProviderDispatcher = previous })
	veto := &preflightVetoDispatcher{}
	taskflowProviderDispatcher = veto
	authority := &claimCountingAuthority{}
	request := ProviderDispatchRequest{
		IssueID:             "issue-1",
		WorkspaceID:         "ws-1",
		AuthenticatedUserID: "user-1",
		ExecutorID:          "CO-01",
		Provider:            "codex",
		Route: ProviderConversationRoute{
			EngineerID:            "CO-01",
			ProviderAccountPoolID: "pool-1",
			ConversationReference: "conv-1",
			OfficialSessionID:     "sess-1",
			VerificationStatus:    ProviderRouteVerified,
			WorkspaceScope:        "ws-1",
		},
	}
	_, _, err := dispatchWithNativeAuthority(context.Background(), authority, NativeDispatchClaimRequest{
		RequestKey:   "req-1",
		IssueID:      "issue-1",
		WorkspaceID:  "ws-1",
		ExecutorID:   "CO-01",
		Provider:     "codex",
		CTOPrincipal: "user-1",
		LeaseSeconds: 60,
	}, request)
	if !errors.Is(err, errPreflightVetoForTest) {
		t.Fatalf("expected preflight veto error, got %v", err)
	}
	if veto.calls != 1 {
		t.Fatalf("expected exactly one preflight call, got %d", veto.calls)
	}
	if authority.claims != 0 {
		t.Fatalf("preflight veto must run before the single-writer claim; claims=%d", authority.claims)
	}
}
