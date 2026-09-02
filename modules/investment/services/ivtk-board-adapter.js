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
    const number = value => typeof format.number === "function" ? format.number(value) : String(value ?? "—");
    const signed = value => typeof format.signed === "function" ? format.signed(value) : String(value ?? "—");
    const percent = value => typeof format.percent === "function" ? format.percent(value) : String(value ?? "—");
    const currency = (value, code) => typeof format.currency === "function" ? format.currency(value, code) : `${code || ""} ${value ?? "—"}`;
    const trend = Number(position?.unrealizedPnl || 0) >= 0 ? "gain" : "loss";
    const code = task?.workCode || "";
    const name = [position?.symbol, position?.name].filter(Boolean).join(" · ") || "未命名標的";
    const taskId = link?.boardTaskId || task?.id || "";
    const marketValueSource = position?.marketValueSource || sourceLabel(position);
    const body = `<dl class="investment-ivtk-card-metrics"><div><dt>股數</dt><dd>${escape(number(position.quantity).replace(/\.00$/, ""))}</dd></div><div><dt>均價</dt><dd>${escape(number(position.averageCost))}</dd></div><div><dt>成本</dt><dd>${escape(currency(position.investedCost, position.currency))}</dd></div><div><dt>市值</dt><dd>${escape(currency(position.marketValue, position.currency))}</dd></div></dl><div class="investment-ivtk-card-pnl ${trend}"><span>${escape(position.currency)}</span><strong>${escape(signed(position.unrealizedPnl))} / ${escape(percent(position.unrealizedPercent))}</strong></div>`;
    const source = `<span class="investment-ivtk-card-source">${escape(marketValueSource)} · Investment Cloud</span>`;
    const card = rootCard({
      className: `investment-ivtk-card ${trend}`,
      code,
      title: name,
      summaryHtml: `<p class="shared-task-card-summary">${escape(position.market)} · ${escape(position.account || "投資組合")}</p>`,
      bodyHtml: body,
      footerHtml: source,
      attributes: {
        "data-shared-task-board-card-id": taskId,
        "data-investment-source-kind": position.sourceKind,
        "data-investment-source-id": position.sourceId,
        "data-investment-card": "position"
      }
    }, dependencies);
    return card;
  }

  function renderWatchlistCard(item, link, task, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const taskId = link?.boardTaskId || task?.id || "";
    const name = [item?.symbol, item?.name].filter(Boolean).join(" · ") || "未命名觀察標的";
    const body = `<dl class="investment-ivtk-watchlist-metrics"><div><dt>市場</dt><dd>${escape(item.market)}</dd></div><div><dt>狀態</dt><dd>${escape(item.status || "觀察")}</dd></div><div><dt>主題</dt><dd>${escape(item.theme || "尚未分類")}</dd></div></dl><p class="investment-ivtk-watchlist-reason">${escape(item.reason || "尚未記錄觀察理由")}</p>`;
    return rootCard({
      className: "investment-ivtk-card investment-ivtk-watchlist-card",
      code: task?.workCode || "",
      title: name,
      summaryHtml: `<p class="shared-task-card-summary">Investment Watchlist · ${escape(item.importance || "觀察")}</p>`,
      bodyHtml: body,
      footerHtml: "<span class=\"investment-ivtk-card-source\">Investment Cloud · 觀察名單</span>",
      attributes: {
        "data-shared-task-board-card-id": taskId,
        "data-investment-source-kind": "watchlist",
        "data-investment-source-id": item.id,
        "data-investment-card": "watchlist"
      }
    }, dependencies);
  }

  function rootCard(options, dependencies = {}) {
    const card = dependencies.card || (typeof globalThis !== "undefined" ? globalThis.ZhugeSharedTaskCard : null);
    if (typeof card?.render === "function") return card.render(options);
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    return `<article class="${escape(options.className || "investment-ivtk-card")}"><div class="shared-task-card-code">${escape(options.code || "")}</div><h3>${escape(options.title || "")}</h3>${options.bodyHtml || ""}</article>`;
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
    return {
      id: workspace.id,
      key: workspace.key,
      name: workspace.name,
      sortOrder: workspace.sortOrder,
      count: cards.length,
      cards,
      cardsHtml: `${cardsHtml}${pendingHtml}`,
      emptyText: workspace.key === "ivtk-stocks" ? "目前沒有可投影的正式持倉。" : "目前沒有正式觀察標的。",
      className: ["investment-ivtk-column", options.onlyWorkspaceKey === workspace.key ? "is-focused" : ""].filter(Boolean).join(" "),
      readOnly: true,
      reorderable: false,
      controlsHtml: ""
    };
  }

  function renderBoard(state = {}, dependencies = {}, options = {}) {
    const board = state.ivtk?.board;
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    if (!board || state.ivtk?.status === "error") {
      const detail = state.ivtk?.error?.message || "IVTK 尚未完成 Cloud 關聯同步。";
      return `<section class="investment-ivtk-runtime"><div class="investment-ivtk-status investment-ivtk-status-pending"><strong>投資戰情板尚未就緒</strong><span>${escape(detail)}</span><small>正式持倉仍以 Investment Cloud 為準，尚未建立卡片時不顯示假資料。</small></div></section>`;
    }
    const workspaces = activeWorkspaces(board)
      .filter(workspace => !options.onlyWorkspaceKey || workspace.key === options.onlyWorkspaceKey);
    const columns = workspaces.map(workspace => buildColumn(workspace, state, dependencies, options));
    const projection = state.ivtk?.projection || {};
    const projectionStatus = state.ivtk?.projectionStatus || "ready";
    const statusHtml = projectionStatus === "ready"
      ? `<span class="investment-ivtk-status-chip">Cloud Projection 已同步</span>`
      : `<span class="investment-ivtk-status-chip is-pending">${escape(projection.error?.message || "等待受控 Projection 同步")}</span>`;
    const boardRenderer = dependencies.goldenMaster || (typeof globalThis !== "undefined" ? globalThis.ZhugeGoldenMaster : null);
    const boardHtml = typeof boardRenderer?.renderBoard === "function"
      ? boardRenderer.renderBoard({
        id: "investmentIvtkBoard",
        boardKey: "investment-ivtk",
        className: "investment-ivtk-board",
        ariaLabel: "投資戰情板",
        emptyText: "目前沒有可顯示的 Investment Cloud 資料。",
        columns
      })
      : `<div class="investment-ivtk-fallback-board">${columns.map(column => `<section><h3>${escape(column.name)}</h3>${column.cardsHtml || `<p>${escape(column.emptyText)}</p>`}</section>`).join("")}</div>`;
    const projectionDetail = [
      Number.isFinite(Number(projection.position_count)) ? `持倉 ${projection.position_count}` : "",
      Number.isFinite(Number(projection.watchlist_count)) ? `觀察 ${projection.watchlist_count}` : ""
    ].filter(Boolean).join(" · ");
    return `<section class="investment-ivtk-runtime"><header class="investment-ivtk-runtime-heading"><div><p class="investment-eyebrow">IVTK · 投資戰情板</p><h2>${escape(options.onlyWorkspaceKey === "ivtk-watchlist" ? "觀察名單" : "我的投資標的")}</h2><p>卡片只呈現 Investment Cloud 正式資料；Board 僅保存穩定關聯與共用卡片身份。</p></div><div class="investment-ivtk-runtime-meta">${statusHtml}<small>${escape(projectionDetail || "Investment Cloud")}</small></div></header>${boardHtml}<p class="investment-ivtk-source-note">資料優先序：最新確認的券商快照 → 歷史期初持倉；不由卡片推導交易。</p></section>`;
  }

  return Object.freeze({
    sourceKey,
    activeWorkspaces,
    renderPositionCard,
    renderWatchlistCard,
    buildColumn,
    renderBoard
  });
});
