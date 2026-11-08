"use client";

import React, { useEffect, useRef, useState } from "react";

const PANEL = "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/access-management/";
const ORIGIN = new URL(PANEL).origin;

// The only message is a presentation status. Pages keeps all credentials and RPCs.
export function useTaskFlowAccessManagement(userId: string | undefined, active: boolean) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState({ userId, status: "unknown" });
  const status = state.userId === userId ? state.status : "unknown";
  useEffect(() => {
    setState({ userId, status: "unknown" });
    const receive = (event: MessageEvent) => {
      if (event.origin !== ORIGIN || event.source !== ref.current?.contentWindow || event.data?.type !== "trqn-access-status") return;
      if (["creator", "login", "denied", "error", "unknown"].includes(event.data.status)) setState({ userId, status: event.data.status });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [userId]);
  return {
    visible: status === "creator" || status === "login",
    frame: userId ? <iframe key={userId} ref={ref} src={PANEL} title="全站存取管理"
      hidden={!active} className="min-h-[560px] w-full border-0" referrerPolicy="strict-origin"
      onLoad={() => ref.current?.contentWindow?.postMessage({ type: "trqn-access-query" }, ORIGIN)} /> : null,
  };
}
