# Learning rewards release, 2026-11-09

This directory is the source for deployed Edge Function `learning-adventure-cloud` on project `lenpbbhwxyyfwgvjcozf`. The English API source is `apps/vocab-quest/supabase/index.ts` on branch `app/vocabulary-quest-20261101`.

## Migration order

Existing wallet, parent shop and redemption migrations precede these migrations.

1. `20261109-learning-rewards.sql` creates the English run-ID index, release marker, round award triggers and daily-review RPC. Apply once, not on every deploy. The release marker starts when first applied; historical attempts are not backfilled.
2. `20261109-learning-spelling-review.sql` replaces the daily RPC for an installation that received the original learning-rewards migration before spelling support. It is safe after the current learning-rewards SQL, which already contains this function version.
3. Deploy this directory's `index.ts` as `learning-adventure-cloud`, and the English API source as `vocab-family-cloud`. Preserve existing environment secrets. No secrets or family URLs belong in source.

Production received the original rewards migration and then the spelling upgrade on November 9. Both Edge Functions already match these source files. No additional production migration or redeploy is needed for this source sync.

## Scope and checks

Completed rounds earn 5 coins for each island's first three rounds per Taipei day, using the existing completed classification, with no new percentage gate. Daily review earns 3 once per island/day after a saved same-day completed or game-over run. Review is server-graded; spelling errors require spelling answers. A run without errors uses up to three learned words, with a labelled same-run fallback on the first day. No historical coin awards and no extra XP, heart or promotion-exam changes.

Verified against disposable families: parallel retry deduplication, parallel distinct-round cap, daily concurrent submissions, wrong answers, game-over correction eligibility, separate islands, unchanged XP during review, exact wallet/ledger agreement and blocked anonymous RPC access. Verified real deployed mobile and desktop flows and English UI completion; shop reserve/refund/fulfill regression passed. Test families were removed.

Frontend releases: hub BUILD 2026.11.09.08, commit `00c18b61494114c8dd0a04bd687be07e94429c7b`; English commit `e5cb91d63f31415e69d5161541c244c4962e8930`.
