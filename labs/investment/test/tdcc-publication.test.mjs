import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { publishTdccHistory } from "../scripts/publish-tdcc-history.mjs";

const SOURCE = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5";
const RELEASE_API = "https://api.github.com/repos/QQweasdzxc/zhuge-ai-os/releases/tags/lab-data-tdcc-history";
const csv = [
  "資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%",
  "20260904,2330,第13級,1,10,10", "20260904,2330,第14級,1,10,15", "20260904,2330,第15級,1,10,25",
  "20261002,2330,第13級,1,10,11", "20261002,2330,第14級,1,10,15", "20261002,2330,第15級,1,10,25",
].join("\n");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return String(body); },
  };
}

test("scheduled TDCC publisher writes a source-dated artifact and does not follow release metadata URLs", async () => {
  const calls = [];
  let artifact = null;
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === SOURCE) return response(200, csv);
    if (url === RELEASE_API && options.method !== "POST") return response(404, {});
    if (url === "https://api.github.com/repos/QQweasdzxc/zhuge-ai-os/releases" && options.method === "POST") {
      return response(201, { upload_url: "https://uploads.github.com/repos/QQweasdzxc/zhuge-ai-os/releases/99/assets{?name,label}" });
    }
    if (String(url).startsWith("https://uploads.github.com/repos/QQweasdzxc/zhuge-ai-os/releases/99/assets?name=")) {
      artifact = JSON.parse(options.body);
      return response(201, { name: new URL(url).searchParams.get("name") });
    }
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  const result = await publishTdccHistory({ fetcher, token: "fixture-token", repo: "QQweasdzxc/zhuge-ai-os", now: () => new Date("2026-10-08T01:00:00.000Z") });
  assert.equal(result.published, true);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.asset, "tdcc-history-2026-10-02-" + result.sourceSha256.slice(0, 12) + ".json");
  assert.equal(artifact.contract, "zhuge-tdcc-static-history-v1");
  assert.deepEqual(artifact.sourceDates, ["2026-09-04", "2026-10-02"]);
  assert.equal(artifact.observations.every(item => item.symbol === "2330"), true);

  const hostileCalls = [];
  const secondFetcher = async (url, options = {}) => {
    hostileCalls.push(String(url));
    if (url === SOURCE) return response(200, csv);
    if (url === RELEASE_API) return response(200, {
      assets: [{
        name: result.asset,
        created_at: "2026-10-08T01:00:00Z",
        browser_download_url: "https://attacker.example/tdcc.json",
      }],
    });
    if (url === `https://github.com/QQweasdzxc/zhuge-ai-os/releases/download/lab-data-tdcc-history/${result.asset}`) return response(200, artifact);
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  const unchanged = await publishTdccHistory({ fetcher: secondFetcher, token: "fixture-token", repo: "QQweasdzxc/zhuge-ai-os", now: () => new Date("2026-10-08T01:00:00.000Z") });
  assert.equal(unchanged.published, false);
  assert.equal(hostileCalls.some(url => url.includes("attacker.example")), false);
});

test("TDCC publication workflow is data-only and follows the official dataset update cadence", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/lab-tdcc-history-publication.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "30 18 1-7 \* 1"/);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main\s*\n[\s\S]*?paths:\s*\n\s+- \.github\/workflows\/lab-tdcc-history-publication\.yml\s*\n\s+- labs\/investment\/scripts\/publish-tdcc-history\.mjs/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /publish-tdcc-history\.mjs/);
  assert.doesNotMatch(workflow, /git push|deploy-pages|upload-pages-artifact/i);

  const publisher = await readFile(new URL("../scripts/publish-tdcc-history.mjs", import.meta.url), "utf8");
  assert.match(publisher, /\/releases\/tags\/\$\{RELEASE_TAG\}/);
  assert.match(publisher, /\/repos\/\$\{repo\}\/releases/);
  assert.match(publisher, /uploads\.github\.com/);
  assert.doesNotMatch(publisher, /\bgit\s+(?:add|commit|push)\b|upload-pages-artifact|deploy-pages/i);
});
