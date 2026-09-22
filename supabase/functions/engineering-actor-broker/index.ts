/* Zhuge AI OS Protected Engineering Actor Broker
 *
 * This is the server-side ingress for the approved ChatGPT server-to-server
 * caller. It verifies a separate connector request signature, then issues a
 * short-lived GPT transition token using the existing Actor Broker identity.
 *
 * The function never accepts a Supabase user session, anon key, chat text, or
 * caller-supplied actor/scope as authorization. It never calls a Board RPC and
 * never receives or returns the Supabase service-role key.
 */

type JsonObject = Record<string, unknown>;

const CONTRACT = "zhuge-engineering-actor-broker-v1";
const ACTOR_ISSUER = "zhuge-ai-os-engineering-broker";
const ACTOR_KEY_ID = "zhuge-engineering-actor-20260810-212242";
const ACTOR_AUDIENCE = "engineering-transition";
const ACTOR_SCOPE = "board:transition";
const ACTOR_LABEL = "GPT";
const ACTOR_PROFILE = "transition";
const MAX_TTL_SECONDS = 300;
const MAX_REQUEST_CLOCK_SKEW_SECONDS = 90;
const MAX_BODY_BYTES = 8 * 1024;
const CALLER_KEY_ID_HEADER = "x-zhuge-broker-key-id";
const CALLER_TIMESTAMP_HEADER = "x-zhuge-broker-timestamp";
const CALLER_REQUEST_ID_HEADER = "x-zhuge-broker-request-id";
const CALLER_SIGNATURE_HEADER = "x-zhuge-broker-signature";

class BrokerError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function text(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new BrokerError("Broker signature is malformed.", 401, "CALLER_AUTH_FAILED");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const decoded = atob(normalized);
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  } catch {
    throw new BrokerError("Broker signature is malformed.", 401, "CALLER_AUTH_FAILED");
  }
}

function decodeJson(raw: string, code: string) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as JsonObject;
  } catch {
    throw new BrokerError("Broker configuration is unavailable.", 503, code);
  }
}

function requiredSecret(name: string) {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new BrokerError("Broker server configuration is unavailable.", 503, "BROKER_CONFIGURATION_UNAVAILABLE");
  return value;
}

function privateActorJwk() {
  const jwk = decodeJson(requiredSecret("ENGINEERING_ACTOR_PRIVATE_JWK"), "BROKER_KEY_UNAVAILABLE");
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !text(jwk.d, 512) || !text(jwk.x, 512) || !text(jwk.y, 512)) {
    throw new BrokerError("Broker actor key is unavailable.", 503, "BROKER_KEY_UNAVAILABLE");
  }
  return jwk;
}

function callerJwks() {
  const configured = decodeJson(requiredSecret("ENGINEERING_BROKER_CALLER_JWKS"), "BROKER_CALLER_KEYS_UNAVAILABLE");
  const keys = configured.keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    throw new BrokerError("Broker caller keys are unavailable.", 503, "BROKER_CALLER_KEYS_UNAVAILABLE");
  }
  return keys as Record<string, JsonWebKey>;
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function boundedTtl(value: unknown) {
  const ttl = value === undefined ? MAX_TTL_SECONDS : Number(value);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    throw new BrokerError(`GPT Actor Token TTL must be between 1 and ${MAX_TTL_SECONDS} seconds.`, 400, "TTL_OUT_OF_BOUNDS");
  }
  return ttl;
}

async function sha256Base64url(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function verifyCaller(request: Request, rawBody: string) {
  const keyId = text(request.headers.get(CALLER_KEY_ID_HEADER), 120);
  const timestampValue = text(request.headers.get(CALLER_TIMESTAMP_HEADER), 40);
  const requestId = text(request.headers.get(CALLER_REQUEST_ID_HEADER), 80);
  const signatureValue = text(request.headers.get(CALLER_SIGNATURE_HEADER), 1024);
  const timestamp = Number(timestampValue);
  const now = Math.floor(Date.now() / 1000);

  if (!keyId || !Number.isInteger(timestamp) || !uuid(requestId) || !signatureValue) {
    throw new BrokerError("Protected Broker caller authentication is required.", 401, "CALLER_AUTH_REQUIRED");
  }
  if (Math.abs(now - timestamp) > MAX_REQUEST_CLOCK_SKEW_SECONDS) {
    throw new BrokerError("Protected Broker caller request is outside the allowed time window.", 401, "CALLER_REQUEST_EXPIRED");
  }

  const jwk = callerJwks()[keyId];
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || jwk.d) {
    throw new BrokerError("Protected Broker caller is not allowlisted.", 403, "CALLER_NOT_ALLOWLISTED");
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch {
    throw new BrokerError("Protected Broker caller key is invalid.", 503, "BROKER_CALLER_KEYS_UNAVAILABLE");
  }

  const signingInput = `${timestamp}.${requestId}.${await sha256Base64url(rawBody)}`;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      base64urlBytes(signatureValue),
      new TextEncoder().encode(signingInput)
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new BrokerError("Protected Broker caller signature is invalid.", 403, "CALLER_SIGNATURE_INVALID");
  return { keyId, requestId, timestamp };
}

function parseRequest(rawBody: string) {
  let value: JsonObject;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    value = parsed as JsonObject;
  } catch {
    throw new BrokerError("Broker request body is invalid.", 400, "REQUEST_INVALID");
  }

  const allowed = new Set(["actor", "profile", "ttl_seconds", "purpose"]);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new BrokerError("Broker request contains a field outside the allowlist.", 400, "REQUEST_NOT_ALLOWLISTED");
  }
  if (text(value.actor, 40) !== ACTOR_LABEL || text(value.profile, 80) !== ACTOR_PROFILE || text(value.purpose, 120) !== "engineering-transition") {
    throw new BrokerError("Broker may issue only the bounded GPT transition capability.", 403, "CAPABILITY_NOT_ALLOWLISTED");
  }
  return { ttlSeconds: boundedTtl(value.ttl_seconds) };
}

async function issueActorToken(ttlSeconds: number) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const jti = crypto.randomUUID();
  const header = { alg: "ES256", typ: "JWT", kid: ACTOR_KEY_ID };
  const claims = {
    iss: ACTOR_ISSUER,
    aud: ACTOR_AUDIENCE,
    sub: "ai:GPT",
    actor_type: "ai",
    actor_label: ACTOR_LABEL,
    scope: ACTOR_SCOPE,
    iat: issuedAt,
    exp: expiresAt,
    jti
  };
  const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "jwk",
      privateActorJwk(),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  } catch {
    throw new BrokerError("Broker actor key is unavailable.", 503, "BROKER_KEY_UNAVAILABLE");
  }
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return {
    token: `${signingInput}.${base64url(new Uint8Array(signature))}`,
    claims: { jti, issuedAt, expiresAt }
  };
}

async function recordIssuance(caller: { keyId: string; requestId: string }, claims: { jti: string; issuedAt: number; expiresAt: number }) {
  const supabaseUrl = text(Deno.env.get("SUPABASE_URL"), 240).replace(/\/$/, "");
  const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!supabaseUrl || !serviceKey) {
    throw new BrokerError("Broker audit boundary is unavailable.", 503, "BROKER_AUDIT_UNAVAILABLE");
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/record_engineering_actor_token_issuance`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      p_request_id: caller.requestId,
      p_jti: claims.jti,
      p_caller_key_id: caller.keyId,
      p_actor_label: ACTOR_LABEL,
      p_audience: ACTOR_AUDIENCE,
      p_scope: ACTOR_SCOPE,
      p_issued_at: new Date(claims.issuedAt * 1000).toISOString(),
      p_expires_at: new Date(claims.expiresAt * 1000).toISOString()
    })
  });
  if (!response.ok) {
    if (response.status === 409) throw new BrokerError("Broker request has already been consumed.", 409, "CALLER_REQUEST_REPLAYED");
    throw new BrokerError("Broker audit boundary is unavailable.", 503, "BROKER_AUDIT_UNAVAILABLE");
  }
}

Deno.serve(async request => {
  try {
    if (request.method !== "POST") return json({ contract: CONTRACT, error: "POST required", code: "METHOD_NOT_ALLOWED" }, 405);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      throw new BrokerError("Broker request is too large.", 413, "REQUEST_TOO_LARGE");
    }
    const caller = await verifyCaller(request, rawBody);
    const requested = parseRequest(rawBody);
    const issued = await issueActorToken(requested.ttlSeconds);
    await recordIssuance(caller, issued.claims);
    return json({
      contract: CONTRACT,
      actor: ACTOR_LABEL,
      audience: ACTOR_AUDIENCE,
      scope: ACTOR_SCOPE,
      jti: issued.claims.jti,
      issued_at: new Date(issued.claims.issuedAt * 1000).toISOString(),
      expires_at: new Date(issued.claims.expiresAt * 1000).toISOString(),
      token: issued.token
    });
  } catch (error) {
    const brokerError = error instanceof BrokerError ? error : null;
    return json({
      contract: CONTRACT,
      code: brokerError?.code || "BROKER_UNAVAILABLE",
      error: brokerError?.message || "Protected Engineering Actor Broker is unavailable."
    }, brokerError?.status || 503);
  }
});
