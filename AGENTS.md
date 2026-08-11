# Horizon theme

Shopify Horizon theme (Liquid, theme blocks) for the `mionasbakery` store.

## Development

Use the [Shopify CLI](https://shopify.dev/docs/storefronts/themes/tools/cli) for all theme work — there is no npm/webpack build step. Files under `assets/`, `blocks/`, `sections/`, `snippets/`, and `templates/` are served to the store as-is.

- `shopify theme dev` — local dev server with hot reload against the store. This is how changes are previewed.
- `shopify theme check` — lint and validate Liquid. Run before considering a change done.
- `shopify theme pull` — sync local files down from the store.
- `shopify theme push` — publish local files to the store. Only run when explicitly asked; it changes the live store's theme.

See the [Developer tools](README.md#developer-tools) section of the README for more.

## Tests

This theme has no test suite, deliberately. Never write test files — not for Mionas components
(`mionas-*.liquid`), not for the scripts under `scripts/`, not anywhere else. Verify changes with
`shopify theme check` and a `shopify theme dev` preview instead. If something has a non-obvious
invariant, record it as a comment in the file rather than as a test.

## Git

`origin` is `mionasbakery/horizon`. `upstream` is `Shopify/horizon` — fetch and merge from it to pull in upstream theme changes.

## Superpowers skills

- Never commit anything to git when following a superpowers skill — skip any commit steps entirely.
- Ignore the superpowers:using-git-worktrees skill — never invoke it.