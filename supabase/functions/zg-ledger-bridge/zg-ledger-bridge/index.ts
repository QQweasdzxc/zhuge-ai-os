// zg-ledger-bridge - deployed source custody recovered 2026-11-04; structured scan department + authenticated actor.
// ZG-ERP「現存資料庫」專用橋接：前台 → 本函式（Google 服務帳號）→ Google Sheets。
// 架構定案：新帳（LEDGER_SPREADSHEET_ID）是唯一讀寫目標；舊帳 59 工作簿唯讀比對。
// 與 gas-vendor-bridge 的差異（必要政策，不照抄既有缺口）：
//   requireUser 之後、任何表格讀寫之前，以呼叫者 JWT 呼叫 is_app_access_approved()
//   —— false / null / 錯誤 / 逾時一律 fail closed（403），任何路徑不得因錯誤處理放行。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

type JsonObject = Record<string, unknown>;

const LEGACY_SPREADSHEET_ID = "1-NPASgtZTcvf_JvmPfjfNU6I7yxD7JPveKGzZrKH6BI"; // 舊帳（唯讀比對）
const LEDGER_SPREADSHEET_ID_SECRET = "ZG_LEDGER_SPREADSHEET_ID"; // 新帳 ID 由 secret 提供（建表後設定）
const SERVICE_ACCOUNT_EMAIL_SECRET = "GOOGLE_SERVICE_ACCOUNT_EMAIL";
const SERVICE_ACCOUNT_PRIVATE_KEY_SECRET = "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_REQUEST_TIMEOUT_MS = 20000;
const APPROVAL_CHECK_TIMEOUT_MS = 10000;
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";

// 新帳分頁（唯寫目標；釐清標示記錄每筆舊帳的核對進度與人工結論，不改寫舊帳原文）；舊帳僅整合-主檔/待確認/整合-流轉對應可比對讀取
const LEDGER_TABS = ["資產", "盤點場次", "盤點紀錄", "流轉紀錄", "進貨批次", "位置表", "釐清標示"] as const;
const LEGACY_READABLE_TABS = ["整合-主檔", "整合-待確認", "整合-流轉對應"] as const;

class HttpError extends Error {
  status: number; code: string; details: JsonObject;
  constructor(message: string, status: number, code: string, details: JsonObject = {}) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
const asText = (value: unknown, fallback = "") => {
  const text = value == null ? fallback : String(value);
  return text.trim();
};

function allowedOrigin(request: Request) {
  const origin = asText(request.headers.get("origin"));
  if (origin && origin !== DEFAULT_ORIGIN) {
    throw new HttpError("Origin is not allowed.", 403, "ORIGIN_NOT_ALLOWED");
  }
  return origin;
}

async function callerClient(request: Request, supabaseUrl: string, anonKey: string) {
  const authorization = asText(request.headers.get("authorization"));
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
  }
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireUser(caller: ReturnType<typeof createClient>) {
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
  return user;
}

// 必要政策：伺服器端確認「已放行」。false/null/錯誤/逾時一律拒絕（fail closed）。
async function requireApproved(caller: ReturnType<typeof createClient>) {
  let result: { data: unknown; error: unknown };
  try {
    const pending = caller.rpc("is_app_access_approved");
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("approval check timeout")), APPROVAL_CHECK_TIMEOUT_MS));
    result = await Promise.race([pending, timeout]) as typeof result;
  } catch (e) {
    throw new HttpError("Access approval check failed.", 403, "ACCESS_CHECK_FAILED",
      { reason: asText((e as Error)?.message).slice(0, 200) });
  }
  if (result.error) {
    throw new HttpError("Access approval check failed.", 403, "ACCESS_CHECK_FAILED",
      { reason: asText((result.error as { message?: string })?.message).slice(0, 200) });
  }
  if (result.data !== true) { // false 與 null（無申請紀錄）都不得放行
    throw new HttpError("Access is not approved for this account.", 403, "ACCESS_NOT_APPROVED");
  }
}

/* --- Google 服務帳號（比照 gas-vendor-bridge：SA 於 Deno secrets，簽 JWT 換 access token） --- */
function pemToArrayBuffer(pem: string): ArrayBuffer { /* 同 gas-vendor-bridge */
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
async function googleAccessToken(email: string, privateKey: string): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = btoa(JSON.stringify({
    iss: email, scope: GOOGLE_SCOPE, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new HttpError("Google token exchange failed.", 502, "GOOGLE_TOKEN_FAILED");
  }
  return body.access_token as string;
}

/* --- Sheets 讀寫（寫入後讀回驗證） --- */
function resolveTarget(tab: string): { spreadsheetId: string; readonly: boolean } {
  if ((LEGACY_READABLE_TABS as readonly string[]).includes(tab)) {
    return { spreadsheetId: LEGACY_SPREADSHEET_ID, readonly: true };
  }
  if ((LEDGER_TABS as readonly string[]).includes(tab)) {
    const id = asText(Deno.env.get(LEDGER_SPREADSHEET_ID_SECRET));
    if (!id) throw new HttpError("Ledger spreadsheet is not configured.", 503, "LEDGER_CONFIG_MISSING");
    return { spreadsheetId: id, readonly: false };
  }
  throw new HttpError("Unknown tab.", 400, "TAB_UNKNOWN");
}

async function sheetsRead(token: string, spreadsheetId: string, tab: string) {
  const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1:Z10000?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS) });
  const body = await res.json();
  if (!res.ok) throw new HttpError("Sheet read failed.", 502, "SHEET_READ_FAILED");
  const values = (body.values || []) as unknown[][];
  return { header: values[0] || [], rows: values.slice(1) };
}

async function sheetsUpdate(token: string, spreadsheetId: string, range: string, row: unknown[]) {
  const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }), signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
  });
  const body = await res.json();
  if (!res.ok) throw new HttpError("Sheet update failed.", 502, "SHEET_UPDATE_FAILED");
  return body;
}

async function sheetsAppend(token: string, spreadsheetId: string, tab: string, row: unknown[]) {
  const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }), signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
  });
  const body = await res.json();
  if (!res.ok) throw new HttpError("Sheet append failed.", 502, "SHEET_APPEND_FAILED");
  return body; // 讀回驗證由呼叫端以 updatedRange 再 read 確認
}

/* --- 動作路由 --- */
Deno.serve(async (request) => {
  let origin = "";
  try {
    origin = allowedOrigin(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const supabaseUrl = asText(Deno.env.get("SUPABASE_URL"));
    const anonKey = asText(Deno.env.get("SUPABASE_ANON_KEY"));
    const caller = await callerClient(request, supabaseUrl, anonKey);
    const user = await requireUser(caller);
    const actor = user.email || user.id;
    await requireApproved(caller); // 必要政策：任何表格讀寫之前

    const email = asText(Deno.env.get(SERVICE_ACCOUNT_EMAIL_SECRET));
    const privateKey = asText(Deno.env.get(SERVICE_ACCOUNT_PRIVATE_KEY_SECRET));
    if (!email || !privateKey) {
      throw new HttpError("Google service account credential is not configured.", 503, "GOOGLE_SERVICE_ACCOUNT_CONFIG_MISSING");
    }
    const token = await googleAccessToken(email, privateKey);

    const url = new URL(request.url);
    const action = asText(url.searchParams.get("action") || "read");
    const tab = asText(url.searchParams.get("tab"));
    const target = resolveTarget(tab);

    if (action === "read") {
      return json({ ...(await sheetsRead(token, target.spreadsheetId, tab)), actor }, 200, origin);
    }
    if (target.readonly) {
      throw new HttpError("Legacy workbook is comparison-only and read-only.", 400, "TARGET_READ_ONLY");
    }
    if (action === "append") {
      const { row } = await request.json() as { row: unknown[] };
      if (!Array.isArray(row)) throw new HttpError("row 必填。", 400, "BAD_REQUEST");
      const expected = ({ "資產": {21:"使用部門",22:"舊帳記錄鍵",23:"舊帳出處",24:"舊帳快照",25:"資料補入時間"}, "盤點場次": {12:"使用部門"}, "盤點紀錄": {8:"使用部門",9:"本次專案",10:"經手人"} } as Record<string, Record<string,string>>)[tab];
      if (expected) {
        const schema = await sheetsRead(token, target.spreadsheetId, tab);
        if (!Object.entries(expected).every(([i,h]) => schema.header[Number(i)] === h)) throw new HttpError("Ledger schema is not ready.", 503, "SCHEMA_NOT_READY");
      }
      const actorColumn = ({ "資產": 19, "盤點場次": 8, "盤點紀錄": 10, "流轉紀錄": 7, "釐清標示": 8 } as Record<string, number>)[tab];
      if (actorColumn != null) { while (row.length <= actorColumn) row.push(""); row[actorColumn] = actor; }
      const appended = await sheetsAppend(token, target.spreadsheetId, tab, row);
      // 寫入後讀回驗證：以前端可見的失敗為準，不假裝成功
      const range = asText(appended?.updates?.updatedRange);
      if (!range) throw new HttpError("Write verification failed.", 502, "WRITE_VERIFY_FAILED");
      return json({ ok: true, updatedRange: range, actor }, 200, origin);
    }
    if (action === "update") {
      const { range, row } = await request.json() as { range: string; row: unknown[] };
      const rng = asText(range);
      if (!rng || !Array.isArray(row)) throw new HttpError("range 與 row 必填。", 400, "BAD_REQUEST");
      // range 必須屬於本次 tab，防止跨分頁寫入
      if (!rng.startsWith(tab + "!")) throw new HttpError("Range 與分頁不符。", 400, "RANGE_TAB_MISMATCH");
      // Preserve original authorship, including historical blanks. Updates must not invent a creator.
      const actorColumn = ({ "資產": 19, "盤點場次": 8, "盤點紀錄": 10, "流轉紀錄": 7, "釐清標示": 8 } as Record<string, number>)[tab];
      if (actorColumn != null) {
        const rowMatch = new RegExp("^" + tab + "!A([2-9][0-9]*|1[0-9]+):[A-Z]+([0-9]+)$").exec(rng);
        if (!rowMatch || rowMatch[1] !== rowMatch[2]) throw new HttpError("Single data row required.", 400, "BAD_REQUEST");
        const prior = await sheetsRead(token, target.spreadsheetId, tab);
        const original = prior.rows[Number(rowMatch[1]) - 2];
        if (!original) throw new HttpError("Original row not found.", 400, "BAD_REQUEST");
        while (row.length <= actorColumn) row.push("");
        row[actorColumn] = original[actorColumn] || "";
      }
      const updated = await sheetsUpdate(token, target.spreadsheetId, rng, row);
      const updatedRange = asText(updated?.updatedRange);
      if (!updatedRange) throw new HttpError("Write verification failed.", 502, "WRITE_VERIFY_FAILED");
      return json({ ok: true, updatedRange }, 200, origin);
    }
    throw new HttpError("Unknown action.", 400, "ACTION_UNKNOWN");
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError("Unexpected error.", 500, "INTERNAL");
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status, origin);
  }
});

function corsHeaders(origin: string) {
  return {
    "access-control-allow-origin": origin || DEFAULT_ORIGIN,
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
}
function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...corsHeaders(origin) }
  });
}
