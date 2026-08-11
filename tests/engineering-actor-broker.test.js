const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Broker = require("../tools/engineering-actor-broker.js");

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateJwk = privateKey.export({ format: "jwk" });

function decode(token) {
  const [header, payload, signature] = token.split(".");
  const decodePart = part => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return { header: decodePart(header), payload: decodePart(payload), signature, signingInput: `${header}.${payload}` };
}

test("broker issues a bounded Co token without service-role claims", () => {
  const token = Broker.issueActorToken("Co", { privateJwk, nowMs: 1_700_000_000_000, ttlSeconds: 300, jti: "test-co" });
  const parsed = decode(token);
  assert.equal(parsed.header.alg, "ES256");
  assert.equal(parsed.payload.actor_type, "ai");
  assert.equal(parsed.payload.actor_label, "Co");
  assert.equal(parsed.payload.aud, "engineering-transition");
  assert.equal(parsed.payload.scope, "board:transition");
  assert.equal(parsed.payload.exp - parsed.payload.iat, 300);
  assert.equal(parsed.payload.role, undefined);
  const verifier = crypto.createVerify("SHA256");
  verifier.update(parsed.signingInput);
  verifier.end();
  assert.equal(verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parsed.signature, "base64url")), true);
});

test("broker rejects invalid actors and TTL outside five minutes", () => {
  assert.throws(() => Broker.issueActorToken("QJC", { privateJwk }), /Unsupported AI actor/);
  assert.throws(() => Broker.issueActorToken("GPT", { privateJwk, ttlSeconds: 301 }), /TTL/);
  assert.throws(() => Broker.issueActorToken("GPT", { privateJwk, ttlSeconds: 0 }), /TTL/);
});

test("broker requires a protected private JWK environment", () => {
  assert.throws(() => Broker.issueActorToken("GPT", { env: {}, nowMs: 1_700_000_000_000 }), /ENGINEERING_ACTOR_PRIVATE_JWK/);
});
