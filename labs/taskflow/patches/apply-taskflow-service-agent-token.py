#!/usr/bin/env python3
"""Install the TaskFlow SAT overlay in a disposable vendor copy, never frozen source.

All anchors and destination collisions are validated before any writes. Reapplication
and changed upstream security boundaries fail closed. SQL is separately reviewed;
this patch does not apply migrations or register an agent.
"""
import argparse
import os
from pathlib import Path

ASSETS = Path(__file__).with_name('service-agent-token')
FROZEN = next((p / 'third_party/multica' for p in Path(__file__).resolve().parents
               if (p / 'third_party/multica').is_dir()), Path('/nonexistent-frozen-vendor'))


def replace_once(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise SystemExit('SAT insertion marker missing, ambiguous, or already patched: ' + anchor[:90])
    return source.replace(anchor, replacement, 1)


def apply(root):
    root = Path(root).resolve()
    if (root == FROZEN.resolve() or FROZEN.resolve() in root.parents
            or any(root.parts[i:i+2] == ('third_party', 'multica') for i in range(len(root.parts)-1))):
        raise SystemExit('SAT refuses to modify frozen third_party/multica')
    server = root / 'server'
    changes = {}
    auth = server / 'internal/middleware/auth.go'
    source = auth.read_text()
    if 'authenticateServiceAgentToken(' in source:
        raise SystemExit('SAT already patched')
    for header in ('X-Actor-Source', 'X-Agent-ID', 'X-Task-ID'):
        if source.count(f'r.Header.Del("{header}")') != 1:
            raise SystemExit('SAT required identity strip marker changed: ' + header)

    # Remove user identity globally; workspace is still a human request selector.
    # The SAT branch captures, validates, then replaces the client workspace.
    anchor = '\t\t\tr.Header.Del("X-Actor-Source")'
    source = replace_once(source, anchor, anchor + '\n\t\t\tr.Header.Del("X-User-ID")\n\t\t\tr.Header.Del("X-User-Email")')
    anchor = '\t\t\t// Agent task token: "mat_" prefix.'
    source = replace_once(source, anchor, '''\t\t\t// SAT is a machine credential, never a human account approval.
\t\t\tif strings.HasPrefix(tokenString, "sat_") {
\t\t\t\tdefer func() { if r.MultipartForm != nil { r.MultipartForm.RemoveAll() } }()
\t\t\t\tif authenticateServiceAgentToken(w, r, queries, tokenString) {
\t\t\t\t\tnext.ServeHTTP(w, r)
\t\t\t\t}
\t\t\t\treturn
\t\t\t}

''' + anchor)
    changes[auth] = source
    actor = server / 'internal/handler/handler.go'
    anchor = 'if r.Header.Get("X-Actor-Source") == "task_token" {'
    changes[actor] = replace_once(actor.read_text(), anchor,
        'if r.Header.Get("X-Actor-Source") == "service_agent_token" {\n'
        '\t\t// SAT identity is server-stamped and workspace-bound by Auth.\n'
        '\t\tif r.Header.Get("X-Workspace-ID") == workspaceID && r.Header.Get("X-Agent-ID") != "" {\n'
        '\t\t\treturn "agent", r.Header.Get("X-Agent-ID")\n\t\t}\n'
        '\t\treturn "member", userID\n\t}\n\t' + anchor)
    guard = server / 'internal/handler/actor_guards.go'
    changes[guard] = replace_once(guard.read_text(), 'case "task_token", "cloud_pat":',
        '// SAT, like mcn_, cannot approve human/account-level actions.\n\tcase "task_token", "cloud_pat", "service_agent_token":')
    ws = server / 'internal/middleware/workspace.go'
    source = ws.read_text()
    if source.count(anchor) != 3:
        raise SystemExit('SAT workspace binding markers changed')
    changes[ws] = source.replace(anchor, 'if r.Header.Get("X-Actor-Source") == "task_token" || r.Header.Get("X-Actor-Source") == "service_agent_token" {')
    router = server / 'cmd/server/router.go'
    anchor = '\t\t\t\tr.Route("/{id}", func(r chi.Router) {\n\t\t\t\t\tr.Get("/", h.GetAgent)'
    changes[router] = replace_once(router.read_text(), anchor, anchor + '''
\t\t\t\t\t// Human workspace owners manage service-only credentials.
\t\t\t\t\tr.With(handler.RequireHumanActor).Post("/service-tokens", h.CreateServiceAgentToken)
\t\t\t\t\tr.With(handler.RequireHumanActor).Get("/service-tokens", h.ListServiceAgentTokens)
\t\t\t\t\tr.With(handler.RequireHumanActor).Delete("/service-tokens/{tokenId}", h.RevokeServiceAgentToken)''')
    for name, dest in (
        ('store.go', 'pkg/db/generated/taskflow_service_agent_token.go'),
        ('middleware.go', 'internal/middleware/taskflow_service_agent_token.go'),
        ('handler.go', 'internal/handler/taskflow_service_agent_token.go'),
    ):
        path = server / dest
        if path.exists():
            raise SystemExit('SAT destination already exists: ' + str(path))
        changes[path] = (ASSETS / name).read_text()
    for path in changes:
        if not path.resolve().is_relative_to(root):
            raise SystemExit('SAT destination escapes disposable root: ' + str(path))
    for path, content in changes.items():
        path.write_text(content)
    print('TASKFLOW_SERVICE_AGENT_TOKEN_PATCH=PASS')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=os.environ.get('TASKFLOW_VENDOR_ROOT', '/src'))
    apply(parser.parse_args().root)
