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
      return `<div class="investment-import-write-message is-success" role="status"><strong>交易紀錄已寫入</strong><span>已透過 Investment Canonical Transaction Contract 更新；目前持股、成本與損益會在 Cloud Read-back 後重新計算。</span></div>`;
    }
    if (state.error) {
      return `<div class="investment-import-write-message is-error" role="alert"><strong>交易紀錄未寫入</strong><span>${text(state.error, escape)}</span></div>`;
    }
    return "";
  }

  function renderForm(state = {}, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const form = state.form || {};
    const busy = ["submitting", "step-up-required"].includes(state.status);
    const selected = String(form.tradeType || "BUY").toUpperCase();
    return `<article class="investment-command-panel investment-transaction-write-panel"><header class="investment-panel-heading"><div><p class="investment-eyebrow">新增交易</p><h2>記錄買入／賣出</h2><p>資料會追加至既有 transactions；持股與成本由唯一 Cloud calculation result 計算。</p></div><span class="investment-panel-status">安全驗證保護</span></header><form class="investment-import-write-form" data-investment-transaction-form><div class="investment-import-write-grid"><label><span>交易類型</span><select name="tradeType" ${busy ? "disabled" : ""}><option value="BUY" ${selected === "BUY" ? "selected" : ""}>買入</option><option value="SELL" ${selected === "SELL" ? "selected" : ""}>賣出</option></select></label><label><span>交易日期</span><input type="date" name="tradeDate" value="${inputValue(form, "tradeDate", new Date().toISOString().slice(0, 10))}" required ${busy ? "disabled" : ""}></label><label><span>市場</span><select name="market" ${busy ? "disabled" : ""}><option value="TW" ${String(form.market || "TW").toUpperCase() === "TW" ? "selected" : ""}>台股</option><option value="US" ${String(form.market || "").toUpperCase() === "US" ? "selected" : ""}>美股</option></select></label><label><span>幣別</span><select name="currency" ${busy ? "disabled" : ""}><option value="TWD" ${String(form.currency || "TWD").toUpperCase() === "TWD" ? "selected" : ""}>TWD</option><option value="USD" ${String(form.currency || "").toUpperCase() === "USD" ? "selected" : ""}>USD</option></select></label><label><span>股票代號</span><input name="symbol" value="${inputValue(form, "symbol")}" autocomplete="off" required ${busy ? "disabled" : ""}></label><label><span>股票名稱</span><input name="name" value="${inputValue(form, "name")}" autocomplete="off" ${busy ? "disabled" : ""}></label><label><span>成交股數</span><input type="number" name="quantity" min="0.000001" step="0.000001" value="${inputValue(form, "quantity")}" required ${busy ? "disabled" : ""}></label><label><span>成交單價</span><input type="number" name="price" min="0" step="0.000001" value="${inputValue(form, "price")}" required ${busy ? "disabled" : ""}></label><label><span>手續費／交易成本</span><input type="number" name="fee" min="0" step="0.01" value="${inputValue(form, "fee", "0")}" ${busy ? "disabled" : ""}></label><label><span>稅／其他賣出成本</span><input type="number" name="tax" min="0" step="0.01" value="${inputValue(form, "tax", "0")}" ${busy ? "disabled" : ""}></label><label><span>Idempotency Key</span><input name="idempotencyKey" minlength="8" value="${inputValue(form, "idempotencyKey")}" required ${busy ? "disabled" : ""}></label><label><span>備註</span><input name="note" value="${inputValue(form, "note")}" ${busy ? "disabled" : ""}></label></div><div class="investment-import-write-actions"><button class="investment-import-write-button" type="submit" ${busy ? "disabled" : ""}>${state.status === "submitting" ? "寫入中…" : "記錄交易"}</button><span class="investment-import-write-hint">買入成本含費用；賣出損益以淨收入減移動加權平均成本計算。</span></div></form>${stepUp(state, escape)}${renderMessage(state, escape)}</article>`;
  }

  function renderRows(transactions = [], dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const format = dependencies.format || {};
    if (!transactions.length) return `<div class="investment-table"><div class="investment-empty-state">目前尚無交易紀錄。新交易會追加至正式 transactions。</div></div>`;
    const rows = transactions.map(transaction => {
      const type = tradeLabels[transaction.tradeType] || transaction.tradeType || "未知";
      const amount = transaction.netAmount || ((transaction.grossAmount || transaction.quantity * transaction.price) * (transaction.tradeType === "BUY" ? -1 : 1));
      const amountText = typeof format.currency === "function" ? format.currency(Math.abs(amount), transaction.currency) : `${transaction.currency || ""} ${Math.abs(amount)}`;
      return `<div class="investment-transaction-row" data-investment-transaction-id="${text(transaction.id, escape)}"><time>${text(typeof format.date === "function" ? format.date(transaction.tradeDate) : transaction.tradeDate, escape)}</time><span><b>${text(type, escape)}</b> · ${text(transaction.symbol, escape)}${transaction.name ? ` · ${text(transaction.name, escape)}` : ""}</span><span>${text(transaction.quantity, escape)} 股</span><span>${text(typeof format.currency === "function" ? format.currency(transaction.price, transaction.currency) : transaction.price, escape)}</span><b>${text(`${transaction.tradeType === "BUY" ? "-" : "+"}${amountText}`, escape)}</b></div>`;
    }).join("");
    return `<div class="investment-table" data-investment-transactions><div class="investment-transaction-row investment-transaction-heading"><b>日期</b><b>交易</b><b>數量</b><b>單價</b><b>淨額</b></div>${rows}</div>`;
  }

  function render(state = {}, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    return `<section class="investment-transaction-page" data-investment-transaction-page><div class="investment-page-heading"><div><p class="investment-eyebrow">💰 Transaction Ledger</p><h1>交易紀錄</h1><p>交易紀錄是輸入；目前持股、移動加權平均成本法與我的損益由同一個 canonical calculation result 產生。</p></div><div class="investment-pill">${transactions.length} 筆 Cloud Read</div></div>${renderForm(dependencies.transactionWrite || {}, dependencies)}<section class="investment-command-panel"><header class="investment-panel-heading"><div><p class="investment-eyebrow">歷史紀錄</p><h2>所有交易</h2><p>既有 opening positions 維持為 Opening Baseline；舊交易不會被回溯疊加。</p></div></header>${renderRows(transactions, { escape, format: dependencies.format })}</section></section>`;
  }

  return Object.freeze({ render });
});
