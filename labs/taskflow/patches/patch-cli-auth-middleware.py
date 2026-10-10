#!/usr/bin/env python3
from pathlib import Path

MARKER = '\t\t\t// Agent task token: "mat_" prefix.'

def patch_cli_authorization_middleware_text(source: str) -> str:
    if source.count(MARKER) != 1 or "auth.ConsumeCLIAuthorizationCode(tokenString)" in source:
        raise SystemExit("Multica auth middleware CLI insertion marker missing, ambiguous, or already patched")
    snippet = """\t\t\t// TaskFlow Zhuge CLI authorization code; one use, native PAT exchange only.
\t\t\tif strings.HasPrefix(tokenString, auth.CLIAuthorizationCodePrefix) {
\t\t\t\tif r.Method != http.MethodPost || strings.TrimRight(r.URL.Path, "/") != "/api/tokens" {
\t\t\t\t\thttp.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t\tuserID, ok := auth.ConsumeCLIAuthorizationCode(tokenString)
\t\t\t\tif !ok {
\t\t\t\t\thttp.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t\tif rejectTemporarilyDisabledUser(w, r, userID, "", "zhuge_cli_code") { return }
\t\t\t\tr.Header.Set("X-User-ID", userID)
\t\t\t\tnext.ServeHTTP(w, r)
\t\t\t\treturn
\t\t\t}

"""
    return source.replace(MARKER, snippet + MARKER, 1)

if __name__ == "__main__":
    middleware_path = Path("/src/server/internal/middleware/auth.go")
    middleware_path.write_text(patch_cli_authorization_middleware_text(middleware_path.read_text()))
    print("TaskFlow CLI auth-code middleware patch applied")
