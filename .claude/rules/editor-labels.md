---
paths:
  - "blocks/*.liquid"
  - "sections/*.liquid"
  - "sections/*.json"
  - "templates/*.json"
---

# Editor labels

Every theme editor label names the file behind it, so a native `group` and a `mionas-group` can
never be confused. Write every label in Title Case, with short joining words (a, and, of, or,
the, to, y, de) in lower case.

- **Schema and preset `"name"`** of a `mionas-*` file: `"Mionas: "` plus the file name without
  `_` and `mionas-`, hyphens as spaces: `_mionas-newsletter-link.liquid` →
  `"Mionas: Newsletter Link"`. A preset that is a variant of its file adds
  `": {Variant}"`, as Horizon does with `"Hero: Marquee"`. Theme check caps a schema name at 25
  characters, so choose a file name with at most 17 characters after `mionas-`; rename the file
  rather than shorten the label.
- **Instance `"name"`** in `templates/*.json`, `sections/*.json` and presets: the component's
  label, plus `" - {Role}"` in 2 cases. First, when its parent holds another block of the same
  component: every one of them gets a different role, `"Mionas: Group - Heading"` beside
  `"Mionas: Group - Body"`. Second, when it is a container whose label says nothing about what it
  holds: Section, Group, Mionas: Group, Custom Liquid, Mionas: Split Panel, Mionas: Collection,
  Featured Collection. Every other block is the label alone (`"Mionas: Text"`). A native component
  uses its Horizon label in Title Case with no prefix: `"Group - Image"`.
- **Role**: plain English words for what the visitor sees there, written in full: `"Opening
  Hours"`, `"Call to Action Heading"`, `"Introduction"`, `"Responsive Styles"`. Abbreviations
  (CTA, CSS, Info, Intro) and design jargon (eyebrow, kicker, lead, copy) hide what the block
  holds.

The label always starts with the component: a role alone (`"Heading"`) or a role in the
component's place (`"Mionas: Title"` on a `mionas-text`) hides which file renders the block.
