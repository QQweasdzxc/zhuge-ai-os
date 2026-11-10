package storage

import (
	"context"
	"errors"
	"time"
)

type TaskFlowSQLDriveSetup struct{ DB TaskFlowDriveDB }

func (s TaskFlowSQLDriveSetup) Issue(ctx context.Context, stateHash string, expiry time.Time, sealedVerifier []byte) error {
	_, e := s.DB.Exec(ctx, `DELETE FROM taskflow.attachment_drive_setup_state WHERE expires_at<clock_timestamp()`)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec(ctx, `INSERT INTO taskflow.attachment_drive_setup_state(state_hash,expires_at,verifier_cipher) VALUES($1,$2,$3)`, stateHash, expiry, sealedVerifier)
	return e
}
func (s TaskFlowSQLDriveSetup) Claim(ctx context.Context, stateHash string, now time.Time) ([]byte, error) {
	var cipher []byte
	e := s.DB.QueryRow(ctx, `UPDATE taskflow.attachment_drive_setup_state SET claimed=true WHERE state_hash=$1 AND NOT claimed AND expires_at>$2 RETURNING verifier_cipher`, stateHash, now).Scan(&cipher)
	if e != nil {
		return nil, errors.New("Drive connection entry invalid or expired")
	}
	return cipher, nil
}
func (s TaskFlowSQLDriveSetup) SaveGrant(ctx context.Context, cipher []byte, owner string) error {
	_, e := s.DB.Exec(ctx, `INSERT INTO taskflow.attachment_drive_grant(id,grant_cipher,owner_email) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET grant_cipher=EXCLUDED.grant_cipher,owner_email=EXCLUDED.owner_email,updated_at=clock_timestamp()`, cipher, owner)
	return e
}
func (s TaskFlowSQLDriveSetup) LoadGrant(ctx context.Context) ([]byte, string, error) {
	var cipher []byte
	var owner string
	e := s.DB.QueryRow(ctx, `SELECT grant_cipher,owner_email FROM taskflow.attachment_drive_grant WHERE id=1`).Scan(&cipher, &owner)
	return cipher, owner, e
}
