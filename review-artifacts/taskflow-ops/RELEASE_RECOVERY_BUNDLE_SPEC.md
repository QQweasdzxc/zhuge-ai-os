# RELEASE_RECOVERY_BUNDLE_SPEC

Status: release-process specification for GPT/CTO review; not a released `.9.32` bundle.  
Identity: one immutable archive per `VERSION / BUILD / COMMIT`; never overwrite an earlier bundle.

## Required name and manifest

`zhuge-release_<VERSION>_<BUILD>_<COMMIT>.tar.zst` (or ZIP where required), plus a detached `SHA256SUMS` and `manifest.json`. The manifest records:

- Product version, build, full Git commit, parent, tag/ref, repository URL, tree SHA and build timestamp/zone.
- SHA256 for every archive member and the archive itself; signing key ID/signature when an approved signing key exists.
- API/Web/Shell image names, immutable OCI digests, platform/architecture, registry location and exact `.tar` image archive checksums. Never use mutable tags as rollback identity.
- Build contexts, Dockerfile paths, toolchain versions, lockfile hashes, SBOM/dependency list, provenance, and whether the build was networked or verified offline.
- Migration IDs included, expected schema compatibility, applied-state readback evidence, and tested rollback/forward-fix instructions. No database dump or credentials in this source bundle.
- CI run IDs/URLs, test totals, browser/device matrix, Docker build logs, known gaps, approvals, deployment IDs/URLs, rollback anchors, nonsecret configuration-key map, and license/NOTICE hashes.

## Required contents

```text
release_<VERSION>_<BUILD>_<COMMIT>/
  manifest.json
  SHA256SUMS
  source/
    repository.bundle              # full git history/ref bundle for the release
    source.tar.zst                 # complete source snapshot, including third_party/multica
    commit.txt / tree.txt / patch-from-previous-release.patch
    LICENSES/third_party/multica/LICENSE
    LICENSES/third_party/multica/NOTICE
  dependencies/
    lockfiles/                     # all language lockfiles
    sbom.spdx.json
    build-provenance.json
    base-images/                   # OCI digests; archives if needed for offline recovery
    package-cache-manifest.json    # hash-indexed Go/npm/pnpm/Alpine/other cached artifacts
  images/
    api.oci.tar + api.digest
    web.oci.tar + web.digest
    shell.oci.tar + shell.digest
  migrations/
    ordered-migration-manifest.json
    migration-source/
    compatibility-and-recovery.md
  qa/
    backend-docker.log
    web-docker.log
    unit-vitest-browser-regression.log
    browser-results/               # exact runner/browser/viewport metadata
    test-summary.json
  deployment/
    nonsecret-env-map.md           # key names and owners only, never values
    API-WEB-SHELL-deploy-order.md
    service-deployment-ids.json
    rollback.md
  LICENSE / NOTICE / THIRD_PARTY_NOTICES/
```

TaskFlow/database backups are separate encrypted artifacts with separate ACLs and keys. The source bundle contains only a backup identifier, checksum, creation time, encryption/key reference identifier, and restore-test evidence; never backup contents, decrypt keys, passwords, JWTs, cookies, or `.env` values.

## Build and recovery gates

1. Freeze the exact final `VERSION / BUILD / COMMIT`; verify clean tree, parent, full source/vendor hashes, lockfiles, migrations and release identity consistency.
2. Build API/Web/Shell; capture immutable image digests and provenance. To claim rebuildable offline, run from a clean isolated builder with upstream author endpoints denied and all OCI bases/packages available from the approved local archive/cache. If not, say `REBUILD OFFLINE = NOT VERIFIED`; a separately verified image archive may still provide offline run/rollback.
3. Run required tests against that exact source/image digest. Bundle logs, not screenshots alone.
4. Compute a deterministic file manifest, verify every checksum after archive creation, test extraction, and sign/approve without modifying the archive.
5. Store one immutable source/image bundle in the approved version archive. Store separately encrypted TaskFlow data backups in a distinct ACL domain. Retain the last known-good bundle and release; never delete the current rollback anchor.
6. Recovery: verify hashes/signature; load exact images; verify nonsecret configuration references exist in the target secret manager; restore only into isolated database first; validate migrations and data invariants; then follow an independently approved deployment plan. Production restore or migration reversal always requires explicit PM authorization.

## Current `.9.32` readiness

This specification is established as a review artifact. A certified `.9.32` recovery bundle cannot yet be produced: final `.9.32` identity has not been assigned, Docker images were not built, remote Docker parity/WebKit are not complete, and no approved offsite encrypted destination has been selected. The existing review ZIP is evidence for the candidate, not a formal release bundle.
