"use client";

import { useEffect, useState } from "react";

export default function ZhugeHandoffPage() {
  const [message, setMessage] = useState("正在接收 Zhuge 身分…");

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = params.get("zhuge_token");
      window.history.replaceState(null, "", window.location.pathname);
      if (!token) {
        setMessage("沒有收到 Zhuge 身分。請從 Zhuge AI OS 的 Lab 入口重新進入。");
        return;
      }
      window.localStorage.setItem("multica_token", token);
      window.location.replace("/");
    } catch {
      setMessage("Zhuge 身分交接失敗。請從 Zhuge AI OS 的 Lab 入口重新進入。");
    }
  }, []);

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md text-center text-sm text-muted-foreground">{message}</div>
    </main>
  );
}
