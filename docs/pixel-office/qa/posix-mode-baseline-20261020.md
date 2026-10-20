# POSIX mode test evidence — `.9.99`

The upstream Habblaud suite currently reports three mode assertions on this
Linux runner: two in `server/test/statusline.test.ts` and one in
`server/test/hooks-install.test.ts`. Each expects `0o644` (`420`) but the
runner creates the file as `0o600` (`384`). This is an environment-level mode
difference, not a family/cat overlay failure.

| Check | Baseline `.9.98` | Candidate `.9.99` | Interpretation |
| --- | --- | --- | --- |
| POSIX mode assertions | 3 failures (420 expected, 384 received) | 3 failures (same assertion) | unchanged baseline behavior |
| Family/cat targeted tests | N/A | PASS | candidate-specific |
| Browser smoke | PASS | PASS | no regression |

The three upstream tests remain `NOT BLOCKING` for this overlay candidate and
are not modified here. A full-suite PASS requires running on the upstream
supported filesystem/mode configuration; no production claim is made from the
local result.
