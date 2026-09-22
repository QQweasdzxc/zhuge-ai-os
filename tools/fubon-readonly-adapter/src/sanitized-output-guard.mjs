const REQUIRED_CONTRACT = "fubon-node-readonly-proof-v1";

const FORBIDDEN_KEYS = new Set([
  "apikey",
  "api_key",
  "personalid",
  "personal_id",
  "certpassword",
  "certificatebase64",
  "certificatepath",
  "password",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "privatekey",
  "private_key",
  "rawresponse",
  "raw_response",
]);

export class SanitizedOutputGuardError extends Error {
  constructor(code) {
    super(code);
    this.name = "SanitizedOutputGuardError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedKey(value) {
  return String(value).replace(/[-\s]/g, "").toLowerCase();
}

function inspectKeys(value, depth = 0) {
  if (depth > 12) throw new SanitizedOutputGuardError("OUTPUT_NESTING_TOO_DEEP");
  if (Array.isArray(value)) {
    for (const item of value) inspectKeys(item, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizedKey(key))) {
      throw new SanitizedOutputGuardError("FORBIDDEN_OUTPUT_FIELD");
    }
    inspectKeys(nested, depth + 1);
  }
}

function serializedWithoutSecrets(value, env) {
  const serialized = JSON.stringify(value);
  for (const key of [
    "FUBON_API_PERSONAL_ID",
    "FUBON_API_KEY",
    "FUBON_CERT_PASSWORD",
    "FUBON_CERT_FILE_BASE64",
  ]) {
    const secret = typeof env?.[key] === "string" ? env[key] : "";
    if (secret && serialized.includes(secret)) {
      throw new SanitizedOutputGuardError("SECRET_VALUE_EXPOSED");
    }
  }
  return serialized;
}

function proofSummary(value) {
  return {
    contract: value.contract,
    result: value.result,
    stage: value.stage ?? "complete",
    sdk_version: value.sdk?.version ?? null,
    control_websocket: {
      allowed: value.control_websocket?.allowed === true,
      connected: value.control_websocket?.connected === true,
    },
    market_data_subscription: {
      active: value.market_data_subscription?.active === true,
      count: Number(value.market_data_subscription?.count ?? 0),
    },
    trading_operation: {
      invoked: value.trading_operation?.invoked === true,
    },
    account_count: Number(value.account?.count ?? 0),
    inventory_accounts: Array.isArray(value.inventory?.per_account)
      ? value.inventory.per_account.length
      : 0,
    quote: value.quote
      ? {
          symbol: value.quote.symbol ?? null,
          available: value.quote.available === true,
          price: value.quote.price ?? null,
          as_of: value.quote.as_of ?? null,
        }
      : null,
  };
}

export function validateSanitizedProof(value, env = process.env) {
  if (!isRecord(value)) throw new SanitizedOutputGuardError("OUTPUT_NOT_OBJECT");
  if (value.contract !== REQUIRED_CONTRACT) {
    throw new SanitizedOutputGuardError("CONTRACT_MISMATCH");
  }

  inspectKeys(value);
  serializedWithoutSecrets(value, env);

  if (value.result !== "PASS") {
    throw new SanitizedOutputGuardError("PROOF_NOT_PASS");
  }
  if (value.credentials_returned !== false) {
    throw new SanitizedOutputGuardError("CREDENTIAL_RETURN_FLAG_INVALID");
  }
  if (value.control_websocket?.allowed !== true || value.control_websocket?.connected !== true) {
    throw new SanitizedOutputGuardError("CONTROL_WEBSOCKET_GUARD_FAILED");
  }
  if (value.market_data_subscription?.active !== false || Number(value.market_data_subscription?.count) !== 0) {
    throw new SanitizedOutputGuardError("MARKET_SUBSCRIPTION_GUARD_FAILED");
  }
  if (value.trading_operation?.invoked !== false) {
    throw new SanitizedOutputGuardError("TRADING_OPERATION_GUARD_FAILED");
  }

  return proofSummary(value);
}
