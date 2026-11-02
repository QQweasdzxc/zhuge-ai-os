"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAuthStore } from "@multica/core/auth";

export const OFFICE_PANEL_KEY = "zhuge.tf.officePanel";
export const OFFICE_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/";
export const OFFICE_ORIGIN = new URL(OFFICE_URL).origin;
export const TF_TOKEN_KEY = "multica_token";
export const EMBEDDED_READY_TYPE = "zhuge-office-ready";
export const EMBEDDED_AUTH_TYPE = "zhuge-office-embedded-auth";
export const EMBEDDED_CLEAR_TYPE = "zhuge-office-embedded-auth-clear";

export function TaskFlowOfficePanel() {
  const [open, setOpen] = useState(false);
  const [large, setLarge] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ZG-52 embedded auth handoff. The token leaves this page only after the
  // office iframe announces readiness, and only when origin AND source both
  // verify against the live iframe; delivery is pinned to the office origin.
  // The token is the current session's own read JWT for the same workspace
  // the office would query after its own login - no new audience or scope.
  // Nothing is persisted: the office keeps it in memory only.
  useEffect(() => {
    function readToken(): string | null {
      try {
        return localStorage.getItem(TF_TOKEN_KEY);
      } catch {
        return null;
      }
    }
    // The session JWT stays valid server-side until its own exp even after
    // logout (HMAC, no revocation list — verified in the API's JWT auth
    // branch), so a logout/account switch must be pushed to the iframe
    // actively: the auth-store subscription below is the immediate path.
    let lastSent: string | null = null;
    function pushAuth(clear: boolean) {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      const token = clear ? null : readToken();
      if (clear || token !== lastSent) {
        lastSent = token;
        iframe.contentWindow.postMessage(
          token ? { type: EMBEDDED_AUTH_TYPE, token } : { type: EMBEDDED_CLEAR_TYPE },
          OFFICE_ORIGIN,
        );
      }
    }
    function onMessage(event: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      if (event.origin !== OFFICE_ORIGIN) return;
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as { type?: unknown } | null;
      if (!data || data.type !== EMBEDDED_READY_TYPE) return;
      lastSent = null; // fresh (re)handshake always re-answers
      pushAuth(false); // logged-out TaskFlow sends nothing; office shows its honest state
    }
    window.addEventListener("message", onMessage);
    // Event-driven revocation: logout() and sessionExpired() both flip the
    // app's auth store, so subscribing revokes the iframe copy immediately.
    // The 60s poll stays only as a fallback for edits outside the store.
    let unsubscribe: (() => void) | null = null;
    let lastUserId: string | null = null;
    try {
      lastUserId = useAuthStore.getState().user?.id ?? null;
      unsubscribe = useAuthStore.subscribe((state) => {
        const userId = state.user?.id ?? null;
        if (state.status !== "authenticated" || !userId) {
          pushAuth(true); // logout / session expiry: revoke the copy now
        } else if (userId !== lastUserId) {
          lastSent = null;
          pushAuth(false); // account switch: replace the copy now
        }
        lastUserId = userId;
      });
    } catch {
      unsubscribe = null; // store unregistered (unit tests): fallback only
    }
    const watcher = setInterval(() => pushAuth(false), 60000);
    return () => {
      window.removeEventListener("message", onMessage);
      if (unsubscribe) unsubscribe();
      clearInterval(watcher);
      pushAuth(true); // panel closing revokes the copy it handed out
    };
  }, [open]);

  // Read after hydration; a fresh browser never creates an iframe by default.
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OFFICE_PANEL_KEY) === "true");
    } catch {
      // Storage may be unavailable; the panel remains usable in memory.
    }
  }, []);

  function changeOpen(next: boolean) {
    setOpen(next);
    try {
      localStorage.setItem(OFFICE_PANEL_KEY, String(next));
    } catch {
      // Storage failure must never interrupt TaskFlow navigation.
    }
    if (!next) toggleRef.current?.focus();
  }

  return (
    <div className="pointer-events-none fixed right-4 top-14 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => changeOpen(!open)}
        className="pointer-events-auto rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-md"
      >
        辦公室
      </button>
      {open && (
        <section
          id={panelId}
          aria-label="像素辦公室"
          className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-xl"
          style={{
            width: large ? 720 : 480,
            height: large ? "75vh" : "60vh",
            maxWidth: "calc(100vw - 2rem)",
            maxHeight: "calc(100dvh - 7rem)",
          }}
        >
          <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm">
            <span className="mr-auto">像素辦公室</span>
            <button type="button" aria-label="放大辦公室" aria-pressed={large}
              onClick={() => setLarge(!large)} className="rounded border px-2 py-1">
              {large ? "標準尺寸" : "放大"}
            </button>
            <button type="button" aria-label="關閉辦公室" onClick={() => changeOpen(false)}
              className="rounded border px-2 py-1">收合</button>
          </header>
          <iframe ref={iframeRef} title="像素辦公室" src={OFFICE_URL}
            className="min-h-0 w-full flex-1 border-0" />
        </section>
      )}
    </div>
  );
}
