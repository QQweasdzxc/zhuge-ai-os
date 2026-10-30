'use strict';

// Zhuge Office 3D — pure alert-decision rules, extracted from onData() so the
// transitions behind 「完成時通知我」 are unit-testable.
//
// Completion is judged by the card's REAL status (tf.issueStatus for TaskFlow
// cards), never by the animation status: a TF in_progress card displays as
// 'idle' and 'idle' is not in ACTIVE, so an animation-status check silently
// never fires done-alerts for TF cards. cancelled / in_review are never
// treated as done themselves. The first snapshot after load or reconnect
// alerts nothing (existing done cards must not spam), and an unchanged card
// across duplicate fetches alerts nothing.

const NotifyRules = (() => {
  // Upstream animation statuses that count as "actively working" for non-TF
  // sessions (unchanged from the original inline rule).
  const ACTIVE = new Set(['thinking', 'tool', 'typing']);

  // The authoritative status of a card: raw issue status for TF cards, else
  // the session/animation status.
  function cardStatus(s) {
    return (s.tf && s.tf.issueStatus) || s.status || null;
  }

  // decide(prev, sessions): prev is a Map key -> { status, cardStatus, stuck }
  // from the previous snapshot (empty Map = first snapshot). Returns
  // { first, alerts: [{ key, kind: 'done'|'attention'|'stuck', session }], next }.
  function decide(prev, sessions) {
    const first = !prev || prev.size === 0;
    const next = new Map();
    const alerts = [];
    for (const s of sessions || []) {
      const before = prev ? prev.get(s.key) : undefined;
      const cur = cardStatus(s);
      const needsYou = s.status === 'waiting' || s.status === 'error';
      let kind = null;
      if (!first && before) {
        if (cur === 'done' && before.cardStatus !== 'done') {
          // Real completion transition. TF cards: any issue status -> done
          // counts (independent of animation status). Non-TF sessions keep the
          // upstream rule: only an actively-working session finishing counts.
          const isTf = !!(s.tf && s.tf.issueStatus);
          if (isTf || ACTIVE.has(before.status)) kind = 'done';
        } else if (needsYou && before.status !== s.status) {
          kind = 'attention';
        } else if (s.stuck && !before.stuck) {
          kind = 'stuck';
        }
      }
      if (kind) alerts.push({ key: s.key, kind, session: s });
      next.set(s.key, { status: s.status, cardStatus: cur, stuck: s.stuck ? 1 : 0 });
    }
    return { first, alerts, next };
  }

  return { ACTIVE, cardStatus, decide };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NotifyRules;
if (typeof window !== 'undefined') window.NotifyRules = NotifyRules;
