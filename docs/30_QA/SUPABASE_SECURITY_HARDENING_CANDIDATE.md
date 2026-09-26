# Supabase Security Hardening Candidate

Status: **Developer candidate / not applied to Production**

## Evidence and classification

| Finding | Current repository evidence | Candidate disposition | Runtime gate |
| --- | --- | --- | --- |
| 3 `SECURITY DEFINER` view errors | Historical Advisor evidence names `current_positions_view`, `holdings_view`, and `my_workspace_view`; current source uses `security_invoker` for `investment_current_positions_view` and `current_broker_positions_view`. | Conditional `security_invoker=true`, revoke anonymous/public SELECT, retain authenticated SELECT. No view is dropped. | Cloud catalog read-back must confirm exact objects, owners, underlying RLS, and current callers before apply. |
| `public.next_knowledge_id` mutable search path | Historical Advisor finding; no current definition is present in this repository. | Conditional catalog loop pins every overload to `pg_catalog, public, auth, extensions, private, pg_temp`. | Cloud function catalog read-back must confirm the exact overload and dependencies. |
| Legacy identity SECURITY DEFINER RPCs executable by `anon` | Historical evidence names `claim_legacy_workspace`, `get_my_workspace_summary`, and `link_workspace_identity`; no current source caller was found. | Revoke `public, anon` for all; fully retire authenticated execution for legacy claim/link; retain authenticated summary only as temporary compatibility. | Cloud caller/route read-back must confirm no current runtime caller before apply. |
| Duplicate RLS policies / indexes | Advisor summary is not a catalog dump and no live catalog is available in this local environment. | No speculative drop/merge. Read-only catalog audit is provided. | Compare `pg_policies` / `pg_indexes` on the target project; each candidate requires a separate named migration. |

## Files

- Candidate migration: `docs/supabase/20260926_security_hardening_candidate.sql`
- Manual rollback: `docs/supabase/ROLLBACK_20260926_security_hardening_candidate.sql`
- Read-only catalog audit: `tools/supabase/security-catalog-audit.sql`
- Candidate tests: `tests/supabase-security-hardening-candidate.test.js`

The migration is conditional and contains no Product Data DML. It is not an assertion that Cloud is already remediated. Applying it remains a human-controlled Cloud Gate after catalog, RLS, dependency, and authenticated runtime read-back.
