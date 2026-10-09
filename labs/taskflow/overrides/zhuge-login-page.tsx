"use client";

import { RedirectIfAuthenticated } from "@/features/landing/components/redirect-if-authenticated";
import { MulticaBrandMark } from "@/components/zhuge-multica-brand";

export default function Page() {
  return (
    <>
      <RedirectIfAuthenticated />
      <main className="min-h-svh bg-background text-foreground">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-6 py-14">
          <section className="w-full rounded-2xl border border-border bg-card p-7 text-center shadow-sm sm:p-10">
            <MulticaBrandMark className="flex items-center justify-center gap-2 text-foreground" />
            <p className="mt-3 text-xs font-semibold tracking-[0.16em] text-muted-foreground">ZHUGE AI OS · IDENTITY</p>
            <h1 className="mt-3 text-2xl font-semibold">不用再登入一次</h1>
            <p className="mt-4 leading-7 text-muted-foreground">
              Multica Lab 不建立第二套 Human Identity。請從 Zhuge AI OS 的 Lab 入口進入，
              系統會沿用已登入的 Zhuge UUID。
            </p>
            <a href="https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=dashboard" className="mt-7 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
              回到 Zhuge AI OS
            </a>
            <footer className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
              © {new Date().getFullYear()} Multica. All rights reserved. ·{" "}
              <a href="https://github.com/multica-ai/multica" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                Multica source and attribution
              </a>
            </footer>
          </section>
        </div>
      </main>
    </>
  );
}
