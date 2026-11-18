(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentTransactionsPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const tradeLabels = Object.freeze({ BUY: "買入", SELL: "賣出", UNKNOWN: "未知" });

  function text(value, escape) {
    return escape(String(value == null ? "" : value));
  }

  function inputValue(form, key, fallback = "") {
    return text(form?.[key] ?? fallback, value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])));
  }

  function stepUp(state = {}, escape) {
    if (state.status !== "step-up-required") return "";
    const busy = ["preparing", "enrolling", "verifying"].includes(state.stepUp?.status);
    const error = state.stepUp?.error ? `<div class="investment-import-step-up-error" role="alert">${text(state.stepUp.error, escape)}</div>` : "";
    if (state.stepUp?.mode === "enrollment_required") {
      return `<div class="investment-import-step-up" data-investment-transaction-step-up-panel><div class="investment-import-step-up-heading"><strong>交易紀錄需要安全驗證</strong><span>第一次記錄交易前，請先設定 Google Authenticator。</span></div>${error}<button type="button" class="investment-primary-link" data-investment-transaction-write-enroll ${busy ? "disabled" : ""}>開始設定驗證器</button></div>`;
    }
    return `<div class="investment-import-step-up" data-investment-transaction-step-up-panel><div class="investment-import-step-up-heading"><strong>確認交易寫入</strong><span>請輸入目前的 6 位數驗證碼，完成後會繼續原本的交易紀錄。</span></div>${error}<form class="investment-import-step-up-form" data-investment-transaction-step-up><label><span>Google Authenticator 驗證碼</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required ${busy ? "disabled" : ""}></label><input type="hidden" name="factorId" value="${text(state.stepUp?.factorId || "", escape)}"><button type="submit" class="investment-primary-link" ${busy ? "disabled" : ""}>${busy ? "驗證中…" : "驗證並繼續"}</button></form></div>`;
  }

  function renderMessage(state = {}, escape) {
    if (state.status === "success") {
      return `<div class="investment-import-write-message is-success" role="status"><strong>交易紀錄已寫入</strong><span>已透過 Investment Canonical Transaction Contract 更新；目前持股、成本與損益會在 Cloud Read-back 後重新計算。</span><button type="button" data-investment-new-buy>登記下一筆交易</button></div>`;
    }
    if (state.error) {
      return `<div class="investment-import-write-message is-error" role="alert"><strong>交易登記未完成</strong><span>${text(state.error, escape)}</span></div>`;
    }
    return "";
  }

  function renderForm(state = {}, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const form = state.form || {};
    if(state.recoveryOnly && state.status!=="success")return `<section class="j-unknown" role="alert"><h2>先確認上一筆交易</h2><p>${text(state.error||"正在查詢原筆",escape)}</p><p>僅保留此分頁的登記識別，沒有保存交易草稿。查詢不會重新送出交易。尚未查到不代表沒有入帳。</p>${state.recoveryUnavailable?'':state.status==="checking"?'<button disabled>核對結果中…</button>':'<button data-j-transaction-check>查詢原筆結果</button>'}<button data-j-recovery-history>查看交易紀錄</button></section>`;
    if(["review","submitting","unknown","checking","success"].includes(state.status)){
      const cash=Number(form.quantity)*Number(form.price)+(form.tradeType==="BUY"?1:-1)*(Number(form.fee||0)+Number(form.tax||0));
      const rows=[["標的",`${form.symbol||""} ${form.name||""}`],["方向",form.tradeType==="SELL"?"賣出":"買入"],["市場／幣別",`${form.market}／${form.currency}`],["交易日期",form.tradeDate],["股數",form.quantity],["成交價",form.price],["手續費",form.fee],["稅",form.tax],[form.tradeType==="BUY"?"預計支出":"預計收入",cash],["備註",form.note||"無"]];
      const status=state.status;
      const message=status==="success"?'<section class="j-message" role="status"><strong>'+(state.recoveryOnly?'已查回原登記識別的交易':'交易紀錄已讀回核對')+'</strong><p>目前持股、成本與損益已重新讀取。不是向券商下單。</p><button data-investment-route="overview">回持股清單</button><button data-investment-new-buy>登記下一筆</button></section>':status==="unknown"?`<section class="j-unknown" role="alert"><strong>結果待確認，請勿新增另一筆</strong><p>${text(state.error||"尚無法確認寫入結果",escape)}</p><p>保留相同登記代碼，先查詢雲端結果。</p><button data-j-transaction-check>查詢這筆結果</button></section>`:status==="submitting"||status==="checking"?`<div class="j-message" role="status"><button disabled>${status==="checking"?"核對結果中…":"處理中…"}</button><p>請勿重複送出。</p></div>`:'<p>尚未寫入。核對後確認，才會依原有安全權限登記。</p><div class="j-actions"><button data-j-transaction-edit>返回修改</button><button class="j-primary" data-j-transaction-confirm>確認登記</button></div>';
      return `<ol class="j-steps" aria-label="操作進度"><li>1 填資料</li><li class="${status==='review'||status==='submitting'?'current':''}">2 核對摘要</li><li class="${['success','unknown','checking'].includes(status)?'current':''}">3 確認結果</li></ol><section class="j-review"><h2>${status==="success"?"登記結果":"核對這筆交易"}</h2><dl>${rows.map(([k,v])=>`<div><dt>${text(k,escape)}</dt><dd class="j-money">${dependencies.confirmedUI?.ui.hidden?"••••":text(v,escape)}</dd></div>`).join("")}</dl><details class="j-note"><summary>登記識別資訊</summary><p>由系統管理，用於確認同一筆記錄。</p><code>${text(form.idempotencyKey,escape)}</code></details>${message}</section>`;
    }

    const busy = ["submitting", "step-up-required", "success"].includes(state.status);
    const selected = String(form.tradeType || "BUY").toUpperCase();
    return `<article class="investment-command-panel investment-transaction-write-panel"><ol class="j-steps" aria-label="操作進度"><li class="current">1 填資料</li><li>2 核對摘要</li><li>3 確認結果</li></ol><form class="investment-import-write-form" data-investment-transaction-form><div class="investment-import-write-grid"><label><span>交易類型</span><select name="tradeType" ${busy ? "disabled" : ""}><option value="BUY" ${selected === "BUY" ? "selected" : ""}>買入</option><option value="SELL" ${selected === "SELL" ? "selected" : ""}>賣出</option></select></label><label><span>交易日期</span><input type="date" name="tradeDate" value="${inputValue(form, "tradeDate", new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()))}" required ${busy ? "disabled" : ""}></label><label><span>市場</span><select name="market" ${busy ? "disabled" : ""}><option value="TW" ${String(form.market || "TW").toUpperCase() === "TW" ? "selected" : ""}>台股</option><option value="US" ${String(form.market || "").toUpperCase() === "US" ? "selected" : ""}>美股</option></select></label><label><span>幣別</span><select name="currency" ${busy ? "disabled" : ""}><option value="TWD" ${String(form.currency || "TWD").toUpperCase() === "TWD" ? "selected" : ""}>TWD</option><option value="USD" ${String(form.currency || "").toUpperCase() === "USD" ? "selected" : ""}>USD</option></select></label><label><span>股票代號</span><input name="symbol" value="${inputValue(form, "symbol")}" autocomplete="off" required ${busy ? "disabled" : ""}></label><label><span>股票名稱</span><input name="name" value="${inputValue(form, "name")}" autocomplete="off" ${busy ? "disabled" : ""}></label><label><span>成交股數</span><input type="number" name="quantity" min="0.000001" step="0.000001" value="${inputValue(form, "quantity")}" required ${busy ? "disabled" : ""}></label><label><span>成交單價</span><input type="number" name="price" min="0" step="0.000001" value="${inputValue(form, "price")}" required ${busy ? "disabled" : ""}></label><label><span>手續費／交易成本</span><input type="number" name="fee" min="0" step="0.01" value="${inputValue(form, "fee", "0")}" ${busy ? "disabled" : ""}></label><label><span>稅／其他賣出成本</span><input type="number" name="tax" min="0" step="0.01" value="${inputValue(form, "tax", "0")}" ${busy ? "disabled" : ""}></label><input type="hidden" name="idempotencyKey" value="${inputValue(form, "idempotencyKey")}"><label><span>備註</span><input name="note" value="${inputValue(form, "note")}" ${busy ? "disabled" : ""}></label></div><div class="investment-import-write-actions"><button class="investment-import-write-button" type="submit" ${busy ? "disabled" : ""}>${state.status === "submitting" ? "寫入中…" : "下一步：核對摘要"}</button><span class="investment-import-write-hint">買入成本含費用；賣出損益以淨收入減移動加權平均成本法計算。</span></div></form>${stepUp(state, escape)}${renderMessage(state, escape)}</article>`;
  }

  function renderPendingActions(actions = [], state = {}, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    if (!actions.length) return "";
    const activeId = String(state.activeId || "");
    const cards = actions.map(action => {
      const tx = action.transaction || {};
      const evidence = action.evidence || {};
      const active = activeId === String(action.id || "");
      const busy = active && ["submitting", "step-up-required"].includes(state.status);
      const before = Number(evidence.beforeQuantity);
      const after = Number(evidence.afterQuantity);
      const quantityChange = Number.isFinite(before) && Number.isFinite(after)
        ? `<span class="investment-pending-quantity">${text(before, escape)} → <b>${text(after, escape)} 股</b></span>`
        : "";
      const price = typeof dependencies.format?.currency === "function"
        ? dependencies.format.currency(Number(tx.price || 0), tx.currency || "TWD")
        : `${tx.currency || ""} ${tx.price || ""}`;
      const error = active && state.error
        ? `<div class="investment-import-write-message is-error" role="alert"><strong>尚未更新</strong><span>${text(state.error, escape)}</span></div>` : "";
      const success = active && state.status === "success"
        ? `<div class="investment-import-write-message is-success" role="status"><strong>已確認更新</strong><span>已透過 canonical transaction contract 正式入帳。</span></div>` : "";
      const step = active ? stepUp({ status: state.status, stepUp: state.stepUp }, escape).replaceAll("data-investment-transaction-", "data-investment-pending-") : "";
      return `<article class="investment-command-panel investment-pending-action" data-investment-pending-action="${text(action.id, escape)}"><header class="investment-panel-heading"><div><p class="investment-eyebrow">${text(action.source || "TRQN 辨識", escape)} · 待我確認</p><h3>${text(action.title || `${tx.symbol || ""} 新交易`, escape)}</h3><p>${text(action.summary || "已與目前 Investment Cloud 資料比對，等待你確認後才會正式入帳。", escape)}</p></div><span class="investment-panel-status">待確認</span></header><div class="investment-pending-transaction-summary"><span><b>${text(tx.symbol || "", escape)}</b>${tx.name ? ` · ${text(tx.name, escape)}` : ""}</span><span>${String(tx.tradeType || "BUY").toUpperCase() === "SELL" ? "賣出" : "買入"} ${text(tx.quantity || "", escape)} 股</span><span>@ ${text(price, escape)}</span>${quantityChange}</div><div class="investment-import-write-actions"><button type="button" class="investment-import-write-button" data-investment-pending-confirm="${text(action.id, escape)}" ${busy ? "disabled" : ""}>${busy ? "確認中…" : "確認更新"}</button><span class="investment-import-write-hint">不確認就不會寫入 SB；你可以稍後再處理。</span></div>${step}${error}${success}</article>`;
    }).join("");
    return `<section class="investment-pending-actions" data-investment-pending-actions><div class="investment-page-heading"><div><p class="investment-eyebrow">🔔 Human-in-the-loop</p><h2>待我確認</h2><p>TRQN 或券商資料來源辨識到的新交易會先停在這裡；只有你確認後才正式寫入 Investment。</p></div><div class="investment-pill">${actions.length} 筆待確認</div></div>${cards}</section>`;
  }

  function renderRows(transactions = [], dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const format = dependencies.format || {};
    if (!transactions.length) return `<div class="investment-table"><div class="investment-empty-state">目前尚無交易紀錄。新交易會追加至正式 transactions。</div></div>`;
    const rows = transactions.map(transaction => {
      const type = tradeLabels[transaction.tradeType] || transaction.tradeType || "未知";
      const amount = transaction.netAmount || ((transaction.grossAmount || transaction.quantity * transaction.price) * (transaction.tradeType === "BUY" ? -1 : 1));
      const amountText = typeof format.currency === "function" ? format.currency(Math.abs(amount), transaction.currency) : `${transaction.currency || ""} ${Math.abs(amount)}`;
      const cashflowLabel = transaction.tradeType === "BUY" ? "買入支出" : transaction.tradeType === "SELL" ? "賣出收入" : "現金流";
      const cashflowSign = transaction.tradeType === "BUY" ? "-" : "+";
      return `<div class="investment-transaction-row" data-investment-transaction-id="${text(transaction.id, escape)}"><time>${text(typeof format.date === "function" ? format.date(transaction.tradeDate) : transaction.tradeDate, escape)}</time><span><b>${text(type, escape)}</b> · ${text(transaction.symbol, escape)}${transaction.name ? ` · ${text(transaction.name, escape)}` : ""}</span><span>${text(transaction.quantity, escape)} 股</span><span>${text(typeof format.currency === "function" ? format.currency(transaction.price, transaction.currency) : transaction.price, escape)}</span><b aria-label="${text(`${cashflowLabel} ${cashflowSign}${amountText}`, escape)}"><small>${text(cashflowLabel, escape)}</small> ${text(`${cashflowSign}${amountText}`, escape)}</b></div>`;
    }).join("");
    return `<div class="investment-table" data-investment-transactions><div class="investment-transaction-row investment-transaction-heading"><b>日期</b><b>交易</b><b>數量</b><b>單價</b><b>現金流</b></div>${rows}</div>`;
  }

  function render(state = {}, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const allTransactions = Array.isArray(state.transactions) ? state.transactions : [];
    const filter = dependencies.transactionFilter || null;
    const transactions = filter ? allTransactions.filter(row => row.symbol === filter.symbol && row.market === filter.market && row.currency === filter.currency) : allTransactions;
    const pendingActions = Array.isArray(state.pendingActions) ? state.pendingActions : [];
    return `<section class="investment-transaction-page"><div class="j-sheet-handle" aria-hidden="true"></div><div class="j-entry-header"><button type="button" data-investment-route="${dependencies.transactionFilter?'detail':'overview'}" aria-label="關閉並返回">×</button><small>正式資料 · 既有權限保護</small></div><h1>登記交易</h1><p class="j-entry-note">記錄已發生的交易，不向券商送單。<br>核對摘要後確認，才會正式登記。</p>${renderPendingActions(pendingActions, dependencies.pendingActionWrite || {}, dependencies)}${renderForm(dependencies.transactionWrite || {}, dependencies)}<details class="investment-ledger-details"><summary>查看交易紀錄與更多歷史</summary>${filter ? `<p>個股篩選只含已讀取部分：${text(filter.symbol,escape)} · ${text(filter.currency,escape)} <button data-investment-transactions-all>顯示全部</button></p>` : ''}${renderRows(transactions, {escape, format:dependencies.format})}<p class="j-note">目前已讀取 ${allTransactions.length} 筆${state.transactionsHasMore?'，尚有更早紀錄':'，已到最早紀錄'}。既有 opening positions 維持為 Opening Baseline，基準前交易不重複加計持股。</p>${state.transactionsHasMore?`<button data-investment-transactions-more ${dependencies.transactionLoadingMore?'disabled':''}>讀取更早交易</button>`:''}</details></section>`;
  }

  return Object.freeze({ render, renderPendingActions });
});
