# Third-Party Multica Source and License Boundary

## Frozen source

- Upstream repository: <https://github.com/multica-ai/multica>
- Frozen commit: [`8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec`](https://github.com/multica-ai/multica/commit/8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec)
- Commit date and subject: 2026-10-08, `fix(desktop): align navigation and tab toolbar content (#9127)`.
- Git tree: `8ab084cede9b821deb4573263c24866fa49383a9`.
- Vendored source path: `third_party/multica/`.
- Source files: 6,432 tracked files copied from the exact commit; content and executable modes were checked against its Git tree.
- The upstream history contains 5,547 reachable commits. To keep the Zhuge repository's vendor import limited to the approved frozen snapshot, the full upstream history is not copied; the upstream URL, exact commit, tree hash, and original commit metadata are retained here for provenance.

The complete upstream files `third_party/multica/LICENSE` and `third_party/multica/NOTICE` are included unchanged. Their SHA-256 values were compared with the pinned upstream commit.

The pinned source has pre-existing whitespace findings reported by `git diff --check` (trailing whitespace and blank lines at EOF). They are retained exactly because this is an unmodified vendor snapshot; normalizing them would make it differ from the reviewed upstream tree.

## License terms relevant to TaskFlow

The governing source is the complete, unmodified Multica License at `third_party/multica/LICENSE`. It contains Part I additional conditions and the incorporated Apache License 2.0 text; Part I controls if terms conflict. The accompanying attribution notice is `third_party/multica/NOTICE`. This summary does not replace either file.

- Internal use within one organization, including multiple workspaces, is permitted without a commercial license.
- Hosting Multica, in whole or substantial part, for users outside that organization requires a commercial license, whether access is paid or free. Embedding it in a third-party commercial offering also requires that license.
- A Multica-derived UI must retain the Multica logo, Multica product name, and displayed copyright/attribution. They may not be removed or modified without a written branding waiver. A branding waiver and a commercial license are separate permissions.
- Source availability by itself is not a hosted service, but recipients who operate a hosted service must obtain their own required license.
- Redistribution of source or object/derivative form must include the complete Multica License and the required NOTICE attribution. Modified files must carry the notices required by the license.

## TaskFlow compliance strategy

1. TaskFlow may be the Zhuge module name, but any UI derived from Multica keeps the Multica name, logo, and displayed attribution. No white-labeling or branding removal is permitted without a written waiver.
2. Keep the frozen source under `third_party/multica/`; do not fetch or clone the Multica application source during a TaskFlow build.
3. Build the vendored source using the upstream Dockerfiles with the vendored directory as the build context:

   ```sh
   docker build -f third_party/multica/Dockerfile -t taskflow-multica-api:local third_party/multica
   docker build -f third_party/multica/Dockerfile.web -t taskflow-multica-web:local third_party/multica
   ```

   These Dockerfiles copy source from the local context. They may download declared Go/Node dependencies; they do not clone the Multica application repository. The existing `labs/multica/Dockerfile.*` files remain the Multica Native Lab Golden Baseline and are not the TaskFlow build entrypoints.
4. Preserve `LICENSE` and `NOTICE` in any redistributed source bundle and compiled images. Both upstream Dockerfiles already copy them into their runtime images.
5. Keep TaskFlow access limited to internal use of the organization unless and until the required commercial license is obtained. Do not expose a third-party hosted/embedded service on the basis of this source import alone.
6. Any future TaskFlow edits to Multica-derived source must be isolated from the frozen snapshot where practical, keep required notices, and retain the attribution boundary above.

No TaskFlow UI reduction, rebranding, governance fusion, feature implementation, main change, or deployment is included in this source-ownership gate.
