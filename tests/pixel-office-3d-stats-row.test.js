"use strict";
// ZG-60 stat-row contract: every count on the TF office stats row opens the
// exact list behind it; the old 「需要你」 bucket is split into 待審核 (review
// queue - no reviewer is recorded, so it never claims to await the viewer)
// and 卡關; 已完成 is labeled cumulative; a clearly labeled 近期更新 strip
// stands in for the (still impossible) 今日完成, which needs transition
// history and must NOT be proxied by last_activity.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "labs/pixel-office-3d/index.html"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "labs/pixel-office-3d/i18n.js"), "utf8");

const window = {};
new Function("window", i18nSrc)(window);
const LOCALES = window.I18N;

test("TF in_review and blocked are their own groups, never folded into needsYou", () => {
  assert.match(html, /case 'in_review': return 'needsReview';/);
  assert.match(html, /case 'blocked': return 'blocked';/);
  assert.ok(!/case 'in_review': case 'blocked': return 'needsYou';/.test(html));
  const groups = html.slice(html.indexOf("const GROUPS = ["), html.indexOf("];", html.indexOf("const GROUPS = [")));
  assert.ok(groups.indexOf("'needsReview'") > -1 && groups.indexOf("'blocked'") > -1);
  assert.ok(groups.indexOf("'needsReview'") < groups.indexOf("'working'"), "review/blocked sort before working");
});

test("TF chips are clickable buttons for review/blocked/working/finished", () => {
  assert.match(html, /const chipKeys = TF_MODE \? \['needsReview', 'blocked', 'working', 'finished'\]/);
  assert.match(html, /<button type="button" class="chip chip-s/);
  assert.match(html, /data-group="\$\{k\}"/);
  assert.ok(!/GROUPS\.slice\(0, 3\)/.test(html), "chips no longer an unclickable slice");
});

test("finished chip is labeled cumulative in TF mode; no today-completed proxy", () => {
  assert.match(html, /L\.tfFinishedAll \|\| L\.finished/);
  // No rendered label may claim daily completion; code comments may mention
  // 今日完成 only to document why it is excluded.
  assert.ok(!/今日完成/.test(i18nSrc), "no locale label claims 今日完成");
  assert.ok(!/>\s*今日完成/.test(html), "no rendered text claims 今日完成");
});

test("chip filter view lists matching tasks and offers a way back", () => {
  assert.match(html, /state\.sideFilter \? GROUPS\.find/);
  assert.match(html, /id="sideFilterBack"/);
  assert.match(html, /state\.sideFilter = null; render\(\); return;/);
  assert.match(html, /state\.sideFilter === k \? ' on' : ''/);
});

test("recent-updates strip is TF-only and clearly labeled", () => {
  assert.match(html, /L\.tfRecentUpdates \|\| '近期更新'/);
  assert.match(html, /sort\(\(a, b\) => b\.lastEventAt - a\.lastEventAt\)\.slice\(0, 5\)/);
});

test("title badge counts every attention group", () => {
  assert.match(html, /gk === 'needsYou' \|\| gk === 'needsReview' \|\| gk === 'blocked'/);
});

test("stats row stays visible and tappable on narrow screens in TF mode", () => {
  assert.match(html, /body\.full\.tf-mode \.summary \{ display: flex/);
});

test("every locale defines the new stat-row keys", () => {
  for (const [code, L] of Object.entries(LOCALES)) {
    for (const k of ["needsReview", "blocked", "tfFinishedAll", "tfRecentUpdates"]) {
      assert.equal(typeof L[k], "string", `${code}.${k}`);
      assert.ok(L[k].length > 0, `${code}.${k} non-empty`);
    }
  }
  assert.equal(LOCALES["zh-TW"].needsReview, "待審核");
  assert.equal(LOCALES["zh-TW"].blocked, "卡關");
  assert.equal(LOCALES["zh-TW"].tfFinishedAll, "已完成（累計）");
  assert.equal(LOCALES["zh-TW"].tfRecentUpdates, "近期更新");
});

test("no wording claims the review queue awaits the viewer personally", () => {
  assert.ok(!/待你核准|等你核准/.test(html), "no 待你核准/等你核准 anywhere");
  assert.ok(!/待你核准|等你核准/.test(i18nSrc), "no 待你核准/等你核准 in i18n");
});
