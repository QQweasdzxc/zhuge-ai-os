(function (root) {
  "use strict";

  const state = { rows: [], links: [], timer: 0, observer: null };

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
      const [rows, links] = await Promise.all([
        gateway.select("investment_current_positions_view", "?select=source_kind,source_id,portfolio_id,symbol,name,market,currency,quantity,avg_cost,invested_cost,last_price,market_value,unrealized_pnl,unrealized_pct,effective_at&order=market.asc,symbol.asc"),
        gateway.select("investment_ivtk_card_links", "?select=board_task_id,source_kind,source_id,card_kind,active&active=eq.true&order=created_at.asc")
      ]);
      state.rows = Array.isArray(rows) ? rows : [];
      state.links = Array.isArray(links) ? links : [];
      apply();
      document.body.dataset.investmentCloudBridge = "ready";
    } catch (error) {
      console.error("[Investment Cloud Bridge]", error);
      document.body.dataset.investmentCloudBridge = "error";
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
