(function (root) {
  "use strict";

  const state = { rows: [], links: [], projection: null, projectionError: null, syncPromise: null, timer: 0, observer: null };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function num(value, digits = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("zh-TW", { maximumFractionDigits: digits }) : "—";
  }
  function money(value, currency) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const prefix = String(currency || "TWD").toUpperCase() === "USD" ? "US$" : "NT$";
    return `${prefix} ${n.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
  }
  function signedMoney(value, currency) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : "-"}${money(Math.abs(n), currency)}`;
  }
  function signedPct(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—";
  }
  function sourceKey(kind, id) { return `${String(kind || "")}:${String(id || "")}`; }

  function projectionChanged(result) {
    return ["created_count", "relinked_count", "moved_count", "deactivated_count"]
      .some(key => Number(result?.[key] || 0) > 0);
  }

  async function refreshSharedBoardAfterProjection() {
    const refresh = root.ZhugeBoardRuntime?.refresh;
    if (typeof refresh !== "function") return;
    // The shared C runtime may still be completing its first read.  The first
    // refresh waits for that read; the second guarantees a fresh Board read
    // after the projection has created or relinked cards.
    await refresh({ quiet: true });
    await refresh({ quiet: true });
  }

  function syncProjection(gateway) {
    if (state.syncPromise) return state.syncPromise;
    if (typeof gateway?.rpc !== "function") {
      const error = new Error("Investment IVTK Projection Contract 尚未就緒。");
      error.code = "INVESTMENT_IVTK_RPC_REQUIRED";
      state.projectionError = error;
      return Promise.resolve(null);
    }
    state.syncPromise = gateway.rpc("sync_investment_ivtk_projection", {})
      .then(async result => {
        state.projection = result || null;
        state.projectionError = null;
        if (projectionChanged(result)) await refreshSharedBoardAfterProjection();
        return result;
      })
      .catch(error => {
        // Projection is a controlled write activation, not a reason to hide
        // already-readable Investment cards.  Preserve the read path and
        // expose the controlled error through the runtime dataset for QA.
        state.projection = null;
        state.projectionError = error;
        return null;
      })
      .finally(() => { state.syncPromise = null; });
    return state.syncPromise;
  }

  function apply() {
    if (!state.rows.length || !state.links.length) return;
    const bySource = new Map(state.rows.map(row => [sourceKey(row.source_kind, row.source_id), row]));
    state.links.forEach(link => {
      if (link.active === false || link.card_kind !== "position") return;
      const row = bySource.get(sourceKey(link.source_kind, link.source_id));
      if (!row) return;
      const card = document.querySelector(`[data-shared-task-board-card-id="${CSS.escape(String(link.board_task_id))}"]`);
      if (!card) return;
      card.dataset.investmentCloudLinked = "true";
      card.dataset.investmentSymbol = row.symbol || "";
      const title = card.querySelector(".shared-task-card-title");
      if (title) title.textContent = `${row.symbol || ""} · ${row.name || ""}`;
      let summary = card.querySelector(".shared-task-card-summary");
      if (!summary) {
        summary = document.createElement("p");
        summary.className = "shared-task-card-summary";
        title?.insertAdjacentElement("afterend", summary);
      }
      summary.textContent = `${num(row.quantity, 3)} 股 · 成本 ${money(row.invested_cost, row.currency)} · 市值 ${money(row.market_value, row.currency)}`;
      let badge = card.querySelector("[data-investment-cloud-pnl]");
      if (!badge) {
        badge = document.createElement("span");
        badge.dataset.investmentCloudPnl = "true";
        badge.className = "investment-cloud-pnl";
        const side = card.querySelector(".shared-task-card-header-side") || card.querySelector(".shared-task-card-header");
        side?.appendChild(badge);
      }
      badge.dataset.trend = Number(row.unrealized_pnl || 0) >= 0 ? "gain" : "loss";
      badge.textContent = `${signedMoney(row.unrealized_pnl, row.currency)} / ${signedPct(row.unrealized_pct)}`;
      card.setAttribute("aria-label", `${row.symbol || ""} ${row.name || ""}，${num(row.quantity, 3)} 股，未實現損益 ${signedMoney(row.unrealized_pnl, row.currency)} ${signedPct(row.unrealized_pct)}`);
    });
  }

  async function load() {
    const gateway = root.ZhugeSupabaseGateway?.createDataGateway?.();
    if (!gateway?.select) return;
    try {
      await syncProjection(gateway);
      const [rows, links] = await Promise.all([
        gateway.select("investment_current_positions_view", "?select=source_kind,source_id,portfolio_id,symbol,name,market,currency,quantity,avg_cost,invested_cost,last_price,market_value,unrealized_pnl,unrealized_pct,effective_at&order=market.asc,symbol.asc"),
        gateway.select("investment_ivtk_card_links", "?select=board_task_id,source_kind,source_id,card_kind,active&active=eq.true&order=created_at.asc")
      ]);
      state.rows = Array.isArray(rows) ? rows : [];
      state.links = Array.isArray(links) ? links : [];
      apply();
      document.body.dataset.investmentCloudBridge = "ready";
      document.body.dataset.investmentCloudProjection = state.projectionError ? "error" : "ready";
    } catch (error) {
      console.error("[Investment Cloud Bridge]", error);
      document.body.dataset.investmentCloudBridge = "error";
      document.body.dataset.investmentCloudProjection = "error";
    }
  }

  function scheduleApply() {
    clearTimeout(state.timer);
    state.timer = setTimeout(apply, 40);
  }

  function boot() {
    load();
    const mount = document.querySelector("[data-board-main-view]") || document.body;
    state.observer = new MutationObserver(scheduleApply);
    state.observer.observe(mount, { childList: true, subtree: true });
    document.addEventListener("click", event => {
      if (event.target.closest?.("#refreshBoardBtn")) setTimeout(load, 250);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window);
