const PRODUCTION_SHELL_ORIGIN = "https://qqweasdzxc.github.io";

function allowedEntryOrigins(): Set<string> {
  const configured = String(process.env.TASKFLOW_ENTRY_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([PRODUCTION_SHELL_ORIGIN, ...configured]);
}

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (origin && allowedEntryOrigins().has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

export async function GET(request: Request) {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: responseHeaders(request.headers.get("origin")),
  });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedEntryOrigins().has(origin)) {
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const headers = responseHeaders(origin);
  headers.set("access-control-allow-methods", "GET, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(null, {
    status: 204,
    headers,
  });
}
