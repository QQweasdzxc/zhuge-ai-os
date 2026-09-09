import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
type JsonObject = Record<string, unknown>;
const SPREADSHEET_ID = "1RO6idAURJi40wnzH7LBeTzkJpSGQ2yZbfSJ7hMde1jY";
const SHEET_NAME = "廠商名冊-CS集團(CS、CK、UU)";
const RANGE = "A:U";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_REQUEST_TIMEOUT_MS = 20000;
const MAX_ROWS = 1000;
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";
const SERVICE_ACCOUNT_EMAIL_SECRET = "GOOGLE_SERVICE_ACCOUNT_EMAIL";
const SERVICE_ACCOUNT_PRIVATE_KEY_SECRET = "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY";
const VENDOR_KEYS = [
  "orderDate", "company", "purchaseNo", "vendorName", "taxId", "contactMailLegacy",
  "paymentTerms", "products", "integritySignedAt", "integrityOriginal", "csrSelfAssessment",
  "csrOriginal", "phone", "contactName", "mobile", "email", "project", "contracted",
  "insured", "vendorId", "businessCategory"
] as const;
const VENDOR_ID_INDEX = VENDOR_KEYS.indexOf("vendorId");
const VENDOR_KEY_INDEX = new Map<string, number>(VENDOR_KEYS.map((key, index) => [key, index]));
const MUTABLE_VENDOR_KEYS = VENDOR_KEYS.filter(key => key !== "vendorId");
const BUSINESS_CATEGORIES = ["採購", "總務"] as const;
class HttpError extends Error {
  status: number;
  code: string;
  details: JsonObject;
  constructor(message: string, status: number, code: string, details: JsonObject = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const asText = (value: unknown, fallback = "") => {
  const text = value == null ? fallback : String(value);
  return text.trim();
};
const asObject = (value: unknown): JsonObject => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {}
);
const safeProviderDetails = (value: unknown): JsonObject => {
  const detail = asObject(value);
  const providerCode = asText(detail.error || detail.code).slice(0, 120);
  const providerMessage = asText(detail.error_description || detail.message || detail.error).slice(0, 500);
  return {
    ...(providerCode ? { provider_code: providerCode } : {}),
    ...(providerMessage ? { provider_message: providerMessage } : {})
  };
};
function allowedOrigin(request: Request) {
  const origin = asText(request.headers.get("origin"));
  if (origin && origin !== DEFAULT_ORIGIN) {
    throw new HttpError("Origin is not allowed.", 403, "ORIGIN_NOT_ALLOWED");
  }
  return origin;
}
function responseHeaders(origin = "") {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, apikey, content-type");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("vary", "Origin");
  }
  return headers;
}
function json(body: JsonObject, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}
function pemToArrayBuffer(value: string) {
  const normalized = value.replace(/\r/g, "").replace(/\\n/g, "\n").trim();
  const body = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new HttpError("Google service account private key is invalid.", 503, "GOOGLE_SERVICE_ACCOUNT_KEY_INVALID");
  }
  const binary = atob(body);
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
}
function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function createGoogleAssertion(email: string, privateKey: string) {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(privateKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    throw new HttpError("Google service account private key could not be loaded.", 503, "GOOGLE_SERVICE_ACCOUNT_KEY_INVALID");
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: email,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600
  }));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}
async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new HttpError(`${label} timed out.`, 504, "GOOGLE_REQUEST_TIMEOUT", { timeout_ms: GOOGLE_REQUEST_TIMEOUT_MS });
    }
    throw new HttpError(`${label} network request failed.`, 502, "GOOGLE_NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
async function responseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return asObject(JSON.parse(text));
  } catch {
    return { raw_message: text.slice(0, 500) };
  }
}
async function googleAccessToken(email: string, privateKey: string) {
  const assertion = await createGoogleAssertion(email, privateKey);
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  }, "Google authentication");
  const body = await responseBody(response);
  if (!response.ok || !asText(body.access_token)) {
    throw new HttpError("Google authentication failed.", 502, "GOOGLE_AUTH_FAILED", {
      provider_status: response.status,
      ...safeProviderDetails(body)
    });
  }
  return asText(body.access_token);
}
function quoteSheetName(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
function rowToVendor(row: unknown, rowNumber: number) {
  const cells = Array.isArray(row) ? row : [];
  const vendor: JsonObject = { rowNumber };
  VENDOR_KEYS.forEach((key, index) => {
    vendor[key] = asText(cells[index]);
  });
  return vendor;
}

function normalizeBusinessCategory(value: unknown, required = false) {
  const values = (Array.isArray(value) ? value : [value])
    .flatMap(item => asText(item).split(/[、,，/／|;；\s]+/))
    .map(item => item.trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) {
    if (required) throw new HttpError("Business category is required.", 400, "VENDOR_CATEGORY_REQUIRED", {
      allowed_categories: [...BUSINESS_CATEGORIES]
    });
    return "";
  }
  const invalid = unique.filter(item => !BUSINESS_CATEGORIES.includes(item as typeof BUSINESS_CATEGORIES[number]));
  if (invalid.length) {
    throw new HttpError("Business category must be 採購 or 總務.", 400, "VENDOR_CATEGORY_INVALID", {
      allowed_categories: [...BUSINESS_CATEGORIES],
      invalid_categories: invalid
    });
  }
  return BUSINESS_CATEGORIES.filter(item => unique.includes(item)).join("、");
}
function normalizeVendorValue(key: string, value: unknown) {
  return key === "businessCategory" ? normalizeBusinessCategory(value) : asText(value);
}
async function readSheetValues(accessToken: string, requestedRange = RANGE) {
  const range = encodeURIComponent(`${quoteSheetName(SHEET_NAME)}!${requestedRange}`);
  const url = `${GOOGLE_SHEETS_API}/${SPREADSHEET_ID}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` }
  }, "Google Sheet read");
  const body = await responseBody(response);
  if (!response.ok) {
    throw new HttpError("Google Sheet read failed.", 502, "GOOGLE_SHEETS_READ_FAILED", {
      provider_status: response.status,
      ...safeProviderDetails(body)
    });
  }
  return Array.isArray(body.values) ? body.values : [];
}
function rowsFromValues(values: unknown[]) {
  return values.slice(1, MAX_ROWS + 1)
    .map((row, index) => rowToVendor(row, index + 2))
    .filter(row => Boolean(row.vendorName || row.vendorId || row.purchaseNo));
}
async function readVendors(accessToken: string) {
  return rowsFromValues(await readSheetValues(accessToken, RANGE));
}
function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}
async function writeVendorFields(accessToken: string, rowNumber: number, patch: JsonObject, updateKeys: string[]) {
  const url = `${GOOGLE_SHEETS_API}/${SPREADSHEET_ID}/values:batchUpdate`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updateKeys.map(key => {
        const index = VENDOR_KEY_INDEX.get(key);
        return {
          range: `${quoteSheetName(SHEET_NAME)}!${columnName(index ?? 0)}${rowNumber}:${columnName(index ?? 0)}${rowNumber}`,
          majorDimension: "ROWS",
          values: [[normalizeVendorValue(key, patch[key])]]
        };
      })
    })
  }, "Google Sheet write");
  const body = await responseBody(response);
  if (!response.ok) {
    throw new HttpError("Google Sheet write failed.", 502, "GOOGLE_SHEETS_WRITE_FAILED", {
      provider_status: response.status,
      ...safeProviderDetails(body)
    });
  }
  return { status: response.status };
}

async function appendVendorRow(accessToken: string, row: string[]) {
  const range = encodeURIComponent(`${quoteSheetName(SHEET_NAME)}!${RANGE}`);
  const url = `${GOOGLE_SHEETS_API}/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ majorDimension: "ROWS", values: [row] })
  }, "Google Sheet append");
  const body = await responseBody(response);
  if (!response.ok) {
    throw new HttpError("Google Sheet append failed.", 502, "GOOGLE_SHEETS_APPEND_FAILED", {
      provider_status: response.status,
      ...safeProviderDetails(body)
    });
  }
  return { status: response.status };
}

function nextVendorId(values: unknown[]) {
  let max = 0;
  values.slice(1, MAX_ROWS + 1).forEach(row => {
    if (!Array.isArray(row)) return;
    const match = /^GAS-V(\d+)$/.exec(asText(row[VENDOR_ID_INDEX]));
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `GAS-V${String(max + 1).padStart(4, "0")}`;
}

async function updateVendor(accessToken: string, vendorId: string, patch: JsonObject) {
  if (Object.prototype.hasOwnProperty.call(patch, "vendorId")) {
    throw new HttpError("Vendor ID cannot be modified.", 400, "VENDOR_ID_IMMUTABLE");
  }
  const invalidKeys = Object.keys(patch).filter(key => !VENDOR_KEY_INDEX.has(key));
  if (invalidKeys.length) {
    throw new HttpError("Vendor update contains unsupported fields.", 400, "VENDOR_UPDATE_FIELDS_INVALID", {
      fields: invalidKeys.slice(0, 20)
    });
  }
  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, "businessCategory")) {
    normalizedPatch.businessCategory = normalizeBusinessCategory(normalizedPatch.businessCategory, true);
  }
  const updateKeys = Object.keys(normalizedPatch).filter(key => MUTABLE_VENDOR_KEYS.includes(key as typeof MUTABLE_VENDOR_KEYS[number]));
  if (!updateKeys.length) {
    throw new HttpError("Vendor update requires at least one mutable field.", 400, "VENDOR_UPDATE_EMPTY");
  }
  const beforeValues = await readSheetValues(accessToken, RANGE);
  const dataRows = beforeValues.slice(1, MAX_ROWS + 1);
  const matchIndex = dataRows.findIndex(row => Array.isArray(row) && asText(row[VENDOR_ID_INDEX]) === vendorId);
  if (matchIndex < 0) {
    throw new HttpError("Vendor ID was not found in Google Sheet.", 404, "VENDOR_NOT_FOUND", { vendor_id: vendorId });
  }
  const rowNumber = matchIndex + 2;
  const write = await writeVendorFields(accessToken, rowNumber, normalizedPatch, updateKeys);
  const afterValues = await readSheetValues(accessToken, RANGE);
  const afterRows = rowsFromValues(afterValues);
  const afterDataRows = afterValues.slice(1, MAX_ROWS + 1);
  const afterMatchIndex = afterDataRows.findIndex(row => Array.isArray(row) && asText(row[VENDOR_ID_INDEX]) === vendorId);
  if (afterMatchIndex < 0) {
    throw new HttpError("Vendor write read-back could not find the original Vendor ID.", 502, "VENDOR_WRITE_READBACK_MISSING", { vendor_id: vendorId, row_number: rowNumber });
  }
  const readBackRowNumber = afterMatchIndex + 2;
  const readBack = rowToVendor(afterDataRows[afterMatchIndex], readBackRowNumber);
  const mismatchedFields = updateKeys.filter(key => asText(readBack[key]) !== normalizeVendorValue(key, normalizedPatch[key]));
  if (asText(readBack.vendorId) !== vendorId || mismatchedFields.length) {
    throw new HttpError("Vendor write read-back does not match the requested update.", 502, "VENDOR_WRITE_READBACK_MISMATCH", {
      vendor_id: vendorId,
      row_number: readBackRowNumber,
      mismatched_fields: mismatchedFields
    });
  }
  return {
    vendorId,
    rowNumber: readBackRowNumber,
    writeStatus: write.status,
    vendor: readBack,
    vendorCount: afterRows.length,
    firstVendorId: asText(afterRows[0]?.vendorId) || null,
    lastVendorId: asText(afterRows[afterRows.length - 1]?.vendorId) || null
  };
}

async function createVendor(accessToken: string, input: JsonObject) {
  if (Object.prototype.hasOwnProperty.call(input, "vendorId")) {
    throw new HttpError("Vendor ID is assigned by the Google Sheet bridge.", 400, "VENDOR_ID_SERVER_ASSIGNED");
  }
  const invalidKeys = Object.keys(input).filter(key => !VENDOR_KEY_INDEX.has(key));
  if (invalidKeys.length) {
    throw new HttpError("Vendor create contains unsupported fields.", 400, "VENDOR_CREATE_FIELDS_INVALID", {
      fields: invalidKeys.slice(0, 20)
    });
  }
  const vendorName = asText(input.vendorName);
  if (!vendorName) throw new HttpError("Vendor name is required.", 400, "VENDOR_NAME_REQUIRED");
  const businessCategory = normalizeBusinessCategory(input.businessCategory, true);
  const beforeValues = await readSheetValues(accessToken, RANGE);
  const beforeRows = rowsFromValues(beforeValues);
  const vendorId = nextVendorId(beforeValues);
  const row = VENDOR_KEYS.map(key => (
    key === "vendorId" ? vendorId : key === "businessCategory" ? businessCategory : asText(input[key])
  ));
  const append = await appendVendorRow(accessToken, row);
  const afterValues = await readSheetValues(accessToken, RANGE);
  const afterRows = rowsFromValues(afterValues);
  const afterDataRows = afterValues.slice(1, MAX_ROWS + 1);
  const matchIndex = afterDataRows.findIndex(current => Array.isArray(current) && asText(current[VENDOR_ID_INDEX]) === vendorId);
  if (matchIndex < 0) {
    throw new HttpError("Vendor create read-back could not find the assigned Vendor ID.", 502, "VENDOR_CREATE_READBACK_MISSING", { vendor_id: vendorId });
  }
  if (afterRows.length !== beforeRows.length + 1) {
    throw new HttpError("Vendor create read-back count does not match the append.", 502, "VENDOR_CREATE_READBACK_COUNT_MISMATCH", {
      before_count: beforeRows.length,
      after_count: afterRows.length,
      vendor_id: vendorId
    });
  }
  const readBack = rowToVendor(afterDataRows[matchIndex], matchIndex + 2);
  const mismatchedFields = VENDOR_KEYS.filter((key, index) => asText(readBack[key]) !== asText(row[index]));
  if (mismatchedFields.length) {
    throw new HttpError("Vendor create read-back does not match the appended row.", 502, "VENDOR_CREATE_READBACK_MISMATCH", {
      vendor_id: vendorId,
      row_number: matchIndex + 2,
      mismatched_fields: mismatchedFields
    });
  }
  return {
    vendorId,
    rowNumber: matchIndex + 2,
    writeStatus: append.status,
    vendor: readBack,
    vendorCount: afterRows.length,
    firstVendorId: asText(afterRows[0]?.vendorId) || null,
    lastVendorId: asText(afterRows[afterRows.length - 1]?.vendorId) || null
  };
}

async function requireUser(request: Request, supabaseUrl: string, anonKey: string) {
  const authorization = asText(request.headers.get("authorization"));
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
  }
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
  return user;
}
Deno.serve(async request => {
  let origin = "";
  try {
    origin = allowedOrigin(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
    if (request.method !== "POST") throw new HttpError("POST is required.", 405, "METHOD_NOT_ALLOWED");
    const supabaseUrl = asText(Deno.env.get("SUPABASE_URL"));
    const anonKey = asText(Deno.env.get("SUPABASE_ANON_KEY"));
    if (!supabaseUrl || !anonKey) throw new HttpError("Supabase server configuration is missing.", 500, "SERVER_CONFIG_MISSING");
    await requireUser(request, supabaseUrl, anonKey);
    const email = asText(Deno.env.get(SERVICE_ACCOUNT_EMAIL_SECRET));
    const privateKey = asText(Deno.env.get(SERVICE_ACCOUNT_PRIVATE_KEY_SECRET));
    const missing = [
      ...(email ? [] : [SERVICE_ACCOUNT_EMAIL_SECRET]),
      ...(privateKey ? [] : [SERVICE_ACCOUNT_PRIVATE_KEY_SECRET])
    ];
    if (missing.length) {
      throw new HttpError(`Google service account credential is not configured: ${missing.join(", ")}.`, 503, "GOOGLE_SERVICE_ACCOUNT_CONFIG_MISSING", { missing_secrets: missing });
    }
    const accessToken = await googleAccessToken(email, privateKey);
    const requestBody = asObject(await request.json().catch(() => ({})));
    const action = asText(requestBody.action, "read").toLowerCase();
    if (action !== "read" && action !== "update" && action !== "create") {
      throw new HttpError("Unsupported bridge action.", 400, "ACTION_NOT_SUPPORTED");
    }
    if (action === "update") {
      const vendorId = asText(requestBody.vendorId);
      if (!vendorId) throw new HttpError("Vendor ID is required.", 400, "VENDOR_ID_REQUIRED");
      const result = await updateVendor(accessToken, vendorId, asObject(requestBody.patch));
      return json({ ok: true, action, source: "google-sheets", spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME, range: RANGE, ...result }, 200, origin);
    }
    if (action === "create") {
      const result = await createVendor(accessToken, asObject(requestBody.vendor));
      return json({ ok: true, action, source: "google-sheets", spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME, range: RANGE, ...result }, 200, origin);
    }
    const rows = await readVendors(accessToken);
    return json({
      ok: true,
      action,
      source: "google-sheets",
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      range: RANGE,
      vendorCount: rows.length,
      firstVendorId: asText(rows[0]?.vendorId) || null,
      lastVendorId: asText(rows[rows.length - 1]?.vendorId) || null,
      rows
    }, 200, origin);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ code: error.code, message: error.message, ...error.details }, error.status, origin);
    }
    return json({ code: "GAS_VENDOR_BRIDGE_FAILED", message: "GAS Vendor bridge failed." }, 500, origin);
  }
});
