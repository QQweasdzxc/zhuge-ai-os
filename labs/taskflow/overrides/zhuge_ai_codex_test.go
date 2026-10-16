package handler

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTaskflowCodexDispatchCommentBindsRunPRAndCheckpoint(t *testing.T) {
	target := codexDispatchTarget{
		Owner: "QQweasdzxc", Repository: "zhuge-ai-os", Number: 52,
		HeadSHA: strings.Repeat("a", 40), URL: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/52",
	}
	comment, err := buildCodexDispatchComment(
		"01a13ee3-8cb4-7e81-9cac-b26a6cebf570", "01a13ee3-8cb4-7e81-9cac-b26a6cebf571",
		"ZG-42", target, "Review dispatch", "Do the scoped TaskFlow change.",
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"@codex", "Run ID:", "PR: #52", target.HeadSHA,
		"ZHUGE_CODEX_DISPATCH_V1", "ZHUGE_CODEX_ACK_V1", "ZHUGE_CODEX_RESULT_V1",
		"public GitHub PR", "TaskFlow title:"} {
		if !strings.Contains(comment, want) {
			t.Errorf("dispatch comment missing %q", want)
		}
	}
	if !strings.Contains(comment, "ACTUAL_CLOUD_THREAD_UUID") || strings.Contains(comment, "TaskFlow API token") {
		t.Fatal("dispatch request must require real provider evidence and contain no credential")
	}
}

func TestTaskflowCodexDispatchCommentRejectsForeignPRAndUnboundedContent(t *testing.T) {
	target := codexDispatchTarget{Owner: "QQweasdzxc", Repository: "zhuge-ai-os", Number: 52,
		HeadSHA: strings.Repeat("b", 40), URL: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/52"}
	if _, err := buildCodexDispatchComment("01a13ee3-8cb4-7e81-9cac-b26a6cebf570",
		"01a13ee3-8cb4-7e81-9cac-b26a6cebf571", "ZG-42", target, strings.Repeat("x", 1001), ""); err == nil {
		t.Fatal("oversized title was accepted")
	}
	target.URL = "https://example.invalid/redirect"
	if _, err := buildCodexDispatchComment("01a13ee3-8cb4-7e81-9cac-b26a6cebf570",
		"01a13ee3-8cb4-7e81-9cac-b26a6cebf571", "ZG-42", target, "title", "description"); err == nil {
		t.Fatal("non-canonical PR URL was accepted")
	}
}

func TestTaskflowCodexDispatchFeatureGateDefaultsClosed(t *testing.T) {
	for _, key := range []string{"ZHUGE_TASKFLOW_CODEX_DISPATCH_ENABLED", "ZHUGE_TASKFLOW_CODEX_ISSUE_COMMENT_WEBHOOK_ENABLED",
		"GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"} {
		t.Setenv(key, "")
	}
	if taskflowCodexDispatchEnabled() {
		t.Fatal("Codex dispatch must remain disabled without all configured gates")
	}
}

func TestTaskflowCodexDispatchPostsOnlyAfterPinnedPRReadback(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	t.Setenv("GITHUB_APP_ID", "12345")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", string(pemKey))

	checkpoint := strings.Repeat("a", 40)
	runPost := func(t *testing.T, currentHead string, wantPost bool) {
		t.Helper()
		var commentBody string
		var tokenRevoked bool
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodPost && r.URL.Path == "/app/installations/808/access_tokens":
				if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
					t.Error("App JWT header missing")
				}
				var body map[string]map[string]string
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body["permissions"]["metadata"] != "read" || body["permissions"]["pull_requests"] != "write" {
					t.Errorf("unexpected installation token permissions: %#v", body["permissions"])
				}
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"token":"short-lived-test-token"}`))
			case r.Method == http.MethodGet && r.URL.Path == "/repos/QQweasdzxc/zhuge-ai-os/pulls/52":
				if r.Header.Get("Authorization") != "Bearer short-lived-test-token" {
					t.Error("installation token not scoped to PR read")
				}
				_, _ = w.Write([]byte(`{"state":"open","merged":false,"head":{"sha":"` + currentHead + `"}}`))
			case r.Method == http.MethodPost && r.URL.Path == "/repos/QQweasdzxc/zhuge-ai-os/issues/52/comments":
				if r.Header.Get("Authorization") != "Bearer short-lived-test-token" {
					t.Error("installation token not scoped to comment write")
				}
				var body struct {
					Body string `json:"body"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				commentBody = body.Body
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"id":912345,"html_url":"https://github.com/QQweasdzxc/zhuge-ai-os/pull/52#issuecomment-912345"}`))
			case r.Method == http.MethodDelete && r.URL.Path == "/installation/token":
				tokenRevoked = r.Header.Get("Authorization") == "Bearer short-lived-test-token"
				w.WriteHeader(http.StatusNoContent)
			default:
				t.Errorf("unexpected GitHub API request: %s %s", r.Method, r.URL.Path)
				http.NotFound(w, r)
			}
		}))
		defer server.Close()
		oldBase := githubAPIBase
		githubAPIBase = server.URL
		t.Cleanup(func() { githubAPIBase = oldBase })
		target := codexDispatchTarget{InstallationID: 808, Owner: "QQweasdzxc", Repository: "zhuge-ai-os",
			Number: 52, HeadSHA: checkpoint, URL: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/52"}
		receipt, failure := postCodexDispatch(t.Context(), target,
			"01a13ee3-8cb4-7e81-9cac-b26a6cebf570", "01a13ee3-8cb4-7e81-9cac-b26a6cebf571",
			"ZG-42", "Title", "Description")
		if wantPost {
			if failure != nil || receipt.CommentID != 912345 || !strings.Contains(receipt.CommentURL, "issuecomment-912345") {
				t.Fatalf("postCodexDispatch = (%+v, %v), want dispatch receipt", receipt, failure)
			}
			if !strings.Contains(commentBody, "@codex") || !strings.Contains(commentBody, "ZHUGE_CODEX_ACK_V1") {
				t.Fatalf("dispatch comment missing protocol markers: %s", commentBody)
			}
		} else if failure == nil || failure.Code != "github_pr_head_changed" || commentBody != "" {
			t.Fatalf("changed PR head should block comment, got (%+v, %v)", receipt, failure)
		}
		if !tokenRevoked {
			t.Error("short-lived GitHub installation token was not revoked")
		}
	}

	t.Run("posts a bounded dispatch only for the exact open PR head", func(t *testing.T) {
		runPost(t, checkpoint, true)
	})
	t.Run("blocks when the PR head changed after approval", func(t *testing.T) {
		runPost(t, strings.Repeat("b", 40), false)
	})
}
