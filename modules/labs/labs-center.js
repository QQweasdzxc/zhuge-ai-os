(function () {
  "use strict";

  const registryUrl = new URL("../../labs/registry.json", document.currentScript.src);
  const list = document.querySelector("[data-labs-list]");
  const state = document.querySelector("[data-labs-state]");
  const count = document.querySelector("[data-lab-count]");

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function localEntryUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/sandbox/") return null;
      return url;
    } catch {
      return null;
    }
  }

  function makeCard(lab) {
    const article = node("article", "lab-card");
    const main = node("div");
    const title = node("h3", "", lab.name || lab.id || "未命名 Lab");
    main.append(title, node("p", "", lab.description || `${lab.category || "未分類"} · ${lab.status || "狀態未設定"} · ${lab.enabled === false ? "已停用" : "已啟用"}`));

    const meta = node("div", "lab-meta");
    [
      `狀態：${lab.status || "未設定"}`,
      `目前 Gate：${lab.currentGate || "未設定"}`
    ].forEach(label => meta.append(node("span", "lab-chip", label)));
    main.append(meta);

    const actions = node("div", "lab-actions");
    const entry = localEntryUrl(lab.localEntry);
    const link = node("a", "", entry && lab.enabled !== false ? "進入 Lab" : "入口不可用");
    if (entry && lab.enabled !== false) {
      link.href = entry.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.href = "#";
      link.setAttribute("aria-disabled", "true");
      link.addEventListener("click", event => event.preventDefault());
    }
    actions.append(link);

    const detail = node("details", "lab-details");
    detail.append(node("summary", "", "來源與隔離說明"));
    const source = node("p", "lab-source", `Source：${lab.source || "未登記"}`);
    if (lab.source) {
      const sourceUrl = new URL(lab.source);
      if (sourceUrl.protocol === "https:") {
        const sourceLink = node("a", "", lab.source);
        sourceLink.href = sourceUrl.href;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        source.replaceChildren(document.createTextNode("Source："), sourceLink);
      }
    }
    detail.append(source);
    detail.append(node("p", "", `研究參考版本：${lab.referenceCommit || "未記錄"}`));
    detail.append(node("p", "", "這是 Zhuge 獨立實作；Genspark 僅作功能研究參考，沒有複製其原始碼或素材。研究入口只使用本機服務，不會打包進 AIOS。"));
    detail.append(node("p", "", "使用「Zhuge Investment Sandbox」一鍵啟動器後，再按「進入 Lab」。所有資料來源、日期、延遲與未接狀態都會在研究頁標示；不需要 upstream 帳號或 Demo/VIP 授權。第三方 Provider credential、權限與使用條款仍照其規則處理。"));
    article.append(main, actions, detail);
    return article;
  }

  async function loadRegistry() {
    try {
      const response = await fetch(registryUrl, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const registry = await response.json();
      if (!registry || !Array.isArray(registry.labs)) throw new Error("REGISTRY_SCHEMA_INVALID");
      const enabledLabs = registry.labs.filter(lab => lab && lab.enabled !== false);
      list.replaceChildren(...enabledLabs.map(makeCard));
      count.textContent = `${enabledLabs.length} 項`;
      if (!enabledLabs.length) {
        const empty = node("p", "labs-state", "目前沒有啟用中的 Lab。若你預期應看到實驗入口，請檢查 labs/registry.json。");
        empty.dataset.labsState = "empty";
        list.replaceChildren(empty);
      }
    } catch {
      count.textContent = "無法讀取";
      state.textContent = "Lab 清單暫時無法讀取。這不會影響既有 AIOS 功能；請確認 labs/registry.json 可由目前來源提供。";
      state.dataset.state = "error";
    }
  }

  loadRegistry();
})();
