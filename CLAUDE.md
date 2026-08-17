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

## Comments

Keep comments minimal. Only write one when the WHY isn't obvious from the code — a platform
quirk, a deliberate tradeoff, a constraint that would otherwise look like an oversight. Skip
comments that restate what the code already says, narrate file history, or read like a design
doc. One or two plain sentences, no jargon — if it takes a paragraph to explain, the code likely
needs to be simpler, not the comment longer.

## Documentation

Every `mionas-*.liquid` block and snippet must start with a LiquidDoc `{% doc %}` block: a one-line
description of what it renders, plus `@param` entries. Shopify's `doc` tag is only valid in blocks
and snippets — **not** sections (`theme check` raises `UnsupportedDocTag` there) — so for
`mionas-*.liquid` sections, put the one-line description as the first line of the existing
`{% comment %}` block instead.

- **Snippets**: document the explicit params accepted via `{% render %}` calls.
- **Blocks**: document only variables consumed from the surrounding Liquid context
  (e.g. `closest.product`, `block`) — not schema settings, which are already
  self-describing in the theme editor schema.

The `{% doc %}` block (or, for sections, the description line) is additive to, not a replacement
for, existing explanatory `{% comment %}` blocks that record the *why* behind non-obvious
decisions.

## Native files

Never edit a native (non-`mionas-`prefixed) file — hard rule, no exceptions for convenience. If
native structure/schema can't express what's needed, ask the user before forking it into a
`mionas-`prefixed copy (per mionas-design-component); don't fork silently.

## Git

`origin` is `mionasbakery/horizon`. `upstream` is `Shopify/horizon` — fetch and merge from it to pull in upstream theme changes.

## Tools

Two JetBrains tools cover code navigation; prefer both over Bash. They answer different questions:

- **`mcp__jbcontext__*` — semantic search, for when you don't know the name.** Natural-language
  queries, and the only tool that reaches _other_ repos (`find_repositories`), so it is the only way
  to answer "who else consumes this?" across repo boundaries. Works without the IDE. **It indexes
  committed revisions, not your working tree** — during an in-flight rename it returns paths that no
  longer exist, so confirm a hit still exists before acting on it.
- **`mcp__idea__*` — the live project model, for when you do know the name, and for everything
  search can't do.** Exact, resolution-aware lookups (`search_symbol`, `get_symbol_info`,
  `analyze_calls` for call graphs, `include_external` for library symbols) plus diagnostics and
  edits: `get_file_problems`, `lint_files`, `reformat_file`, `rename_refactoring`, `build_project`.
  Reads the working tree, so it sees uncommitted edits. **Requires the IDE open on the project.**

**jbcontext to locate, `idea` to verify and change.** Note the jbcontext `PreToolUse` hook runs in
`--mode enforce` and blocks Bash discovery (`find`, `grep`, `git log`) until a semantic search has
run this session — so a jbcontext search comes first even when the exact lookup you want is an
`idea` call.

## Superpowers skills

- Never commit anything to git when following a superpowers skill — skip any commit steps entirely.
- Ignore the superpowers:using-git-worktrees skill — never invoke it.