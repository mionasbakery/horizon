#!/usr/bin/env node
// Writes the release into snippets/mionas-version.liquid before a push, which analytics then reports
// as the theme version. Takes the release tag, or falls back to `git describe --tags` for a direct
// push. Restore the file with `git checkout snippets/mionas-version.liquid` afterwards.
// Run: npm run theme:version -- [version]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../snippets/mionas-version.liquid", import.meta.url));
const version = process.argv[2] || execSync("git describe --tags", { encoding: "utf8" }).trim();

if (!/^[\w.+-]+$/.test(version)) {
  console.error(`ERROR: "${version}" is not a release name.`);
  process.exit(1);
}

const source = readFileSync(file, "utf8");
const updated = source.replace(/^dev$/m, version);
if (updated === source) {
  console.error(`ERROR: ${file} has no "dev" line to replace; it already holds a version or was rewritten.`);
  process.exit(1);
}
writeFileSync(file, updated);
console.log(`Theme version ${version}`);
