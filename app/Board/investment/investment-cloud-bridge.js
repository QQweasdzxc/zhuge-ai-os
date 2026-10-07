(function (root) {
  "use strict";

  const state = { rows: [], links: [], histories: new Map(), projection: null, projectionError: null, syncPromise: null, timer: 0, observer: null, detailLayer: null, detailPanel: null, detailTrigger: null, detailCard: null, detailListenersBound: false };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
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
  function sourceKey(kind, id) { return `${String(kind || "")}:${String(id || "")}`; }

  function historyRequest(row) {
    const market = String(row?.market || "").trim().toUpperCase();
    if (!row?.symbol || !["TW", "TWSE", "TPEX", "TWO"].includes(market)) return null;
    return { symbol: String(row.symbol).trim().toUpperCase().replace(/\.(TW|TWO)$/i, ""), market: "TW", name: String(row.name || "") };
  }
  function marketKey(value) {
    const market = String(value || "").trim().toUpperCase();
    return ["TW", "TWSE", "TPEX", "TWO"].includes(market) ? "TW" : market;
  }

  async function loadOfficialHistories(gateway, rows) {
    if (typeof gateway?.invokeFunction !== "function") return new Map();
    const symbols = [...new Map(rows
      .filter(row => row?.position_status === "current" && Number(row?.quantity || 0) > 0)
      .map(historyRequest)
      .filter(Boolean)
      .map(item => [`${item.market}:${item.symbol}`, item])).values()];
    if (!symbols.length) return new Map();
    try {
      const response = await gateway.invokeFunction("investment-intelligence-read", { symbols, news_limit: 1, portfolio_context: {}, strategy_ids: [] });
      if (response?.contract !== "zhuge-investment-intelligence-edge-v1" || response?.read_only !== true) return new Map();
      const histories = Array.isArray(response?.histories) ? response.histories : [];
      return new Map(histories.map(history => [`${String(history.market || "").toUpperCase()}:${String(history.symbol || "").toUpperCase()}`, history]));
    } catch (error) {
      // The existing authenticated Investment read authority may be unavailable.
      // The holding projection remains usable; the card renders an honest empty trend.
      return new Map();
    }
  }

  function resolveInvestmentItem(taskId) {
    const link = state.links.find(item => String(item?.board_task_id || item?.boardTaskId || "") === String(taskId || "") && item?.active !== false);
    if (!link) return null;
    const cardKind = link.card_kind || link.cardKind || "";
    const sourceKind = link.source_kind || link.sourceKind || "";
    const sourceId = link.source_id || link.sourceId || "";
    const item = state.rows.find(row => String(row?.source_kind || row?.sourceKind || "") === String(sourceKind) && String(row?.source_id || row?.sourceId || "") === String(sourceId));
    return item ? { item, cardKind } : null;
  }

  function registerTaskDrawerExtension() {
    const factory = root.InvestmentIVTKBoardAdapter?.createTaskDrawerExtension;
    if (typeof factory !== "function") return;
    root.InvestmentIVTKTaskDrawerExtension = factory({ resolveItem: resolveInvestmentItem, escape: esc });
  }

  registerTaskDrawerExtension();

  function ensureDetailLayer() {
    if (state.detailLayer?.isConnected) return state.detailLayer;
    const layer = document.createElement("div");
    layer.className = "investment-holding-detail-layer";
    layer.dataset.investmentHoldingDetailLayer = "true";
    layer.hidden = true;
    layer.innerHTML = `<button type="button" class="investment-holding-detail-backdrop" data-investment-holding-detail-backdrop aria-label="關閉持股明細"></button><section id="investmentHoldingDetailPanel" class="investment-holding-detail-panel" role="dialog" aria-labelledby="investmentHoldingDetailTitle" tabindex="-1"></section>`;
    document.body.appendChild(layer);
    state.detailLayer = layer;
    state.detailPanel = layer.querySelector(".investment-holding-detail-panel");
    layer.querySelector("[data-investment-holding-detail-backdrop]")?.addEventListener("click", closeHoldingDetail);
    layer.addEventListener("click", event => {
      if (event.target.closest?.("[data-investment-holding-detail-close]")) closeHoldingDetail();
    });
    return layer;
  }

  function closeHoldingDetail({ restoreFocus = true } = {}) {
    if (!state.detailLayer) return;
    state.detailLayer.hidden = true;
    state.detailLayer.dataset.mode = "";
    state.detailPanel?.replaceChildren();
    state.detailTrigger?.setAttribute("aria-expanded", "false");
    const trigger = state.detailTrigger;
    state.detailTrigger = null;
    state.detailCard = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function positionDesktopDetail(card, panel) {
    const rect = card.getBoundingClientRect();
    const width = Math.min(380, Math.max(280, window.innerWidth - 32));
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(260, Math.floor(window.innerHeight * 0.76))}px`;
    panel.style.visibility = "hidden";
    panel.style.left = "0px";
    panel.style.top = "0px";
    const panelRect = panel.getBoundingClientRect();
    const gap = 12;
    const right = rect.right + gap;
    const left = rect.left - panelRect.width - gap;
    let x;
    let y = rect.top;
    if (right + panelRect.width <= window.innerWidth - 12) x = right;
    else if (left >= 12) x = left;
    else {
      x = Math.min(Math.max(12, rect.left), window.innerWidth - panelRect.width - 12);
      if (rect.bottom + gap + panelRect.height <= window.innerHeight - 12) y = rect.bottom + gap;
      else y = rect.top - panelRect.height - gap;
    }
    y = Math.min(Math.max(12, y), window.innerHeight - panelRect.height - 12);
    panel.style.left = `${Math.round(x)}px`;
    panel.style.top = `${Math.round(y)}px`;
    panel.style.visibility = "visible";
  }

  function openHoldingDetail(card, trigger) {
    const taskId = card?.dataset.sharedTaskBoardCardId;
    const resolved = resolveInvestmentItem(taskId);
    const renderer = root.InvestmentHoldingCardPresentation?.renderHoldingDetail;
    if (!resolved || resolved.cardKind !== "position" || resolved.item?.position_status !== "current" || typeof renderer !== "function") return;
    if (state.detailTrigger === trigger && !state.detailLayer?.hidden) {
      closeHoldingDetail();
      return;
    }
    if (!state.detailLayer?.hidden) closeHoldingDetail({ restoreFocus: false });
    const layer = ensureDetailLayer();
    const history = state.histories.get(`${marketKey(resolved.item.market)}:${String(resolved.item.symbol || "").toUpperCase().replace(/\.(TW|TWO)$/i, "")}`) || null;
    const taskCode = card.dataset.investmentWorkCode || card.dataset.workCode || card.querySelector(".shared-task-card-code")?.textContent?.trim() || "";
    state.detailPanel.innerHTML = renderer(resolved.item, { workCode: taskCode }, history, root.InvestmentFormatters || {});
    state.detailTrigger = trigger;
    state.detailCard = card;
    trigger.setAttribute("aria-expanded", "true");
    layer.hidden = false;
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    layer.dataset.mode = mobile ? "mobile" : "desktop";
    state.detailPanel.setAttribute("aria-modal", mobile ? "true" : "false");
    if (mobile) {
      state.detailPanel.style.width = "";
      state.detailPanel.style.maxHeight = `${Math.floor(window.innerHeight * 0.76)}px`;
      state.detailPanel.style.left = "";
      state.detailPanel.style.top = "";
      state.detailPanel.style.visibility = "visible";
    } else {
      positionDesktopDetail(card, state.detailPanel);
    }
    state.detailPanel.querySelector("[data-investment-holding-detail-close]")?.focus({ preventScroll: true });
  }

  function bindHoldingDetail(rootNode) {
    if (!rootNode || state.detailListenersBound) return;
    state.detailListenersBound = true;
    ensureDetailLayer();
    rootNode.addEventListener("click", event => {
      const trigger = event.target.closest?.("[data-investment-holding-detail-trigger]");
      if (trigger) {
        event.preventDefault();
        event.stopPropagation();
        const card = trigger.closest(".investment-holding-runtime-card");
        openHoldingDetail(card, trigger);
        return;
      }
    }, true);
    document.addEventListener("click", event => {
      if (!state.detailLayer || state.detailLayer.hidden) return;
      if (event.target.closest?.(".investment-holding-detail-panel") || event.target.closest?.("[data-investment-holding-detail-trigger]")) return;
      closeHoldingDetail({ restoreFocus: Boolean(event.target.closest?.("[data-investment-holding-detail-backdrop]")) });
    }, true);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && state.detailLayer && !state.detailLayer.hidden) {
        event.preventDefault();
        closeHoldingDetail();
        return;
      }
      if (event.key === "Tab" && state.detailLayer && !state.detailLayer.hidden && state.detailLayer.dataset.mode === "mobile") {
        const focusable = [...state.detailPanel.querySelectorAll("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")];
        if (focusable.length) {
          const first = focusable[0], last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
    });
    rootNode.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.target.closest?.("[data-investment-holding-detail-trigger]")) event.stopPropagation();
    }, true);
    const reposition = () => {
      if (!state.detailLayer || state.detailLayer.hidden) return;
      if (!state.detailCard?.isConnected) { closeHoldingDetail({ restoreFocus: false }); return; }
      const mobile = window.matchMedia("(max-width: 640px)").matches;
      state.detailLayer.dataset.mode = mobile ? "mobile" : "desktop";
      state.detailPanel.setAttribute("aria-modal", mobile ? "true" : "false");
      if (mobile) {
        state.detailPanel.style.width = "";
        state.detailPanel.style.maxHeight = `${Math.floor(window.innerHeight * 0.76)}px`;
        state.detailPanel.style.left = "";
        state.detailPanel.style.top = "";
        state.detailPanel.style.visibility = "visible";
      } else positionDesktopDetail(state.detailCard, state.detailPanel);
    };
    window.addEventListener("resize", reposition, { passive: true });
    window.addEventListener("scroll", reposition, { passive: true, capture: true });
  }

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
      if (link.active === false || !["position", "history"].includes(link.card_kind)) return;
      const row = bySource.get(sourceKey(link.source_kind, link.source_id));
      if (!row) return;
      const card = document.querySelector(`[data-shared-task-board-card-id="${CSS.escape(String(link.board_task_id))}"]`);
      if (!card) return;
      card.dataset.investmentCloudLinked = "true";
      card.dataset.investmentSymbol = row.symbol || "";
      if (link.card_kind === "history" || row.position_status === "history") {
        const signature = JSON.stringify(row);
        if (card.dataset.investmentHistoricalProjection === signature) return;
        const title = card.querySelector(".shared-task-card-title");
        if (title) title.textContent = `${row.symbol || ""} · ${row.name || ""}`;
        let summary = card.querySelector(".shared-task-card-summary");
        if (!summary) {
          summary = document.createElement("p");
          summary.className = "shared-task-card-summary";
          title?.insertAdjacentElement("afterend", summary);
        }
        summary.textContent = `已平倉 · 已實現 ${signedMoney(row.realized_pnl, row.currency)}`;
        let badge = card.querySelector("[data-investment-cloud-pnl]");
        if (!badge) {
          badge = document.createElement("span");
          badge.dataset.investmentCloudPnl = "true";
          badge.className = "investment-cloud-pnl";
          const side = card.querySelector(".shared-task-card-header-side") || card.querySelector(".shared-task-card-header");
          side?.appendChild(badge);
        }
        badge.dataset.trend = Number(row.realized_pnl || 0) >= 0 ? "gain" : "loss";
        badge.textContent = `已實現 ${signedMoney(row.realized_pnl, row.currency)}`;
        card.setAttribute("aria-label", `${row.symbol || ""} ${row.name || ""}，已平倉，已實現損益 ${signedMoney(row.realized_pnl, row.currency)}`);
        card.dataset.investmentHistoricalProjection = signature;
        return;
      }
      if (link.card_kind !== "position" || row.position_status !== "current") return;
      const content = root.InvestmentHoldingCardPresentation;
      if (!content?.renderHoldingContent) return;
      const market = marketKey(row.market);
      const history = state.histories.get(`${market}:${String(row.symbol || "").toUpperCase().replace(/\.(TW|TWO)$/i, "")}`) || null;
      const signature = JSON.stringify({ row, history: history ? { provider: history.provider, asOf: history.asOf, bars: (history.bars || []).slice(-20).map(bar => [bar.asOf, bar.close]) } : null });
      if (card.dataset.investmentHoldingProjection === signature) return;
      card.dataset.investmentCard = "position";
      card.dataset.investmentSourceKind = row.source_kind || "";
      card.dataset.investmentSourceId = row.source_id || "";
      card.classList.add("investment-holding-runtime-card");
      const taskCode = card.dataset.workCode || card.querySelector(".shared-task-card-code")?.textContent?.trim() || "";
      card.dataset.investmentWorkCode = taskCode;
      card.innerHTML = content.renderHoldingContent(row, { workCode: taskCode }, history, root.InvestmentFormatters || {});
      const priceLabel = row.last_price !== null && row.last_price !== undefined && row.last_price !== "" && Number.isFinite(Number(row.last_price)) ? row.last_price : "尚無行情";
      const percentLabel = row.unrealized_pct !== null && row.unrealized_pct !== undefined && row.unrealized_pct !== "" && Number.isFinite(Number(row.unrealized_pct)) ? row.unrealized_pct : "—";
      const label = `${row.symbol || ""} ${row.name || ""}，持股估值 ${priceLabel}，未實現損益率 ${percentLabel}`;
      card.setAttribute("aria-label", label);
      card.dataset.investmentHoldingProjection = signature;
    });
  }

  async function load() {
    const gateway = root.ZhugeSupabaseGateway?.createDataGateway?.();
    if (!gateway?.select) return;
    try {
      await syncProjection(gateway);
      const [rows, links] = await Promise.all([
        gateway.select("investment_current_positions_view", "?select=source_kind,source_id,portfolio_id,symbol,name,market,currency,quantity,avg_cost,invested_cost,last_price,market_value,unrealized_pnl,unrealized_pct,realized_pnl,ever_held,position_status,effective_at,market_value_source&order=market.asc,symbol.asc,source_id.asc"),
        gateway.select("investment_ivtk_card_links", "?select=board_task_id,source_kind,source_id,card_kind,active&active=eq.true&order=created_at.asc")
      ]);
      state.rows = Array.isArray(rows) ? rows : [];
      state.links = Array.isArray(links) ? links : [];
      state.histories = await loadOfficialHistories(gateway, state.rows);
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
    bindHoldingDetail(mount);
    state.observer = new MutationObserver(scheduleApply);
    state.observer.observe(mount, { childList: true, subtree: true });
    document.addEventListener("click", event => {
      if (event.target.closest?.("#refreshBoardBtn")) setTimeout(load, 250);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window);
