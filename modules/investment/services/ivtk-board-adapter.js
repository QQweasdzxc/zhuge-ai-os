(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentIVTKBoardAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function sourceKey(kind, id) {
    return `${String(kind || "").trim()}:${String(id || "").trim()}`;
  }

  function taskMap(board = {}) {
    return new Map((Array.isArray(board.tasks) ? board.tasks : [])
      .map(task => [String(task?.id || ""), task])
      .filter(([id]) => id));
  }

  function linkMap(board = {}) {
    return new Map((Array.isArray(board.links) ? board.links : [])
      .filter(link => link?.active !== false)
      .map(link => [sourceKey(link.sourceKind || link.source_kind, link.sourceId || link.source_id), link]));
  }

  function activeWorkspaces(board = {}) {
    return (Array.isArray(board.workspaces) ? board.workspaces : [])
      .filter(workspace => workspace?.active !== false && ["ivtk-stocks", "ivtk-watchlist"].includes(String(workspace.key || "")))
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  }

  function sourceLabel(position) {
    return position?.sourceKind === "broker_snapshot_item" ? "最新確認的券商快照" : "歷史期初持倉";
  }

  function renderPositionCard(position, link, task, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const format = dependencies.format || {};
    const number = value => String(typeof format.number === "function" ? format.number(value) : (value ?? "—"));
    const signed = value => String(typeof format.signed === "function" ? format.signed(value) : (value ?? "—"));
    const percent = value => String(typeof format.percent === "function" ? format.percent(value) : (value ?? "—"));
    const currency = (value, code) => String(typeof format.currency === "function" ? format.currency(value, code) : `${code || ""} ${value ?? "—"}`);
    const trend = Number(position?.unrealizedPnl || 0) >= 0 ? "gain" : "loss";
    const code = task?.workCode || "";
    const symbol = position?.symbol || "未命名標的";
    const name = position?.name || "未命名標的";
    const taskId = link?.boardTaskId || task?.id || "";
    const marketValueSource = position?.marketValueSource || sourceLabel(position);
    const quantity = number(position.quantity).replace(/\.00$/, "");
    const pnl = `${signed(position.unrealizedPnl)} / ${percent(position.unrealizedPercent)}`;
    const summary = `${escape(quantity)} 股 · 成本 ${escape(currency(position.investedCost, position.currency))} · 市值 ${escape(currency(position.marketValue, position.currency))}`;
    const body = `<div class="investment-ivtk-card-data-slot" data-investment-data-slot="position" aria-label="成本 ${escape(currency(position.investedCost, position.currency))}；均價 ${escape(number(position.averageCost))}"><span>成本 ${escape(currency(position.investedCost, position.currency))}</span><span>均價 ${escape(number(position.averageCost))}</span></div>`;
    const indicator = `<span class="investment-ivtk-card-indicator ${trend}" data-investment-performance="${trend}" title="${escape(pnl)}">${escape(pnl)}</span>`;
    const card = rootCard({
      // These are the canonical C Card classes. Investment only adds the
      // approved performance indicator as a data slot; it does not change
      // Card geometry, lifecycle, or interaction semantics.
      className: `card taskcard shared-task-board-card board-cloud-card investment-performance-${trend}`,
      code,
      title: `${symbol} · ${name}`,
      summaryHtml: `<p class="shared-task-card-summary">${summary}</p>`,
      actionsHtml: indicator,
      bodyHtml: body,
      attributes: {
        "data-shared-task-board-card-id": taskId,
        "data-investment-source-kind": position.sourceKind,
        "data-investment-source-id": position.sourceId,
        "data-investment-card": "position",
        "data-investment-source-label": marketValueSource,
        tabindex: "0",
        role: "button",
        "aria-label": `${symbol} ${name}，${quantity} 股，${pnl}`
      }
    }, dependencies);
    return card;
  }

  function renderWatchlistCard(item, link, task, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const taskId = link?.boardTaskId || task?.id || "";
    const symbol = item?.symbol || "未命名觀察標的";
    const name = item?.name || "未命名觀察標的";
    const status = item.status || "觀察";
    const body = `<div class="investment-ivtk-card-data-slot" data-investment-data-slot="watchlist"><span>${escape(item.reason || "尚未記錄觀察理由")}</span></div>`;
    return rootCard({
      className: "card taskcard shared-task-board-card board-cloud-card investment-watchlist-card",
      code: task?.workCode || "",
      title: symbol,
      summaryHtml: `<p class="shared-task-card-summary">${escape(name)} · ${escape(item.market || "—")} · ${escape(item.importance || "觀察")}</p>`,
      actionsHtml: `<span class="investment-ivtk-card-indicator watchlist">${escape(status)}</span>`,
      bodyHtml: body,
      attributes: {
        "data-shared-task-board-card-id": taskId,
        "data-investment-source-kind": "watchlist",
        "data-investment-source-id": item.id,
        "data-investment-card": "watchlist",
        tabindex: "0",
        role: "button",
        "aria-label": `${symbol} ${name}，${status}`
      }
    }, dependencies);
  }

  function rootCard(options, dependencies = {}) {
    const card = dependencies.card || (typeof globalThis !== "undefined" ? globalThis.ZhugeSharedTaskCard : null);
    if (typeof card?.render === "function") return card.render(options);
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    return `<div class="shared-capability-unavailable" data-shared-capability="c-card" role="status"><strong>模組 C 卡片尚未載入</strong><span>${escape(options.title || "Investment Card")}</span></div>`;
  }

  function buildColumn(workspace, state, dependencies, options = {}) {
    const board = state.ivtk?.board || {};
    const positions = Array.isArray(state.positions) ? state.positions : [];
    const watchlist = Array.isArray(state.watchlist) ? state.watchlist : [];
    const links = linkMap(board);
    const tasks = taskMap(board);
    const cards = [];
    if (workspace.key === "ivtk-stocks") {
      positions
        .slice()
        .sort((left, right) => `${left.market}:${left.symbol}`.localeCompare(`${right.market}:${right.symbol}`))
        .forEach(position => {
          const kind = position.sourceKind || "opening_position";
          const id = position.sourceId || position.id;
          const link = links.get(sourceKey(kind, id));
          const task = link ? tasks.get(link.boardTaskId) : null;
          if (link && task && link.cardKind === "position") cards.push({ position, link, task, kind: "position" });
        });
    } else {
      watchlist
        .slice()
        .sort((left, right) => `${left.market}:${left.symbol}`.localeCompare(`${right.market}:${right.symbol}`))
        .forEach(item => {
          const link = links.get(sourceKey("watchlist", item.id));
          const task = link ? tasks.get(link.boardTaskId) : null;
          if (link && task && link.cardKind === "watchlist") cards.push({ item, link, task, kind: "watchlist" });
        });
    }
    const cardsHtml = cards.map(card => card.kind === "position"
      ? renderPositionCard(card.position, card.link, card.task, dependencies)
      : renderWatchlistCard(card.item, card.link, card.task, dependencies)).join("");
    const expectedCount = workspace.key === "ivtk-stocks" ? positions.length : watchlist.length;
    const pendingCount = Math.max(0, expectedCount - cards.length);
    const pendingHtml = pendingCount
      ? `<p class="investment-ivtk-pending-note">${pendingCount} 筆 Investment 資料尚在等待 IVTK 關聯同步。</p>`
      : "";
    const menuButton = `<button class="workspace-menu" type="button" data-workspace-menu="${String(workspace.id || "").replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}" title="工作區操作" aria-label="工作區操作" aria-haspopup="menu" aria-expanded="false">⋮</button>`;
    return {
      id: workspace.id,
      key: workspace.key,
      name: workspace.name,
      sortOrder: workspace.sortOrder,
      count: cards.length,
      cards,
      cardsHtml: `${cardsHtml}${pendingHtml}`,
      emptyText: workspace.key === "ivtk-stocks" ? "目前沒有可投影的正式持倉。" : "目前沒有正式觀察標的。",
      // Workspace geometry and controls remain C-owned. A projection is
      // intentionally read-only, so the shared Board receives no domain
      // create/reorder controls and the binder rejects drag operations.
      className: "",
      readOnly: true,
      reorderable: false,
      controlsHtml: menuButton
    };
  }

  function renderBoard(state = {}, dependencies = {}, options = {}) {
    const board = state.ivtk?.board;
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    if (!board || state.ivtk?.status === "error") {
      const detail = state.ivtk?.error?.message || "IVTK 尚未完成 Cloud 關聯同步。";
      return `<section class="empty-golden-master investment-ivtk-runtime" data-golden-master="investment-ivtk" data-golden-master-data="unavailable" data-golden-master-surface><div class="investment-ivtk-status investment-ivtk-status-pending"><strong>Investment C Board 尚未就緒</strong><span>${escape(detail)}</span><small>正式持倉仍以 Investment Cloud 為準，尚未建立卡片時不顯示假資料。</small></div></section>`;
    }
    const workspaces = activeWorkspaces(board)
      .filter(workspace => !options.onlyWorkspaceKey || workspace.key === options.onlyWorkspaceKey);
    const columns = workspaces.map(workspace => buildColumn(workspace, state, dependencies, options));
    const projection = state.ivtk?.projection || {};
    const projectionStatus = state.ivtk?.projectionStatus || "ready";
    const statusHtml = projectionStatus === "ready"
      ? `<span class="golden-master-toolbar-status" data-investment-ivtk-status>Investment Cloud Projection 已同步</span>`
      : `<span class="golden-master-toolbar-status" data-investment-ivtk-status>等待受控 Projection 同步：${escape(projection.error?.message || "尚未完成")}</span>`;
    const boardRenderer = dependencies.goldenMaster || (typeof globalThis !== "undefined" ? globalThis.ZhugeGoldenMaster : null);
    const boardHtml = typeof boardRenderer?.renderBoard === "function"
      ? boardRenderer.renderBoard({
        id: "boardColumns",
        boardKey: "investment-ivtk",
        // C owns the Board framework. This class is intentionally the same
        // canonical class used by the Mother Template runtime.
        className: "golden-master-board",
        ariaLabel: "投資戰情板",
        emptyText: "目前沒有可顯示的 Investment Cloud 資料。",
        columns
      })
      : `<div class="shared-capability-unavailable" data-shared-capability="c-board" role="status"><strong>模組 C 看板尚未載入</strong><span>Investment 不會建立另一套看板呈現。</span></div>`;
    const projectionDetail = [
      Number.isFinite(Number(projection.position_count)) ? `持倉 ${projection.position_count}` : "",
      Number.isFinite(Number(projection.watchlist_count)) ? `觀察 ${projection.watchlist_count}` : ""
    ].filter(Boolean).join(" · ");
    const goldenMaster = boardRenderer;
    const toolbarHtml = typeof goldenMaster?.renderToolbar === "function"
      ? goldenMaster.renderToolbar({
        id: "goldenMasterToolbar",
        filters: [],
        includeSearch: false,
        statusHtml: `${statusHtml}<span class="golden-master-toolbar-status" data-investment-ivtk-count>${escape(projectionDetail || "Investment Cloud")}</span>`,
        legend: "Investment Cloud 是金融資料來源；卡片只呈現目前投影，不由卡片推導交易。"
      })
      : `<div class="shared-capability-unavailable" data-shared-capability="c-toolbar" role="status"><strong>模組 C 工具列尚未載入</strong><span>${statusHtml}</span></div>`;
    return `<section class="empty-golden-master investment-ivtk-runtime" data-golden-master="investment-ivtk" data-golden-master-data="cloud" data-golden-master-surface data-template-consumer="investment-ivtk">${toolbarHtml}<div data-golden-master-board-mount>${boardHtml}</div><div class="golden-master-drawer-host" data-golden-master-drawer-host></div></section>`;
  }

  function toSharedViewModel(item = {}, link = {}, task = {}, dependencies = {}) {
    const isWatchlist = item?.kind === "watchlist" || item?.sourceKind === "watchlist" || link?.cardKind === "watchlist";
    const title = item?.symbol || item?.name || (isWatchlist ? "觀察標的" : "投資標的");
    const summary = isWatchlist
      ? `${item?.name || "未命名觀察標的"} · ${item?.market || "—"}`
      : `${item?.name || "未命名標的"} · ${item?.market || "—"}`;
    return Object.freeze({
      task: Object.freeze({
        ...task,
        id: task?.id || link?.boardTaskId || "",
        workCode: task?.workCode || "",
        title,
        summary
      }),
      activity: Object.freeze([]),
      checklist: Object.freeze([]),
      attachments: Object.freeze([]),
      latestProgress: "",
      workContent: summary,
      consumer: "investment-ivtk",
      sourceKind: isWatchlist ? "watchlist" : item?.sourceKind || "opening_position",
      sourceId: item?.sourceId || item?.id || link?.sourceId || "",
      readOnly: true,
      escape: dependencies.escape
    });
  }

  function renderDrawer(item, link, task, dependencies = {}) {
    const drawer = dependencies.drawer || (typeof globalThis !== "undefined" ? globalThis.ZhugeSharedTaskDrawer : null);
    const goldenMaster = dependencies.goldenMaster || (typeof globalThis !== "undefined" ? globalThis.ZhugeGoldenMaster : null);
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const format = dependencies.format || {};
    const isWatchlist = link?.cardKind === "watchlist" || item?.sourceKind === "watchlist";
    const title = item?.symbol || item?.name || (isWatchlist ? "觀察標的" : "投資標的");
    const properties = isWatchlist
      ? [
        { key: "market", icon: "◎", label: "市場", value: item?.market || "—" },
        { key: "status", icon: "◉", label: "狀態", value: item?.status || "觀察" },
        { key: "importance", icon: "☆", label: "重要性", value: item?.importance || "觀察" }
      ]
      : [
        { key: "quantity", icon: "#", label: "持有數量", value: String(item?.quantity ?? "—") },
        { key: "average-cost", icon: "≈", label: "平均成本", value: typeof format.currency === "function" ? format.currency(item?.averageCost, item?.currency) : String(item?.averageCost ?? "—") },
        { key: "market-value", icon: "▣", label: "目前市值", value: typeof format.currency === "function" ? format.currency(item?.marketValue, item?.currency) : String(item?.marketValue ?? "—") },
        { key: "unrealized-pnl", icon: "↕", label: "未實現損益", value: typeof format.signed === "function" ? format.signed(item?.unrealizedPnl) : String(item?.unrealizedPnl ?? "—") },
        { key: "return-rate", icon: "%", label: "報酬率", value: typeof format.percent === "function" ? format.percent(item?.unrealizedPercent) : String(item?.unrealizedPercent ?? "—") }
      ];
    const details = isWatchlist
      ? `<p>${escape(item?.reason || "尚未記錄觀察理由")}</p>`
      : `<dl class="investment-ivtk-drawer-data"><div><dt>代號</dt><dd>${escape(item?.symbol || "—")}</dd></div><div><dt>名稱</dt><dd>${escape(item?.name || "—")}</dd></div><div><dt>成本</dt><dd>${escape(typeof format.currency === "function" ? format.currency(item?.investedCost, item?.currency) : String(item?.investedCost ?? "—"))}</dd></div><div><dt>券商市值語意</dt><dd>${escape(item?.marketValueSource || sourceLabel(item))}</dd></div></dl>`;
    const drawerOptions = {
      title,
      titleCode: task?.workCode || link?.boardTaskId || "IVTK",
      subtitle: isWatchlist ? "Investment · 觀察名單" : "Investment · Cloud Position",
      readOnly: true,
      properties,
      sections: [{ id: "investment-data", title: "Investment 資料", hint: "Read-only · Cloud Source of Truth", html: details }],
      activity: { title: "資料來源", hint: "只顯示正式 Investment Evidence", html: `<div class="shared-task-drawer-empty">${escape(isWatchlist ? "目前沒有觀察活動紀錄。" : "此卡片由 Investment Cloud Position 投影；不偽造交易紀錄。")}</div>` }
    };
    if (goldenMaster?.renderDrawer) {
      // Golden Master resolves shared components from its options object.
      // Keep the Drawer renderer canonical while allowing the adapter to
      // provide the already-loaded shared Drawer implementation explicitly.
      return goldenMaster.renderDrawer({ ...drawerOptions, components: { drawer } });
    }
    return drawer?.render ? drawer.render(drawerOptions) : "";
  }

  function findCardEntry(state = {}, taskId) {
    const board = state.ivtk?.board || {};
    const task = taskMap(board).get(String(taskId || ""));
    if (!task) return null;
    const link = (Array.isArray(board.links) ? board.links : []).find(item => String(item?.boardTaskId || "") === String(taskId) && item?.active !== false);
    if (!link) return null;
    const sourceKind = link.sourceKind || link.source_kind;
    const sourceId = link.sourceId || link.source_id;
    const item = sourceKind === "watchlist"
      ? (Array.isArray(state.watchlist) ? state.watchlist : []).find(row => String(row?.id || "") === String(sourceId))
      : (Array.isArray(state.positions) ? state.positions : []).find(row => String(row?.sourceId || row?.id || "") === String(sourceId));
    return item ? { item, link, task } : null;
  }

  function createRuntimeBridge(state = {}, dependencies = {}, options = {}) {
    const root = options.root || (typeof globalThis !== "undefined" ? globalThis : null);
    const boardRoot = options.boardRoot || null;
    const goldenMaster = dependencies.goldenMaster || root?.ZhugeGoldenMaster;
    const adapter = Object.freeze({
      consumer: "investment-ivtk",
      sharedDrawerContract: Object.freeze({ ownsDrawer: false, viewModel: "toSharedViewModel", renderer: "ZhugeGoldenMaster.renderDrawer" }),
      toSharedViewModel
    });

    function closeDrawer() {
      boardRoot?.querySelector?.("[data-golden-master-drawer-host]")?.replaceChildren();
    }

    function openTaskDetail(taskOrId) {
      const taskId = typeof taskOrId === "object" ? taskOrId?.id : taskOrId;
      const entry = findCardEntry(state, taskId);
      const host = boardRoot?.querySelector?.("[data-golden-master-drawer-host]");
      if (!entry || !host) return null;
      host.innerHTML = renderDrawer(entry.item, entry.link, entry.task, dependencies);
      const drawer = host.querySelector("[data-shared-task-drawer]");
      const contract = goldenMaster?.assertSharedDrawerContract?.({ consumer: "investment-ivtk", adapter, drawer: dependencies.drawer || root?.ZhugeSharedTaskDrawer });
      if (contract && !contract.ok) {
        host.replaceChildren();
        const error = new Error(contract.code || "SHARED_DRAWER_CONTRACT_INVALID");
        error.code = contract.code;
        throw error;
      }
      drawer?.querySelectorAll?.("[data-shared-task-drawer-close]").forEach(node => node.addEventListener("click", closeDrawer));
      return Object.freeze({ status: "opened", taskId: String(taskId), drawer });
    }

    function refresh() {
      return typeof options.refresh === "function" ? options.refresh() : Promise.resolve({ status: "noop" });
    }

    async function moveTaskToWorkspace() {
      const error = new Error("Investment IVTK Projection is read-only; workspace movement is controlled by Investment Cloud.");
      error.code = "INVESTMENT_IVTK_READ_ONLY";
      throw error;
    }

    function completionGateStatus() {
      return Object.freeze({ ok: true, code: "INVESTMENT_POSITION_READ_ONLY", status: "read_only" });
    }

    function completionGateMessage() {
      return "Investment Position Card 由 Cloud Projection 控制，不能在 Board 內直接完成或改寫。";
    }

    function runParityGuard(parityOptions = {}) {
      const engine = dependencies.parity || root?.ZhugeTemplateParityEngine;
      const report = engine?.run
        ? engine.run({ consumerId: "investment-ivtk", trigger: parityOptions.trigger || "runtime" })
        : { status: "unavailable", gapCount: null, fingerprint: "UNAVAILABLE" };
      const surface = boardRoot?.closest?.("[data-golden-master-surface]") || boardRoot?.querySelector?.("[data-golden-master-surface]") || boardRoot;
      if (surface?.dataset) {
        surface.dataset.templateParity = report.status || "unknown";
        surface.dataset.templateGap = String(report.gapCount ?? "");
      }
      return report;
    }

    const runtime = { consumer: "investment-ivtk", refresh, openTaskDetail, moveTaskToWorkspace, completionGateStatus, completionGateMessage, runParityGuard, getSnapshot: () => Object.freeze({ consumer: "investment-ivtk", positionCount: Array.isArray(state.positions) ? state.positions.length : 0, watchlistCount: Array.isArray(state.watchlist) ? state.watchlist.length : 0 }) };
    if (boardRoot) {
      boardRoot.__investmentIvtkRuntime = runtime;
      if (typeof goldenMaster?.bindBoard === "function") {
        goldenMaster.bindBoard(boardRoot, { canDragCard: () => false, canReorderColumn: () => false, onCardDrop: () => moveTaskToWorkspace(), onColumnDrop: () => moveTaskToWorkspace() });
      }
      root?.ZhugeGoldenMasterWorkspaceSettings?.bind?.(boardRoot, state.ivtk?.board?.workspaces || [], {
        service: dependencies.workspaceNotificationService || null
      });
      if (!boardRoot.dataset.investmentIvtkRuntimeBound) {
        boardRoot.addEventListener("click", event => {
          const current = boardRoot.__investmentIvtkRuntime;
          const card = event.target.closest?.("[data-investment-card]");
          if (!current || !card || !boardRoot.contains(card)) return;
          current.openTaskDetail(card.dataset.sharedTaskBoardCardId || "");
        });
        boardRoot.addEventListener("keydown", event => {
          if (!(["Enter", " "].includes(event.key))) return;
          const card = event.target.closest?.("[data-investment-card]");
          if (!card || !boardRoot.contains(card)) return;
          event.preventDefault();
          boardRoot.__investmentIvtkRuntime?.openTaskDetail(card.dataset.sharedTaskBoardCardId || "");
        });
        boardRoot.dataset.investmentIvtkRuntimeBound = "true";
      }
    }
    return Object.freeze(runtime);
  }

  return Object.freeze({
    sourceKey,
    activeWorkspaces,
    renderPositionCard,
    renderWatchlistCard,
    buildColumn,
    renderBoard,
    toSharedViewModel,
    renderDrawer,
    findCardEntry,
    createRuntimeBridge
  });
});
