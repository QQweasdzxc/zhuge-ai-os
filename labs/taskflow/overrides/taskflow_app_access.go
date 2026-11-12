package auth

// ZG-71. Dormant until TASKFLOW_APP_ACCESS_ENFORCE=on. Per-request App access decision for
// TaskFlow human credentials. Targeted lookup by user id against the same
// resolver as the Supabase gates; bounded last-good cache; fail closed.

import (
	"context"
	"os"
	"strings"
	"sync"
	"time"
)

type AppAccessLookup func(ctx context.Context, userID string) (bool, error)

const (
	appAccessFreshTTL   = 15 * time.Second // max revocation delay when DB is reachable
	appAccessStaleGrace = 60 * time.Second // max time a known-allowed answer survives a lookup outage
	appAccessLookupTime = 2 * time.Second
)

type appAccessEntry struct {
	allowed bool
	at      time.Time
}

var (
	appAccessMu     sync.Mutex
	appAccessFn     AppAccessLookup
	appAccessCache  = map[string]appAccessEntry{}
	appAccessNow    = time.Now
	appAccessEnable = func() bool {
		return strings.EqualFold(strings.TrimSpace(os.Getenv("TASKFLOW_APP_ACCESS_ENFORCE")), "on")
	}
)

// SetAppAccessLookup is called once at startup with a DB-backed lookup.
func SetAppAccessLookup(fn AppAccessLookup) {
	appAccessMu.Lock()
	defer appAccessMu.Unlock()
	appAccessFn = fn
	appAccessCache = map[string]appAccessEntry{}
}

// IsAppAccessDeniedUserID reports whether App access is Off for this user.
// Dormant (false) unless TASKFLOW_APP_ACCESS_ENFORCE=on. When enforced:
//   - fresh cache (<=15s) answers;
//   - otherwise a 2s targeted lookup; success refreshes the cache;
//   - lookup failure: only a previously ALLOWED answer younger than 60s
//     is honoured; anything else (never seen, denied, expired, no lookup
//     wired, invalid id) is denied. No creator bypass: the DB refuses to
//     switch a creator or oneself Off, so none is needed.
func IsAppAccessDeniedUserID(userID string) bool {
	if !appAccessEnable() {
		return false
	}
	id := strings.ToLower(strings.TrimSpace(userID))
	if id == "" {
		return true
	}
	now := appAccessNow()
	appAccessMu.Lock()
	fn := appAccessFn
	e, ok := appAccessCache[id]
	appAccessMu.Unlock()
	if ok && now.Sub(e.at) <= appAccessFreshTTL {
		return !e.allowed
	}
	if fn == nil {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), appAccessLookupTime)
	defer cancel()
	allowed, err := fn(ctx, id)
	if err != nil {
		return !(ok && e.allowed && now.Sub(e.at) <= appAccessStaleGrace)
	}
	appAccessMu.Lock()
	appAccessCache[id] = appAccessEntry{allowed: allowed, at: now}
	appAccessMu.Unlock()
	return !allowed
}
