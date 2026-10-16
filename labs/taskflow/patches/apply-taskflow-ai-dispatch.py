#!/usr/bin/env python3
"""Source-only pinned vendor TaskFlow AI execution API extension.

A single TaskFlow site; native workspace membership and issue are the authority.
This patch does not dispatch Co, deploy, apply migrations, or change production.
"""
import argparse
from pathlib import Path

ROUTE = "server/cmd/server/router.go"
ANCHOR = '\t\t\t\t\tr.Get("/", h.GetIssue)'
NEW = (ANCHOR +
    '\n\t\t\t\t\t// Zhuge AI execution: native issue and human member authority.' +
    '\n\t\t\t\t\tr.With(handler.RequireHumanActor).Get("/zhuge-ai/runs", h.ZhugeAIListRuns)' +
    '\n\t\t\t\t\tr.With(handler.RequireHumanActor).Post("/zhuge-ai/approve", h.ZhugeAIApproveRun)')
OVERLAY_FILES = ("zhuge_ai_dispatch.go", "zhuge_ai_dispatch_test.go")
MIGRATIONS = ("591_zhuge_ai_engineering_run.up.sql","591_zhuge_ai_engineering_run.down.sql")

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

def apply(root,overlays,migrations):
    router = root / ROUTE
    source = router.read_text()
    verify(source)
    outputs = [root/"server/internal/handler"/name for name in OVERLAY_FILES]
    sources = [overlays/name for name in OVERLAY_FILES]
    outputs += [migrations/name for name in MIGRATIONS]
    sources += [overlays/"migrations"/name for name in MIGRATIONS]
    for src,target in zip(sources,outputs):
        if not src.is_file() or target.exists():
            raise ValueError(f"missing overlay or duplicate patch target: {src}, {target}")
    router.write_text(source.replace(ANCHOR,NEW,1))
    for src,target in zip(sources,outputs):
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(src.read_bytes())
    print("TaskFlow AI native human/member authorization and migration artifacts staged; no live dispatch")

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",type=Path,required=True)
    ap.add_argument("--overlays",type=Path,required=True)
    ap.add_argument("--migrations",type=Path,required=True)
    args=ap.parse_args()
    apply(args.root,args.overlays,args.migrations)
