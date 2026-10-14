package storage

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testTaskFlowUserID = "11111111-1111-4111-8111-111111111111"
const testTaskFlowObjectKey = "workspaces/22222222-2222-4222-8222-222222222222/018f0000-0000-7000-8000-000000000001.pdf"

func TestTaskFlowTUSBaseURLUsesProjectStorageHostname(t *testing.T) {
	projectURL, err := url.Parse("https://example-project.supabase.co")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := taskFlowTUSBaseURL(projectURL), "https://example-project.storage.supabase.co"; got != want {
		t.Fatalf("TUS base URL = %q, want %q", got, want)
	}
	customURL, err := url.Parse("https://storage.internal.example.test")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := taskFlowTUSBaseURL(customURL), customURL.String(); got != want {
		t.Fatalf("custom TUS base URL = %q, want %q", got, want)
	}
}

func TestTaskFlowSupabaseStorageResumableUploadAndReadback13MiB(t *testing.T) {
	data := bytes.Repeat([]byte("x"), (13<<20)+(512<<10))
	var nextOffset int
	var chunks int
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "public-test-key" || r.Header.Get("Authorization") != "Bearer supabase.user.jwt" {
			t.Errorf("storage request did not carry scoped credentials")
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/storage/v1/upload/resumable":
			if r.Header.Get("Tus-Resumable") != "1.0.0" || r.Header.Get("Upload-Length") != fmt.Sprint(len(data)) || r.Header.Get("x-upsert") != "false" {
				t.Errorf("TUS create headers are incomplete")
			}
			metadata := parseTusMetadata(r.Header.Get("Upload-Metadata"))
			if metadata["bucketName"] != TaskFlowSupabaseAttachmentBucket || metadata["objectName"] != testTaskFlowObjectKey || metadata["contentType"] != "application/pdf" {
				t.Errorf("TUS metadata did not scope the object: %#v", metadata)
			}
			w.Header().Set("Location", "/storage/v1/upload/resumable/upload-1")
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPatch && r.URL.Path == "/storage/v1/upload/resumable/upload-1":
			if got := r.Header.Get("Upload-Offset"); got != fmt.Sprint(nextOffset) {
				t.Errorf("chunk offset = %q, want %d", got, nextOffset)
			}
			if r.Header.Get("Content-Type") != "application/offset+octet-stream" || r.Header.Get("Tus-Resumable") != "1.0.0" {
				t.Errorf("TUS chunk headers are incomplete")
			}
			chunk, _ := io.ReadAll(r.Body)
			nextOffset += len(chunk)
			chunks++
			w.Header().Set("Upload-Offset", fmt.Sprint(nextOffset))
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/storage/v1/object/info/taskflow-attachments/"):
			_, _ = fmt.Fprintf(w, `{"size":%d}`, len(data))
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	store, err := NewTaskFlowSupabaseStorage(server.URL, "public-test-key", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithTaskFlowSupabaseJWT(context.Background(), "supabase.user.jwt")
	url, err := store.Upload(ctx, testTaskFlowObjectKey, data, "application/pdf", "not-used-in-key.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if nextOffset != len(data) || chunks != 3 {
		t.Fatalf("uploaded %d bytes in %d chunks, want %d in 3 chunks", nextOffset, chunks, len(data))
	}
	if !strings.Contains(url, "/storage/v1/object/authenticated/taskflow-attachments/") || strings.Contains(url, "supabase.user.jwt") {
		t.Fatalf("returned object URL is not a stable private URL: %q", url)
	}
}

func TestTaskFlowSupabaseStorageRejectsMissingJWTAndInvalidKeys(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("storage request made without a scoped user JWT")
	}))
	defer server.Close()
	store, err := NewTaskFlowSupabaseStorage(server.URL, "public-test-key", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Upload(context.Background(), testTaskFlowObjectKey, []byte("x"), "application/pdf", "x.pdf"); err == nil {
		t.Fatal("upload without identity JWT unexpectedly succeeded")
	}
	ctx := WithTaskFlowSupabaseJWT(context.Background(), "supabase.user.jwt")
	for _, key := range []string{
		"workspaces/22222222-2222-4222-8222-222222222222/../escape",
		"other-bucket/22222222-2222-4222-8222-222222222222/file.pdf",
		"workspaces/not-a-uuid/file.pdf",
		"users/22222222-2222-4222-8222-222222222222/avatar.png",
	} {
		if _, err := store.Upload(ctx, key, []byte("x"), "application/pdf", "x.pdf"); err == nil {
			t.Errorf("invalid key %q unexpectedly succeeded", key)
		}
	}
	if _, err := store.Upload(ctx, testTaskFlowObjectKey, make([]byte, TaskFlowSupabaseAttachmentMaxBytes+1), "application/pdf", "large.pdf"); err == nil {
		t.Fatal("oversize upload unexpectedly succeeded")
	}
}

func TestTaskFlowSupabaseStorageRejectsServiceRoleCredentials(t *testing.T) {
	serviceRole := "e30." + base64.RawURLEncoding.EncodeToString([]byte(`{"role":"service_role"}`)) + ".sig"
	if _, err := NewTaskFlowSupabaseStorage("https://project.example.test", serviceRole, nil); err == nil {
		t.Fatal("service_role key unexpectedly accepted as anon key")
	}
	if _, err := NewTaskFlowSupabaseStorage("https://project.example.test", "sb_secret_project-wide", nil); err == nil {
		t.Fatal("Supabase secret key unexpectedly accepted as anon key")
	}
}

func TestTaskFlowSupabaseStorageSignsOnlySameOriginURLAndDownloadName(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.Path, "/storage/v1/object/sign/taskflow-attachments/") {
			t.Errorf("unexpected signature request %s %s", r.Method, r.URL.Path)
		}
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = fmt.Fprint(w, `{"signedURL":"/object/sign/taskflow-attachments/file.pdf?token=short-lived"}`)
	}))
	defer server.Close()
	store, err := NewTaskFlowSupabaseStorage(server.URL, "public-test-key", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithTaskFlowSupabaseJWT(context.Background(), "supabase.user.jwt")
	signed, err := store.PresignGetWithContentDisposition(ctx, testTaskFlowObjectKey, 5*time.Minute, `attachment; filename="報價 1.pdf"`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(signed, server.URL+"/storage/v1/object/sign/taskflow-attachments/") || !strings.Contains(signed, "download=") || strings.Contains(signed, "supabase.user.jwt") {
		t.Fatalf("signed download URL is not safe or same-origin: %q", signed)
	}
}

func parseTusMetadata(raw string) map[string]string {
	result := make(map[string]string)
	for _, entry := range strings.Split(raw, ",") {
		parts := strings.SplitN(strings.TrimSpace(entry), " ", 2)
		if len(parts) != 2 {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(parts[1])
		if err == nil {
			result[parts[0]] = string(decoded)
		}
	}
	return result
}
