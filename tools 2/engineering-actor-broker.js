#!/usr/bin/env node
/**
 * Protected Engineering Actor Broker.
 *
 * This tool only issues short-lived signed actor tokens. It never calls
 * Supabase, writes Board data, or contains a service-role credential.
 * ENGINEERING_ACTOR_PRIVATE_JWK must exist only in the protected tool runtime.
 */
"use strict";

const crypto = require("node:crypto");

const ALLOWED_ACTORS = new Set(["Co", "GPT"]);
const ISSUER = "zhuge-ai-os-engineering-broker";
const ACTOR_PROFILES = Object.freeze({
  transition: Object.freeze({ audience: "engineering-transition", scope: "board:transition" }),
  "memory-read": Object.freeze({ audience: "engineering-memory-read", scope: "engineering-memory:read" }),
  "governance-write": Object.freeze({ audience: "engineering-governance-write", scope: "engineering-governance:write", actors: Object.freeze(["GPT"]) })
});
const AUDIENCE = ACTOR_PROFILES.transition.audience;
const SCOPE = ACTOR_PROFILES.transition.scope;
const MAX_TTL_SECONDS = 300;
const DEFAULT_KEY_ID = "zhuge-engineering-actor-20260810-212242";

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyFromEnvironment(env = process.env) {
  const raw = String(env.ENGINEERING_ACTOR_PRIVATE_JWK || "");
  if (!raw) throw new Error("ENGINEERING_ACTOR_PRIVATE_JWK is required in the protected broker runtime.");
  let jwk;
  try { jwk = JSON.parse(raw); } catch { throw new Error("ENGINEERING_ACTOR_PRIVATE_JWK must be valid JSON JWK."); }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) throw new Error("Engineering actor key must be a P-256 private JWK.");
  return jwk;
}

function issueActorToken(actor, options = {}) {
  if (!ALLOWED_ACTORS.has(actor)) throw new Error(`Unsupported AI actor: ${actor || "(empty)"}`);
  const profileName = options.profile || "transition";
  const profile = ACTOR_PROFILES[profileName];
  if (!profile) throw new Error(`Unsupported Engineering Actor profile: ${profileName}`);
  if (profile.actors && !profile.actors.includes(actor)) throw new Error(`Actor ${actor} is not allowed for profile ${profileName}.`);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const issuedAt = Math.floor(nowMs / 1000);
  const ttl = Number.isFinite(options.ttlSeconds) ? Math.floor(options.ttlSeconds) : MAX_TTL_SECONDS;
  if (ttl < 1 || ttl > MAX_TTL_SECONDS) throw new Error(`Token TTL must be between 1 and ${MAX_TTL_SECONDS} seconds.`);
  const header = { alg: "ES256", typ: "JWT", kid: options.keyId || DEFAULT_KEY_ID };
  const payload = {
    iss: ISSUER,
    aud: profile.audience,
    sub: `ai:${actor}`,
    actor_type: "ai",
    actor_label: actor,
    scope: profile.scope,
    iat: issuedAt,
    exp: issuedAt + ttl,
    jti: options.jti || crypto.randomUUID()
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key: crypto.createPrivateKey({ key: options.privateJwk || privateKeyFromEnvironment(options.env), format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = next;
    index += 1;
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.command !== "issue" || !args.actor) throw new Error("Usage: node tools/engineering-actor-broker.js issue --actor Co|GPT");
    console.log(issueActorToken(args.actor, {
      profile: args.profile || "transition",
      ttlSeconds: args.ttl ? Number(args.ttl) : undefined,
      keyId: args["key-id"] || undefined
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { ALLOWED_ACTORS, ACTOR_PROFILES, ISSUER, AUDIENCE, SCOPE, MAX_TTL_SECONDS, DEFAULT_KEY_ID, issueActorToken, parseArgs };
