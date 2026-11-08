"use client";

import { useEffect, useState } from "react";
import { api } from "@multica/core/api";
import { MulticaBrandMark } from "@/components/zhuge-multica-brand";

type CliIntent = { status: "valid"; callback: string; state: string } | { status: "none" | "invalid" };
type CliSSO = {
  parseCliIntent(params: URLSearchParams | string): CliIntent;
  buildAiosLauncherUrl(intent: CliIntent): string;
  buildCliCallbackUrl(callback: string, token: string, state: string): string;
  consumeCliState(state: string, storage: Storage): boolean;
};
declare global { interface Window { ZhugeTaskFlowCliSSO?: CliSSO } }

function loadCliSSO(): Promise<CliSSO> {
  if (window.ZhugeTaskFlowCliSSO) return Promise.resolve(window.ZhugeTaskFlowCliSSO);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-taskflow-cli-sso="true"]');
    const script = existing || document.createElement("script");
    const finish = () => window.ZhugeTaskFlowCliSSO ? resolve(window.ZhugeTaskFlowCliSSO) : reject(new Error("CLI authorization helper unavailable"));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("CLI authorization helper unavailable")), { once: true });
    if (!existing) {
      script.src = "/zhuge-cli-sso.js";
      script.async = true;
      script.dataset.taskflowCliSso = "true";
      document.head.appendChild(script);
    }
  });
}

export default function Page() {
  const [message, setMessage] = useState("正在確認 TRQN 身分…");
  const [intent, setIntent] = useState<CliIntent>({ status: "none" });
  const [identity, setIdentity] = useState<{ id: string; name: string; email: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    const current = new URL(window.location.href);
    const queryHasIntent = current.searchParams.has("cli_callback") || current.searchParams.has("cli_state");
    void loadCliSSO().then((sso) => {
      if (!alive) return;
      if (queryHasIntent) {
        const parsed = sso.parseCliIntent(current.searchParams);
        window.history.replaceState(null, "", current.pathname);
        if (parsed.status !== "valid") {
          setMessage("CLI 登入要求無效或已過期。請在 CLI 重新執行 multica login。");
          return;
        }
        window.location.replace(sso.buildAiosLauncherUrl(parsed));
        return;
      }
      const parsed = sso.parseCliIntent(new URLSearchParams(current.hash.replace(/^#/, "")));
      if (current.hash) window.history.replaceState(null, "", current.pathname + current.search);
      if (parsed.status !== "valid") {
        setIntent(parsed);
        if (parsed.status === "invalid") {
          setMessage("CLI 登入要求無效。請在 CLI 重新執行 multica login。");
          return;
        }
        // No CLI intent: a direct or stale landing on this gate. A browser that
        // already holds a live TaskFlow session (e.g. signed in through the
        // Zhuge entry in another tab) continues straight into the workspace
        // instead of stopping here; the root route forwards it to the board.
        // Everyone else gets a working door below: the official Zhuge entry,
        // which hands a signed-in Zhuge session straight through and otherwise
        // starts the login-then-return flow. Authentication is never skipped.
        const existing = window.localStorage.getItem("multica_token");
        if (existing) {
          api.setToken(existing);
          api.getMe().then((user) => {
            if (!alive || !user) return;
            window.location.replace("/");
          }).catch(() => {
            if (!alive) return;
            api.setToken(null);
            setSessionChecked(true);
            setMessage("TaskFlow 登入狀態已過期。請從 TRQN 重新進入。");
          });
          return;
        }
        setSessionChecked(true);
        setMessage("請從 TRQN 的 WORK → TaskFlow 進入；CLI 登入也必須使用同一個 TRQN 身分。");
        return;
      }
      setIntent(parsed);
      api.setToken(window.localStorage.getItem("multica_token"));
      api.getMe().then((user) => {
        if (!alive) return;
        setIdentity({ id: user.id, name: user.name, email: user.email });
        setReady(true);
        setMessage("請確認以此 TRQN 身分授權 Multica CLI。授權碼 5 分鐘後失效。");
      }).catch(() => {
        if (!alive) return;
        api.setToken(null);
        setMessage("TaskFlow 身分已失效。請先在 TRQN 登入，再重新執行 multica login。");
      });
    }).catch(() => {
      if (alive) setMessage("無法安全載入 CLI 授權元件，請重新從 TRQN 進入。");
    });
    return () => { alive = false; };
  }, []);

  const authorize = async () => {
    if (intent.status !== "valid" || working || !ready) return;
    const sso = window.ZhugeTaskFlowCliSSO;
    if (!sso || !sso.consumeCliState(intent.state, window.sessionStorage)) {
      setError("此 CLI 登入要求已使用或已過期。請在 CLI 重新執行 multica login。");
      setReady(false);
      return;
    }
    setWorking(true);
    setError("");
    try {
      const { token: authorizationCode } = await api.issueCliToken();
      window.location.replace(sso.buildCliCallbackUrl(intent.callback, authorizationCode, intent.state));
    } catch {
      setWorking(false);
      setReady(false);
      setError("CLI 授權失敗。為避免重放，請在 CLI 重新執行 multica login。");
    }
  };

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-6 py-14">
        <section className="w-full rounded-2xl border border-border bg-card p-7 text-center shadow-sm sm:p-10">
          <MulticaBrandMark className="flex items-center justify-center gap-2 text-foreground" />
          <p className="mt-3 text-xs font-semibold tracking-[0.16em] text-muted-foreground">TRQN · IDENTITY</p>
          <h1 className="mt-3 text-2xl font-semibold">TaskFlow / CLI 身分授權</h1>
          <p className="mt-4 leading-7 text-muted-foreground">{message}</p>
          {identity && (
            <div className="mt-5 rounded-lg border border-border p-4 text-left text-sm" aria-label="已驗證的 TRQN 使用者">
              <div className="font-semibold">{identity.name || identity.email}</div>
              <div className="text-muted-foreground">{identity.email}</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">TRQN UUID：{identity.id}</div>
            </div>
          )}
          {intent.status !== "valid" && sessionChecked && (
            <div className="mt-6 flex flex-col justify-center gap-3">
              <a href="https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">從 TRQN 進入 TaskFlow</a>
            </div>
          )}
          {intent.status === "valid" && (
            <div className="mt-6 flex flex-col justify-center gap-3">
              <button type="button" disabled={!ready || working} onClick={() => void authorize()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
                {working ? "正在授權 CLI…" : "授權此 CLI"}
              </button>
              <a href="https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/" rel="noreferrer" className="text-sm text-muted-foreground underline underline-offset-4">取消並返回 TRQN</a>
            </div>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
          <footer className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
            © {new Date().getFullYear()} Multica. All rights reserved. ·{" "}
            <a href="https://github.com/multica-ai/multica" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Multica source and attribution</a>
          </footer>
        </section>
      </div>
    </main>
  );
}
