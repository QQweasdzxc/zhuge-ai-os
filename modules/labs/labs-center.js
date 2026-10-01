(function () {
  "use strict";

  const scriptUrl = new URL(document.currentScript.src);
  const labsRootUrl = new URL("../../labs/", scriptUrl);
  const registryUrl = new URL("registry.json", labsRootUrl);
  const list = document.querySelector("[data-labs-list]");
  const state = document.querySelector("[data-labs-state]");
  const count = document.querySelector("[data-lab-count]");

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function sameOriginEntryUrl(value) {
    try {
      const url = new URL(String(value || ""), labsRootUrl);
      if (url.origin !== location.origin || !url.pathname.startsWith(labsRootUrl.pathname)) return null;
      return url;
    } catch {
      return null;
    }
  }

  function safeSourceLink(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  function makeCard(lab) {
    const article = node("article", "lab-card");
    const main = node("div");
    main.append(
      node("h3", "", lab.name || lab.id || "未命名 Lab"),
      node("p", "", `${lab.category || "未分類"} · ${lab.status || "狀態未設定"} · ${lab.enabled === false ? "已停用" : "已啟用"}`),
    );

    const meta = node("div", "lab-meta");
    [
      `目前 Gate：${lab.currentGate || "未設定"}`,
      `來源權利：${lab.licenseStatus || "未確認"}`,
      ...(Array.isArray(lab.dataTruthLabels) ? lab.dataTruthLabels.map((label) => `資料狀態：${label}`) : []),
    ].forEach((label) => meta.append(node("span", "lab-chip", label)));
    main.append(meta);

    const actions = node("div", "lab-actions");
    const entry = sameOriginEntryUrl(lab.localEntry);
    const link = node("a", "", entry && lab.enabled !== false ? "進入 Lab" : "入口未啟用");
    if (entry && lab.enabled !== false) {
      link.href = entry.href;
    } else {
      link.href = "#";
      link.setAttribute("aria-disabled", "true");
      link.addEventListener("click", (event) => event.preventDefault());
    }
    actions.append(link);

    const detail = node("details", "lab-details");
    detail.append(node("summary", "", "資料來源與使用邊界"));
    const source = node("p", "lab-source", `Source：${lab.source || "未登記"}`);
    const sourceUrl = safeSourceLink(lab.source);
    if (sourceUrl) {
      const anchor = node("a", "", sourceUrl.href);
      anchor.href = sourceUrl.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      source.replaceChildren(document.createTextNode("Source："), anchor);
    }
    detail.append(source);
    if (lab.upstreamCommit) detail.append(node("p", "", `凍結上游 commit：${lab.upstreamCommit}`));
    detail.append(node("p", "", "Lab 由 AIOS 同源網頁直接開啟，不需另外啟動服務。Provider 若受瀏覽器跨來源政策或第三方條款限制，會明確標示未接通；不會以模擬資料填補。"));

    article.append(main, actions, detail);
    return article;
  }

  async function loadRegistry() {
    try {
      const response = await fetch(registryUrl, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const registry = await response.json();
      if (!registry || !Array.isArray(registry.labs)) throw new Error("REGISTRY_SCHEMA_INVALID");
      const enabledLabs = registry.labs.filter((lab) => lab && lab.enabled !== false);
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
