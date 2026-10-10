import { NextRequest, NextResponse } from "next/server";

const AIOS_TASKFLOW_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/";
const CLI_STATE = /^[a-f0-9]{32}$/;

function validCallback(raw: string): boolean {
  try {
    const url = new URL(raw);
    const port = Number(url.port);
    const host = url.hostname.toLowerCase();
    return url.protocol === "http:"
      && !url.username && !url.password
      && url.pathname === "/callback"
      && !url.search && !url.hash
      && url.port !== "" && Number.isInteger(port) && port >= 1 && port <= 65535
      && (host === "localhost" || host === "127.0.0.1");
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.replace(/\/+$/, "") !== "/login") return NextResponse.next();

  const callbacks = request.nextUrl.searchParams.getAll("cli_callback");
  const states = request.nextUrl.searchParams.getAll("cli_state");
  if (callbacks.length === 0 && states.length === 0) return NextResponse.next();

  const target = new URL(AIOS_TASKFLOW_URL);
  if (callbacks.length === 1 && states.length === 1 && validCallback(callbacks[0]) && CLI_STATE.test(states[0])) {
    const fragment = new URLSearchParams();
    fragment.set("cli_callback", callbacks[0]);
    fragment.set("cli_state", states[0]);
    target.hash = fragment.toString();
  } else {
    target.hash = "cli_error=invalid";
  }
  // The incoming callback/state are non-credential CLI correlation data.
  // Redirect before page scripts run; the destination receives them only in a fragment.
  return NextResponse.redirect(target, 303);
}

export const config = { matcher: ["/login"] };
