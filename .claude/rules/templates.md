---
paths:
  - "templates/*.json"
---

# Page layout

`templates/page.json`, the default page, is the reference layout for every `page.*.json`
template. A page matches it when its section padding, the gap between its groups, the heading
group's gap, and every group's padding equal the reference. The body group's own gap follows its
content. Width is the one setting a page chooses: 720px, or wider when
its layout needs the room.

- Build the page as a `Mionas: Page Heading` section holding `Mionas: Group - Heading`
  (breadcrumbs, then a `Mionas: Heading Group` for the title and any intro line; Alignment Center to
  match the body), then one section with
  `Mionas: Group - Body` and any call to action as a further group. That section's top padding is
  the gap between heading and body.
- Give content its own section only when it needs a different section width. The last section
  carries the reference's bottom padding.
- When you change the reference, bring every `page.*.json` template to match in the same change.

These pages already follow the layout; copy the one closest to the page you build:

- `page.faq.json`: a call to action as a third group after the body.
- `page.contacto.json`: a body wider than 720px, for its two columns.
- `page.sobre-nosotros.json`: a full-width hero image in its own section between heading and body.
