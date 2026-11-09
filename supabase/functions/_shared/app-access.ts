/* User-JWT boundary only. Never substitute a service/actor credential. */
export class AppAccessError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code; }
}
export async function requireAppAccess(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new AppAccessError("Authentication required", 401, "AUTH_REQUIRED");
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const apikey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !apikey) throw new AppAccessError("Access check unavailable", 503, "ACCESS_CONFIG_MISSING");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // The RPC authenticates auth.uid() from the caller JWT. false/null/non-boolean,
    // HTTP errors, malformed JSON, network errors and timeouts all fail closed.
    const response = await fetch(`${url}/rest/v1/rpc/is_app_access_approved`, {
      method: "POST", headers: { authorization, apikey, "content-type": "application/json" },
      body: "{}", signal: controller.signal
    });
    if (!response.ok || await response.json() !== true) throw new Error("Access denied");
  } catch {
    throw new AppAccessError("App access denied or unavailable", 403, "APP_ACCESS_REQUIRED");
  } finally { clearTimeout(timer); }
}
