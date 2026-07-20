// Guards the static traps in blocks/mionas-review-card.liquid that no visual check would catch.
// See scripts/mionas-split-hero-contract.test.mjs for the pattern this follows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const blockPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "blocks",
  "mionas-review-card.liquid"
);

const readBlock = () => readFileSync(blockPath, "utf8");

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

test("the card's untokenized max-width is declared exactly once", () => {
  const block = readBlock();
  assert.equal(
    occurrences(block, "320px"),
    1,
    "Card.module.css hardcodes max-width: 320px with no token behind it yet; it must be declared once as a block-local custom property so it is one line to swap when the design system tokenizes it"
  );
});

test("no colour is hardcoded", () => {
  const block = readBlock();
  const hexes = block.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(
    hexes,
    [],
    `every colour must come from a --review-card-* / --card-base-* token; found ${hexes.join(", ")}`
  );
});

test("text spends the theme's loaded body font, not the design system's inert font-family string", () => {
  const block = readBlock();
  assert.equal(
    occurrences(block, "var(--font-body--family)"),
    2,
    "the quote and name must both use --font-body--family, which the theme actually loads and preloads"
  );
  assert.equal(
    occurrences(block, "var(--card-base-font-family)"),
    0,
    "--card-base-font-family is an inert font-list string in design-tokens.css; a custom property loads no font file, so it renders Archivo only by coincidence and falls back the moment the theme's body font setting changes"
  );
});
