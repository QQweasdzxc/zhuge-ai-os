package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/issuestatus"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/dbid"
)

type zhugeLoginRequest struct {
	AccessToken string `json:"access_token"`
}

type zhugeSupabaseUser struct {
	ID           string         `json:"id"`
	Email        string         `json:"email"`
	UserMetadata map[string]any `json:"user_metadata"`
}

type zhugeAccessRow struct {
	Status string `json:"status"`
}

func zhugePGUUID(raw string) (pgtype.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(id), Valid: true}, nil
}

func zhugeDisplayName(u zhugeSupabaseUser) string {
	for _, key := range []string{"full_name", "name"} {
		if v, ok := u.UserMetadata[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	if at := strings.Index(u.Email, "@"); at > 0 {
		return u.Email[:at]
	}
	return u.Email
}

func zhugeSupabaseRequest(ctx context.Context, method, path, token string, body any) (*http.Response, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("ZHUGE_SUPABASE_URL")), "/")
	anon := strings.TrimSpace(os.Getenv("ZHUGE_SUPABASE_ANON_KEY"))
	if base == "" || anon == "" {
		return nil, errors.New("Zhuge Supabase identity bridge is not configured")
	}
	var reader *strings.Reader
	if body == nil {
		reader = strings.NewReader("")
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = strings.NewReader(string(raw))
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("apikey", anon)
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}

func verifyZhugeIdentity(ctx context.Context, token string) (zhugeSupabaseUser, error) {
	var user zhugeSupabaseUser
	resp, err := zhugeSupabaseRequest(ctx, http.MethodGet, "/auth/v1/user", token, nil)
	if err != nil {
		return user, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return user, fmt.Errorf("Zhuge identity rejected: %s", resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return user, err
	}
	if user.ID == "" || user.Email == "" {
		return user, errors.New("Zhuge identity is incomplete")
	}

	accessResp, err := zhugeSupabaseRequest(ctx, http.MethodPost, "/rest/v1/rpc/resolve_app_access", token, map[string]any{})
	if err != nil {
		return user, err
	}
	defer accessResp.Body.Close()
	if accessResp.StatusCode != http.StatusOK {
		return user, fmt.Errorf("Zhuge app access lookup failed: %s", accessResp.Status)
	}
	var raw json.RawMessage
	if err := json.NewDecoder(accessResp.Body).Decode(&raw); err != nil {
		return user, err
	}
	var rows []zhugeAccessRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		var row zhugeAccessRow
		if err2 := json.Unmarshal(raw, &row); err2 != nil {
			return user, err
		}
		rows = []zhugeAccessRow{row}
	}
	if len(rows) == 0 || !strings.EqualFold(strings.TrimSpace(rows[0].Status), "APPROVED") {
		return user, errors.New("Zhuge app access is not approved")
	}
	return user, nil
}

func (h *Handler) ensureZhugeUser(ctx context.Context, identity zhugeSupabaseUser) (db.User, error) {
	userID, err := zhugePGUUID(identity.ID)
	if err != nil {
		return db.User{}, err
	}

	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return db.User{}, err
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	existingByEmail, emailErr := qtx.GetUserByEmail(ctx, strings.ToLower(identity.Email))
	if emailErr == nil && uuidToString(existingByEmail.ID) != identity.ID {
		return db.User{}, errors.New("email is already bound to a different local identity")
	}
	if emailErr != nil && !errors.Is(emailErr, pgx.ErrNoRows) {
		return db.User{}, emailErr
	}

	name := zhugeDisplayName(identity)
	_, err = tx.Exec(ctx, `
		INSERT INTO "user" (id, name, email, onboarded_at, onboarding_questionnaire, profile_description)
		VALUES ($1, $2, $3, now(), '{}'::jsonb, '')
		ON CONFLICT (id) DO UPDATE
		SET name = EXCLUDED.name,
		    email = EXCLUDED.email,
		    onboarded_at = COALESCE("user".onboarded_at, now()),
		    updated_at = now()
	`, userID, name, strings.ToLower(identity.Email))
	if err != nil {
		return db.User{}, err
	}

	workspaces, err := qtx.ListWorkspaces(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if len(workspaces) == 0 {
		wsID := dbid.NewV7()
		memberID := dbid.NewV7()
		slug := "zhuge-lab-" + strings.ReplaceAll(identity.ID[:8], "-", "")
		_, err = tx.Exec(ctx, `
			INSERT INTO workspace
			  (id, name, slug, description, context, issue_prefix)
			VALUES
			  ($1, 'Zhuge AI OS Lab', $2,
			   'Multica native collaboration lab owned by Zhuge AI OS.',
			   'Identity, UUID authority, runtime and source boundaries are owned by Zhuge AI OS.',
			   'ZG')
		`, wsID, slug)
		if err != nil {
			return db.User{}, err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO member (id, workspace_id, user_id, role)
			VALUES ($1, $2, $3, 'owner')
		`, memberID, wsID, userID)
		if err != nil {
			return db.User{}, err
		}
		if err := issuestatus.Ensure(ctx, qtx, wsID); err != nil {
			return db.User{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return db.User{}, err
	}
	return h.Queries.GetUser(ctx, userID)
}

// ZhugeLogin accepts the already-authenticated Zhuge Supabase session.
// There is deliberately no Multica registration / OTP step: Zhuge remains the
// single human Identity Authority, and Multica reuses that canonical UUID.
func (h *Handler) ZhugeLogin(w http.ResponseWriter, r *http.Request) {
	var req zhugeLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	token := strings.TrimSpace(req.AccessToken)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing Zhuge session")
		return
	}

	identity, err := verifyZhugeIdentity(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusForbidden, "Zhuge identity is not authorized")
		return
	}
	user, err := h.ensureZhugeUser(r.Context(), identity)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to bind Zhuge identity")
		return
	}

	tokenString, err := h.issueJWT(user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create local session")
		return
	}
	_ = auth.SetAuthCookies(w, tokenString)

	writeJSON(w, http.StatusOK, LoginResponse{
		Token: tokenString,
		User:  h.userToResponse(user),
	})
}

var _ = time.Second
