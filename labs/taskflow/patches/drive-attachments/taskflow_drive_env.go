package storage

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const TaskFlowDriveCallbackPath = "/auth/taskflow-drive/callback"

func TaskFlowDriveSetupFromEnv(db TaskFlowDriveDB) (*TaskFlowDriveOAuthSetup, error) {
	if os.Getenv("TASKFLOW_DRIVE_SETUP_ENABLED") != "1" {
		return nil, nil
	}
	s := &TaskFlowDriveOAuthSetup{Client: &http.Client{Timeout: 30 * time.Second}, ClientID: os.Getenv("TASKFLOW_DRIVE_CLIENT_ID"), ClientSecret: os.Getenv("TASKFLOW_DRIVE_CLIENT_SECRET"), MasterSecret: os.Getenv("TASKFLOW_DRIVE_MASTER_SECRET"), OwnerEmail: os.Getenv("TASKFLOW_DRIVE_OWNER_EMAIL"), CallbackURL: os.Getenv("TASKFLOW_DRIVE_CALLBACK_URL"), Store: TaskFlowSQLDriveSetup{db}}
	u, e := url.Parse(s.CallbackURL)
	if e != nil || u.Path != TaskFlowDriveCallbackPath {
		return nil, errors.New("private Drive callback path mismatch")
	}
	if e = s.validate(); e != nil {
		return nil, e
	}
	return s, nil
}
func TaskFlowDriveStorageFromEnv(ctx context.Context, db TaskFlowDriveDB) (*TaskFlowDriveStorage, error) {
	mode := strings.TrimSpace(os.Getenv("TASKFLOW_ATTACHMENT_STORAGE"))
	if mode != "drive" && mode != "drive-readonly" {
		return nil, errors.New("unsupported private Drive storage mode")
	}
	setup, e := TaskFlowDriveSetupFromEnv(db)
	if e != nil || setup == nil {
		return nil, errors.New("private Drive setup unavailable; refusing ephemeral fallback")
	}
	sealed, owner, e := (TaskFlowSQLDriveSetup{db}).LoadGrant(ctx)
	if e != nil || !strings.EqualFold(owner, setup.OwnerEmail) {
		return nil, errors.New("private Drive grant missing or wrong account")
	}
	plain, e := openDriveGrant(setup.MasterSecret, sealed)
	if e != nil {
		return nil, errors.New("private Drive grant unavailable")
	}
	defer clearDriveBytes(plain)
	var grant struct {
		Refresh string `json:"refresh_token"`
		Scope   string `json:"scope"`
		Owner   string `json:"owner_email"`
		Folder  string `json:"folder_id"`
	}
	if json.Unmarshal(plain, &grant) != nil || grant.Refresh == "" || grant.Scope != TaskFlowDriveScope || !strings.EqualFold(grant.Owner, setup.OwnerEmail) {
		return nil, errors.New("private Drive grant scope mismatch")
	}
	tokens := &TaskFlowDriveOAuthToken{Client: setup.Client, ClientID: setup.ClientID, ClientSecret: setup.ClientSecret, RefreshToken: grant.Refresh}
	tokens.PersistRefresh = func(ctx context.Context, refresh string) error {
		payload, _ := json.Marshal(map[string]string{"refresh_token": refresh, "scope": TaskFlowDriveScope, "owner_email": grant.Owner, "folder_id": grant.Folder})
		defer clearDriveBytes(payload)
		sealed, e := sealDriveGrant(setup.MasterSecret, payload)
		if e != nil {
			return e
		}
		return (TaskFlowSQLDriveSetup{db}).SaveGrant(ctx, sealed, grant.Owner)
	}
	folder := os.Getenv("TASKFLOW_DRIVE_FOLDER_ID")
	if folder != "" && folder != grant.Folder {
		return nil, errors.New("Drive folder differs from authorized app folder")
	}
	folder = grant.Folder
	store, e := NewTaskFlowDriveStorage(setup.Client, tokens, TaskFlowSQLDriveIndex{db}, folder)
	if e != nil {
		return nil, e
	}
	if e = store.checkFolder(ctx); e != nil {
		return nil, e
	}
	policy := os.Getenv("TASKFLOW_DRIVE_DELETE_POLICY")
	if policy != "" && policy != "trash30" {
		return nil, errors.New("unsupported Drive deletion policy")
	}
	store.trashEnabled = policy == "trash30"
	if mode == "drive-readonly" {
		store.SetReadOnly()
	}
	return store, nil
}
