#!/usr/bin/env node
/**
 * Protected Governance execution environment loader.
 *
 * The Supabase URL and anon key are public project configuration.  The
 * Engineering Actor private JWK is a protected credential and is loaded only
 * at approval time from the inherited protected environment or macOS
 * Keychain.  Nothing from this module is intended for browser bundling.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PUBLIC_CONFIG_PATH = path.join(PROJECT_ROOT, "shared", "app-config.js");
const KEYCHAIN_ACCOUNT = "co-gpt-broker";
const KEYCHAIN_SERVICE = "zhuge-ai-os-engineering-actor-private-jwk";

function normalizeHttpsUrl(value, name) {
  const url = String(value || "").trim().replace(/\/$/, "");
  if (!url || !/^https:\/\//i.test(url)) throw new Error(`${name} must use HTTPS.`);
  return url;
}

function readPublicSupabaseConfig(filePath = PUBLIC_CONFIG_PATH) {
  const source = fs.readFileSync(filePath, "utf8");
  const urlMatch = source.match(/supabaseUrl:\s*["']([^"']+)["']/);
  const keyMatch = source.match(/supabaseAnonKey:\s*["']([^"']+)["']/);
  if (!urlMatch || !keyMatch) throw new Error("Canonical public Supabase configuration is incomplete.");
  return Object.freeze({
    supabaseUrl: normalizeHttpsUrl(urlMatch[1], "Public Supabase URL"),
    supabaseAnonKey: String(keyMatch[1]).trim()
  });
}

function readPublicAppOrigin(filePath = PUBLIC_CONFIG_PATH) {
  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(/WEB_APP_URL\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("Canonical public Web App URL is incomplete.");
  let url;
  try { url = new URL(match[1]); } catch { throw new Error("Canonical public Web App URL is invalid."); }
  if (!/^https?:$/i.test(url.protocol)) throw new Error("Canonical public Web App URL must use HTTP(S).");
  return url.origin;
}

function resolveExecutionEnvironment(env = process.env, options = {}) {
  const publicConfig = options.publicConfig || readPublicSupabaseConfig(options.publicConfigPath || PUBLIC_CONFIG_PATH);
  const configuredUrl = env.SUPABASE_URL || env.ZHUGE_SUPABASE_URL || publicConfig.supabaseUrl;
  const supabaseUrl = normalizeHttpsUrl(configuredUrl, "SUPABASE_URL");
  const supabaseAnonKey = String(
    env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || publicConfig.supabaseAnonKey || ""
  ).trim();
  if (!supabaseAnonKey) throw new Error("The public Supabase anon/publishable key is missing.");
  const governanceWriteUrl = normalizeHttpsUrl(
    env.ENGINEERING_GOVERNANCE_WRITE_URL || `${supabaseUrl}/functions/v1/engineering-transition`,
    "ENGINEERING_GOVERNANCE_WRITE_URL"
  );
  return Object.freeze({
    supabaseUrl,
    supabaseAnonKey,
    governanceWriteUrl,
    productOrigins: Object.freeze([readPublicAppOrigin(options.publicConfigPath || PUBLIC_CONFIG_PATH)]),
    urlSource: env.SUPABASE_URL || env.ZHUGE_SUPABASE_URL ? "protected-environment" : "canonical-public-project-config"
  });
}

function parsePrivateJwk(raw) {
  let jwk;
  try { jwk = JSON.parse(String(raw || "")); } catch {
    throw new Error("Protected Engineering Actor key is not valid JSON.");
  }
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) {
    throw new Error("Protected Engineering Actor key is not a valid P-256 private JWK.");
  }
  return Object.freeze(jwk);
}

function readProtectedPrivateJwk(env = process.env, options = {}) {
  if (env.ENGINEERING_ACTOR_PRIVATE_JWK) return parsePrivateJwk(env.ENGINEERING_ACTOR_PRIVATE_JWK);
  const execFile = options.execFileSync || execFileSync;
  try {
    const raw = execFile("security", [
      "find-generic-password",
      "-a", KEYCHAIN_ACCOUNT,
      "-s", KEYCHAIN_SERVICE,
      "-w"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return parsePrivateJwk(raw);
  } catch {
    throw new Error("Protected Engineering Actor key is unavailable from the protected environment.");
  }
}

function loadProtectedGovernanceEnvironment(env = process.env, options = {}) {
  const execution = resolveExecutionEnvironment(env, options);
  return Object.freeze({ ...execution, privateJwk: readProtectedPrivateJwk(env, options) });
}

module.exports = {
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  PROJECT_ROOT,
  PUBLIC_CONFIG_PATH,
  normalizeHttpsUrl,
  readPublicSupabaseConfig,
  readPublicAppOrigin,
  resolveExecutionEnvironment,
  parsePrivateJwk,
  readProtectedPrivateJwk,
  loadProtectedGovernanceEnvironment
};
