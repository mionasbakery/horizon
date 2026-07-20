---
name: shopify-translations
description: >
  Find, propose, and push missing or outdated Shopify content translations for a given store
  locale (collections, products, pages, blog articles, menus, metaobjects). Use this whenever the
  user asks to find untranslated content, audit translation coverage, translate collection/product
  names into a language, check what's missing for a locale like Catalan/Spanish/French, or wants
  to push translations to the store via the Admin API. This is about store *content* (data in
  Shopify's database), not the theme's own UI strings in locales/*.json — don't confuse the two.
---

# Shopify content translation audit

Store content (collection titles, product descriptions, pages, articles, menu items,
metaobjects...) lives in Shopify's database and is translated via the Admin GraphQL API's
translation system — completely separate from this theme's `locales/*.json` files, which only
cover theme UI strings (buttons, labels). If the user's request is actually about theme UI
strings, that's a normal locale-file edit, not this skill.

This skill has three steps: **find** what's missing, **propose** translations for review, then
**push** only what's approved. Never skip straight to push — translating is a judgment call
(tone, product terminology, puns in collection names) and pushing writes to the live store, so a
human must see every value before it goes out.

## Prerequisites: Admin API credentials

The scripts need `SHOPIFY_STORE_DOMAIN` (e.g. `mionasbakery.myshopify.com`) and
`SHOPIFY_ADMIN_API_TOKEN` in the environment. Check for them first:

```sh
[ -n "$SHOPIFY_STORE_DOMAIN" ] && [ -n "$SHOPIFY_ADMIN_API_TOKEN" ] && echo present
```

If missing, tell the user they need a custom app Admin API access token (Shopify admin →
Settings → Apps and sales channels → Develop apps → create/select an app → Configure Admin API
scopes) with `read_translations` + `write_translations`, plus a read scope per resource type
being scanned (`read_products`, `read_content` for pages/articles, `read_online_store_navigation`
for menus, `read_metaobjects`). Ask them to export both env vars, then continue — do not ask them
to paste the token into chat; have them set it in their shell.

## Step 1 — Find missing translations

Run the finder for the requested locale:

```sh
node .claude/skills/shopify-translations/scripts/find_missing.mjs --locale ca \
  > .claude/skills/shopify-translations/reports/ca-missing.json
```

`--types` optionally narrows the scan (default covers COLLECTION, PRODUCT, ONLINE_STORE_PAGE,
ARTICLE, BLOG, MENU, METAOBJECT) — pass a comma list like `--types COLLECTION,PRODUCT` if the user
only cares about a subset. The script errors out clearly if the locale isn't enabled on the store,
listing what is.

Summarize the report to the user grouped by resource type and status (`missing` vs `outdated` —
outdated means the source content changed since it was last translated), e.g.:

> Catalan (ca): 12 missing, 3 outdated
> - Collections: 5 missing (Pans, Galetes, ...)
> - Products: 7 missing, 3 outdated

Reports are gitignored scratch data (`reports/`) — regenerate rather than trust a stale one if
significant time has passed or the user has edited content since.

## Step 2 — Propose translations and review

For each item in the report, draft a translation from `sourceValue` into the target locale
yourself — you're a capable translator, this doesn't need an external service. Keep the store's
existing voice: check a couple of already-translated sibling items (e.g. other collection titles
already in `ca`) for tone/register before drafting new ones, and preserve product/brand names that
shouldn't be translated (e.g. proper nouns, the "Mionas" brand itself).

Present the full proposed list to the user in one pass — a table of resource / field / original /
proposed translation reads best — and ask them to confirm, edit, or drop entries. Don't push
anything until they've reviewed the whole batch; this is store content customers will see, and
translation nuance is exactly the kind of thing worth a human pass.

Once approved, write the final set to a JSON file the push script can consume — same shape as the
report's `items`, but with `value` set to the approved translation and any dropped items removed:

```json
[
  { "resourceId": "gid://shopify/Collection/123", "key": "title", "locale": "ca", "value": "Pans", "digest": "..." }
]
```

(`resourceId`, `key`, `locale`, and `digest` carry over unchanged from the report — only `value`
is new.)

## Step 3 — Push approved translations

```sh
node .claude/skills/shopify-translations/scripts/push_translations.mjs \
  .claude/skills/shopify-translations/reports/ca-approved.json
```

This is the one irreversible, store-visible step — confirm with the user that the approved file
is final before running it (per the standing rule on actions with real-world side effects). The
script reports per-resource success/failure to stderr and a `{succeeded, failed}` summary to
stdout; if anything fails (e.g. a stale digest because content changed mid-review), report which
items failed and re-run step 1 for just those to get a fresh digest before retrying.
