#!/usr/bin/env node
// Lists translatable content on the store that has no translation (or a stale/empty one) for a
// given locale. Talks to the Shopify Admin GraphQL API directly — no npm dependencies, since the
// theme repo has none and Node's built-in fetch is enough.
//
// Usage:
//   SHOPIFY_STORE_DOMAIN=my-shop.myshopify.com SHOPIFY_ADMIN_API_TOKEN=shpat_xxx \
//     node find_missing.mjs --locale ca [--types COLLECTION,PRODUCT] > report.json
//
// Requires a custom app Admin API access token with the read_translations scope, plus a read
// scope for each resource type being scanned (read_products, read_content, read_online_store_pages,
// read_online_store_navigation, read_metaobjects — Shopify enforces these per resource type).

const API_VERSION = "2025-01";

const DEFAULT_TYPES = [
  "COLLECTION",
  "PRODUCT",
  "ONLINE_STORE_PAGE",
  "ARTICLE",
  "BLOG",
  "MENU",
  "METAOBJECT",
];

function parseArgs(argv) {
  const args = { locale: null, types: DEFAULT_TYPES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--locale") args.locale = argv[++i];
    else if (argv[i] === "--types") args.types = argv[++i].split(",").map((t) => t.trim());
  }
  if (!args.locale) {
    throw new Error("Missing required --locale <code> (e.g. --locale ca)");
  }
  return args;
}

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

const SHOP_LOCALES_QUERY = `
  query ShopLocales {
    shopLocales {
      locale
      primary
      published
    }
  }
`;

const TRANSLATABLE_RESOURCES_QUERY = `
  query TranslatableResources($type: TranslatableResourceType!, $locale: String!, $cursor: String) {
    translatableResources(resourceType: $type, first: 50, after: $cursor) {
      pageInfo { hasNextPage }
      edges {
        cursor
        node {
          resourceId
          translatableContent { key value locale digest }
          translations(locale: $locale) { key value outdated }
        }
      }
    }
  }
`;

async function fetchAllForType(domain, token, type, locale) {
  const missing = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await shopifyGraphQL(domain, token, TRANSLATABLE_RESOURCES_QUERY, {
      type,
      locale,
      cursor,
    });
    const conn = data.translatableResources;

    for (const edge of conn.edges) {
      const node = edge.node;
      const existing = new Map(node.translations.map((t) => [t.key, t]));

      for (const content of node.translatableContent) {
        if (!content.value || !content.value.trim()) continue; // nothing to translate
        const translation = existing.get(content.key);
        const isMissing = !translation || !translation.value || !translation.value.trim();
        const isOutdated = translation?.outdated === true;
        if (isMissing || isOutdated) {
          missing.push({
            resourceType: type,
            resourceId: node.resourceId,
            key: content.key,
            sourceLocale: content.locale,
            sourceValue: content.value,
            digest: content.digest,
            status: isMissing ? "missing" : "outdated",
          });
        }
      }
      cursor = edge.cursor;
    }
    hasNextPage = conn.pageInfo.hasNextPage;
  }

  return missing;
}

async function main() {
  const { locale, types } = parseArgs(process.argv.slice(2));
  const domain = requireEnv("SHOPIFY_STORE_DOMAIN");
  const token = requireEnv("SHOPIFY_ADMIN_API_TOKEN");

  const localesData = await shopifyGraphQL(domain, token, SHOP_LOCALES_QUERY, {});
  const shopLocale = localesData.shopLocales.find((l) => l.locale === locale);
  if (!shopLocale) {
    const available = localesData.shopLocales.map((l) => l.locale).join(", ");
    throw new Error(`Locale "${locale}" is not enabled on this store. Available: ${available}`);
  }
  if (!shopLocale.published) {
    process.stderr.write(
      `Warning: locale "${locale}" exists but is not published (visible to customers) yet.\n`
    );
  }

  const results = [];
  for (const type of types) {
    process.stderr.write(`Scanning ${type}...\n`);
    const missing = await fetchAllForType(domain, token, type, locale);
    results.push(...missing);
    process.stderr.write(`  ${missing.length} missing/outdated field(s)\n`);
  }

  process.stdout.write(JSON.stringify({ locale, generatedCount: results.length, items: results }, null, 2));
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
