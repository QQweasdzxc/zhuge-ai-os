#!/usr/bin/env python3
from pathlib import Path

router = Path("/src/server/cmd/server/router.go")
text = router.read_text()
needle = 'r.With(authVerifyRL).Post("/auth/verify-code", h.VerifyCode)'
replacement = needle + '\n\tr.With(authVerifyRL).Post("/auth/zhuge", h.ZhugeLogin)'
if '/auth/zhuge' not in text:
    if needle not in text:
        raise SystemExit("Multica router auth marker not found")
    router.write_text(text.replace(needle, replacement, 1))

cli_token_route = 'r.Post("/api/cli-token", h.IssueCliToken)'
zhuge_cli_token_route = 'r.Post("/api/cli-token", h.ZhugeIssueCliToken)'
if text.count(cli_token_route) == 1:
    text = text.replace(cli_token_route, zhuge_cli_token_route, 1)
elif text.count(zhuge_cli_token_route) != 1:
    raise SystemExit("Native CLI token route marker not found or ambiguous")
router.write_text(text)

cli_helper = Path("/src/apps/web/public/zhuge-cli-sso.js")
cli_helper.parent.mkdir(parents=True, exist_ok=True)
cli_helper.write_text(Path("/tmp/zhuge-cli-sso.js").read_text())

proxy_source = Path("/tmp/zhuge-cli-proxy.ts")
proxy_target = Path("/src/apps/web/proxy.ts")
if proxy_target.exists():
    raise SystemExit("TaskFlow CLI proxy target already exists; refusing to overwrite")
proxy_target.write_text(proxy_source.read_text())

cli_test_source = Path("/tmp/zhuge_auth_cli_test.go")
if cli_test_source.exists():
    Path("/src/server/internal/handler/zhuge_auth_cli_test.go").write_text(cli_test_source.read_text())

handoff = Path("/src/apps/web/app/(auth)/zhuge-handoff")
handoff.mkdir(parents=True, exist_ok=True)
handoff.joinpath("page.tsx").write_text(Path("/tmp/zhuge-handoff-page.tsx").read_text())

ready_source = Path("/tmp/zhuge-ready-route.ts")
if ready_source.exists():
    ready = Path("/src/apps/web/app/zhuge-ready")
    ready.mkdir(parents=True, exist_ok=True)
    ready.joinpath("route.ts").write_text(ready_source.read_text())
