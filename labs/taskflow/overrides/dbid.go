// Zhuge AI OS Lab override for Multica canonical database row identities.
//
// The Multica application still owns its native models and lifecycle.  This
// override makes canonical persisted row IDs an explicit Zhuge Lab authority
// boundary while preserving Multica's UUIDv7 semantics and compatibility.
//
// Security/lease/idempotency tokens are intentionally NOT routed through this
// package; Multica keeps generating those with cryptographically random UUIDs.
package dbid

import (
    "log/slog"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5/pgtype"
)

// NewV7 is the Zhuge Lab canonical row-ID allocator used by Multica persistence.
// UUIDv7 is retained so upstream ordering/index locality semantics stay native.
func NewV7() pgtype.UUID {
    id, err := uuid.NewV7()
    if err != nil {
        slog.Error("zhuge lab uuid authority: uuidv7 generation failed; database fallback will be used", "error", err)
        return pgtype.UUID{}
    }
    return pgtype.UUID{Bytes: [16]byte(id), Valid: true}
}
