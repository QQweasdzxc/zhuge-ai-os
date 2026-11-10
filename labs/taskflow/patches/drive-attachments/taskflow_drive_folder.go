package storage

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// A pre-generated folder ID is reserved before creation. Retries reuse that
// immutable ID rather than creating another folder with a look-alike name.
func (s *TaskFlowDriveOAuthSetup) provisionFolder(ctx context.Context, client *http.Client, access string) (string, error) {
	base := "https://www.googleapis.com"
	if s.driveEndpoint != "" {
		base = s.driveEndpoint
	}
	call := func(method, path, body string) (*http.Response, error) {
		req, e := http.NewRequestWithContext(ctx, method, base+path, strings.NewReader(body))
		if e != nil {
			return nil, e
		}
		req.Header.Set("Authorization", "Bearer "+access)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		return client.Do(req)
	}
	res, e := call("GET", "/drive/v3/files/generateIds?count=1&space=drive&type=files", "")
	if e != nil {
		return "", e
	}
	var ids struct {
		IDs []string `json:"ids"`
	}
	e = json.NewDecoder(io.LimitReader(res.Body, 8192)).Decode(&ids)
	closeDriveResponse(res)
	if e != nil || res.StatusCode != 200 || len(ids.IDs) != 1 || !validDriveID(ids.IDs[0]) {
		return "", errors.New("Drive folder ID unavailable")
	}
	id, e := s.Store.ReserveFolder(ctx, ids.IDs[0])
	if e != nil || !validDriveID(id) {
		return "", errors.New("Drive folder reservation unavailable")
	}
	payload, _ := json.Marshal(map[string]any{"id": id, "name": "TRQN TF 附件", "mimeType": "application/vnd.google-apps.folder", "parents": []string{"root"}, "appProperties": map[string]string{"taskflow_private_attachments": "v1"}})
	res, e = call("POST", "/drive/v3/files?fields=id", string(payload))
	if e != nil {
		return "", e
	}
	status := res.StatusCode
	closeDriveResponse(res)
	if status != 200 && status != 201 && status != 409 {
		return "", errors.New("private Drive folder creation incomplete")
	}
	res, e = call("GET", "/drive/v3/files/"+id+"?fields=id,mimeType,trashed,shared,ownedByMe,appProperties", "")
	if e != nil {
		return "", e
	}
	var m struct {
		ID         string            `json:"id"`
		Mime       string            `json:"mimeType"`
		Trashed    bool              `json:"trashed"`
		Shared     *bool             `json:"shared"`
		Owned      bool              `json:"ownedByMe"`
		Properties map[string]string `json:"appProperties"`
	}
	e = json.NewDecoder(io.LimitReader(res.Body, 8192)).Decode(&m)
	closeDriveResponse(res)
	if e != nil || res.StatusCode != 200 || m.ID != id || m.Mime != "application/vnd.google-apps.folder" || m.Trashed || m.Shared == nil || *m.Shared || !m.Owned || m.Properties["taskflow_private_attachments"] != "v1" {
		return "", errors.New("Drive folder is not private and app-owned")
	}
	return id, nil
}

func (s TaskFlowSQLDriveSetup) ReserveFolder(ctx context.Context, proposed string) (string, error) {
	if !validDriveID(proposed) {
		return "", errors.New("invalid Drive folder ID")
	}
	_, e := s.DB.Exec(ctx, `INSERT INTO taskflow.attachment_drive_folder(id,file_id) VALUES(1,$1) ON CONFLICT(id) DO NOTHING`, proposed)
	if e != nil {
		return "", e
	}
	var id string
	e = s.DB.QueryRow(ctx, `SELECT file_id FROM taskflow.attachment_drive_folder WHERE id=1`).Scan(&id)
	return id, e
}
