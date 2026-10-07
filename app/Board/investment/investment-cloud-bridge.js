(function (root) {
  "use strict";

  const state = { rows: [], links: [], histories: new Map(), projection: null, projectionError: null, syncPromise: null, timer: 0, observer: null, detailLayer: null, detailPanel: null, detailTrigger: null, detailCard: null, detailListenersBound: false, portfolioFilter: "all" };

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

  function currentPositionRows() {
    return state.rows.filter(row => row?.position_status === "current" && Number.isFinite(Number(row?.quantity)) && Number(row.quantity) > 0);
  }

  function portfolioAmount(metric, currency, mode = "currency") {
    if (!metric || metric.value === null) return `<span class="investment-portfolio-unavailable">${metric?.missingCount ? "部分資料尚缺" : "—"}</span>`;
    const format = root.InvestmentFormatters || {};
    const value = Number(metric.value);
    if (mode === "signed") return typeof format.signed === "function" ? format.signed(value, 2) : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
    return typeof format.currency === "function" ? format.currency(value, currency) : money(value, currency);
  }

  function renderCurrencyTotals(summary, field, mode = "currency", includeRoi = false) {
    return summary.currencies.map(currency => {
      const group = summary.groups[currency];
      const metric = group[field];
      const roi = includeRoi && group.roi !== null
        ? `<small>${(root.InvestmentFormatters?.percent?.(group.roi) || `${group.roi >= 0 ? "+" : ""}${group.roi.toFixed(2)}%`)}</small>`
        : includeRoi ? `<small>報酬率資料不足</small>` : "";
      return `<span class="investment-portfolio-currency-total" data-currency="${esc(currency)}"><b>${portfolioAmount(metric, currency, mode)}</b><small>${esc(currency)}${metric?.missingCount ? ` · ${metric.missingCount} 檔未完整` : ""}</small>${roi}</span>`;
    }).join("") || `<span class="investment-portfolio-unavailable">尚無目前持股</span>`;
  }

  function renderPortfolioSummary(rows) {
    const presenter = root.InvestmentHoldingCardPresentation;
    const summary = presenter?.summarizeCurrentPositions?.(rows) || { count: 0, currencies: [], groups: {} };
    const format = root.InvestmentFormatters || {};
    return `<div class="investment-portfolio-summary" data-investment-portfolio-summary>
      <div class="investment-portfolio-summary-desktop">
        <article><span>總市值</span><div>${renderCurrencyTotals(summary, "marketValue")}</div></article>
        <article><span>投入成本</span><div>${renderCurrencyTotals(summary, "investedCost")}</div></article>
        <article><span>未實現損益</span><div>${renderCurrencyTotals(summary, "unrealizedPnl", "signed", true)}</div></article>
        <article><span>持股檔數</span><strong>${summary.count}</strong></article>
      </div>
      <div class="investment-portfolio-summary-mobile">
        <article><span>總市值</span><div>${renderCurrencyTotals(summary, "marketValue")}</div></article>
        <article><span>總損益</span><div>${renderCurrencyTotals(summary, "unrealizedPnl", "signed", true)}</div></article>
        <details><summary>投入成本與持股數</summary><div>${renderCurrencyTotals(summary, "investedCost")}<span>${summary.count} 檔目前持股</span></div></details>
      </div>
    </div>`;
  }

  function marketFilterFor(row) {
    const market = marketKey(row?.market);
    return ["TW", "TWSE", "TPEX", "TWO"].includes(market) ? "tw" : market === "US" ? "us" : "other";
  }

  function mountPortfolioView() {
    const board = document.querySelector('[data-shared-task-board="investment-ivtk"]');
    if (!board) return;
    board.classList.add("investment-portfolio-board");
    let view = board.querySelector(":scope > [data-investment-portfolio-view]");
    if (!view) {
      view = document.createElement("section");
      view.className = "investment-portfolio-view";
      view.dataset.investmentPortfolioView = "true";
      view.setAttribute("aria-label", "目前持股 Portfolio View");
      view.innerHTML = `<div data-investment-portfolio-summary-host></div><div class="investment-portfolio-filters" role="group" aria-label="依市場篩選持股"><button type="button" data-investment-market-filter="all">全部</button><button type="button" data-investment-market-filter="tw">台股</button><button type="button" data-investment-market-filter="us">美股</button></div><div class="investment-portfolio-grid" data-investment-portfolio-grid></div><p class="investment-portfolio-pending" data-investment-portfolio-pending hidden></p>`;
      board.prepend(view);
      view.addEventListener("click", event => {
        const button = event.target.closest?.("[data-investment-market-filter]");
        if (!button) return;
        state.portfolioFilter = button.dataset.investmentMarketFilter || "all";
        view.querySelectorAll("[data-investment-market-filter]").forEach(item => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", active ? "true" : "false");
        });
        view.querySelectorAll(".investment-holding-runtime-card").forEach(card => {
          card.hidden = state.portfolioFilter !== "all" && card.dataset.investmentMarket !== state.portfolioFilter;
        });
      });
    }
    const summaryHost = view.querySelector("[data-investment-portfolio-summary-host]");
    const summaryMarkup = renderPortfolioSummary(currentPositionRows());
    if (summaryHost.dataset.signature !== summaryMarkup) {
      summaryHost.innerHTML = summaryMarkup;
      summaryHost.dataset.signature = summaryMarkup;
    }
    const grid = view.querySelector("[data-investment-portfolio-grid]");
    const currentRows = currentPositionRows();
    const links = new Map(state.links.filter(link => link.active !== false && link.card_kind === "position")
      .map(link => [sourceKey(link.source_kind, link.source_id), link]));
    const mounted = new Set();
    let cardIndex = 0;
    currentRows.forEach(row => {
      const link = links.get(sourceKey(row.source_kind, row.source_id));
      if (!link) return;
      const card = board.querySelector(`[data-shared-task-board-card-id="${CSS.escape(String(link.board_task_id))}"]`);
      if (!card) return;
      card.classList.add("investment-portfolio-card");
      card.dataset.investmentMarket = marketFilterFor(row);
      card.hidden = state.portfolioFilter !== "all" && card.dataset.investmentMarket !== state.portfolioFilter;
      const anchor = grid.children[cardIndex] || null;
      if (card.parentElement !== grid || card !== anchor) grid.insertBefore(card, anchor);
      cardIndex += 1;
      mounted.add(String(link.board_task_id));
    });
    grid.querySelectorAll(".investment-holding-runtime-card").forEach(card => {
      if (!mounted.has(String(card.dataset.sharedTaskBoardCardId || ""))) card.remove();
    });
    board.querySelectorAll(":scope > [data-shared-task-board-column]").forEach(column => { column.hidden = true; });
    const pending = view.querySelector("[data-investment-portfolio-pending]");
    const missingLinks = currentRows.length - mounted.size;
    pending.hidden = missingLinks === 0;
    pending.textContent = missingLinks ? `${missingLinks} 檔目前持股仍在等待既有 IVTK 卡片關聯同步；資料保留顯示狀態，未建立或移動工作卡。` : "";
    view.querySelectorAll("[data-investment-market-filter]").forEach(item => {
      const active = item.dataset.investmentMarketFilter === state.portfolioFilter;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", active ? "true" : "false");
    });
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
      card.innerHTML = content.renderPortfolioHoldingContent(row, { workCode: taskCode }, history, root.InvestmentFormatters || {});
      const priceLabel = row.last_price !== null && row.last_price !== undefined && row.last_price !== "" && Number.isFinite(Number(row.last_price)) ? row.last_price : "尚無行情";
      const percentLabel = row.unrealized_pct !== null && row.unrealized_pct !== undefined && row.unrealized_pct !== "" && Number.isFinite(Number(row.unrealized_pct)) ? row.unrealized_pct : "—";
      const label = `${row.symbol || ""} ${row.name || ""}，持股估值 ${priceLabel}，未實現損益率 ${percentLabel}`;
      card.setAttribute("aria-label", label);
      card.dataset.investmentHoldingProjection = signature;
    });
    mountPortfolioView();
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
    mount.classList.add("investment-portfolio-surface");
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
