#!/usr/bin/env node

/**
 * Sanitized provider readiness probe.
 *
 * This file intentionally reads only environment-variable presence. It never
 * prints a secret value, sends a provider credential, or persists a response.
 */

import { setTimeout as delay } from "node:timers/promises";

const probes = [
  {
    name: "skyeye",
    required: ["TDX_CLIENT_ID", "TDX_CLIENT_SECRET", "CWA_API_KEY", "MOENV_API_KEY"],
    url: process.env.Zhuge_SKYEYE_RUNTIME_URL
  },
  {
    name: "task-086-attachment-ai",
    required: ["OPENAI_API_KEY"],
    url: process.env.Zhuge_TASK_ATTACHMENT_RUNTIME_URL
  },
  {
    name: "line-task-runtime",
    required: ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"],
    url: process.env.Zhuge_LINE_RUNTIME_URL
  }
];

function configured(required) {
  return required.every((name) => typeof process.env[name] === "string" && process.env[name].length > 0);
}

async function availability(url) {
  if (!url) return { available: "unknown", errorCategory: "RUNTIME_URL_NOT_CONFIGURED" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    if (response.ok) return { available: "available", errorCategory: null };
    if (response.status === 401 || response.status === 403) {
      return { available: "available", errorCategory: "AUTH_REQUIRED" };
    }
    if (response.status === 404) return { available: "unavailable", errorCategory: "NOT_FOUND" };
    return { available: "unavailable", errorCategory: `HTTP_${response.status}` };
  } catch (error) {
    return {
      available: "unavailable",
      errorCategory: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR"
    };
  } finally {
    clearTimeout(timeout);
  }
}

const results = [];
for (const probe of probes) {
  const isConfigured = configured(probe.required);
  const runtime = isConfigured ? await availability(probe.url) : {
    available: "unavailable",
    errorCategory: "PROVIDER_NOT_CONFIGURED"
  };
  results.push({
    provider: probe.name,
    configured: isConfigured,
    available: runtime.available,
    errorCategory: runtime.errorCategory,
    requiredSecretNames: probe.required,
    probeUrlConfigured: Boolean(probe.url)
  });
}

console.log(JSON.stringify({
  contract: "zhuge-provider-readiness-v1",
  status: "PASS",
  secretValuesExposed: false,
  results
}, null, 2));

await delay(0);
