---
paths:
  - "**/*mionas-*.liquid"
---

# LiquidDoc

Every `mionas-*.liquid` block and snippet starts with a LiquidDoc `{% doc %}` block: a one-line
description of what it renders, plus `@param` entries.

- **Snippets**: document the explicit params accepted via `{% render %}` calls.
- **Blocks**: document only variables consumed from the surrounding Liquid context
  (e.g. `closest.product`, `block`); schema settings already describe themselves in the editor.
- **Sections**: `doc` is invalid there (`theme check` raises `UnsupportedDocTag`), so put the
  one-line description as the first line of the existing `{% comment %}` block.

The `{% doc %}` block adds to the explanatory `{% comment %}` blocks that record the *why* behind
non-obvious decisions; keep those.
