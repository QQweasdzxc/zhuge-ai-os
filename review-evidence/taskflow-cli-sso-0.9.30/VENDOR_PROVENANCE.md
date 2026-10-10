# Frozen Multica Vendor Provenance

Candidate source: `22182207b2e58a465204df8d1f84bc5300f84535`. This is a read-only provenance report; it does not modify the vendor snapshot.

- Fixed upstream: `https://github.com/multica-ai/multica` at `8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec`.
- Upstream tree at that exact commit: `8ab084cede9b821deb4573263c24866fa49383a9`.
- Candidate Git subtree object `HEAD:third_party/multica`: `8ab084cede9b821deb4573263c24866fa49383a9`.
- `origin/taskflow-dev:third_party/multica`: `8ab084cede9b821deb4573263c24866fa49383a9`.
- Tracked vendor file count: **6,432**.
- A fresh temporary fetch/checkout of the exact upstream SHA completed. `diff -qr --exclude=.git <pinned-upstream-checkout> third_party/multica` returned exit code **0** and **0 difference lines**.
- Git tree hashes are identical, which covers each path, blob content, and file mode in the subtree; no extra vendor file or edit exists.
- Candidate versus `origin/taskflow-dev` under `third_party/multica/`: **0 changed paths**.

Reproduction commands:

```sh
git rev-parse 22182207b2e58a465204df8d1f84bc5300f84535:third_party/multica
git rev-parse origin/taskflow-dev:third_party/multica
git ls-tree -r --name-only 22182207b2e58a465204df8d1f84bc5300f84535 third_party/multica | wc -l
git diff --name-only origin/taskflow-dev..22182207b2e58a465204df8d1f84bc5300f84535 -- third_party/multica
```

The direct byte comparison was run from a temporary checkout fetched at the fixed upstream SHA. No source under the vendored directory was rewritten for this verification.
