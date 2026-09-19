import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

export const CONTRACT = "fubon-node-readonly-proof-v1";
export const SDK_NAME = "fubon-neo";
export const SDK_VERSION = "2.3.0";
export const DEFAULT_SYMBOL = "2330";

const CREDENTIAL_ENV_KEYS = Object.freeze([
  "FUBON_API_PERSONAL_ID",
  "FUBON_API_KEY",
  "FUBON_CERT_PASSWORD",
  "FUBON_CERT_FILE_BASE64",
]);

export class ProofError extends Error {
  constructor(code, stage, message = code) {
    super(message);
    this.name = "ProofError";
    this.code = code;
    this.stage = stage;
  }
}

export class CredentialBoundaryError extends ProofError {
  constructor(missing) {
    super("CREDENTIALS_NOT_INJECTED", "credential_boundary");
    this.name = "CredentialBoundaryError";
    this.missing = Object.freeze([...missing]);
  }
}

function requiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveMaybePromise(value) {
  return value && typeof value.then === "function" ? value : Promise.resolve(value);
}

function safePackageVersion(moduleSpecifier) {
  try {
    const packagePath = require.resolve(`${moduleSpecifier}/package.json`);
    return require(packagePath).version;
  } catch {
    return undefined;
  }
}

export function loadFubonSdk({ moduleSpecifier = process.env.FUBON_NODE_SDK_MODULE || SDK_NAME } = {}) {
  let loaded;
  try {
    loaded = require(moduleSpecifier);
  } catch {
    throw new ProofError("SDK_LOAD_UNAVAILABLE", "sdk_load");
  }

  const FubonSDK = loaded?.FubonSDK ?? loaded?.default?.FubonSDK ?? loaded?.default;
  if (typeof FubonSDK !== "function") {
    throw new ProofError("SDK_EXPORT_INVALID", "sdk_load");
  }

  return {
    FubonSDK,
    moduleSpecifier,
    version: safePackageVersion(moduleSpecifier),
  };
}

export function readServerCredentials(env = process.env) {
  const missing = CREDENTIAL_ENV_KEYS.filter((key) => !requiredString(env[key]));
  if (missing.length > 0) {
    throw new CredentialBoundaryError(missing);
  }

  const certificateBase64 = env.FUBON_CERT_FILE_BASE64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(certificateBase64) || certificateBase64.length < 16) {
    throw new ProofError("CERTIFICATE_ENCODING_INVALID", "credential_boundary");
  }

  return {
    personalId: env.FUBON_API_PERSONAL_ID,
    apiKey: env.FUBON_API_KEY,
    certPassword: env.FUBON_CERT_PASSWORD,
    certificateBase64,
  };
}

async function materializeCertificate(certificateBase64) {
  const certificatePath = join(tmpdir(), `zhuge-fubon-readonly-${randomUUID()}.pfx`);
  let certificateBytes;
  try {
    certificateBytes = Buffer.from(certificateBase64, "base64");
  } catch {
    throw new ProofError("CERTIFICATE_ENCODING_INVALID", "credential_boundary");
  }
  if (certificateBytes.length === 0) {
    throw new ProofError("CERTIFICATE_ENCODING_INVALID", "credential_boundary");
  }

  await fs.writeFile(certificatePath, certificateBytes, { mode: 0o600, flag: "wx" });
  return certificatePath;
}

async function removeTemporaryCertificate(certificatePath) {
  if (!certificatePath) return;
  await fs.rm(certificatePath, { force: true }).catch(() => undefined);
}

function responseData(response, stage) {
  if (!response || response.isSuccess !== true) {
    throw new ProofError(`${stage.toUpperCase()}_FAILED`, stage);
  }
  return response.data;
}

function maskIdentifier(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.length <= 2) return "**";
  return `${"*".repeat(Math.max(2, text.length - 2))}${text.slice(-2)}`;
}

function accountEvidence(account) {
  return {
    account: maskIdentifier(account?.account),
    branch: maskIdentifier(account?.branchNo),
    name_present: requiredString(account?.name),
  };
}

function inventoryEvidence(rows) {
  const inventoryRows = Array.isArray(rows) ? rows : [];
  const symbols = [...new Set(
    inventoryRows
      .map((row) => row?.stockNo ?? row?.symbol)
      .filter((value) => value !== null && value !== undefined)
      .map(String),
  )].sort();

  return {
    row_count: inventoryRows.length,
    symbol_count: symbols.length,
    symbols,
  };
}

function quoteEvidence(response, symbol) {
  const data = responseData(response, "quote");
  const quote = data && typeof data === "object" ? data : {};
  const candidatePrice = quote.lastPrice ?? quote.price ?? quote.closePrice ?? quote.last;
  const price = typeof candidatePrice === "number" && Number.isFinite(candidatePrice)
    ? candidatePrice
    : null;
  const asOf = quote.lastUpdated ?? quote.timestamp ?? quote.time ?? null;

  return {
    symbol,
    available: price !== null,
    price,
    as_of: asOf === null || asOf === undefined ? null : String(asOf),
    raw_fields_present: Object.keys(quote).filter((key) => key !== "account"),
  };
}

export async function runReadOnlyProof({
  env = process.env,
  moduleSpecifier = process.env.FUBON_NODE_SDK_MODULE || SDK_NAME,
  symbol = DEFAULT_SYMBOL,
} = {}) {
  loadFubonSdk({ moduleSpecifier });

  // Hard guard: the official native SDK constructor starts its control
  // WebSocket transport before credential validation. B1 explicitly forbids
  // establishing any WebSocket, so do not instantiate, read credentials, or
  // continue to login until PM approves a transport boundary change.
  throw new ProofError("SDK_INSTANTIATE_REQUIRES_WEBSOCKET", "sdk_instantiate");

  /* istanbul ignore next -- retained as the approved read-only flow after the transport gate is resolved */
  const loaded = loadFubonSdk({ moduleSpecifier });

  let sdk;
  try {
    sdk = new loaded.FubonSDK();
  } catch {
    throw new ProofError("SDK_INSTANTIATE_FAILED", "sdk_instantiate");
  }

  let certificatePath;
  try {
    const credentials = readServerCredentials(env);
    certificatePath = await materializeCertificate(credentials.certificateBase64);

    const loginResponse = await resolveMaybePromise(
      sdk.apikeyLogin(
        credentials.personalId,
        credentials.apiKey,
        certificatePath,
        credentials.certPassword,
      ),
    );
    const accounts = responseData(loginResponse, "login");
    if (!Array.isArray(accounts)) {
      throw new ProofError("LOGIN_RESPONSE_INVALID", "login");
    }

    const inventories = [];
    for (const account of accounts) {
      const inventoryResponse = await resolveMaybePromise(sdk.accounting.inventories(account));
      inventories.push(responseData(inventoryResponse, "inventory"));
    }

    // initRealtime creates the SDK's REST client and a dormant WebSocket client.
    // It does not connect or subscribe; this proof never calls connect/subscribe.
    await resolveMaybePromise(sdk.initRealtime());
    const quoteResponse = await resolveMaybePromise(
      sdk.marketdata.restClient.stock.intraday.quote({ symbol }),
    );

    return {
      contract: CONTRACT,
      result: "PASS",
      sdk: {
        name: SDK_NAME,
        version: loaded.version ?? SDK_VERSION,
        module_specifier: loaded.moduleSpecifier,
      },
      account: {
        status: "PASS",
        count: accounts.length,
        accounts: accounts.map(accountEvidence),
      },
      inventory: {
        status: "PASS",
        per_account: inventories.map(inventoryEvidence),
      },
      quote: {
        status: "PASS",
        ...quoteEvidence(quoteResponse, symbol),
      },
      stream_subscriptions: 0,
      websocket_connected: false,
      mutating_operations_invoked: false,
    };
  } finally {
    await removeTemporaryCertificate(certificatePath);
    if (sdk && typeof sdk.shutdown === "function") {
      try {
        sdk.shutdown();
      } catch {
        // Cleanup must not expose SDK or credential details.
      }
    }
  }
}

export function sanitizedError(error) {
  if (error instanceof ProofError) {
    const blocked = new Set([
      "CREDENTIALS_NOT_INJECTED",
      "SDK_INSTANTIATE_REQUIRES_WEBSOCKET",
    ]);
    return {
      contract: CONTRACT,
      result: blocked.has(error.code) ? "BLOCKED" : "FAIL",
      stage: error.stage,
      error_code: error.code,
      credentials_returned: false,
      stream_subscriptions: 0,
      websocket_connected: false,
      mutating_operations_invoked: false,
    };
  }

  return {
    contract: CONTRACT,
    result: "FAIL",
    stage: "adapter",
    error_code: "ADAPTER_UNEXPECTED_ERROR",
    credentials_returned: false,
    stream_subscriptions: 0,
    websocket_connected: false,
    mutating_operations_invoked: false,
  };
}
