#!/usr/bin/env node
/**
 * Protected server-to-server client for engineering-actor-broker.
 *
 * This is connector-side code. Its private key must remain in the connector's
 * protected server runtime; it must never run in a browser or be logged.
 */
"use strict";

const crypto = require("node:crypto");

const MAX_BODY_BYTES = 8 * 1024;
const DEFAULT_KEY_ID = "chatgpt-engineering-connector-1";

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyFromEnvironment(env = process.env) {
  const raw = String(env.ENGINEERING_BROKER_CALLER_PRIVATE_JWK || "");
  if (!raw) throw new Error("ENGINEERING_BROKER_CALLER_PRIVATE_JWK is required in the protected connector runtime.");
  let jwk;
  try { jwk = JSON.parse(raw); } catch { throw new Error("ENGINEERING_BROKER_CALLER_PRIVATE_JWK must be valid JSON JWK."); }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error("Broker caller key must be a P-256 private JWK.");
  }
  return jwk;
}

function requestId(value) {
  const id = String(value || crypto.randomUUID());
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("requestId must be a UUID.");
  }
  return id;
}

function createBrokerRequest(payload = {}, options = {}) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw new Error("Broker request is too large.");
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const timestamp = Math.floor(nowMs / 1000);
  const id = requestId(options.requestId);
  const keyId = String(options.keyId || process.env.ENGINEERING_BROKER_CALLER_KEY_ID || DEFAULT_KEY_ID).trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(keyId)) throw new Error("Caller key id is invalid.");
  const bodyHash = crypto.createHash("sha256").update(body, "utf8").digest("base64url");
  const signingInput = `${timestamp}.${id}.${bodyHash}`;
  const signer = crypto.createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({
    key: crypto.createPrivateKey({ key: options.privateJwk || privateKeyFromEnvironment(options.env), format: "jwk" }),
    dsaEncoding: "ieee-p1363"
  });
  return Object.freeze({
    body,
    requestId: id,
    timestamp,
    headers: Object.freeze({
      "content-type": "application/json",
      "x-zhuge-broker-key-id": keyId,
      "x-zhuge-broker-timestamp": String(timestamp),
      "x-zhuge-broker-request-id": id,
      "x-zhuge-broker-signature": base64url(signature)
    })
  });
}

async function requestBroker(config, payload = {}, options = {}) {
  const request = createBrokerRequest(payload, options);
  const response = await fetch(config.url, { method: "POST", headers: request.headers, body: request.body });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    const error = new Error(String(parsed?.error || "Engineering Actor Broker request failed."));
    error.code = parsed?.code || "BROKER_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return parsed;
}

module.exports = { MAX_BODY_BYTES, DEFAULT_KEY_ID, privateKeyFromEnvironment, createBrokerRequest, requestBroker };
