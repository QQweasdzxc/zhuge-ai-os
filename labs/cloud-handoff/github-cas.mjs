/**
 * Optional GitHub Contents CAS adapter for a dedicated *handoff ledger* branch.
 * Uses normal authenticated GitHub API; never stores tokens in manifests.
 * Not wired into TaskFlow Production or the Cloud runner in this candidate.
 * Runtime: cloud Node 22+ only, server-side.
 */
import { Buffer } from "node:buffer";
import { validateHandoff } from "./contract.mjs";

export function createGithubCasStore({
  repository, ledgerBranch, token, fetcher = fetch, apiBase = "https://api.github.com"
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) throw Error("invalid repository");
  if (!ledgerBranch || ledgerBranch === "main" || !ledgerBranch.startsWith("review/")) throw Error("isolated ledger branch required");
  if (typeof token !== "string" || !token) throw Error("server-only GitHub token required");
  const origin = apiBase.replace(/\/$/, "") + "/repos/" + repository;
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const manifestPath = task => {
    if (typeof task !== "string" || !/^GH-[1-9][0-9]*$/.test(task)) throw Error("invalid task id");
    return "labs/cloud-handoff/ledger/" + task.toLowerCase() + ".json";
  };
  async function http(method, path, data) {
    const r = await fetcher(origin + path, {
      method, headers: { ...headers, ...(data ? { "Content-Type": "application/json" } : {}) },
      body: data ? JSON.stringify(data) : undefined,
      redirect: "error"
    });
    return r;
  }
  async function load(task) {
    const path = manifestPath(task);
    const r = await http("GET", "/contents/" + path + "?ref=" + encodeURIComponent(ledgerBranch));
    if (r.status === 404) return null;
    if (!r.ok) throw Error("handoff ledger read unavailable (" + r.status + ")");
    const j = await r.json();
    if (j.type !== "file" || typeof j.sha !== "string" || j.encoding !== "base64") throw Error("invalid ledger object");
    const data = validateHandoff(JSON.parse(Buffer.from(j.content.replace(/\s/g, ""), "base64").toString("utf8")));
    if (data.task.id !== task || data.repo !== repository) throw Error("ledger identity mismatch");
    return { data, blobSha: j.sha };
  }
  async function verifiedCodeHead(branch) {
    const r = await http("GET", "/branches/" + encodeURIComponent(branch));
    if (!r.ok) return null;
    const j = await r.json();
    return j.commit?.sha ?? null;
  }
  async function claimWithCas({ task, expectedRevision, expectedSha, next }) {
    validateHandoff(next);
    if (next.task.id !== task || next.repo !== repository || next.phase !== "CLAIMED" ||
        next.revision !== expectedRevision + 1 || next.source.head_sha !== expectedSha) {
      throw Error("invalid proposed Git handoff claim");
    }
    const current = await load(task);
    if (!current || current.data.phase !== "HANDOFF_READY" ||
        current.data.revision !== expectedRevision ||
        current.data.source.head_sha !== expectedSha) {
      return { committed: false, reason: "stale_checkpoint_or_unseeded" };
    }
    const liveHead = await verifiedCodeHead(next.source.branch);
    if (liveHead !== expectedSha) {
      return { committed: false, reason: "source_branch_moved" };
    }
    const content = Buffer.from(JSON.stringify(next, null, 2) + "\n", "utf8").toString("base64");
    const r = await http("PUT", "/contents/" + manifestPath(task), {
      message: "chore(handoff): claim " + task + " revision " + next.revision,
      content, branch: ledgerBranch, sha: current.blobSha
    });
    if (r.status === 409 || r.status === 422) return { committed: false, reason: "concurrent_cas_conflict" };
    if (!r.ok) throw Error("handoff CAS write unavailable (" + r.status + ")");
    const saved = await r.json();
    if (typeof saved.content?.sha !== "string" || !saved.commit?.sha) {
      throw Error("handoff write result is ambiguous; reconcile before launching");
    }
    return { committed: true, revision: next.revision, ledgerCommitSha: saved.commit.sha };
  }
  return Object.freeze({ load, verifiedCodeHead, claimWithCas });
}
