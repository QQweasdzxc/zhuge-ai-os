import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mergeTdccPublishedHistory } from "../src/domain/tdcc-historical-series.mjs";

const SOURCE_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5";
const DATASET_URL = "https://data.gov.tw/dataset/11452";
const RELEASE_TAG = "lab-data-tdcc-history";
const ASSET_PREFIX = "tdcc-history-";
const API_ROOT = "https://api.github.com";
const CANONICAL_REPOSITORY = "QQweasdzxc/zhuge-ai-os";
const ASSET_NAME_PATTERN = /^tdcc-history-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/;

async function readResponse(response, description) {
  if (!response.ok) throw new Error(`${description} failed: HTTP ${response.status}`);
  return response;
}

async function githubRequest(url, token, options = {}, fetcher = fetch) {
  const response = await fetcher(url, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  return response;
}

function canonicalAssetUrl(assetName) {
  if (!ASSET_NAME_PATTERN.test(String(assetName || ""))) throw new Error("TDCC history asset name is invalid; publication stopped.");
  return `https://github.com/${CANONICAL_REPOSITORY}/releases/download/${RELEASE_TAG}/${encodeURIComponent(assetName)}`;
}

async function loadPreviousRelease(repo, token, fetcher) {
  const url = `${API_ROOT}/repos/${repo}/releases/tags/${RELEASE_TAG}`;
  const response = await githubRequest(url, token, {}, fetcher);
  if (response.status === 404) return null;
  const release = await (await readResponse(response, "TDCC data release lookup")).json();
  const asset = Array.isArray(release.assets)
    ? release.assets.filter(item => ASSET_NAME_PATTERN.test(String(item.name || ""))).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
    : null;
  if (!asset) return null;
  const previousResponse = await fetcher(canonicalAssetUrl(asset.name), { headers: { accept: "application/json" } });
  const previous = await (await readResponse(previousResponse, "previous TDCC dataset read")).json();
  if (previous?.contract !== "zhuge-tdcc-static-history-v1" || !Array.isArray(previous.observations)) {
    throw new Error("Existing TDCC data release has an invalid history contract; publication stopped.");
  }
  for (const item of previous.observations) {
    if (!item || !/^[A-Z0-9.-]{1,16}$/.test(String(item.symbol || ""))
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ""))
      || !item.levels || typeof item.levels !== "object"
      || ["13", "14", "15"].some(level => item.levels[level] !== null
        && (!Number.isFinite(Number(item.levels[level])) || Number(item.levels[level]) < 0 || Number(item.levels[level]) > 100))) {
      throw new Error("Existing TDCC data release contains an invalid observation; publication stopped.");
    }
  }
  return { release, asset, previous };
}

async function ensureDataRelease(repo, token, existing, fetcher) {
  if (existing) return existing.release;
  const response = await githubRequest(`${API_ROOT}/repos/${repo}/releases`, token, {
    method: "POST",
    body: JSON.stringify({
      tag_name: RELEASE_TAG,
      target_commitish: "main",
      name: "Lab market data · TDCC historical series",
      body: `Automated normalized snapshots from [TDCC dataset 11452](${DATASET_URL}). This is a data publication artifact, not a Product Source release.`,
      draft: false,
      prerelease: true,
      make_latest: "false",
    }),
  }, fetcher);
  return await (await readResponse(response, "TDCC data release creation")).json();
}

async function uploadAsset(token, release, assetName, jsonBytes, fetcher) {
  const uploadBase = String(release.upload_url || "").replace(/\{\?.*$/, "");
  const uploadUrl = new URL(uploadBase);
  if (uploadUrl.origin !== "https://uploads.github.com" || !uploadUrl.pathname.startsWith("/repos/")) throw new Error("TDCC release upload authority is invalid.");
  const target = `${uploadUrl.href}?name=${encodeURIComponent(assetName)}`;
  const uploaded = await fetcher(target, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: jsonBytes,
  });
  return await (await readResponse(uploaded, "TDCC asset upload")).json();
}

export async function publishTdccHistory({ fetcher = fetch, token, repo, now = () => new Date() } = {}) {
  if (!token || String(repo || "").toLowerCase() !== CANONICAL_REPOSITORY.toLowerCase()) {
    throw new Error("The scheduled TDCC publisher requires its authenticated token and canonical Zhuge repository.");
  }
  const sourceResponse = await fetcher(SOURCE_URL, { headers: { accept: "text/csv,text/plain" } });
  const sourceText = await (await readResponse(sourceResponse, "official TDCC source fetch")).text();
  const sourceSha256 = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const previousRelease = await loadPreviousRelease(repo, token, fetcher);
  const published = mergeTdccPublishedHistory(sourceText, previousRelease?.previous || null, {
    fetchedAt: now().toISOString(),
    sourceUrl: SOURCE_URL,
    sourceSha256,
  });
  if (!published.sourceDates.length) throw new Error("TDCC source contained no source-dated observations; no history artifact was published.");
  const latestPrevious = previousRelease?.previous;
  if (latestPrevious?.sourceSha256 === sourceSha256) {
    return Object.freeze({
      tag: RELEASE_TAG,
      asset: previousRelease.asset.name,
      sourceDateCount: latestPrevious.sourceDates?.length || 0,
      observationCount: latestPrevious.observations?.length || 0,
      status: latestPrevious.status,
      sourceSha256,
      assetUrl: canonicalAssetUrl(previousRelease.asset.name),
      published: false,
    });
  }
  const jsonBytes = JSON.stringify(published);
  const release = await ensureDataRelease(repo, token, previousRelease, fetcher);
  const sourceDate = published.sourceDates.at(-1) || "undated";
  const assetName = `${ASSET_PREFIX}${sourceDate}-${sourceSha256.slice(0, 12)}.json`;
  const asset = await uploadAsset(token, release, assetName, jsonBytes, fetcher);
  return Object.freeze({
    tag: RELEASE_TAG,
    asset: assetName,
    sourceDateCount: published.sourceDates.length,
    observationCount: published.observations.length,
    status: published.status,
    sourceSha256,
    assetUrl: asset.browser_download_url,
    published: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishTdccHistory({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY })
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`TDCC publication failed: ${error?.message || error}\n`);
      process.exitCode = 1;
    });
}
