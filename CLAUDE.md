# Horizon theme

Shopify Horizon theme (Liquid, theme blocks) for the `mionasbakery` store.

## Development

Use the Shopify CLI; there is no build step, and files under `assets/`, `blocks/`, `sections/`,
`snippets/` and `templates/` are served as-is.

- Preview with `shopify theme dev`. A change is done when `shopify theme check` passes.
- `shopify theme push` changes the live store: run it only when explicitly asked.

## Verification

Verify every change with `shopify theme check` and a `shopify theme dev` preview; the theme has no
test suite by design. Record a non-obvious invariant as a comment in the file it governs.

## Comments

Write a comment only for a WHY the code can't show: a platform quirk, a deliberate tradeoff, a
constraint that would otherwise look like an oversight. One or two plain sentences stating the
conclusion, about code that exists. If it needs a paragraph, simplify the code instead.

## Design

`../design-system/DESIGN.md` is the Mionas design system: tokens, text roles and component specs.
Read it before you change any block, snippet, section, template or asset.

## Native files

Edit only `mionas-`prefixed files; native files stay untouched, no exceptions for convenience. If
native structure or schema can't express what's needed, ask the user before forking it into a
`mionas-`prefixed copy (per mionas-implement-design).

## Git

`origin` is `mionasbakery/horizon`. `upstream` is `Shopify/horizon`: fetch and merge from it to pull
in upstream theme changes.

## Tools

Use `mcp__jbcontext__*` semantic search to locate code when you don't know the name (it also
searches other repos, but indexes committed code, so confirm a hit still exists). Use `mcp__idea__*`
to verify and change code you can name; it reads the working tree and needs the IDE open. A hook
blocks Bash discovery (`find`, `grep`, `git log`) until a jbcontext search has run this session.

## Superpowers skills

- Never commit anything to git when following a superpowers skill — skip any commit steps entirely.
- Ignore the superpowers:using-git-worktrees skill — never invoke it.
