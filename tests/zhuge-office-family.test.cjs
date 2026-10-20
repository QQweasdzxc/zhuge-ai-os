"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("P2 #78 keeps exactly three family residents and one non-worker pet", () => {
  const source = read("integrations/habblaud/overrides/client/src/adapters/zhuge-family.ts");
  for (const id of ["zhuge-family-beidili", "zhuge-family-anan", "zhuge-family-kaka", "zhuge-pet-blackgray-cat"]) {
    assert.match(source, new RegExp(id));
  }
  assert.match(source, /name: '背地裡'/);
  assert.match(source, /name: '安安'/);
  assert.match(source, /name: '卡卡'/);
  assert.match(source, /name: '黑灰色小貓'/);
  assert.match(source, /zhugeResident/);
  assert.match(source, /status: 'idle'/);
  assert.match(source, /非 AI Worker/);
  assert.doesNotMatch(source, /provider:/);
});

test("P2 #78 uses the native renderer Sprite contract for the pet", () => {
  const build = read("integrations/habblaud/build.mjs");
  const sprite = read("integrations/habblaud/overrides/client/src/world/residents/zhuge-resident-sprite.ts");
  assert.match(build, /zhuge-resident-sprite\.ts/);
  assert.match(build, /zhugeResidentSprite/);
  assert.match(sprite, /canvas: HTMLCanvasElement|canvas, ax:/);
  assert.match(sprite, /imageSmoothingEnabled = false/);
  assert.match(sprite, /return sprite/);
});

test("P2 #78 leaves the frozen Multica vendor untouched", () => {
  const { execFileSync } = require("node:child_process");
  assert.equal(execFileSync("git", ["status", "--short", "third_party/multica"], { cwd: root, encoding: "utf8" }), "");
});

test("P2 #78 roster direction labels family and pet without worker state", () => {
  const hud = read("integrations/habblaud/overrides/client/src/ui/zhuge-hud.ts");
  assert.match(hud, /家庭生活角色 · 角色介紹/);
  assert.match(hud, /寵物角色 · 角色介紹/);
  assert.match(hud, /\$\{person\.name\}（家庭生活角色）/);
  assert.match(hud, /\$\{person\.name\}（寵物）/);
  assert.match(hud, /虛擬家庭生活角色（非 AI Worker、非工程工作狀態）/);
  assert.match(hud, /虛擬寵物（非 AI Worker、非工程工作狀態）/);
  assert.doesNotMatch(hud, /resident[^\n]*主要代理|resident[^\n]*正在規劃工作/);
});
