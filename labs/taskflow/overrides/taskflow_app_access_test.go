package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

func setup(t *testing.T, fn AppAccessLookup) *time.Time {
	t.Helper()
	now := time.Unix(1000, 0)
	appAccessNow = func() time.Time { return now }
	appAccessEnable = func() bool { return true }
	SetAppAccessLookup(fn)
	t.Cleanup(func() { appAccessNow = time.Now })
	return &now
}

func TestDormantWhenNotEnforced(t *testing.T) {
	setup(t, func(context.Context, string) (bool, error) { return false, nil })
	appAccessEnable = func() bool { return false }
	if IsAppAccessDeniedUserID("u1") {
		t.Fatal("dormant must not deny")
	}
}
func TestOffDeniedOnDeniedAllowedPasses(t *testing.T) {
	setup(t, func(_ context.Context, id string) (bool, error) { return id == "ok", nil })
	if IsAppAccessDeniedUserID("ok") {
		t.Fatal("allowed denied")
	}
	if !IsAppAccessDeniedUserID("off") {
		t.Fatal("off allowed")
	}
	if !IsAppAccessDeniedUserID("") {
		t.Fatal("empty id allowed")
	}
}
func TestPendingNewIdentityNotAdmittedByCache(t *testing.T) {
	// targeted lookup: a never-seen id is decided by the resolver, not by a list
	setup(t, func(context.Context, string) (bool, error) { return false, nil })
	if !IsAppAccessDeniedUserID("new-pending") {
		t.Fatal("pending admitted")
	}
}
func TestRevocationWithinFreshTTL(t *testing.T) {
	allowed := true
	now := setup(t, func(context.Context, string) (bool, error) { return allowed, nil })
	if IsAppAccessDeniedUserID("u") {
		t.Fatal()
	}
	allowed = false
	*now = now.Add(appAccessFreshTTL + time.Second)
	if !IsAppAccessDeniedUserID("u") {
		t.Fatal("revocation not seen after TTL")
	}
}
func TestOutageBoundedGraceThenClosed(t *testing.T) {
	fail := false
	now := setup(t, func(context.Context, string) (bool, error) {
		if fail {
			return false, errors.New("db down")
		}
		return true, nil
	})
	if IsAppAccessDeniedUserID("u") {
		t.Fatal()
	}
	fail = true
	*now = now.Add(appAccessFreshTTL + time.Second)
	if IsAppAccessDeniedUserID("u") {
		t.Fatal("grace not honoured")
	}
	*now = now.Add(appAccessStaleGrace)
	if !IsAppAccessDeniedUserID("u") {
		t.Fatal("not closed after grace")
	}
}
func TestOutageNeverSeenOrDeniedStaysDenied(t *testing.T) {
	setup(t, func(context.Context, string) (bool, error) { return false, errors.New("down") })
	if !IsAppAccessDeniedUserID("never") {
		t.Fatal()
	}
}
func TestDeniedNotRescuedByOutage(t *testing.T) {
	fail := false
	now := setup(t, func(context.Context, string) (bool, error) {
		if fail {
			return false, errors.New("x")
		}
		return false, nil
	})
	if !IsAppAccessDeniedUserID("u") {
		t.Fatal()
	}
	fail = true
	*now = now.Add(appAccessFreshTTL + time.Second)
	if !IsAppAccessDeniedUserID("u") {
		t.Fatal("denied rescued")
	}
}
func TestNoLookupWiredFailsClosed(t *testing.T) {
	setup(t, nil)
	if !IsAppAccessDeniedUserID("u") {
		t.Fatal()
	}
}
