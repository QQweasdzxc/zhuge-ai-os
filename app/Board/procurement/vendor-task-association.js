(function initializeGasVendorTaskAssociation(global){
  "use strict";

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
  const text = value => String(value == null ? "" : value).trim();
  const categoryText = value => Array.isArray(value)
    ? value.map(text).filter(Boolean).join("、")
    : text(value).replace(/[|,，/／;；]+/g, "、");
  const VENDOR_FIELDS = [
    ["vendorName", "廠商名稱"],
    ["company", "公司"],
    ["businessCategory", "業務分類"],
    ["products", "產品／服務"],
    ["contactName", "聯絡人"],
    ["phone", "電話"],
    ["mobile", "手機"],
    ["email", "Email"],
    ["paymentTerms", "付款方式"]
  ];

  function vendorSummary(row) {
    if (!row) return "";
    const parts = [text(row.vendorName), text(row.company), categoryText(row.businessCategory)].filter(Boolean);
    return parts.join(" · ");
  }

  function renderDetail(row) {
    if (!row) return "";
    return `<dl class="gas-vendor-detail-list">${VENDOR_FIELDS.map(([key, label]) => {
      const value = key === "businessCategory" ? categoryText(row[key]) : text(row[key]);
      return value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "";
    }).join("")}</dl>`;
  }

  function sectionMarkup() {
    return `<div class="gas-vendor-association" data-gas-vendor-association-root>
      <div class="gas-vendor-association-state" data-gas-vendor-association-state data-task-drawer-extension-error="gas-vendor-association" aria-live="polite">正在讀取關聯資料…</div>
      <div class="gas-vendor-association-picker">
        <label class="gas-vendor-search-label"><span>搜尋廠商</span><input type="search" data-gas-vendor-search placeholder="輸入廠商名稱、公司或產品／服務" autocomplete="off"></label>
        <div class="gas-vendor-results" data-gas-vendor-results role="listbox" aria-label="廠商搜尋結果"></div>
      </div>
      <div class="gas-vendor-selected" data-gas-vendor-selected>尚未關聯廠商。</div>
      <div class="gas-vendor-association-actions">
        <button type="button" class="btn2" data-gas-vendor-view disabled>查看廠商資料</button>
        <button type="button" class="btn2 primary" data-gas-vendor-save disabled>儲存關聯</button>
        <button type="button" class="btn2" data-gas-vendor-clear disabled>解除關聯</button>
      </div>
      <div class="gas-vendor-detail" data-gas-vendor-detail hidden></div>
    </div>`;
  }

  function createController(options) {
    const host = options.container?.querySelector?.("[data-gas-vendor-association-root]");
    if (!host) return null;
    const task = options.task || {};
    const boardService = options.service;
    const VendorSheetService = global.VendorSheetService?.VendorSheetService;
    if (!VendorSheetService || typeof boardService?.getTaskVendorLink !== "function" || typeof boardService?.setTaskVendorLink !== "function") {
      throw new Error("GAS 廠商關聯服務尚未就緒。");
    }
    const vendorService = new VendorSheetService();
    const state = { vendors: [], linked: null, selected: null, busy: false, detail: null };
    const status = host.querySelector("[data-gas-vendor-association-state]");
    const search = host.querySelector("[data-gas-vendor-search]");
    const results = host.querySelector("[data-gas-vendor-results]");
    const selected = host.querySelector("[data-gas-vendor-selected]");
    const view = host.querySelector("[data-gas-vendor-view]");
    const save = host.querySelector("[data-gas-vendor-save]");
    const clear = host.querySelector("[data-gas-vendor-clear]");
    const detail = host.querySelector("[data-gas-vendor-detail]");
    const readOnly = options.readOnly === true;

    function setStatus(message, stateName = "") {
      if (!status) return;
      status.textContent = message;
      if (stateName) status.dataset.state = stateName;
      else delete status.dataset.state;
    }
    function findVendor(vendorId) {
      const id = text(vendorId);
      return state.vendors.find(row => text(row.vendorId) === id) || null;
    }
    function currentVendor() {
      return state.selected || findVendor(state.linked?.vendorId);
    }
    function filteredVendors() {
      const query = text(search?.value).toLowerCase();
      if (!query) return state.vendors.slice(0, 8);
      return state.vendors.filter(row => [row.vendorName, row.company, row.businessCategory, row.products, row.contactName]
        .map(text).join(" ").toLowerCase().includes(query)).slice(0, 12);
    }
    function renderResults() {
      if (!results) return;
      const rows = filteredVendors();
      results.innerHTML = rows.length
        ? rows.map(row => `<button type="button" class="gas-vendor-result" data-gas-vendor-choice="${esc(row.vendorId)}" role="option"><strong>${esc(text(row.vendorName) || "未命名廠商")}</strong><span>${esc(vendorSummary(row))}</span></button>`).join("")
        : `<div class="gas-vendor-no-results">找不到符合的廠商。</div>`;
    }
    function renderSelected() {
      const row = currentVendor();
      if (selected) {
        selected.innerHTML = row
          ? `<strong>${esc(text(row.vendorName) || "未命名廠商")}</strong><span>${esc(vendorSummary(row))}</span>`
          : state.linked?.vendorId
            ? `<strong>目前關聯的廠商</strong><span>最新廠商名冊中暫時找不到資料。</span>`
            : "尚未關聯廠商。";
      }
      if (view) view.disabled = readOnly || !row || state.busy;
      if (save) save.disabled = readOnly || !state.selected || state.busy;
      if (clear) clear.disabled = readOnly || !state.linked?.vendorId || state.busy;
      renderResults();
    }
    function renderDetailPanel(row) {
      if (!detail) return;
      detail.hidden = !row;
      detail.innerHTML = row ? `<div class="gas-vendor-detail-heading"><strong>最新廠商資料</strong><button type="button" class="btn2" data-gas-vendor-detail-close>收合</button></div>${renderDetail(row)}` : "";
      detail.querySelector("[data-gas-vendor-detail-close]")?.addEventListener("click", () => {
        state.detail = null;
        renderDetailPanel(null);
      });
    }
    function setBusy(value) {
      state.busy = value;
      if (search) search.disabled = readOnly || value;
      renderSelected();
    }
    async function reloadLink() {
      const link = await boardService.getTaskVendorLink(task.id);
      state.linked = link && typeof link === "object" ? link : { vendorId: "" };
      state.selected = findVendor(state.linked.vendorId);
      renderSelected();
      return state.linked;
    }
    async function saveLink() {
      const row = state.selected;
      if (!row || !text(row.vendorId)) {
        setStatus("請先選擇要關聯的廠商。", "error");
        return;
      }
      setBusy(true);
      setStatus("正在保存關聯並確認最新結果…");
      try {
        await boardService.setTaskVendorLink(task.id, row.vendorId);
        const readback = await reloadLink();
        if (text(readback.vendorId) !== text(row.vendorId)) throw new Error("Cloud 回讀的廠商關聯與剛才保存的結果不一致。");
        setStatus("廠商關聯已保存。", "ok");
        options.setBanner?.("廠商關聯已保存；卡片只保留正式關聯識別，廠商資料仍由 Google Sheet 提供。", "success");
      } catch (error) {
        setStatus(error?.message || "廠商關聯保存失敗。", "error");
      } finally {
        setBusy(false);
      }
    }
    async function clearLink() {
      setBusy(true);
      setStatus("正在解除關聯並確認最新結果…");
      try {
        await boardService.setTaskVendorLink(task.id, null);
        const readback = await reloadLink();
        if (text(readback.vendorId)) throw new Error("Cloud 回讀仍存在廠商關聯。");
        state.detail = null;
        renderDetailPanel(null);
        setStatus("廠商關聯已解除。", "ok");
        options.setBanner?.("廠商關聯已解除。", "success");
      } catch (error) {
        setStatus(error?.message || "解除廠商關聯失敗。", "error");
      } finally {
        setBusy(false);
      }
    }
    async function viewLatestVendor() {
      const row = currentVendor();
      if (!row) return;
      setBusy(true);
      setStatus("正在讀取最新廠商資料…");
      try {
        const latestRows = await vendorService.list();
        const latest = latestRows.find(item => text(item.vendorId) === text(row.vendorId));
        if (!latest) throw new Error("最新廠商名冊中找不到這筆資料。");
        state.vendors = state.vendors.map(item => text(item.vendorId) === text(latest.vendorId) ? latest : item);
        state.selected = latest;
        state.detail = latest;
        renderSelected();
        renderDetailPanel(latest);
        setStatus("已顯示 Google Sheet 的最新資料。", "ok");
      } catch (error) {
        setStatus(error?.message || "最新廠商資料讀取失敗。", "error");
      } finally {
        setBusy(false);
      }
    }
    search?.addEventListener("input", renderResults);
    results?.addEventListener("click", event => {
      const choice = event.target.closest?.("[data-gas-vendor-choice]");
      if (!choice) return;
      const row = findVendor(choice.dataset.gasVendorChoice);
      if (!row) return;
      state.selected = row;
      state.detail = null;
      renderDetailPanel(null);
      renderSelected();
      setStatus("已選擇廠商，請按「儲存關聯」完成保存。", "pending");
    });
    save?.addEventListener("click", saveLink);
    clear?.addEventListener("click", clearLink);
    view?.addEventListener("click", viewLatestVendor);

    return {
      async load() {
        setStatus("正在讀取關聯與廠商名冊…");
        const [link, rows] = await Promise.all([boardService.getTaskVendorLink(task.id), vendorService.list()]);
        state.linked = link && typeof link === "object" ? link : { vendorId: "" };
        state.vendors = Array.isArray(rows) ? rows : [];
        state.selected = findVendor(state.linked.vendorId);
        renderSelected();
        setStatus(state.linked.vendorId ? "已載入目前關聯。" : "尚未關聯廠商。", "ok");
      }
    };
  }

  global.ZhugeGasVendorAssociation = Object.freeze({
    id: "gas-vendor-association",
    renderSection() {
      return {
        id: "gas-vendor-association",
        title: "關聯廠商",
        hint: "卡片只保存關聯識別；廠商內容即時讀取 Google Sheet",
        className: "gas-vendor-association-section",
        html: sectionMarkup()
      };
    },
    async mount(options) {
      const controller = createController(options);
      if (controller) await controller.load();
    }
  });
})(window);
