---
paths:
  - "**/*mionas-*.liquid"
  - "snippets/*-bridge.liquid"
  - "assets/mionas-*.css"
---

# Where CSS goes

Shopify subsets `compiled_assets/styles.css` to the page's **render tree**: a file's
`{% stylesheet %}` CSS ships only on pages that render that file. Put each rule where the render
tree carries it to every element that wears its classes.

- **Component CSS**: `{% stylesheet %}` in the file that emits the classes. Snippets take one
  too. When several blocks share a class vocabulary, the rules live in the snippet they all
  render (`mionas-text`, `mionas-stamp`, `mionas-button-class`), never in one of the blocks. A
  block that wears classes from a CSS file outside its render tree renders unstyled on any page
  where that file is absent, and it looks fine wherever that file happens to render (the footer
  renders several).
- **Shared class vocabularies**: build the classes by rendering their snippet
  (`{% render 'mionas-button-class', ... %}`). That render is also what ships the CSS, so a
  hand-written `'mionas-button mionas-button--sm'` string is a page without button rules.
- **Liquid-dependent CSS** (settings values, `font_face`, per-instance values): `{% style %}`.
  Its output lands in the HTML byte for byte, so explain rules with `{%- comment -%}`, which
  Shopify strips. Everything static leaves the block.
- **Global static CSS with no component to go with**: `assets/mionas-base.css`, linked from
  `snippets/design-system-bridge.liquid` after `base.css`. It holds overrides of Horizon's own
  variables and reskins of native components, whose files stay untouched. Keep it to that: every
  rule in it costs every page. CSS comments are fine there; the CDN minifies the file.

Rules that override a class from another file use a two-class selector (`.text-role.mionas-price`),
because the order of files inside the compiled stylesheet is not fixed.
