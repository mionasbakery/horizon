---
name: mionas-design-component
description: >
  Bring a Mionas design-system (../design-system) look into the Horizon theme, whether that means
  reskinning an existing native section/block to match it, importing a design-system component as a
  new section/block/snippet, or creating a brand-new Mionas-only component when no matching one
  exists there yet. Use whenever the user asks to add, build, create, port, align, or reskin a
  component/section/block to match the design system or "Mionas" styling, mentions a design-system
  component by name (Button, Card, ProductCard, SplitHero, Footer, Nav, Form, TextField, etc.), or
  wants a new theme component styled to match the Mionas design language even without naming a
  specific source. Governs two decisions every time: (1) reskin the native file via a CSS bridge and
  settings JSON — the default when Horizon's existing structure already covers the need — versus
  forking a new file, only when the native structure/schema genuinely can't express the design; (2)
  when forking, name the new file mionas-{name}.{extension} with theme-editor label "Mionas: {name}",
  and never edit an existing native (non-mionas-prefixed) .liquid template to satisfy the request
  unless the user has explicitly said to modify that file.
---

# Building Mionas components in the Horizon theme

This skill covers the *shape* of the work: deciding what kind of file to create, naming it, and
keeping it separate from Shopify's native theme files. For the *substance* — which design tokens to
spend, how to bridge typography, how fonts work, contract-test patterns — defer to the
`mionas-design-sync` skill's "Mirroring a design-system component in the theme" section. Read it
before building anything; don't duplicate that guidance here.

## Two entry points

**Importing an existing component.** The user names something that already exists in
`../design-system/src/react/` (Button, Card, ProductCard, SplitHero, Footer, Nav, Form, TextField,
Checkbox, IconButton, Link, List, Box, Text, ...). Read the component's `.tsx` and `.module.css`
there before writing any Liquid — that's the source of truth for structure, states, and spacing, not
a guess from the name.

**Creating something new.** The user wants a component that doesn't exist in the design system yet,
but should look and feel like it belongs — same spacing scale, same color roles, same type roles.
Build it in the theme using existing tokens plus block-local custom properties for anything not yet
tokenized (`mionas-design-sync` explains this pattern). Because the design system is the source of
truth, a genuinely new pattern shouldn't live in the theme alone forever: after building it, ask the
user whether it's worth proposing back into `../design-system` as a real component. Only start
editing files in `../design-system` after they say yes — that's a second repo with its own history
and consumers, so it deserves an explicit decision, not an assumption.

## First question: does this need a new file at all?

Before scaffolding anything, check whether Horizon already has a native section/block that covers
the same job structurally (a footer, a menu, a text block, a hero). If it does, the default —
proven out in this theme for the footer and header nav — is to **reskin it in place, not fork it**:

- Extend `snippets/design-system-bridge.liquid` (global tokens) or a component-scoped bridge like
  `snippets/header-bridge.liquid` with `{% style %}` rules that re-point CSS custom properties on
  the native file's existing classes, rendered from `layout/theme.liquid`.
- Change only *configuration* — a section group's settings JSON (e.g. `sections/footer-group.json`),
  block settings, `templates/*.json` — never the section/block `.liquid` template's markup or logic.
  Editing this JSON is normal merchant configuration, not "overriding a native component"; the
  guardrail below is about template files, not settings data.
- Check for an existing mechanism before writing new CSS: e.g. `snippets/contrast-override.liquid`
  already auto-inverts text/link/icon color when a section's `background_color` doesn't contrast —
  setting a color in settings JSON can be enough by itself, no new bridge rule needed.

This keeps the theme's merge surface with `upstream` (`Shopify/horizon`) small — see the footer
integration (`docs/superpowers/specs/2026-07-19-footer-design-system-integration-design.md`), which
explicitly chose "reskin, not structural port" specifically to avoid taking on conflict risk on
every future Horizon update for a fidelity gain the user didn't need. Confirm this reskin-only
scope decision with the user when a native structural difference (e.g. an asymmetric grid, a layout
the settings schema can't express) is tempting to chase — that's a real tradeoff, not a default.

**Fork a new file only when the native template's structure or schema genuinely can't express what's
needed** — new settings, new markup, a layout the existing block can't produce. (Past example: the
now-removed `mionas-split-hero.liquid` forked because no combination of settings on Horizon's
native hero block could produce a full-bleed two-color panel with an inverse button.) That's the
bar to clear before creating a new file instead of reskinning.

## Deciding section, block, or snippet

When a fork is warranted, Horizon's architecture already draws this line; match the component to it
rather than defaulting to whatever feels easiest:

- **Section** — a page-level composition with its own settings, meant to be added/removed/reordered
  in the theme editor's section list (`sections/`). Use this when the design-system component *is*
  a page region (e.g. a Footer, a full hero).
- **Block** — a reusable piece placed inside a section, with its own schema and `block.shopify_attributes`
  (`blocks/`). Most design-system components map here — Button, Card, ProductCard, SplitHero are all
  blocks, not sections, because they compose *into* something else.
- **Snippet** — plain reusable markup with no editor presence, `{% render %}`-ed from a section/block
  (`snippets/`). Use this for something the design system exposes as a component but that never
  needs independent settings in the editor — a pure visual primitive rendered by other Mionas blocks,
  or a bridge like `design-system-bridge.liquid` itself.

If genuinely unsure, look at how the equivalent native Horizon file is structured (e.g. `blocks/button.liquid`
for a button-like component) — same shape, new name and Mionas styling.

## Naming convention

Every new file this skill creates, regardless of type, is named:

```
mionas-{name}.{extension}
```

e.g. `blocks/mionas-product-card.liquid`, `sections/mionas-footer.liquid`,
`snippets/mionas-icon-button.liquid`. Use kebab-case for `{name}`, matching the design-system
component's own name (ProductCard → `mionas-product-card`).

Sections and blocks are visible in the theme editor via their schema's `"name"` field — set it
literally to `"Mionas: {Name}"` (e.g. `"Mionas: Product card"`), not a `t:` locale key. Native
Horizon sections/blocks use `t:names.*` locale lookups; Mionas components use a plain string so
they're unmistakable in the editor's block/section picker regardless of locale coverage. If the
component has a `presets` entry, name that the same way.

Snippets have no schema and thus no editor label — the `mionas-` file prefix is the only marker, and
it's enough: anyone grepping `snippets/` or reading a `{% render 'mionas-...' %}` call knows
immediately this isn't a native Shopify file.

`blocks/mionas-text.liquid` (editor label `"Mionas: Text role"`, deliberately distinct from
Horizon's own `blocks/text.liquid`/`"Text"` block, told apart by both filename and label) is a
reference example of this convention applied — it was renamed into it from an earlier native-style
name (`text-role.liquid` → `mionas-text-role.liquid` → `mionas-text.liquid`). Renaming an existing
component's file and schema `"name"`/`presets` touches
every `"type"` reference to it across templates and any block/section that whitelists it as a child
block type (`grep -rn '"type": "<old-name>"'` across `templates/`, `sections/`, `blocks/`), plus any
contract test resolving its file path — treat a rename with the same care as creating a new file,
and only do it when the user has explicitly asked.

## Never fork or edit native *template* files without being asked

"Native" here means any section/block/snippet `.liquid` template that isn't `mionas-`-prefixed —
Shopify's upstream Horizon files, still fetched and merged from `Shopify/horizon` per this repo's
CLAUDE.md, or the theme's own pre-existing customizations. This guardrail is specifically about
template markup/logic — editing settings JSON to configure a native section (colors, block order,
copy) is normal and expected, covered in "does this need a new file at all?" above, not this rule.

So once you've concluded a fork actually is warranted (native structure can't express the need):

1. Default to creating `mionas-product-card.liquid` as the new file — never edit the native
   `.liquid` template in place — and point the section/preset/settings at the new one where
   relevant, so the native file is left untouched and mergeable with upstream.
2. Only edit a native `.liquid` template directly if the user has explicitly said to change/override
   that specific file — don't infer permission from "this seems like a small tweak," and don't
   infer it from a fork being the "obvious" choice either; check with the user if a reskin genuinely
   seems insufficient but you're not certain.
3. If you're unsure whether something counts as "the native file" (e.g. it's already been modified
   before), check `git log --oneline -- <path>` — if commits predate any Mionas-specific work, treat
   it as native and follow the same-name rule above.

## Building the component

**Reskinning natively** (from "does this need a new file at all?" above): follow
`header-bridge.liquid`'s pattern — a `{% style %}` block re-pointing CSS custom properties onto the
native file's existing classes, with a comment explaining *why* each override is needed (specificity
quirks, which breakpoint/variant it targets, what it deliberately leaves alone). No new naming or
schema is involved; the settings JSON changes are just data.

**Forking a new file:**

1. Read the design-system source (`.tsx` + `.module.css`) or, for a new pattern, agree the visual
   spec with the user before writing Liquid.
2. Scaffold the file under the right directory with the `mionas-` name, schema `"name"`, and
   `presets` (if a block) per the naming convention above.
3. Spend design tokens via `var(--...)`, following `mionas-design-sync`'s rules — never hardcode a
   value the design system already tokenizes, and never spend a design-system `--font-family-*`
   token directly (fonts route through the theme's loaded font settings).
4. For anything visual the design system hasn't tokenized yet, declare a block-local custom property
   once, clearly commented as a placeholder for a future token.
5. If the component has non-obvious invariants a screenshot can't show (a font that could silently
   fall back, a literal that must stay single-sourced), record them in a comment at the top of the
   file. Do not add test files — this theme has no test suite.

## Verify before done

```sh
shopify theme check   # Liquid lint
```

Preview with `shopify theme dev` and check the component renders and is selectable in the theme
editor under its "Mionas: {Name}" label. Never run `shopify theme push` unless explicitly asked —
it changes the live store.
