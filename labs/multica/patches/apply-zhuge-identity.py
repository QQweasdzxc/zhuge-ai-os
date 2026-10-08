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

handoff = Path("/src/apps/web/app/(auth)/zhuge-handoff")
handoff.mkdir(parents=True, exist_ok=True)
handoff.joinpath("page.tsx").write_text(Path("/tmp/zhuge-handoff-page.tsx").read_text())
