import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

/*
 * TASK-043 Phase 1.3 — Hosted Edge compatibility proof only.
 *
 * This function is deliberately not an Investment adapter. It does not read
 * or write Zhuge product data, does not create a broker snapshot, and does
 * not expose any trading operation. It exists only to prove whether the
 * pinned Fubon Neo SDK can execute the server-side read flow in Hosted Edge.
 *
 * Deployment must keep Supabase JWT verification enabled. The function also
 * checks the existing Creator/App Access authority before reading secrets.
 */

type JsonObject = Record<string, unknown>;

const CONTRACT = "fubon-edge-compatibility-v1";
const SDK_VERSION = "2.3.0";
const SDK_SPECIFIER = "npm:fubon-neo@2.3.0";
const ALLOWED_ORIGIN = "https://qqweasdzxc.github.io";
const QUOTE_SYMBOL = "2330";
const CERTIFICATE_PATH_PREFIX = "/tmp/fubon-compatibility-proof-";
const CERTIFICATE_PATH_SUFFIX = ".pfx";
const SECRET_NAMES = [
  "FUBON_API_PERSONAL_ID",
  "FUBON_API_KEY",
  "FUBON_CERT_PASSWORD",
  "FUBON_CERT_FILE_BASE64"
] as const;

type SecretName = typeof SECRET_NAMES[number];
type Credentials = {
  personalId: string;
  apiKey: string;
  certificatePassword: string;
  certificateBase64: string;
};

type ProviderResponse = {
  isSuccess?: unknown;
  data?: unknown;
};

type FubonAccount = {
  accountType?: unknown;
  branchNo?: unknown;
  account?: unknown;
};

type FubonSdk = {
  apikeyLogin: (
    personalId: string,
    apiKey: string,
    certificatePath: string,
    certificatePassword?: string
  ) => ProviderResponse;
  accounting: {
    inventories: (account: FubonAccount) => ProviderResponse;
  };
  initRealtime: () => void;
  marketdata?: {
    restClient?: {
      stock?: {
        intraday?: {
          quote?: (input: { symbol: string }) => Promise<unknown>;
        };
      };
    };
  };
  shutdown?: () => void;
};

type FubonSdkConstructor = new () => FubonSdk;

class ProofError extends Error {
  readonly status: number;
  readonly code: string;
  readonly stage: string;
  readonly safeDetails: JsonObject;

  constructor(
    status: number,
    code: string,
    stage: string,
    safeDetails: JsonObject = {}
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.stage = stage;
    this.safeDetails = safeDetails;
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
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
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin)
  });
}

function requestOrigin(request: Request) {
  const origin = String(request.headers.get("origin") || "").trim();
  if (origin && origin !== ALLOWED_ORIGIN) {
    throw new ProofError(403, "ORIGIN_NOT_ALLOWED", "request");
  }
  return origin;
}

function requireBearer(request: Request) {
  const authorization = String(request.headers.get("authorization") || "").trim();
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new ProofError(401, "AUTH_REQUIRED", "authorization");
  }
  return authorization;
}

async function rejectRequestBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) return;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ProofError(400, "REQUEST_BODY_NOT_ALLOWED", "request");
  }
  if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0) {
    return;
  }
  throw new ProofError(400, "REQUEST_BODY_NOT_ALLOWED", "request");
}

function requiredRuntimeConfig() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const anonKey = String(Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
  if (!url || !anonKey) {
    throw new ProofError(503, "AUTH_RUNTIME_NOT_CONFIGURED", "authorization");
  }
  return { url, anonKey };
}

async function requireAuthorizedCreator(request: Request) {
  const authorization = requireBearer(request);
  const config = requiredRuntimeConfig();
  const client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: { Authorization: authorization }
    }
  });

  const userResult = await client.auth.getUser();
  if (userResult.error || !userResult.data?.user?.id) {
    throw new ProofError(401, "AUTH_INVALID", "authorization");
  }

  const creatorResult = await client.rpc("resolve_creator_capability", {});
  if (creatorResult.error) {
    throw new ProofError(503, "CREATOR_AUTHORITY_UNAVAILABLE", "authorization");
  }
  const creatorRow = Array.isArray(creatorResult.data)
    ? creatorResult.data[0]
    : creatorResult.data;
  if (asObject(creatorRow).is_creator !== true) {
    throw new ProofError(403, "CREATOR_CAPABILITY_REQUIRED", "authorization");
  }

  const accessResult = await client.rpc("is_app_access_approved", {});
  if (accessResult.error) {
    throw new ProofError(503, "APP_ACCESS_AUTHORITY_UNAVAILABLE", "authorization");
  }
  if (accessResult.data !== true) {
    throw new ProofError(403, "APP_ACCESS_APPROVAL_REQUIRED", "authorization");
  }
}

function readCredentials(): Credentials {
  const values = new Map<SecretName, string>();
  const missing: SecretName[] = [];

  for (const name of SECRET_NAMES) {
    const value = String(Deno.env.get(name) ?? "");
    values.set(name, value);
    if (!value.trim()) missing.push(name);
  }

  if (missing.length) {
    throw new ProofError(503, "SECRET_MISSING", "secrets", {
      missing_secret_names: missing
    });
  }

  return {
    personalId: values.get("FUBON_API_PERSONAL_ID")!.trim(),
    apiKey: values.get("FUBON_API_KEY")!.trim(),
    certificatePassword: values.get("FUBON_CERT_PASSWORD")!,
    certificateBase64: values.get("FUBON_CERT_FILE_BASE64")!
  };
}

function decodeCertificate(value: string) {
  const source = value.trim();
  if (!source || /^data:/i.test(source)) {
    throw new ProofError(503, "CERTIFICATE_ENCODING_INVALID", "certificate");
  }

  const compact = source.replace(/\s+/g, "");
  if (
    compact.length % 4 === 1
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    throw new ProofError(503, "CERTIFICATE_ENCODING_INVALID", "certificate");
  }

  try {
    const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (!bytes.length) {
      throw new Error("empty certificate");
    }
    return bytes;
  } catch {
    throw new ProofError(503, "CERTIFICATE_ENCODING_INVALID", "certificate");
  }
}

async function writeEphemeralCertificate(bytes: Uint8Array) {
  const path = `${CERTIFICATE_PATH_PREFIX}${crypto.randomUUID()}${CERTIFICATE_PATH_SUFFIX}`;
  try {
    await Deno.writeFile(path, bytes, { createNew: true });
    return path;
  } catch {
    throw new ProofError(503, "CERTIFICATE_TEMP_WRITE_FAILED", "certificate");
  }
}

async function removeEphemeralCertificate(path: string) {
  try {
    await Deno.remove(path);
  } catch {
    // The temporary volume is invocation-local. Cleanup is best-effort and
    // never emits the path or any credential material.
  }
}

async function loadFubonSdk(): Promise<FubonSdkConstructor> {
  try {
    const loaded = await import(SDK_SPECIFIER) as Record<string, unknown>;
    const defaultExport = asObject(loaded.default);
    const candidate = loaded.FubonSDK ?? defaultExport.FubonSDK ?? loaded.default;
    if (typeof candidate !== "function") throw new Error("FubonSDK export missing");
    return candidate as FubonSdkConstructor;
  } catch {
    // Native addon / FFI failures are intentionally surfaced only as a
    // sanitized compatibility result. Raw module errors may disclose paths.
    throw new ProofError(503, "SDK_LOAD_UNAVAILABLE", "sdk_load");
  }
}

function providerData(response: unknown, stage: string) {
  const payload = asObject(response);
  if (payload.isSuccess !== true || !("data" in payload)) {
    throw new ProofError(502, `FUBON_${stage.toUpperCase()}_FAILED`, stage);
  }
  return payload.data;
}

function requireAccounts(value: unknown): FubonAccount[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProofError(502, "FUBON_LOGIN_RETURNED_NO_ACCOUNTS", "login");
  }
  return value as FubonAccount[];
}

function sanitizedAccountMetadata(accounts: FubonAccount[]) {
  return {
    account_count: accounts.length,
    account_types_present: accounts.every(account => Boolean(String(account.accountType ?? "").trim()))
  };
}

async function runProof() {
  const FubonSDK = await loadFubonSdk();
  const credentials = readCredentials();
  const certificateBytes = decodeCertificate(credentials.certificateBase64);
  const certificatePath = await writeEphemeralCertificate(certificateBytes);
  let sdk: FubonSdk | null = null;

  try {
    sdk = new FubonSDK();
    const loginResponse = sdk.apikeyLogin(
      credentials.personalId,
      credentials.apiKey,
      certificatePath,
      credentials.certificatePassword
    );
    const accounts = requireAccounts(providerData(loginResponse, "login"));

    const inventoryRowCounts: number[] = [];
    for (const account of accounts) {
      const inventory = providerData(sdk.accounting.inventories(account), "inventory");
      if (!Array.isArray(inventory)) {
        throw new ProofError(502, "FUBON_INVENTORY_SHAPE_INVALID", "inventory");
      }
      inventoryRowCounts.push(inventory.length);
    }

    if (typeof sdk.initRealtime !== "function") {
      throw new ProofError(503, "SDK_MARKET_DATA_SURFACE_UNAVAILABLE", "quote");
    }
    sdk.initRealtime();

    const quote = await sdk.marketdata?.restClient?.stock?.intraday?.quote?.({
      symbol: QUOTE_SYMBOL
    });
    const quoteObject = asObject(quote);
    if (
      String(quoteObject.symbol || "") !== QUOTE_SYMBOL
      || typeof quoteObject.lastPrice !== "number"
      || !Number.isFinite(quoteObject.lastPrice)
    ) {
      throw new ProofError(502, "FUBON_QUOTE_RESULT_INVALID", "quote");
    }

    return {
      contract: CONTRACT,
      result: "PASS",
      sdk: {
        package: "fubon-neo",
        version: SDK_VERSION,
        specifier: SDK_SPECIFIER
      },
      runtime: {
        kind: "supabase-edge",
        native_addon: "loaded"
      },
      secret_boundary: {
        source: "edge-secrets",
        values_returned: false,
        certificate_persisted: false
      },
      login: {
        status: "PASS",
        ...sanitizedAccountMetadata(accounts)
      },
      inventories: {
        status: "PASS",
        accounts_tested: accounts.length,
        row_counts: inventoryRowCounts
      },
      latest_quote: {
        status: "PASS",
        symbol: QUOTE_SYMBOL,
        transport: "REST",
        last_price_present: true,
        last_updated_present: typeof quoteObject.lastUpdated === "number",
        stream_subscriptions: 0
      },
      read_only_boundary: {
        mutating_operations_invoked: false,
        order_permission_probe: "NOT_CALLED"
      },
      credentials_returned: false
    };
  } finally {
    try {
      sdk?.shutdown?.();
    } catch {
      // Do not allow SDK cleanup errors to expose provider details.
    }
    await removeEphemeralCertificate(certificatePath);
  }
}

function failureResponse(error: unknown, origin: string) {
  if (error instanceof ProofError) {
    return json({
      contract: CONTRACT,
      result: "FAIL",
      stage: error.stage,
      error_code: error.code,
      ...error.safeDetails,
      credentials_returned: false
    }, error.status, origin);
  }
  return json({
    contract: CONTRACT,
    result: "FAIL",
    stage: "unknown",
    error_code: "PROOF_FAILED",
    credentials_returned: false
  }, 503, origin);
}

Deno.serve(async request => {
  let origin = "";
  try {
    origin = requestOrigin(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(origin) });
    }
    if (request.method !== "POST") {
      throw new ProofError(405, "METHOD_NOT_ALLOWED", "request");
    }

    await rejectRequestBody(request);
    await requireAuthorizedCreator(request);
    const result = await runProof();
    return json(result, 200, origin);
  } catch (error) {
    return failureResponse(error, origin);
  }
});
