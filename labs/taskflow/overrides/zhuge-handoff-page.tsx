"use client";

import { useEffect, useState } from "react";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";

export default function ZhugeHandoffPage() {
  const [message, setMessage] = useState("正在接收 Zhuge 身分…");

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = params.get("zhuge_token");
      const destination = params.get("zhuge_dest") || "/";
      window.history.replaceState(null, "", window.location.pathname);
      if (!token) {
        setMessage("沒有收到 Zhuge 身分。請從 Zhuge AI OS 的 Lab 入口重新進入。");
        return;
      }
      window.localStorage.setItem("multica_token", token);
      window.location.replace(destination);
    } catch {
      setMessage("Zhuge 身分交接失敗。請從 Zhuge AI OS 的 Lab 入口重新進入。");
    }
  }, []);

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mb-5 flex items-center justify-center gap-2 text-foreground">
          <MulticaIcon className="size-5" noSpin />
          <span className="text-sm font-semibold lowercase tracking-[0.04em]">multica</span>
        </div>
        <div className="text-sm text-muted-foreground">{message}</div>
        <footer className="mt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Multica. All rights reserved. ·{" "}
          <a href="https://github.com/multica-ai/multica" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Multica source and attribution
          </a>
        </footer>
      </div>
    </main>
  );
}
