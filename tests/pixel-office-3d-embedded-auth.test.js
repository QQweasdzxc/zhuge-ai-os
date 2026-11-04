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
const ROOT = fs.readFileSync(nodePath.join(__dirname, "..", "index.html"), "utf8");

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

// --- ZG-52 nested-embed relay (site root shell) ------------------------------

const { EMBEDDED_SHELL_ORIGIN, EMBEDDED_AUTH_TYPE } = require("../labs/pixel-office-3d/tf-source.js");

test("auth gate accepts the first-party shell origin, rejects everything else", () => {
  const parent = {};
  const ok = { type: EMBEDDED_AUTH_TYPE, token: "jwt-1" };
  assert.equal(embeddedAuthMessageOk(EMBEDDED_SHELL_ORIGIN, parent, ok), true, "shell origin accepted (nested embed)");
  assert.equal(embeddedAuthMessageOk(EMBEDDED_PARENT_ORIGIN, parent, ok), true, "direct TF embed still accepted");
  assert.equal(embeddedAuthMessageOk("https://evil.example", parent, ok), false, "third party rejected");
  assert.equal(embeddedAuthMessageOk("https://qqweasdzxc.github.io.evil.example", parent, ok), false, "lookalike suffix rejected");
  assert.equal(embeddedClearMessageOk(EMBEDDED_SHELL_ORIGIN, parent, { type: EMBEDDED_CLEAR_TYPE }), true, "clear via shell accepted");
  assert.equal(embeddedClearMessageOk("https://evil.example", parent, { type: EMBEDDED_CLEAR_TYPE }), false, "clear from third party rejected");
});

test("office accepts nested embed via shell referrer, rejects foreign referrers", () => {
  assert.ok(INDEX.includes("TfSource.EMBEDDED_SHELL_ORIGIN"), "office referrer allowlist includes the shell origin");
  assert.ok(INDEX.includes("TfSource.EMBEDDED_PARENT_ORIGIN"), "direct TF embed still allowed");
});

function runRelay(win) {
  const m = ROOT.match(/\/\/ ZG-52 embedded-auth relay[\s\S]*?<\/script>/);
  assert.ok(m, "relay script present in root index.html");
  const body = m[0].replace(/<\/?script>/g, "");
  // minimal DOM/window mock
  const listeners = [];
  win.addEventListener = (t, fn) => { if (t === "message") listeners.push(fn); };
  win.location = { origin: "https://qqweasdzxc.github.io" };
  new Function("window", "document", "location", body)(win, win.document, win.location);
  return listeners;
}

test("root relay forwards ready office->TF and auth TF->office, drops foreign origins", () => {
  const officeWin = { posted: [] };
  const parentWin = { posted: [] };
  const officeEl = { contentWindow: { postMessage: (data, origin) => officeWin.posted.push({ data, origin }) } };
  const win = {
    parent: { postMessage: (data, origin) => parentWin.posted.push({ data, origin }) },
    document: { querySelector: () => officeEl },
  };
  const officeContentWindow = officeEl.contentWindow;
  const [relay] = runRelay(win);
  assert.ok(relay, "message listener installed");

  // ready from the office iframe -> forwarded to TF origin only
  relay({ data: { type: "zhuge-office-ready" }, source: officeContentWindow, origin: "https://qqweasdzxc.github.io" });
  assert.deepEqual(parentWin.posted, [{ data: { type: "zhuge-office-ready" }, origin: "https://zhuge-taskflow-web.onrender.com" }]);
  assert.equal(officeWin.posted.length, 0);

  // auth from the TF parent -> forwarded into the office iframe
  relay({ data: { type: "zhuge-office-embedded-auth", token: "jwt-9" }, source: win.parent, origin: "https://zhuge-taskflow-web.onrender.com" });
  assert.deepEqual(officeWin.posted, [{ data: { type: "zhuge-office-embedded-auth", token: "jwt-9" }, origin: "https://qqweasdzxc.github.io" }]);

  // clear likewise
  relay({ data: { type: "zhuge-office-embedded-auth-clear" }, source: win.parent, origin: "https://zhuge-taskflow-web.onrender.com" });
  assert.equal(officeWin.posted.length, 2);

  // foreign origin pretending to be TF -> dropped
  relay({ data: { type: "zhuge-office-embedded-auth", token: "evil" }, source: win.parent, origin: "https://evil.example" });
  assert.equal(officeWin.posted.length, 2, "foreign auth dropped");

  // injected into the office frame from outside -> dropped (source not the iframe)
  relay({ data: { type: "zhuge-office-embedded-auth", token: "evil" }, source: {}, origin: "https://qqweasdzxc.github.io" });
  assert.equal(parentWin.posted.length, 1, "non-iframe source not relayed upward");

  // unknown types never relay
  relay({ data: { type: "zhuge-office-ready2" }, source: officeContentWindow, origin: "https://qqweasdzxc.github.io" });
  assert.equal(parentWin.posted.length, 1);
});

test("root relay wiring markers: pinned origins, no token persistence, after iframe", () => {
  assert.ok(ROOT.includes("zhuge-taskflow-web.onrender.com"), "TF origin pinned");
  assert.ok(!/localStorage|sessionStorage/.test(ROOT.match(/\/\/ ZG-52 embedded-auth relay[\s\S]*?<\/script>/)[0]), "relay never touches storage");
  assert.ok(ROOT.indexOf("ZG-52 embedded-auth relay") > ROOT.indexOf("<iframe"), "relay installs after the iframe exists");
});

// --- regression: late token must re-poll immediately (production double-layer
// finding 2026-11-02: the relay delivered the token AFTER the poller's first
// tokenless tick, and nothing re-read until the >=60s interval, leaving the
// nested office stuck on 等待內嵌授權 with 任務 0) ----------------------------

test("kick: a token landing after the first tick re-reads now, not one interval later", async () => {
  const { startTfSource } = require("../labs/pixel-office-3d/tf-source.js");
  const ctl = createEmbeddedAuthCtl({});
  const states = [];
  const boards = [];
  const fetchImpl = stubFetch([
    { match: "/api/issues", respond: async () => ok200({ issues: [{ id: "i1", title: "巢狀卡片", status_category: "in_progress" }], total: 1 }) },
    { match: "/api/projects", respond: async () => ok200({ projects: [] }) },
    { match: "/api/zhuge/native-ai-tasks", respond: async () => ok200({ tasks: [] }) },
  ]);
  globalThis.window = { fetch: fetchImpl, localStorage: { getItem: () => null } };
  try {
    const poller = startTfSource({
      intervalSec: 3600, // production cadence: 1h — kick must NOT wait for it
      apiBase: "https://api.example", workspace: "ws",
      getEmbeddedJwt: () => ctl.getToken(),
      authCtl: ctl,
      onData: (d) => boards.push(d),
      onState: (s) => states.push(s),
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(boards.length, 1, "first tokenless tick reports its honest state");
    assert.equal(boards[0].sessions.length, 0);
    assert.equal(states[0].auth, "auth-required");

    ctl.setToken("late-jwt"); // relay delivers the handshake after load
    poller.kick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(boards.length, 2, "kick re-reads immediately");
    assert.equal(boards[1].sessions.length, 1, "board fills on the kicked read");
    assert.equal(boards[1].sessions[0].title.includes("巢狀卡片"), true);

    poller.stop();
    poller.kick(); // after stop, kick is inert
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(boards.length, 2, "stopped poller stays stopped");
  } finally {
    delete globalThis.window;
  }
});

test("office wiring markers: setToken is followed by the poller kick", () => {
  const setBlock = INDEX.match(/embeddedAuthMessageOk[\s\S]{0,400}/);
  assert.ok(setBlock, "auth acceptance block exists");
  assert.ok(setBlock[0].includes("tfSourceKick"), "kick armed in the acceptance block");
  assert.ok(/tfSourceKick = tfStarted && typeof tfStarted\.kick/.test(INDEX), "connect() captures the poller kick");
});
