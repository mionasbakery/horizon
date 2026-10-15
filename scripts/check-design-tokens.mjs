#!/usr/bin/env node
// Checks the committed assets/design-tokens.css against the contract, without ../design-system, so CI
// catches a hand edit that tokens:sync would have refused. Run: npm run tokens:check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findMissingTokens, findWrongValues } from "./design-tokens-contract.mjs";

const file = fileURLToPath(new URL("../assets/design-tokens.css", import.meta.url));
const css = readFileSync(file, "utf8");
const missing = findMissingTokens(css);
const wrong = findWrongValues(css);

for (const token of missing) console.error(`missing: ${token}`);
for (const { token, expected, actual } of wrong) {
  console.error(`wrong value: ${token} is ${actual}, the contract expects ${expected}`);
}
if (missing.length > 0 || wrong.length > 0) process.exit(1);

console.log("assets/design-tokens.css matches the contract");
