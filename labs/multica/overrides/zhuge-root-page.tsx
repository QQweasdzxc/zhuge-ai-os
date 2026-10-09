import type { Metadata } from "next";
import { RedirectIfAuthenticated } from "@/features/landing/components/redirect-if-authenticated";

export const metadata: Metadata = {
  title: { absolute: "Multica Agent Lab · Zhuge AI OS" },
  description: "Zhuge AI OS 的 Multica 原生 Agent 協作實驗場域。",
};

export default function LandingPage() {
  return (
    <>
      <RedirectIfAuthenticated />
      <main className="min-h-svh bg-background text-foreground">
        <div className="mx-auto flex min-h-svh w-full max-w-3xl items-center px-6 py-14">
          <section className="w-full rounded-2xl border border-border bg-card p-7 shadow-sm sm:p-10">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">ZHUGE AI OS · LAB</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Multica Agent Lab</h1>
            <p className="mt-4 leading-7 text-muted-foreground">
              這是 Zhuge AI OS 內的 Multica 實驗場域。人類身分、UUID 與 Workspace 邊界由 Zhuge 管理；
              Multica 保留原生 Issues、Agents、Runs、Runtimes、Skills、Squads 與 Autopilot 體驗。
            </p>
            <div className="mt-7 rounded-xl border border-border bg-muted/30 p-4 text-sm leading-6">
              <strong>請從 Zhuge AI OS 的 Lab 入口進入。</strong>
              <p className="mt-1 text-muted-foreground">此技術網址不提供另一套註冊、OTP 或 Multica Cloud 帳號。</p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=dashboard" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">回到 Zhuge AI OS</a>
              <a href="https://github.com/multica-ai/multica" target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium">查看上游原始碼</a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
