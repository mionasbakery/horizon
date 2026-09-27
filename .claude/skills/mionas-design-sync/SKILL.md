---
name: mionas-design-sync
description: >
  Sync the Horizon Shopify theme with the Mionas design system in ../design-system, the source of
  truth, and remove the drift between them. Use when the user wants to sync, pull, or align theme
  tokens or components with the design system; when `npm run tokens:sync` fails or
  design-tokens.css looks stale; when the design system renamed, revalued, or removed a token; when
  it added or changed a component, variant, size, or prop the theme could adopt; and when editing
  files that spend design tokens (assets/design-tokens.css, snippets/design-system-bridge.liquid,
  scripts/design-tokens-contract.mjs, blocks using var(--text-role-*), var(--button-*) and the
  like). `mionas-implement-design` owns building a new mirror block in the first place.
---

# Syncing the Horizon theme with the design system

The sibling repo `../design-system` (npm package `@mionasbakery/design-tokens`) is the **source of
truth** for tokens and component design. The theme adapts to the design system, never the reverse:
when a sync reveals a mismatch, the fix belongs in the theme's contract/bridge/blocks — unless the
design-system change turns out to be accidental, which you confirm in *its* git history before
adapting to it.

A sync has two halves, and both run every time: the **token sync** brings the values across, and
the **drift review** brings the components across. A sync that copies tokens nothing spends is half
done.

## The three layers

| Layer | File(s) | Rule |
|---|---|---|
| Generated tokens | `assets/design-tokens.css` | Never hand-edit. Only the sync writes it, copying `../design-system/dist/tokens.flat.css` verbatim. |
| Contract | `scripts/design-tokens-contract.mjs` | The only place the theme hardcodes design-system token names **and values**. Mirrors every token the bridge spends. |
| Spenders | `snippets/design-system-bridge.liquid`, `assets/mionas-base.css`, blocks/sections/snippets using `var(--…)` | Reference tokens; must move together with the contract on any rename/revalue. |

The bridge maps design-system text roles onto Horizon's typography variables (`--font-h1--size`
etc.) and fixes button metrics/weight. It renders after `theme-styles-variables`, so it wins the
cascade. Only size, line-height, and letter-spacing are bridged — family, weight, and case stay in
Shopify font settings so Shopify keeps hosting and preloading the faces.

## Token sync

```sh
npm run tokens:sync   # from the theme root
```

This builds the design system, validates the contract against `dist/tokens.flat.css`, and copies it
into `assets/design-tokens.css` only if validation passes. A failed sync leaves the theme's copy
untouched — that is deliberate; don't work around it.

**In a worktree** (`~/orca/workspaces/horizon/<branch>`), `../design-system` does not exist and the
script fails to find it. Do its three steps by hand against the main checkout,
`~/projects/design-system`: `npm run build` there (if it fails with EPERM on `dist/`, rerun it
unsandboxed), validate with `findMissingTokens`/`findWrongValues` from the contract,
then copy `dist/tokens.flat.css` over `assets/design-tokens.css` and `cmp` the two. Tell the user
you ran the steps by hand.

After any sync that changed `assets/design-tokens.css`, check whether tokens the theme spends
*outside* the bridge changed too (see "Renames are silent outside the contract" below), then run
the drift review.

## Interpreting a failed sync

**Missing token** — the design system removed or renamed something the bridge spends.
1. Find what happened: `git -C ../design-system log --oneline -- 'src/**/*.json'` and grep
   `dist/tokens.flat.css` for the likely new name.
2. Renamed: update the name in `scripts/design-tokens-contract.mjs` **and** every `var()` reference
   in the theme (bridge + blocks). Removed: decide with the user what the bridge should map that
   slot to now (e.g. when the display family collapsed into `hero`, h1 was re-pointed at the hero
   role).

**Wrong value** — the token exists but doesn't carry the contract's literal.
- If the actual value is a `var(...)` reference: the source was repointed at `dist/tokens.css`
  instead of `dist/tokens.flat.css`. The flat variant exists because the theme declares some of the
  same shared names (e.g. `--letter-spacing-sm`) with different values, and a reference would
  silently resolve to the theme's value. Fix the source path, never the contract.
- If it's a new literal: the design system revalued the token. Confirm it's deliberate (design-system
  git log), then update the expected value in the contract — the contract records the design
  system's current intent; it is not a veto over it. Then re-read every comment that states the old
  value or leans on it: the bridge derivations (`--button-padding-block` is derived from height and
  line-height) and the heading-ladder comments in `assets/mionas-base.css` go stale silently.

Never "fix" a failed sync by hand-editing `assets/design-tokens.css` or deleting contract entries
to make it pass. Contract entries are pruned only when the theme genuinely stops spending a token
(that has happened: label/stamp roles were pruned when nothing bridged them).

## Renames are silent outside the contract

The contract only guards bridge tokens. Blocks spend many more, and a stale `var(--old-name)` in a
block does not error; the style just falls back to unset. So after any design-system rename or
removal:

```sh
grep -rn 'var(--<old-name>' blocks/ snippets/ sections/ assets/
```

and update every hit. When a block starts spending a token the bridge doesn't, consider whether it
is load-bearing enough to add to `EXPECTED_TOKENS` so future renames fail loudly at sync time.

## Drift review

**Drift** is any place the theme and the design system disagree about a component: a mirror that
lacks a variant, size, or prop the component now has; a theme-only variant the design system now
covers under its own name; a **lookalike** that restates a component's look in local CSS instead of
rendering the shared mirror. The goal is reuse: every `mionas-*` element that looks like a
design-system component renders that component's mirror, with the design system's names. Native
files stay untouched; a native element that drifts goes in the report as a bridge-reskin candidate
for `mionas-implement-design`.

1. **List what to compare.** Two sources, both every run:
   - **Standing check.** For every existing mirror, compare its whitelist and schema options with
     the component's current `.tsx` prop types and defaults. Drift persists across syncs, so this
     runs even when nothing new arrived.
   - **New arrivals.** Diff `assets/design-tokens.css` against `dist/tokens.flat.css` before the
     copy: a new component-token prefix or step (`--stamp-size-*`, `--button-inverse-outline-*`)
     means a new component, variant, size, or pair. Then read the design-system commits since the
     last sync for changes that add no tokens, such as a component that now composes another.

   Done when every mirror is compared and every new component, variant, size, prop, and default is
   on a list.
2. **Find every counterpart.** For each item, find its mirror (`mionas-{kebab-name}`) and its
   lookalikes in `mionas-*` files: grep the component's token prefix (`--icon-button-`, `--stamp-`) and the tokens of
   the component it composes (IconButton composes Button, so `--button-size-*` in a close button is
   a lookalike), and run a semantic search for the look itself. Then list every stored instance of
   the mirror in `templates/*.json`, section groups, and section/block `presets`, with the element
   it sits beside when the component sizes itself from a neighbour (a Stamp pairs with the text it
   labels). Done when every item has its mirror, its lookalikes, and its stored instances named, or
   an explicit "none". A component with lookalikes but no mirror gets a proposal to build one
   through `mionas-implement-design`; a component with neither is listed as not adopted.
3. **Report the drift.** One table: element, where it renders, what it uses now, the design-system
   component, variant and size it should use, and the visible effect in plain words. Close with the
   proposed changes. Apply them after the user approves, because they change live pages; technical
   choices inside that scope are yours to make.
4. **Apply.** Follow "Mirroring a design-system component in the theme" below, then "Migrating
   stored settings". Done when no `mionas-*` lookalike keeps local CSS for a look its mirror
   provides, the mirror's whitelist and
   schema carry the component's full variant and size set, and every stored instance uses a valid
   design-system value.

## Mirroring a design-system component in the theme

Design-system React components (`../design-system/src/components/`) define the look; theme blocks
and snippets reproduce it in Liquid + CSS. `blocks/mionas-feature-card.liquid` (mirroring
`FeatureCard`) is the reference example. When creating or updating a mirror:

- **Compose as the component composes.** When a component is built on another (IconButton on
  Button, Stamp on Text), its mirror renders the other's mirror (`mionas-button-class`,
  `mionas-text`) and adds only its own overrides. One class vocabulary per look, in the snippet that
  owns it, so a new variant lands everywhere at once.
- **Mirror the full set.** Expose every variant, size, and prop value the component has, even ones
  no page uses yet, and use the design system's names for them. A theme-only variant is drift the
  moment the design system gains an equivalent: retire it into the design-system name.
- Take structure, spacing, colors, and typography from the component's `.module.css` and its
  component tokens — expressed as `var(--…)` references to `assets/design-tokens.css`, not copied
  literals.
- **Fonts are the exception**: spend the theme's loaded font variables (e.g.
  `var(--font-accent--family)`), never design-system `--font-family-*` tokens. Those are inert
  strings in a stylesheet — a custom property loads no font file. They render correctly only by
  coincidence and fall back the moment the theme's font setting changes.
- A design the system hasn't tokenized yet (a color with no token): declare the literal **once** as
  a block-local custom property, and swap it for the token when the design system emits one.
- Watch for the traps a screenshot can't show: fonts that silently fall back, literals that must stay
  single-sourced, hardcoded colors that should be tokens. Check them by reading the diff — this theme
  has no test suite and none should be added.

## Migrating stored settings

When a mirror's setting values change, the stored values change with them:

- Keep the setting `id`, so each instance keeps one control and its stored key. Change the option
  values to the design-system names.
- Rewrite the value in every stored instance from the drift review's list, choosing each value from
  the instance's context (the heading a stamp sits above, the surface an icon button sits on).
  Re-parse the files afterwards and print every instance's new value to prove none was missed.
- Whitelist the values in the snippet and fall back to the component's default. The live store's
  editor-saved settings can differ from the repo, and an unmatched value would render unstyled.

## Verify before done

```sh
shopify theme check   # Liquid lint
```

Preview with `shopify theme dev`, and name the pages whose elements changed. Never
`shopify theme push` unless explicitly asked — it changes the live store.
