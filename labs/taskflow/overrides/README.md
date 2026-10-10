# TaskFlow-owned Native Lab overlay snapshot

These files are isolated copies of the proven `labs/multica/overrides/` and
`labs/multica/patches/` inputs. The TaskFlow Docker wrappers consume only these
copies, leaving the Native Lab Golden Baseline unchanged.

The landing, login, and handoff presentation copies add the upstream Multica
logo, product name, and exact displayed copyright attribution required by the
vendored license. A small client-component wrapper renders the upstream logo
from Server Component routes. Identity, routing, house-rule, and data behavior
otherwise match the Native Lab baseline. The frozen upstream source itself
remains unchanged under `third_party/multica/`.
