"use client";

import { useEffect, useId, useRef, useState } from "react";

export const OFFICE_PANEL_KEY = "zhuge.tf.officePanel";
export const OFFICE_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/";

export function TaskFlowOfficePanel() {
  const [open, setOpen] = useState(false);
  const [large, setLarge] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

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
          <iframe title="像素辦公室" src={OFFICE_URL}
            className="min-h-0 w-full flex-1 border-0" />
        </section>
      )}
    </div>
  );
}
