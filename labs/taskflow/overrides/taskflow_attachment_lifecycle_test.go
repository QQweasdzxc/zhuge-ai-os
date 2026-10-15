package storage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTaskFlowLifecycleIntentGatewayAndReservation(t *testing.T) {
	t.Setenv("TASKFLOW_ATTACHMENT_LIFECYCLE", "true")
	intents := []string{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer isolated-user-jwt" {
			t.Error("scoped credential missing")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path == "/rest/v1/rpc/attachment_reserve_taskflow" {
			if body["p_card"] != "33333333-3333-4333-8333-333333333333" || body["p_size"] != float64(13) {
				t.Error("reservation lost card/size")
			}
			w.WriteHeader(204)
			return
		}
		intent, _ := body["intent"].(string)
		intents = append(intents, intent)
		if intent == "preview" {
			w.WriteHeader(404)
			return
		}
		if intent == "download" {
			json.NewEncoder(w).Encode(map[string]any{"enabled": true, "url": "https://" + r.Host + "/functions/v1/attachment-lifecycle?cap=isolated-download"})
			return
		}
		t.Error("unexpected gateway intent")
	}))
	defer server.Close()
	adapter, err := NewTaskFlowSupabaseStorage(server.URL, "anon", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithTaskFlowSupabaseJWT(context.Background(), "isolated-user-jwt")
	ctx = WithTaskFlowAttachmentCard(ctx, "33333333-3333-4333-8333-333333333333")
	if err := adapter.lifecycleReserve(ctx, testTaskFlowObjectKey, "fixture.pdf", 13); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.PresignGet(ctx, testTaskFlowObjectKey, time.Hour); err == nil {
		t.Fatal("expired preview was allowed")
	}
	signed, err := adapter.PresignGetWithContentDisposition(ctx, testTaskFlowObjectKey, time.Hour, "attachment; filename=test.pdf")
	if err != nil || !strings.Contains(signed, "cap=isolated-download") {
		t.Fatalf("download after preview expiry: %v", err)
	}
	if strings.Join(intents, ",") != "preview,download" {
		t.Fatal(intents)
	}
}

func TestTaskFlowConfiguredFreeUploadCap(t *testing.T) {
	t.Setenv("ZHUGE_SUPABASE_URL", "https://isolated.supabase.co")
	t.Setenv("ZHUGE_SUPABASE_ANON_KEY", "isolated-publishable")
	t.Setenv("TASKFLOW_STORAGE_MAX_BYTES", "14000000")
	adapter, err := NewTaskFlowSupabaseStorageFromEnv()
	if err != nil || adapter.maxBytes != 14000000 {
		t.Fatalf("lower project cap not honored: %v", err)
	}
	t.Setenv("TASKFLOW_STORAGE_MAX_BYTES", "50000001")
	if _, err := NewTaskFlowSupabaseStorageFromEnv(); err == nil {
		t.Fatal("paid-tier cap was accepted")
	}
}
