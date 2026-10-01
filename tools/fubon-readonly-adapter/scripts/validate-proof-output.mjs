import { readFile } from "node:fs/promises";

import {
  SanitizedOutputGuardError,
  validateSanitizedProof,
} from "../src/sanitized-output-guard.mjs";

const filePath = process.argv[2];

if (!filePath) {
  process.stderr.write("FUBON_OUTPUT_GUARD_FAILED:OUTPUT_FILE_REQUIRED\n");
  process.exit(1);
}

try {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  const summary = validateSanitizedProof(value);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const code = error instanceof SanitizedOutputGuardError
    ? error.code
    : "OUTPUT_PARSE_OR_GUARD_FAILED";
  process.stderr.write(`FUBON_OUTPUT_GUARD_FAILED:${code}\n`);
  process.exit(1);
}
