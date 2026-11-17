(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentReceivablesPanel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS = Object.freeze({
    advanced: Object.freeze({ label: "代墊未請款", next: Object.freeze([["billed", "標為已請款"], ["returned", "標為退回"]]) }),
    billed: Object.freeze({ label: "已請款", next: Object.freeze([["received", "標為已收"], ["advanced", "退回代墊"]]) }),
    received: Object.freeze({ label: "已收", next: Object.freeze([]) }),
    returned: Object.freeze({ label: "退回", next: Object.freeze([]) })
  });

  function normalize(item = {}) {
    return Object.freeze({
      id: String(item.id || ""),
      amount: Number(item.amount) || 0,
      currency: String(item.currency || "TWD").toUpperCase(),
      counterparty: String(item.counterparty || ""),
      reason: String(item.reason || ""),
      occurredOn: String(item.occurredOn || item.occurred_on || ""),
      status: STATUS[item.status] ? String(item.status) : "advanced",
      taskRef: String(item.taskRef || item.task_ref || ""),
      visibility: item.visibility === "shared" ? "shared" : "private",
      note: String(item.note || "")
    });
  }

  function summarize(items = []) {
    const open = { TWD: 0, USD: 0 };
    let openCount = 0;
    items.forEach(item => {
      if (item.status === "advanced" || item.status === "billed") {
        open[item.currency] = (open[item.currency] || 0) + item.amount;
        openCount += 1;
      }
    });
    return Object.freeze({ open, openCount });
  }

  function taskRefMarkup(taskRef, escape) {
    if (!taskRef) return "";
    const isUrl = /^https:\/\/\S+$/.test(taskRef);
    return isUrl
      ? `<a class="investment-receivable-task" href="${escape(taskRef)}" target="_blank" rel="noopener noreferrer">關聯任務 ↗</a>`
      : `<span class="investment-receivable-task">關聯任務：${escape(taskRef)}</span>`;
  }

  function renderRow(item, dependencies) {
    const escape = dependencies.escape;
    const format = dependencies.format;
    const status = STATUS[item.status];
    const actions = status.next.map(([next, label]) =>
      `<button type="button" data-receivable-action="set-status" data-receivable-id="${escape(item.id)}" data-receivable-next="${escape(next)}">${escape(label)}</button>`).join("");
    return `<article class="investment-receivable-row is-${item.status}" data-receivable-id="${escape(item.id)}">
      <div class="investment-receivable-main"><strong>${escape(item.counterparty)}</strong><span>${escape(item.reason)}</span><small>${escape(item.occurredOn)} · ${escape(status.label)}${item.visibility === "shared" ? " · 允許同步（未啟用）" : " · 私人"}</small></div>
      <div class="investment-receivable-side"><b>${escape(format.currency(item.amount, item.currency))}</b>${taskRefMarkup(item.taskRef, escape)}<div class="investment-receivable-actions">${actions}</div></div>
    </article>`;
  }

  function render(receivables = [], dependencies = {}) {
    const escape = dependencies.escape;
    const format = dependencies.format;
    const items = (Array.isArray(receivables) ? receivables : []).map(normalize);
    const summary = summarize(items);
    const openParts = Object.entries(summary.open).filter(([, value]) => value > 0)
      .map(([currency, value]) => format.currency(value, currency));
    const rows = items.length
      ? items.map(item => renderRow(item, dependencies)).join("")
      : `<div class="investment-panel-empty"><strong>目前沒有應收款</strong><small>第一筆可從下方登記；之後每筆可選擇關聯到專案任務。</small></div>`;
    return `<section class="investment-receivables" data-investment-section="receivables" data-investment-receivable-panel="true">
      <header class="investment-panel-heading"><div><h2>應收款</h2><p>未收合計 ${openParts.length ? escape(openParts.join("＋")) : "NT$ 0"}（${summary.openCount} 筆）</p></div></header>
      <p class="investment-receivable-boundary">關聯任務僅為參照連結；雙向同步尚未啟用，目前不從任務側自動寫入。</p>
      ${rows}
      <details class="investment-receivable-add"><summary>登記一筆應收款</summary>
        <form data-receivable-form="create">
          <label>幣別<select name="currency"><option value="TWD">TWD 新台幣</option><option value="USD">USD 美元</option></select></label>
          <label>金額<input type="number" name="amount" min="0.01" step="0.01" required></label>
          <label>對象<input type="text" name="counterparty" maxlength="240" required></label>
          <label>事由<input type="text" name="reason" maxlength="500" required></label>
          <label>日期<input type="date" name="occurred_on" required></label>
          <label>關聯任務（選填，代號或連結）<input type="text" name="task_ref" maxlength="500" placeholder="例如 TQ-40 或任務網址"></label>
          <label>同步範圍<select name="visibility"><option value="private" selected>私人（只留在島）</option><option value="shared">可同步（日後允許顯示在共用看板）</option></select></label>
          <label>備註（選填）<input type="text" name="note" maxlength="1000"></label>
          <button type="submit">登記</button>
        </form>
      </details>
    </section>`;
  }

  return Object.freeze({ render, normalize, summarize, STATUS });
});
