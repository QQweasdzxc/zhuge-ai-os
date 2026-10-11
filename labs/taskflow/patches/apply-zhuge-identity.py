#!/usr/bin/env python3
from pathlib import Path

router = Path("/src/server/cmd/server/router.go")
AUTH_VERIFY_ROUTE = 'r.With(authVerifyRL).Post("/auth/verify-code", h.VerifyCode)'
ZHUGE_LOGIN_ROUTE = 'r.With(authVerifyRL).Post("/auth/zhuge", h.ZhugeLogin)'
CLI_TOKEN_ROUTE = 'r.Post("/api/cli-token", h.IssueCliToken)'
ZHUGE_CLI_TOKEN_ROUTE = 'r.Post("/api/cli-token", h.ZhugeIssueCliToken)'


def patch_router_routes(source: str) -> str:
    """Apply both TaskFlow route changes to one in-memory router snapshot."""
    auth_routes = [line.strip() for line in source.splitlines() if '.Post("/auth/zhuge"' in line]
    if not auth_routes:
        if source.count(AUTH_VERIFY_ROUTE) != 1:
            raise SystemExit("Multica router auth marker missing, ambiguous, or already patched")
        source = source.replace(AUTH_VERIFY_ROUTE, AUTH_VERIFY_ROUTE + "\n\t" + ZHUGE_LOGIN_ROUTE, 1)
    elif auth_routes != [ZHUGE_LOGIN_ROUTE]:
        raise SystemExit("Zhuge login route marker missing, ambiguous, or mapped to an unexpected handler")

    cli_routes = [line.strip() for line in source.splitlines() if '.Post("/api/cli-token"' in line]
    if cli_routes == [CLI_TOKEN_ROUTE]:
        source = source.replace(CLI_TOKEN_ROUTE, ZHUGE_CLI_TOKEN_ROUTE, 1)
    elif cli_routes != [ZHUGE_CLI_TOKEN_ROUTE]:
        raise SystemExit("Native CLI token route marker missing, ambiguous, or mapped to an unexpected handler")

    auth_routes = [line.strip() for line in source.splitlines() if '.Post("/auth/zhuge"' in line]
    cli_routes = [line.strip() for line in source.splitlines() if '.Post("/api/cli-token"' in line]
    if auth_routes != [ZHUGE_LOGIN_ROUTE] or source.count(ZHUGE_LOGIN_ROUTE) != 1:
        raise SystemExit("Final Zhuge login route postcondition failed")
    if cli_routes != [ZHUGE_CLI_TOKEN_ROUTE] or source.count(ZHUGE_CLI_TOKEN_ROUTE) != 1:
        raise SystemExit("Final Zhuge CLI token route postcondition failed")
    return source



def main():
    text = patch_router_routes(router.read_text())

    cli_helper = Path("/src/apps/web/public/zhuge-cli-sso.js")
    cli_helper.parent.mkdir(parents=True, exist_ok=True)
    cli_helper.write_text(Path("/tmp/zhuge-cli-sso.js").read_text())

    proxy_source = Path("/tmp/zhuge-cli-proxy.ts")
    proxy_target = Path("/src/apps/web/proxy.ts")
    if not proxy_target.exists():
        raise SystemExit("Multica proxy.ts marker file not found")
    proxy_text = proxy_target.read_text()
    proxy_signature = "export function proxy(req: NextRequest) {"
    proxy_call = (
        "export function proxy(req: NextRequest) {\n"
        "  const zhugeTaskFlowResponse = zhugeTaskFlowCliLogin(req);\n"
        "  if (zhugeTaskFlowResponse) return zhugeTaskFlowResponse;"
    )
    if proxy_text.count(proxy_signature) != 1 or "zhugeTaskFlowCliLogin(req)" in proxy_text:
        raise SystemExit("Multica proxy entry marker missing, ambiguous, or already patched")
    proxy_text = proxy_text.replace(
        proxy_signature,
        proxy_source.read_text().rstrip() + "\n\n" + proxy_signature,
        1,
    )
    proxy_text = proxy_text.replace(proxy_signature, proxy_call, 1)
    proxy_target.write_text(proxy_text)

    auth_source = Path("/tmp/zhuge_cli_grant.go")
    auth_test_source = Path("/tmp/zhuge_cli_grant_test.go")
    middleware_test_source = Path("/tmp/zhuge_cli_middleware_test.go")
    if not auth_source.exists() or not auth_test_source.exists() or not middleware_test_source.exists():
        raise SystemExit("TaskFlow CLI authorization grant overlay is incomplete")
    Path("/src/server/internal/auth/zhuge_cli_grant.go").write_text(auth_source.read_text())
    Path("/src/server/internal/auth/zhuge_cli_grant_test.go").write_text(auth_test_source.read_text())
    Path("/src/server/internal/middleware/zhuge_cli_middleware_test.go").write_text(middleware_test_source.read_text())

    cli_test_source = Path("/tmp/zhuge_auth_cli_test.go")
    if not cli_test_source.exists():
        raise SystemExit("TaskFlow CLI handler test overlay is missing")
    Path("/src/server/internal/handler/zhuge_auth_cli_test.go").write_text(cli_test_source.read_text())

    handoff = Path("/src/apps/web/app/(auth)/zhuge-handoff")
    handoff.mkdir(parents=True, exist_ok=True)
    handoff.joinpath("page.tsx").write_text(Path("/tmp/zhuge-handoff-page.tsx").read_text())

    ready_source = Path("/tmp/zhuge-ready-route.ts")
    if ready_source.exists():
        ready = Path("/src/apps/web/app/zhuge-ready")
        ready.mkdir(parents=True, exist_ok=True)
        ready.joinpath("route.ts").write_text(ready_source.read_text())

    # Keep one in-memory router snapshot through both route edits so the CLI
    # replacement cannot overwrite /auth/zhuge with stale pre-patch contents.
    router.write_text(text)
    print("TaskFlow final router routes verified: POST /auth/zhuge and POST /api/cli-token each registered once")


if __name__ == "__main__":
    main()
