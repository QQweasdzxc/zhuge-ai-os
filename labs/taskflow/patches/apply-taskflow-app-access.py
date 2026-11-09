#!/usr/bin/env python3
"""ZG-71: wire the dormant App access decision into the vendored TaskFlow server.
Each edit asserts exactly one anchor and fails if already patched."""
import argparse, shutil
from pathlib import Path

def edit(path: Path, old: str, new: str, done: str):
    s = path.read_text()
    if done in s or s.count(old) != 1:
        raise SystemExit(f"anchor missing, ambiguous or already patched: {path} :: {old[:50]!r}")
    path.write_text(s.replace(old, new, 1))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--overrides", required=True)
    a = ap.parse_args()
    root, ov = Path(a.root), Path(a.overrides)
    srv = root / "server"
    shutil.copy(ov / "taskflow_app_access.go", srv / "internal/auth/taskflow_app_access.go")
    shutil.copy(ov / "taskflow_app_access_test.go", srv / "internal/auth/taskflow_app_access_test.go")
    shutil.copy(ov / "taskflow_app_access_lookup.go", srv / "cmd/server/taskflow_app_access_lookup.go")

    # 1. Single choke point: every id-based disabled check also asks App access.
    edit(srv / "internal/auth/temporary_disabled_users.go",
         "\t_, ok := temporarilyDisabledUserIDs[userID]\n\treturn ok\n}",
         "\tif _, ok := temporarilyDisabledUserIDs[userID]; ok {\n\t\treturn true\n\t}\n\treturn IsAppAccessDeniedUserID(userID)\n}",
         "IsAppAccessDeniedUserID")

    # 2. Startup wiring right after the pool is created.
    edit(srv / "cmd/server/main.go",
         "\tdefer pool.Close()\n",
         "\tdefer pool.Close()\n\tinstallTaskflowAppAccessLookup(pool)\n",
         "installTaskflowAppAccessLookup")

    hub = srv / "internal/realtime/hub.go"
    # 3. Open websockets: recheck before each outbound message and on every ping tick.
    edit(hub,
         "\t\tcase message, ok := <-c.send:\n\t\t\tc.conn.SetWriteDeadline(time.Now().Add(writeWait))\n\t\t\tif !ok {",
         "\t\tcase message, ok := <-c.send:\n\t\t\tif ok && auth.IsAppAccessDeniedUserID(c.userID) {\n\t\t\t\tc.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, \"account disabled\"))\n\t\t\t\treturn\n\t\t\t}\n\t\t\tc.conn.SetWriteDeadline(time.Now().Add(writeWait))\n\t\t\tif !ok {",
         "ClosePolicyViolation")
    edit(hub,
         "\t\tcase <-ticker.C:\n\t\t\tc.conn.SetWriteDeadline(time.Now().Add(writeWait))\n\t\t\tif err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {",
         "\t\tcase <-ticker.C:\n\t\t\tif auth.IsAppAccessDeniedUserID(c.userID) {\n\t\t\t\tc.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, \"account disabled\"))\n\t\t\t\treturn\n\t\t\t}\n\t\t\tc.conn.SetWriteDeadline(time.Now().Add(writeWait))\n\t\t\tif err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {",
         "account disabled\"))\n\t\t\t\treturn\n\t\t\t}\n\t\t\tc.conn.SetWriteDeadline(time.Now().Add(writeWait))\n\t\t\tif err := c.conn.WriteMessage(websocket.PingMessage")
if __name__ == "__main__":
    main()
