#!/usr/bin/env node
// Pushes approved translations to the Shopify Admin API via translationsRegister, one call per
// resource (the API accepts a batch of fields per resourceId, but not across resources).
//
// Usage:
//   SHOPIFY_STORE_DOMAIN=my-shop.myshopify.com SHOPIFY_ADMIN_API_TOKEN=shpat_xxx \
//     node push_translations.mjs approved.json
//
// approved.json must be an array of:
//   { resourceId, key, locale, value, digest }
// (this is exactly the shape find_missing.mjs's "items" produce, plus a filled-in "value" —
// see SKILL.md step 2 for how that field gets populated and reviewed before this step runs)

import { readFileSync } from "node:fs";

const API_VERSION = "2025-01";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it to your store's Admin API credentials before running this script.`
    );
  }
  return value;
}

async function shopifyGraphQL(domain, token, query, variables) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL request failed: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

const REGISTER_MUTATION = `
  mutation RegisterTranslations($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      userErrors { field message }
      translations { key locale value }
    }
  }
`;

function groupByResource(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.resourceId)) groups.set(item.resourceId, []);
    groups.get(item.resourceId).push(item);
  }
  return groups;
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node push_translations.mjs <approved.json>");

  const domain = requireEnv("SHOPIFY_STORE_DOMAIN");
  const token = requireEnv("SHOPIFY_ADMIN_API_TOKEN");

  const items = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Input file must be a non-empty JSON array of translation items.");
  }
  for (const item of items) {
    for (const field of ["resourceId", "key", "locale", "value", "digest"]) {
      if (!item[field]) throw new Error(`Item missing "${field}": ${JSON.stringify(item)}`);
    }
  }

  const groups = groupByResource(items);
  let succeeded = 0;
  let failed = 0;

  for (const [resourceId, fields] of groups) {
    const translations = fields.map((f) => ({
      key: f.key,
      locale: f.locale,
      value: f.value,
      translatableContentDigest: f.digest,
    }));

    const data = await shopifyGraphQL(domain, token, REGISTER_MUTATION, { resourceId, translations });
    const errors = data.translationsRegister.userErrors;

    if (errors.length > 0) {
      failed += fields.length;
      process.stderr.write(`FAILED ${resourceId}: ${JSON.stringify(errors)}\n`);
    } else {
      succeeded += data.translationsRegister.translations.length;
      process.stderr.write(`OK ${resourceId}: ${fields.map((f) => f.key).join(", ")}\n`);
    }
  }

  process.stdout.write(JSON.stringify({ succeeded, failed }, null, 2));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
