const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Client = require("../tools/engineering-actor-broker-client.js");

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateJwk = privateKey.export({ format: "jwk" });

test("connector request is signed independently from the GPT Actor Token key", () => {
  const request = Client.createBrokerRequest({
    actor: "GPT",
    profile: "transition",
    ttl_seconds: 300,
    purpose: "engineering-transition"
  }, { privateJwk, nowMs: 1_700_000_000_000, requestId: "8f2d8e6e-74b9-4cc2-8f61-5cfca4e1f2ad", keyId: "test-connector-1" });
  const bodyHash = crypto.createHash("sha256").update(request.body, "utf8").digest("base64url");
  const signingInput = `${request.timestamp}.${request.requestId}.${bodyHash}`;
  const verifier = crypto.createVerify("SHA256");
  verifier.update(signingInput);
  verifier.end();
  assert.equal(verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(request.headers["x-zhuge-broker-signature"], "base64url")), true);
  assert.equal(request.headers["x-zhuge-broker-key-id"], "test-connector-1");
  assert.doesNotMatch(request.body, /private|service_role|token/i);
});

test("connector request rejects a missing protected private key", () => {
  assert.throws(() => Client.createBrokerRequest({}, { env: {} }), /ENGINEERING_BROKER_CALLER_PRIVATE_JWK/);
});

test("connector request keeps the payload and body hash bounded", () => {
  assert.throws(() => Client.createBrokerRequest({ large: "x".repeat(Client.MAX_BODY_BYTES) }, { privateJwk }), /too large/i);
  const request = Client.createBrokerRequest({}, { privateJwk });
  assert.match(request.headers["x-zhuge-broker-request-id"], /^[0-9a-f-]{36}$/i);
});
