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

let nativeRuntimeLock = Promise.resolve();

export class ProofError extends Error {
  constructor(code, stage, message = code, telemetry = undefined) {
    super(message);
    this.name = "ProofError";
    this.code = code;
    this.stage = stage;
    this.telemetry = telemetry;
  }
}

export class CredentialBoundaryError extends ProofError {
  constructor(missing, telemetry = undefined) {
    super("CREDENTIALS_NOT_INJECTED", "credential_boundary", "CREDENTIALS_NOT_INJECTED", telemetry);
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

async function withIsolatedWorkingDirectory(callback) {
  const previousRun = nativeRuntimeLock;
  let releaseRun;
  nativeRuntimeLock = new Promise((resolve) => {
    releaseRun = resolve;
  });
  await previousRun;

  const originalDirectory = process.cwd();
  const isolatedDirectory = await fs.mkdtemp(join(tmpdir(), "zhuge-fubon-readonly-"));
  try {
    process.chdir(isolatedDirectory);
    return await callback(isolatedDirectory);
  } finally {
    process.chdir(originalDirectory);
    await fs.rm(isolatedDirectory, { recursive: true, force: true }).catch(() => undefined);
    releaseRun();
  }
}

function decodeNativeLogLine(line) {
  const candidate = line.trim();
  if (!candidate || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate)) return "";
  try {
    return Buffer.from(candidate, "base64").toString("utf8");
  } catch {
    return "";
  }
}

async function hasControlWebSocketConnectionEvidence(isolatedDirectory) {
  const logDirectory = join(isolatedDirectory, "log");
  const logNames = await fs.readdir(logDirectory).catch(() => []);
  for (const logName of logNames) {
    const content = await fs.readFile(join(logDirectory, logName), "utf8").catch(() => "");
    if (content.split(/\r?\n/).some((line) => decodeNativeLogLine(line).includes("Successfully connected to WebSocket"))) {
      return true;
    }
  }
  return false;
}

function controlTelemetry(connected, attempted = true) {
  return {
    control_websocket: {
      allowed: true,
      attempted,
      connected,
    },
    market_data_subscription: {
      active: false,
      count: 0,
    },
    trading_operation: {
      invoked: false,
    },
  };
}

async function observeControlWebSocket(isolatedDirectory, waitMs = 1200) {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const connected = await hasControlWebSocketConnectionEvidence(isolatedDirectory);
  if (!connected) {
    throw new ProofError(
      "SDK_CONTROL_WEBSOCKET_UNAVAILABLE",
      "sdk_instantiate",
      "SDK_CONTROL_WEBSOCKET_UNAVAILABLE",
      controlTelemetry(false),
    );
  }
  return controlTelemetry(true);
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
  return withIsolatedWorkingDirectory(async (isolatedDirectory) => {
    const loaded = loadFubonSdk({ moduleSpecifier });
    let sdk;
    let telemetry;
    try {
      try {
        sdk = new loaded.FubonSDK();
      } catch {
        throw new ProofError("SDK_INSTANTIATE_FAILED", "sdk_instantiate");
      }

      telemetry = await observeControlWebSocket(isolatedDirectory);

      let credentials;
      try {
        credentials = readServerCredentials(env);
      } catch (error) {
        if (error instanceof ProofError) error.telemetry = telemetry;
        throw error;
      }

      let certificatePath;
      try {
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

        // This creates the SDK REST client and a dormant market-data client.
        // The proof never calls market-data connect() or subscribe().
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
          ...telemetry,
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
          credentials_returned: false,
        };
      } finally {
        await removeTemporaryCertificate(certificatePath);
      }
    } finally {
      if (sdk && typeof sdk.shutdown === "function") {
        try {
          sdk.shutdown();
        } catch {
          // Cleanup must not expose SDK or credential details.
        }
      }
    }
  });
}

export async function runControlSocketProof({
  moduleSpecifier = process.env.FUBON_NODE_SDK_MODULE || SDK_NAME,
} = {}) {
  return withIsolatedWorkingDirectory(async (isolatedDirectory) => {
    const loaded = loadFubonSdk({ moduleSpecifier });
    let sdk;
    try {
      try {
        sdk = new loaded.FubonSDK();
      } catch {
        throw new ProofError("SDK_INSTANTIATE_FAILED", "sdk_instantiate");
      }
      const telemetry = await observeControlWebSocket(isolatedDirectory);
      return {
        contract: CONTRACT,
        result: "PASS",
        stage: "sdk_instantiate",
        sdk: {
          name: SDK_NAME,
          version: loaded.version ?? SDK_VERSION,
          module_specifier: loaded.moduleSpecifier,
        },
        ...telemetry,
        credentials_read: false,
        credentials_returned: false,
      };
    } finally {
      if (sdk && typeof sdk.shutdown === "function") {
        try {
          sdk.shutdown();
        } catch {
          // Cleanup must not expose SDK or credential details.
        }
      }
    }
  });
}

export function sanitizedError(error) {
  if (error instanceof ProofError) {
    const blocked = new Set([
      "CREDENTIALS_NOT_INJECTED",
      "SDK_CONTROL_WEBSOCKET_UNAVAILABLE",
    ]);
    return {
      contract: CONTRACT,
      result: blocked.has(error.code) ? "BLOCKED" : "FAIL",
      stage: error.stage,
      error_code: error.code,
      credentials_returned: false,
      ...(error.telemetry ?? controlTelemetry(false, false)),
    };
  }

  return {
    contract: CONTRACT,
    result: "FAIL",
    stage: "adapter",
    error_code: "ADAPTER_UNEXPECTED_ERROR",
    credentials_returned: false,
    ...controlTelemetry(false, false),
  };
}
