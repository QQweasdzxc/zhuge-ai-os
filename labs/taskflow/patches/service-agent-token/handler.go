package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/auth"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/dbid"
)

func (h *Handler) serviceTokenOwner(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	if isMachineCredentialActor(r) {
		writeError(w, 403, "human actor required")
		return "", "", "", false
	}
	human, ok := requireUserID(w, r)
	if !ok {
		return "", "", "", false
	}
	ws := h.resolveWorkspaceID(r)
	member, err := h.getWorkspaceMember(r.Context(), human, ws)
	if err != nil || member.Role != "owner" {
		writeError(w, 403, "workspace owner required")
		return "", "", "", false
	}
	agent := chi.URLParam(r, "id")
	id, err := parseServiceTokenUUID(agent)
	if err != nil {
		writeError(w, 400, "invalid agent id")
		return "", "", "", false
	}
	a, err := h.Queries.GetAgent(r.Context(), id)
	if err != nil || uuidToString(a.WorkspaceID) != ws || a.ArchivedAt.Valid {
		writeError(w, 403, "agent outside workspace")
		return "", "", "", false
	}
	// A workspace owner must not mint another owner's agent identity,
	// especially for a private agent. Token management is owner-isolated.
	if uuidToString(a.OwnerID) != human {
		writeError(w, http.StatusForbidden, "agent owner required")
		return "", "", "", false
	}
	return agent, ws, human, true
}

func parseServiceTokenUUID(s string) (pgtype.UUID, error) {
	var id pgtype.UUID
	err := id.Scan(s)
	return id, err
}

func (h *Handler) CreateServiceAgentToken(w http.ResponseWriter, r *http.Request) {
	agent, ws, human, ok := h.serviceTokenOwner(w, r)
	if !ok {
		return
	}
	var req struct {
		Name      string     `json:"name"`
		ExpiresAt *time.Time `json:"expires_at"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if dec.Decode(&req) != nil {
		writeError(w, 400, "invalid request")
		return
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		writeError(w, 400, "invalid request")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	now := time.Now().UTC()
	expires := now.Add(90 * 24 * time.Hour)
	if req.ExpiresAt != nil {
		expires = req.ExpiresAt.UTC()
	}
	if req.Name == "" || len(req.Name) > 200 || !expires.After(now) || expires.After(now.Add(90*24*time.Hour)) {
		writeError(w, 400, "name and expiry within 90 days required")
		return
	}
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		writeError(w, 500, "token generation failed")
		return
	}
	plaintext := "sat_" + hex.EncodeToString(secret[:])
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "transaction failed")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	token, err := q.CreateServiceAgentToken(r.Context(), uuidToString(dbid.NewV7()), agent, ws, req.Name, auth.HashToken(plaintext), human, expires)
	if err != nil {
		writeError(w, 500, "token creation failed")
		return
	}
	if err = h.auditServiceToken(r, q, "service_agent_token_created", token.ID, agent, ws, human); err != nil {
		writeError(w, 500, "audit write failed")
		return
	}
	if tx.Commit(r.Context()) != nil {
		writeError(w, 500, "commit failed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, struct {
		db.ServiceAgentTokenMetadata
		Token string `json:"token"`
	}{token, plaintext})
}

func (h *Handler) ListServiceAgentTokens(w http.ResponseWriter, r *http.Request) {
	agent, ws, _, ok := h.serviceTokenOwner(w, r)
	if !ok {
		return
	}
	tokens, err := h.Queries.ListServiceAgentTokens(r.Context(), agent, ws)
	if err != nil {
		writeError(w, 500, "token listing failed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, tokens)
}

func (h *Handler) RevokeServiceAgentToken(w http.ResponseWriter, r *http.Request) {
	agent, ws, human, ok := h.serviceTokenOwner(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "tokenId")
	if _, err := parseServiceTokenUUID(id); err != nil {
		writeError(w, 400, "invalid token id")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "transaction failed")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	if q.RevokeServiceAgentToken(r.Context(), id, agent, ws) != nil {
		writeError(w, 404, "token not found")
		return
	}
	if h.auditServiceToken(r, q, "service_agent_token_revoked", id, agent, ws, human) != nil {
		writeError(w, 500, "audit write failed")
		return
	}
	if tx.Commit(r.Context()) != nil {
		writeError(w, 500, "commit failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) auditServiceToken(r *http.Request, q *db.Queries, action, id, agent, ws, human string) error {
	// Audit metadata intentionally excludes both hash and plaintext.
	details, _ := json.Marshal(map[string]string{"token_id": id, "agent_id": agent})
	_, err := q.CreateActivity(r.Context(), db.CreateActivityParams{ID: dbid.NewV7(), WorkspaceID: parseUUID(ws), ActorType: pgtype.Text{String: "member", Valid: true}, ActorID: parseUUID(human), Action: action, Details: details})
	return err
}
