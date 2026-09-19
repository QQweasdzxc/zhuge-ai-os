import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  CONTRACT,
  SDK_NAME,
  SDK_VERSION,
  loadFubonSdk,
  runControlSocketProof,
  sanitizedError,
} from "./adapter.mjs";

const execFileAsync = promisify(execFile);
const HOST = "0.0.0.0";
const DEFAULT_PORT = 10000;
const HTTPS_PROBE_URL = "https://www.fbs.com.tw/";
const HTTPS_PROBE_TIMEOUT_MS = 10_000;

function status(value) {
  return value ? "PASS" : "FAIL";
}

async function readRuntimeEvidence() {
  let uname = null;
  try {
    const result = await execFileAsync("uname", ["-m"], { timeout: 2_000 });
    uname = result.stdout.trim() || null;
  } catch {
    // The sanitized health contract records the missing runtime evidence only.
  }

  let glibc = null;
  try {
    glibc = process.report?.getReport?.().header?.glibcVersionRuntime ?? null;
  } catch {
    // process.report is optional outside supported Node runtimes.
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const linux = process.platform === "linux";
  const x64 = process.arch === "x64" && uname === "x86_64";

  return {
    status: status(linux && x64 && nodeMajor === 20 && Boolean(glibc)),
    platform: process.platform,
    arch: process.arch,
    uname_m: uname,
    glibc,
    node: process.version,
    node_major: nodeMajor,
    node_20: status(nodeMajor === 20),
    linux: status(linux),
    native_architecture: status(x64),
  };
}

async function probeOutboundHttps() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTPS_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(HTTPS_PROBE_URL, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "zhuge-fubon-runtime-spike/1.0" },
    });
    await response.body?.cancel();
    return {
      status: "PASS",
      host: new URL(HTTPS_PROBE_URL).host,
      http_status: response.status,
      response_received: true,
    };
  } catch {
    return {
      status: "FAIL",
      host: new URL(HTTPS_PROBE_URL).host,
      http_status: null,
      response_received: false,
      error_code: "OUTBOUND_HTTPS_UNAVAILABLE",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sdkFailure(error, fallbackStage) {
  const safe = sanitizedError(error);
  return {
    status: "FAIL",
    stage: safe.stage ?? fallbackStage,
    error_code: safe.error_code ?? "SDK_PROBE_FAILED",
  };
}

async function runStartupProbe() {
  const runtime = await readRuntimeEvidence();
  let sdkLoad;
  let sdkInstantiate;
  let controlWebSocket;

  try {
    const loaded = loadFubonSdk();
    sdkLoad = {
      status: "PASS",
      name: SDK_NAME,
      version: loaded.version ?? SDK_VERSION,
      constructor_available: typeof loaded.FubonSDK === "function",
    };
  } catch (error) {
    sdkLoad = sdkFailure(error, "sdk_load");
  }

  if (sdkLoad.status === "PASS") {
    try {
      const control = await runControlSocketProof();
      sdkInstantiate = {
        status: "PASS",
        constructor_available: true,
      };
      controlWebSocket = {
        status: control.control_websocket.connected ? "PASS" : "FAIL",
        allowed: true,
        attempted: true,
        connected: control.control_websocket.connected,
        lifecycle: "startup_probe",
      };
    } catch (error) {
      const failed = sdkFailure(error, "sdk_instantiate");
      sdkInstantiate = {
        status: failed.stage === "sdk_instantiate" ? "FAIL" : "NOT_REACHED",
        constructor_available: false,
        ...(failed.stage === "sdk_instantiate" ? { error_code: failed.error_code } : {}),
      };
      controlWebSocket = {
        status: "FAIL",
        allowed: true,
        attempted: true,
        connected: false,
        lifecycle: "startup_probe",
        error_code: failed.error_code,
      };
    }
  } else {
    sdkInstantiate = { status: "NOT_REACHED", constructor_available: false };
    controlWebSocket = {
      status: "NOT_REACHED",
      allowed: true,
      attempted: false,
      connected: false,
      lifecycle: "startup_probe",
    };
  }

  const outboundHttps = await probeOutboundHttps();
  const noMutation = {
    market_data_subscription: { active: false, count: 0 },
    trading_operation: { invoked: false },
    credentials_read: false,
    credentials_returned: false,
  };
  const overallPass = [
    runtime.status,
    sdkLoad.status,
    sdkInstantiate.status,
    controlWebSocket.status,
    outboundHttps.status,
  ].every((value) => value === "PASS");

  return {
    contract: "fubon-render-runtime-spike-v1",
    source_contract: CONTRACT,
    result: overallPass ? "PASS" : "FAIL",
    runtime,
    sdk_load: sdkLoad,
    sdk_instantiate: sdkInstantiate,
    control_websocket: controlWebSocket,
    outbound_https: outboundHttps,
    ...noMutation,
  };
}

function writeJson(response, value, httpStatus) {
  response.writeHead(httpStatus, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

const startupEvidence = await runStartupProbe();
const server = createServer((request, response) => {
  if (request.method !== "GET" || !["/", "/healthz"].includes(request.url)) {
    writeJson(response, { error: "NOT_FOUND" }, 404);
    return;
  }

  writeJson(response, startupEvidence, startupEvidence.result === "PASS" ? 200 : 503);
});

const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
server.listen(Number.isFinite(port) ? port : DEFAULT_PORT, HOST);
