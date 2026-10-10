// TaskFlow-owned insertion used by apply-zhuge-identity.py.
// The frozen Multica proxy remains the routing authority; this only adds the
// Zhuge CLI login handoff before native locale and runtime routing.
const ZHUGE_TASKFLOW_CLI_AI_OS_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/";
const ZHUGE_TASKFLOW_CLI_STATE = /^[a-f0-9]{32}$/;

function zhugeTaskFlowValidCliCallback(raw: string): boolean {
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

function zhugeTaskFlowCliLogin(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname.replace(/\/+$/, "") !== "/login") return null;

  const callbacks = request.nextUrl.searchParams.getAll("cli_callback");
  const states = request.nextUrl.searchParams.getAll("cli_state");
  if (callbacks.length === 0 && states.length === 0) return null;

  const callback = callbacks.length === 1 ? callbacks[0] ?? "" : "";
  const state = states.length === 1 ? states[0] ?? "" : "";
  const target = new URL(ZHUGE_TASKFLOW_CLI_AI_OS_URL);
  if (
    callbacks.length === 1
    && states.length === 1
    && zhugeTaskFlowValidCliCallback(callback)
    && ZHUGE_TASKFLOW_CLI_STATE.test(state)
  ) {
    const fragment = new URLSearchParams();
    fragment.set("cli_callback", callback);
    fragment.set("cli_state", state);
    target.hash = fragment.toString();
  } else {
    target.hash = "cli_error=invalid";
  }

  // Callback/state are non-credential CLI correlation values. The redirect
  // moves them into a fragment before the native Multica proxy runs.
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
