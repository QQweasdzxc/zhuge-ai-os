"use client";

import { useState } from "react";

export default function TaskFlowDriveConnection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const cookies = Object.fromEntries(document.cookie.split("; ").map((part) => {
        const i = part.indexOf("=");
        return [part.slice(0, i), part.slice(i + 1)];
      }));
      const csrf = cookies.multica_csrf_session || cookies.multica_csrf;
      if (!csrf) throw new Error("請先登入 TF，再回到這個連線頁面。");
      const response = await fetch("/api/taskflow-drive/setup", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: "{}",
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error("請先登入 TF，再回到這個連線頁面。");
        if (response.status === 403) throw new Error("這個連線只限 TF 擁有者操作。請使用原本的擁有者帳號登入。");
        throw new Error("專用連線尚未準備完成，沒有啟用儲存。請回原對話告訴我。");
      }
      const data = await response.json();
      const url = new URL(data.authorization_url);
      if (url.origin !== "https://accounts.google.com" || url.pathname !== "/o/oauth2/v2/auth" || url.searchParams.get("scope") !== "https://www.googleapis.com/auth/drive.file") {
        throw new Error("連線入口檢查未通過，沒有啟用儲存。請回原對話告訴我。");
      }
      window.location.assign(url.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "目前無法建立連線，請稍後再試。");
      setBusy(false);
    }
  }
  return <main style={{ boxSizing: "border-box", minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px 16px", background: "#f5f6fa", color: "#182033", fontFamily: "system-ui, sans-serif" }}>
    <section style={{ boxSizing: "border-box", width: "100%", maxWidth: 520, border: "1px solid #dde1eb", borderRadius: 20, background: "#fff", padding: "clamp(24px, 6vw, 40px)", boxShadow: "0 12px 36px #14203b0a" }}>
      <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", color: "#526079", margin: "0 0 18px" }}>TRQN / TF</p>
      <h1 style={{ fontSize: 28, lineHeight: 1.35, margin: "0 0 16px" }}>連接私人附件資料夾</h1>
      <p style={{ lineHeight: 1.85, margin: "0 0 20px" }}>連線後，TF 會在你的 Google Drive 建立「TRQN TF 附件」私人資料夾，用來保存之後上傳的附件。任務內仍可直接看圖和下載，不用公開分享。</p>
      <ul style={{ paddingLeft: 22, lineHeight: 1.85, margin: "0 0 24px", color: "#4c586f" }}>
        <li>只授權這個應用程式建立或選取的檔案，不是整個雲端硬碟。</li>
        <li>請在 Google 畫面確認你要使用的帳號與權限。</li>
        <li>完成授權後仍需檢查，還不代表附件修復已完成。舊附件另行查核。</li>
      </ul>
      <button disabled={busy} onClick={connect} style={{ width: "100%", minHeight: 48, border: 0, borderRadius: 10, background: busy ? "#6c7da1" : "#284eaa", color: "#fff", fontSize: 16, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>{busy ? "正在開啟 Google…" : "前往 Google 授權"}</button>
      {error && <p role="alert" style={{ margin: "18px 0 0", lineHeight: 1.7, color: "#a12332" }}>{error}</p>}
      <p style={{ margin: "18px 0 0", fontSize: 13, lineHeight: 1.7, color: "#626e84" }}>不想連線可以直接關閉。這裡不會要求你提供 Google 密碼。</p>
    </section>
  </main>;
}
