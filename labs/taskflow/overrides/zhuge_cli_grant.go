package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"
)

const (
	// CLIAuthorizationCodePrefix is an opaque, one-use code carried through
	// the native CLI's legacy "token" callback field. It is not a bearer API
	// access token and is accepted only by POST /api/tokens.
	CLIAuthorizationCodePrefix      = "zgc_"
	cliAuthorizationCodeTTL         = 5 * time.Minute
	maxPendingCLIAuthorizationCodes = 4096
)

type cliAuthorizationGrant struct {
	userID    string
	expiresAt time.Time
}

var cliAuthorizationGrants = struct {
	sync.Mutex
	codes map[[32]byte]cliAuthorizationGrant
}{codes: make(map[[32]byte]cliAuthorizationGrant)}

func NewCLIAuthorizationCode(userID string) (string, error) {
	return newCLIAuthorizationCodeAt(userID, time.Now())
}

func newCLIAuthorizationCodeAt(userID string, now time.Time) (string, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", errors.New("missing canonical user identity")
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	code := CLIAuthorizationCodePrefix + base64.RawURLEncoding.EncodeToString(random[:])
	digest := sha256.Sum256([]byte(code))
	cliAuthorizationGrants.Lock()
	defer cliAuthorizationGrants.Unlock()
	for key, grant := range cliAuthorizationGrants.codes {
		if !now.Before(grant.expiresAt) {
			delete(cliAuthorizationGrants.codes, key)
		}
	}
	if len(cliAuthorizationGrants.codes) >= maxPendingCLIAuthorizationCodes {
		return "", errors.New("too many pending CLI authorizations")
	}
	if _, exists := cliAuthorizationGrants.codes[digest]; exists {
		return "", errors.New("duplicate CLI authorization code")
	}
	cliAuthorizationGrants.codes[digest] = cliAuthorizationGrant{userID: userID, expiresAt: now.Add(cliAuthorizationCodeTTL)}
	return code, nil
}

// A process restart invalidates outstanding grants safely; the user restarts CLI login.
func ConsumeCLIAuthorizationCode(code string) (string, bool) {
	return consumeCLIAuthorizationCodeAt(code, time.Now())
}

func consumeCLIAuthorizationCodeAt(code string, now time.Time) (string, bool) {
	if !strings.HasPrefix(code, CLIAuthorizationCodePrefix) {
		return "", false
	}
	digest := sha256.Sum256([]byte(code))
	cliAuthorizationGrants.Lock()
	defer cliAuthorizationGrants.Unlock()
	grant, exists := cliAuthorizationGrants.codes[digest]
	if exists {
		delete(cliAuthorizationGrants.codes, digest)
	}
	if !exists || !now.Before(grant.expiresAt) {
		return "", false
	}
	return grant.userID, true
}
