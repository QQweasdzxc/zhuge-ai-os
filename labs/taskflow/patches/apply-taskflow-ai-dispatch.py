#!/usr/bin/env python3
"""Source-only pinned vendor TaskFlow AI execution API extension.

A single TaskFlow site; native workspace membership and issue are the authority.
This patch does not dispatch Co, deploy, apply migrations, or change production.
"""
import argparse
from pathlib import Path

ROUTE = "server/cmd/server/router.go"
GITHUB = "server/internal/handler/github.go"
ANCHOR = '\t\t\t\t\tr.Get("/", h.GetIssue)'
NEW = (ANCHOR +
    '\n\t\t\t\t\t// Zhuge AI execution: native issue and human member authority.' +
    '\n\t\t\t\t\tr.With(handler.RequireHumanActor).Get("/zhuge-ai/runs", h.ZhugeAIListRuns)' +
    '\n\t\t\t\t\tr.With(handler.RequireHumanActor).Post("/zhuge-ai/approve", h.ZhugeAIApproveRun)')
HANDLER_OVERLAYS = (
    "zhuge_ai_dispatch.go",
    "zhuge_github_webhook.go",
)
CONTRACT_OVERLAYS = (
    "zhuge_ai_contract.go",
    "zhuge_ai_contract_test.go",
)
MIGRATIONS = (
    "591_zhuge_ai_engineering_run.up.sql",
    "591_zhuge_ai_engineering_run.down.sql",
    "592_zhuge_ai_run_active_issue_index.up.sql",
    "592_zhuge_ai_run_active_issue_index.down.sql",
    "593_zhuge_ai_run_idempotency_index.up.sql",
    "593_zhuge_ai_run_idempotency_index.down.sql",
    "594_zhuge_ai_event_delivery_once_index.up.sql",
    "594_zhuge_ai_event_delivery_once_index.down.sql",
    "595_zhuge_ai_run_issue_history_index.up.sql",
    "595_zhuge_ai_run_issue_history_index.down.sql",
    "596_zhuge_ai_event_run_index.up.sql",
    "596_zhuge_ai_event_run_index.down.sql",
)
WEBHOOK_METHOD = "func (h *Handler) HandleGitHubWebhook(w http.ResponseWriter, r *http.Request) {"
WEBHOOK_METHOD_RENAMED = "func (h *Handler) HandleGitHubWebhookNative(w http.ResponseWriter, r *http.Request) {"
WEBHOOK_ROUTE = 'r.Post("/api/webhooks/github", h.HandleGitHubWebhook)'
WEBHOOK_ROUTE_PATCHED = 'r.Post("/api/webhooks/github", h.HandleTaskflowGitHubWebhook)'

def verify(text):
    if text.count(ANCHOR) != 1 or "ZhugeAIApproveRun" in text:
        raise ValueError("native GET Issue route changed, ambiguous or already patched")
    # route MUST remain inside existing authenticated /api/issues/{id} group
    top = text.index('r.Route("/api/issues", func(r chi.Router) {')
    issue = text.index('r.Route("/{id}", func(r chi.Router) {', top)
    marker = text.index(ANCHOR, issue)
    if marker - issue > 600 or "RequireWorkspaceMember(queries)" not in text[top-1600:top]:
        raise ValueError("native member-authenticated issue scope missing")
    return True

def verify_webhook(text, router):
    if text.count(WEBHOOK_METHOD) != 1 or WEBHOOK_METHOD_RENAMED in text:
        raise ValueError("GitHub webhook method changed, ambiguous or already wrapped")
    if router.count(WEBHOOK_ROUTE) != 1 or WEBHOOK_ROUTE_PATCHED in router:
        raise ValueError("GitHub webhook route changed, ambiguous or already wrapped")
    if "func verifyWebhookSignature(" not in text or "func githubWebhookSecret()" not in text:
        raise ValueError("native GitHub webhook signature verification is unavailable")
    return True

def apply(root,overlays,migrations):
    router = root / ROUTE
    source = router.read_text()
    verify(source)
    github = root / GITHUB
    github_source = github.read_text()
    verify_webhook(github_source, source)
    outputs = [root/"server/internal/handler"/name for name in HANDLER_OVERLAYS]
    sources = [overlays/name for name in HANDLER_OVERLAYS]
    outputs += [root/"server/internal/handler/taskflowcontract"/name for name in CONTRACT_OVERLAYS]
    sources += [overlays/name for name in CONTRACT_OVERLAYS]
    outputs += [migrations/name for name in MIGRATIONS]
    sources += [overlays/"migrations"/name for name in MIGRATIONS]
    for src,target in zip(sources,outputs):
        if not src.is_file() or target.exists():
            raise ValueError(f"missing overlay or duplicate patch target: {src}, {target}")
    router.write_text(source.replace(ANCHOR,NEW,1).replace(WEBHOOK_ROUTE,WEBHOOK_ROUTE_PATCHED,1))
    github.write_text(github_source.replace(WEBHOOK_METHOD,WEBHOOK_METHOD_RENAMED,1))
    for src,target in zip(sources,outputs):
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(src.read_bytes())
    print("TaskFlow Run approval/readback and GitHub delivery receipt staged; provider launch remains disabled")

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",type=Path,required=True)
    ap.add_argument("--overlays",type=Path,required=True)
    ap.add_argument("--migrations",type=Path,required=True)
    args=ap.parse_args()
    apply(args.root,args.overlays,args.migrations)
