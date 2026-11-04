/* ZG-ERP 落差比對＋舊帳釐清標示（設計版 v2，2026-11-04，純函式，不觸網）。
 * 架構定案（使用者 11:57／12:00）：舊帳只比對、新帳管現況；過渡期每筆舊帳都要有交代——
 * 核對進度與查明結果以「釐清標示」連到新帳，舊資料原文永不改寫。
 * 鐵律：
 *  - 範圍沒盤完，舊有未掃到只標「尚未掃到」，永不輸出「遺失」。
 *  - 「已報廢」「已遺失」只能來自人工釐清標示（原因＋證據＋確認人齊全），系統不自行推定。
 *  - 同編號多筆（舊帳 409 組）候選並列「待人工判定」，不選 canonical、不計入資產數。
 *  - 位置不同不自動改帳：列「位置不符」候選，前台逐筆確認後才產生正式調撥事件。
 *  - 記錄鍵＋來源列在舊帳重整/排序後可能失效：釐清標示帶出處快照，join 前比對內容，
 *    不符就標「標示失配」留人工，不移花接木到別列。
 *  - 現場實際盤到的設備算進新帳數量，不因舊帳同編號多筆而被排除；
 *    舊帳候選的不確定與實體設備的身分是兩回事。
 */
(function (global) {
  "use strict";

  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();

  /* 出處快照：寫標示時凍結該列可識別內容；join 時比對，不符即「標示失配」 */
  function snapshotOf(row) {
    return { code: row.code || "", name: row.name || "", model: row.model || "", siteLead: row.siteLead || "", zone: row.zone || "" };
  }
  function snapshotMatches(snap, row) {
    if (!snap) return true; // 舊標示無快照：降級為僅記錄鍵 join（寫入端 v2 起必帶快照）
    return norm(snap.code) === norm(row.code) && norm(snap.name) === norm(row.name)
      && norm(snap.model) === norm(row.model) && norm(snap.siteLead) === norm(row.siteLead)
      && norm(snap.zone) === norm(row.zone);
  }

  /* 釐清結論：系統可比對出的進度 vs 只能人工給的結論 */
  const PROGRESS = ["尚未掃到", "已盤到", "待查清"];
  const CONCLUSIONS = ["位置確認", "位置不符已確認", "已報廢", "已遺失", "其他"];
  /* 這兩個結論必須原因＋證據＋確認人齊全（缺一即不合法，不得寫入） */
  const CONCLUSION_REQUIRES_EVIDENCE = ["已報廢", "已遺失"];

  function validateAnnotation(a) {
    if (!a || !a.recordKey) return { ok: false, reason: "缺記錄鍵" };
    if (a.conclusion && !CONCLUSIONS.includes(a.conclusion)) return { ok: false, reason: "結論不在列舉內" };
    if (CONCLUSION_REQUIRES_EVIDENCE.includes(a.conclusion)) {
      if (!a.reason || !a.evidence || !a.confirmer) {
        return { ok: false, reason: "「" + a.conclusion + "」需原因、證據、確認人三者齊全" };
      }
    }
    return { ok: true };
  }

  function inScopeLegacy(row, scope) {
    if (scope.site && norm(row.siteLead).indexOf(norm(scope.site)) === -1) return false; // 來源工作表只是線索
    if (scope.project && norm(row.project) !== norm(scope.project)) return false;
    return true;
  }
  function inScopeNew(a, scope) {
    if (scope.site && norm(a.site) !== norm(scope.site)) return false;
    if (scope.project && norm(a.project) !== norm(scope.project)) return false;
    return true;
  }

  function observedCodes(db, scope) {
    const codes = new Map();
    (db.assets || []).filter((a) => inScopeNew(a, scope)).forEach((a) => {
      const e = codes.get(a.code) || { sources: new Set(), site: a.site, zone: a.zone };
      e.sources.add("資產"); codes.set(a.code, e);
    });
    const sessIds = new Set((db.sessions || []).filter((s) => {
      if (scope.site && norm(s.site) !== norm(scope.site)) return false;
      if (scope.project && norm(s.project || "") !== norm(scope.project)) return false;
      return true;
    }).map((s) => s.id));
    (db.records || []).filter((r) => sessIds.has(r.sessionId) && r.code).forEach((r) => {
      const e = codes.get(r.code) || { sources: new Set(), site: r.site, zone: r.zone };
      e.sources.add("掃描"); codes.set(r.code, e);
    });
    return codes;
  }

  /* annotations: [{recordKey, code, progress, conclusion, reason, evidence, confirmer, at, newAssetCode, note}]
   * 以記錄鍵 join；人工結論覆寫系統進度（已釐清不再出現在待查清單） */
  function reconcile(legacyRows, db, scope, annotations) {
    scope = scope || {};
    const annByKey = new Map();
    (annotations || []).forEach((a) => { if (a && a.recordKey) annByKey.set(a.recordKey, a); });

    const legacy = (legacyRows || []).filter((r) => r.code); // 無編號列不進比對鍵，僅人工查
    const scopedLegacy = legacy.filter((r) => inScopeLegacy(r, scope));
    const observed = observedCodes(db, scope);

    const byCode = new Map();
    scopedLegacy.forEach((r) => {
      const list = byCode.get(r.code) || []; list.push(r); byCode.set(r.code, list);
    });
    const ambiguous = [...byCode.entries()].filter(([, list]) => list.length > 1)
      .map(([code, list]) => ({ code, verdict: "待人工判定", candidates: list }));

    const matched = [], locationMismatch = [], pending = [], clarified = [], staleAnnotations = [];
    const applyAnn = (row) => {
      const ann = annByKey.get(row.recordKey);
      if (!ann) return null;
      if (!snapshotMatches(ann.snapshot, row)) { // 快照不符：標示失配，不套用到別列
        staleAnnotations.push({ recordKey: row.recordKey, annotation: ann, currentRow: snapshotOf(row), verdict: "標示失配" });
        return null;
      }
      return ann;
    };
    byCode.forEach((list, code) => {
      if (list.length > 1) return; // 模糊組不進自動比對
      const row = list[0];
      const ann = applyAnn(row);
      if (ann && ann.conclusion) { // 人工結論優先：已釐清
        clarified.push({ code, legacy: row, annotation: ann, verdict: ann.conclusion });
        return;
      }
      const obs = observed.get(code);
      if (!obs) {
        pending.push({ legacy: row, annotation: ann || null, verdict: scope.closed ? "待查清" : "尚未掃到",
          openQuestion: "舊帳記在「" + (row.siteLead || "?") + "／" + (row.zone || "?") + "」，本範圍尚未掃到——設備在哪？仍在用、已報廢或已遺失，待查明" });
        return;
      }
      if (scope.site && norm(obs.site) !== norm(scope.site)) {
        locationMismatch.push({ code, legacy: row, observedSite: obs.site, observedZone: obs.zone, annotation: ann || null, verdict: "位置不符",
          openQuestion: "舊帳主張「" + (row.siteLead || "?") + "」，本次在「" + (obs.site || "?") + "」觀察到——以哪個為準，待前台逐筆確認" });
        return;
      }
      matched.push({ code, legacy: row, observed: obs, annotation: ann || null, verdict: "已盤到" });
    });

    /* 舊帳模糊組：已盤到的實體設備照算新帳數量，僅舊帳候選關係待人工判定 */
    const ambiguousObserved = [], ambiguousUnobserved = [];
    ambiguous.forEach((g) => {
      const obs = observed.get(g.code);
      if (obs) ambiguousObserved.push({ code: g.code, observed: obs, candidates: g.candidates, verdict: "已盤到（舊帳候選待人工判定）" });
      else ambiguousUnobserved.push(g);
    });

    const legacyCodes = new Set(scopedLegacy.map((r) => r.code));
    const newOnly = [...observed.entries()].filter(([code]) => !legacyCodes.has(code))
      .map(([code, obs]) => ({ code, observed: obs, verdict: "新增／待查", countedInNewInventory: true }));

    /* 每筆舊帳的交代總帳：已盤到＋已釐清＝有交代；其餘＝沒查清。
     * newInventory＝範圍內實際觀察到的實體設備數，不因舊帳模糊而扣（記錄≠資產，僅資產與掃描觀察計入）。 */
    const accounted = matched.length + clarified.length;
    return {
      scope: { site: scope.site || "", project: scope.project || "", closed: !!scope.closed },
      counts: {
        legacyInScope: scopedLegacy.length,
        observedInScope: observed.size,
        matched: matched.length,
        locationMismatch: locationMismatch.length,
        pending: pending.length,
        clarified: clarified.length,
        newOnly: newOnly.length,
        ambiguous: ambiguous.length,
        ambiguousObserved: ambiguousObserved.length,
        ambiguousUnobserved: ambiguousUnobserved.length,
        staleAnnotations: staleAnnotations.length,
        newInventory: observed.size,
        accounted,
        unaccounted: scopedLegacy.length - accounted
      },
      matched, locationMismatch, pending, clarified, newOnly, ambiguous, ambiguousObserved, ambiguousUnobserved, staleAnnotations
    };
  }

  global.ZgErpReconcile = Object.freeze({ reconcile, observedCodes, validateAnnotation, snapshotOf, snapshotMatches, PROGRESS, CONCLUSIONS });
  if (typeof module !== "undefined" && module.exports) module.exports = { reconcile, observedCodes, validateAnnotation, snapshotOf, snapshotMatches, PROGRESS, CONCLUSIONS };
})(typeof window !== "undefined" ? window : globalThis);
