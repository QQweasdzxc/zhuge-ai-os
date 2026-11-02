"use strict";

// ZG-52 embedded auth bridge tests. Two layers:
//  1. behavioral: the lifecycle controller + poll stale-guard against real
//     logout / account-switch / delayed-old-token scenarios (old JWT is still
//     server-valid until its exp — the discard discipline is what protects
//     the iframe, and it is what these tests exercise);
//  2. wiring markers: the office/panel scripts keep the verified handshake
//     and the event-driven revocation paths intact.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");

const {
  embeddedAuthMessageOk,
  embeddedClearMessageOk,
  createEmbeddedAuthCtl,
  pollTfOnce,
  EMBEDDED_PARENT_ORIGIN,
  EMBEDDED_CLEAR_TYPE,
} = require("../labs/pixel-office-3d/tf-source.js");

const INDEX = fs.readFileSync(nodePath.join(__dirname, "..", "labs/pixel-office-3d/index.html"), "utf8");
const PANEL = fs.readFileSync(nodePath.join(__dirname, "..", "labs/taskflow/overrides/taskflow-office-panel.tsx"), "utf8");

const ok200 = (body) => ({ status: 200, json: async () => body });

// --- behavioral: controller ------------------------------------------------

test("logout: revoke drops the token, wipes, aborts the in-flight read", () => {
  const wiped = [];
  const ctl = createEmbeddedAuthCtl({ onWipe: () => wiped.push(Date.now()) });
  ctl.setToken("A-token");
  const read = ctl.begin();
  assert.equal(ctl.getToken(), "A-token");
  ctl.revoke(); // parent logged out; A-token is STILL server-valid until exp
  assert.equal(ctl.getToken(), null, "token dropped immediately");
  assert.equal(read.signal.aborted, true, "in-flight read aborted");
  assert.equal(ctl.isStale(read.gen), true, "old generation is stale");
  assert.equal(wiped.length, 2, "set + revoke each wiped the board");
});

test("account switch: replace wipes A and kills A's reads before B is used", () => {
  const wiped = [];
  const ctl = createEmbeddedAuthCtl({ onWipe: () => wiped.push(1) });
  ctl.setToken("A-token");
  const readA = ctl.begin();
  ctl.setToken("B-token");
  assert.equal(readA.signal.aborted, true);
  assert.equal(ctl.isStale(readA.gen), true);
  assert.equal(ctl.getToken(), "B-token");
  const readB = ctl.begin();
  assert.equal(readB.signal.aborted, false, "B's generation is live");
  assert.equal(ctl.isStale(readB.gen), false);
  readB.done();
});

// --- behavioral: poll discard against a still-valid old JWT ----------------

function stubFetch(handlers) {
  return async (url, init) => {
    for (const h of handlers) {
      if (url.includes(h.match)) {
        const out = await h.respond(init);
        return out;
      }
    }
    return ok200({});
  };
}

test("delayed A response after logout is discarded (old JWT still valid)", async () => {
  const ctl = createEmbeddedAuthCtl({});
  ctl.setToken("A-token");
  const read = ctl.begin();
  let releaseIssues;
  const issuesGate = new Promise((resolve) => { releaseIssues = resolve; });
  const fetchImpl = stubFetch([
    // The server still honours A's JWT (HMAC, no revocation) — 200, not 401.
    { match: "/api/issues", respond: async () => { await issuesGate; return ok200({ issues: [{ id: "i1", title: "A card", status_category: "in_progress" }], total: 1 }); } },
    { match: "/api/projects", respond: async () => ok200({ projects: [] }) },
    { match: "/api/zhuge/native-ai-tasks", respond: async () => ok200({ tasks: [] }) },
  ]);
  const pending = pollTfOnce(fetchImpl, "", Date.now(), {
    apiBase: "https://api.example", workspace: "ws",
    embedded: true, embeddedJwt: "A-token",
    signal: read.signal, isStale: () => ctl.isStale(read.gen),
  });
  ctl.revoke(); // logout while the A read is in flight
  releaseIssues();
  const r = await pending;
  assert.equal(r.state, "stale", "A's late response is marked stale, never merged");
  assert.equal(r.sessions, undefined);
  read.done();
});

test("account switch mid-poll discards A's in-flight read", async () => {
  const ctl = createEmbeddedAuthCtl({});
  ctl.setToken("A-token");
  const readA = ctl.begin();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = stubFetch([
    { match: "/api/issues", respond: async () => { await gate; return ok200({ issues: [{ id: "i1", title: "A card" }], total: 1 }); } },
    { match: "/api/projects", respond: async () => ok200({ projects: [] }) },
    { match: "/api/zhuge/native-ai-tasks", respond: async () => ok200({ tasks: [] }) },
  ]);
  const pending = pollTfOnce(fetchImpl, "", Date.now(), {
    apiBase: "https://api.example", workspace: "ws",
    embedded: true, embeddedJwt: "A-token",
    signal: readA.signal, isStale: () => ctl.isStale(readA.gen),
  });
  ctl.setToken("B-token"); // switch happens while A's response is in flight
  release();
  const r = await pending;
  assert.equal(r.state, "stale");
  readA.done();
  // B's own read is unaffected and completes normally.
  const readB = ctl.begin();
  const rB = await pollTfOnce(stubFetch([
    { match: "/api/issues", respond: async () => ok200({ issues: [{ id: "i2", title: "B card", status_category: "todo" }], total: 1 }) },
    { match: "/api/projects", respond: async () => ok200({ projects: [] }) },
    { match: "/api/zhuge/native-ai-tasks", respond: async () => ok200({ tasks: [] }) },
  ]), "", Date.now(), {
    apiBase: "https://api.example", workspace: "ws",
    embedded: true, embeddedJwt: "B-token",
    signal: readB.signal, isStale: () => ctl.isStale(readB.gen),
  });
  readB.done();
  assert.equal(rB.state, "ok");
  assert.equal(rB.sessions.length, 1);
  assert.equal(rB.sessions[0].title.includes("B card"), true);
});

// --- message gates ----------------------------------------------------------

test("auth message gate keeps the strict parent/origin/source contract", () => {
  const parent = {};
  const ok = { type: "zhuge-office-embedded-auth", token: "jwt" };
  assert.equal(embeddedAuthMessageOk(EMBEDDED_PARENT_ORIGIN, parent, ok), true);
  assert.equal(embeddedAuthMessageOk("https://evil.example", parent, ok), false);
  assert.equal(embeddedAuthMessageOk(EMBEDDED_PARENT_ORIGIN, null, ok), false);
  assert.equal(embeddedAuthMessageOk(EMBEDDED_PARENT_ORIGIN, parent, { ...ok, token: "" }), false);
  assert.equal(embeddedAuthMessageOk(EMBEDDED_PARENT_ORIGIN, parent, { type: "other" }), false);
});

test("clear message gate accepts only the pinned parent's clear", () => {
  const parent = {};
  assert.equal(embeddedClearMessageOk(EMBEDDED_PARENT_ORIGIN, parent, { type: EMBEDDED_CLEAR_TYPE }), true);
  assert.equal(embeddedClearMessageOk("https://evil.example", parent, { type: EMBEDDED_CLEAR_TYPE }), false);
  assert.equal(embeddedClearMessageOk(EMBEDDED_PARENT_ORIGIN, null, { type: EMBEDDED_CLEAR_TYPE }), false);
  assert.equal(embeddedClearMessageOk(EMBEDDED_PARENT_ORIGIN, parent, { type: "zhuge-office-embedded-auth" }), false);
});

// --- wiring markers ----------------------------------------------------------

test("office wires the controller: wipe board, abort reads, discard stale", () => {
  assert.ok(INDEX.includes("createEmbeddedAuthCtl"), "controller created");
  assert.ok(INDEX.includes("wipeEmbeddedBoard"), "wipe path exists");
  assert.ok(INDEX.includes("state.prev = new Map()"), "alert baseline reset on wipe");
  assert.ok(INDEX.includes("embeddedClearMessageOk"), "clear validated through the gate");
  assert.ok(INDEX.includes("embeddedAuthCtl.setToken"), "replace goes through the controller");
  assert.ok(!/localStorage\.setItem\([^)]*token/i.test(INDEX), "token never persisted");
});

test("panel revokes via the auth store immediately, poll is fallback only", () => {
  assert.ok(PANEL.includes('from "@multica/core/auth"'), "auth store imported");
  assert.ok(PANEL.includes("useAuthStore.subscribe"), "event-driven revocation");
  assert.ok(PANEL.includes("pushAuth(true)"), "immediate clear on logout/expiry");
  assert.ok(PANEL.includes("lastSent = null"), "account switch forces re-send");
  assert.ok(PANEL.includes("setInterval"), "60s fallback remains");
  assert.ok(PANEL.includes("EMBEDDED_CLEAR_TYPE"), "clear type sent");
});
