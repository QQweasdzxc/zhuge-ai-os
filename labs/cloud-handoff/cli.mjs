#!/usr/bin/env node
/**
 * Read-only manifest inspector. No GitHub write, agent launch or API access.
 * Usage: node labs/cloud-handoff/cli.mjs validate|gate|brief manifest.json
 */
import { readFileSync } from "node:fs";
import { validateHandoff, canDispatch, handoffBrief } from "./contract.mjs";
const [action, file] = process.argv.slice(2);
if (!["validate", "gate", "brief"].includes(action) || !file) {
  console.error("usage: node labs/cloud-handoff/cli.mjs validate|gate|brief <manifest.json>");
  process.exitCode = 2;
} else {
  try {
    const data = validateHandoff(JSON.parse(readFileSync(file, "utf8")));
    if (action === "validate") console.log("VALID " + data.task.id + " phase=" + data.phase);
    if (action === "gate") console.log(JSON.stringify(canDispatch(data), null, 2));
    if (action === "brief") process.stdout.write(handoffBrief(data));
  } catch (error) {
    console.error(String(error.message).slice(0, 500));
    process.exitCode = 1;
  }
}
