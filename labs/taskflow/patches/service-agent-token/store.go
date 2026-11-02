// TaskFlow-owned overlay, not sqlc output. Schema changes are reviewed separately.
package db

import (
	"context"
	"time"
)

// ServiceAgentTokenMetadata never contains a hash or plaintext credential.
type ServiceAgentTokenMetadata struct {
	ID          string     `json:"id"`
	AgentID     string     `json:"agent_id"`
	WorkspaceID string     `json:"workspace_id"`
	Name        string     `json:"name"`
	CreatedBy   string     `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	ExpiresAt   time.Time  `json:"expires_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
}

// Authentication deliberately has no cache: revoke and expiry take effect on
// the next request. Membership/agent deletion or archival also fails closed.
func (q *Queries) AuthenticateServiceAgentToken(ctx context.Context, hash string) (ServiceAgentTokenMetadata, string, error) {
	var t ServiceAgentTokenMetadata
	var slug string
	err := q.db.QueryRow(ctx, `UPDATE taskflow.service_agent_tokens t SET last_used_at=clock_timestamp()
 FROM taskflow.agent a, taskflow.member m, taskflow.workspace w
 WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp()
 AND a.id=t.agent_id AND a.workspace_id=t.workspace_id AND a.archived_at IS NULL
 AND a.owner_id=t.created_by
 AND m.user_id=t.created_by AND m.workspace_id=t.workspace_id AND w.id=t.workspace_id
 RETURNING t.id::text,t.agent_id::text,t.workspace_id::text,t.name,t.created_by::text,
 t.created_at,t.last_used_at,t.expires_at,t.revoked_at,w.slug`, hash).Scan(
		&t.ID, &t.AgentID, &t.WorkspaceID, &t.Name, &t.CreatedBy, &t.CreatedAt, &t.LastUsedAt, &t.ExpiresAt, &t.RevokedAt, &slug)
	return t, slug, err
}

// ServiceAgentResourceInWorkspace checks resource ownership before a handler
// that might otherwise authorize via the human's memberships in other workspaces.
func (q *Queries) ServiceAgentResourceInWorkspace(ctx context.Context, kind, id, ws string) bool {
	var ok bool
	var sql string
	switch kind {
	case "issue":
		sql = `SELECT EXISTS(SELECT 1 FROM taskflow.issue WHERE id=$1::uuid AND workspace_id=$2::uuid)`
	case "attachment":
		sql = `SELECT EXISTS(SELECT 1 FROM taskflow.attachment a JOIN taskflow.issue i ON i.id=a.issue_id AND i.workspace_id=a.workspace_id WHERE a.id=$1::uuid AND a.workspace_id=$2::uuid AND a.chat_session_id IS NULL AND a.chat_message_id IS NULL)`
	default:
		return false
	}
	return q.db.QueryRow(ctx, sql, id, ws).Scan(&ok) == nil && ok
}

func (q *Queries) CreateServiceAgentToken(ctx context.Context, id, agent, ws, name, hash, human string, expires time.Time) (ServiceAgentTokenMetadata, error) {
	var t ServiceAgentTokenMetadata
	err := q.db.QueryRow(ctx, `INSERT INTO taskflow.service_agent_tokens
 (id,agent_id,workspace_id,name,token_hash,created_by,expires_at)
 SELECT $1::uuid,a.id,a.workspace_id,$4,$5,m.user_id,$7
 FROM taskflow.agent a JOIN taskflow.member m ON m.workspace_id=a.workspace_id
 WHERE a.id=$2::uuid AND a.workspace_id=$3::uuid AND a.archived_at IS NULL
 AND m.user_id=$6::uuid AND m.role='owner' AND a.owner_id=m.user_id
 RETURNING id::text,agent_id::text,workspace_id::text,name,created_by::text,created_at,last_used_at,expires_at,revoked_at`,
		id, agent, ws, name, hash, human, expires).Scan(&t.ID, &t.AgentID, &t.WorkspaceID, &t.Name, &t.CreatedBy, &t.CreatedAt, &t.LastUsedAt, &t.ExpiresAt, &t.RevokedAt)
	return t, err
}

func (q *Queries) ListServiceAgentTokens(ctx context.Context, agent, ws string) ([]ServiceAgentTokenMetadata, error) {
	rows, err := q.db.Query(ctx, `SELECT id::text,agent_id::text,workspace_id::text,name,created_by::text,created_at,last_used_at,expires_at,revoked_at
 FROM taskflow.service_agent_tokens WHERE agent_id=$1::uuid AND workspace_id=$2::uuid ORDER BY created_at,id`, agent, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ServiceAgentTokenMetadata{}
	for rows.Next() {
		var t ServiceAgentTokenMetadata
		if err := rows.Scan(&t.ID, &t.AgentID, &t.WorkspaceID, &t.Name, &t.CreatedBy, &t.CreatedAt, &t.LastUsedAt, &t.ExpiresAt, &t.RevokedAt); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

func (q *Queries) RevokeServiceAgentToken(ctx context.Context, id, agent, ws string) error {
	var found string
	return q.db.QueryRow(ctx, `UPDATE taskflow.service_agent_tokens SET revoked_at=coalesce(revoked_at,clock_timestamp())
 WHERE id=$1::uuid AND agent_id=$2::uuid AND workspace_id=$3::uuid RETURNING id::text`, id, agent, ws).Scan(&found)
}
