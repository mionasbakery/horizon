---
paths:
  - "templates/*.json"
---

# Editor labels

Give every section and block instance an explicit English `"name"` that states its role on that
page: `"Mionas: {Component} - {Role}"` for custom `mionas-*` components, `"{Component} - {Role}"`
for native ones. Leave out the role when it would repeat the component (`"Mionas: Card"`). The
"Mionas:" prefix is the only sign of a custom component in the editor tree.

# Page layout

`templates/page.json`, the default page, is the reference layout for every `page.*.json`
template. A page matches it when its section padding, the gap between its groups, the heading
group's gap, and every group's padding equal the reference. The body group's own gap follows its
content. Width is the one setting a page chooses: 720px, or wider when
its layout needs the room.

- Build the page as one section: `Mionas: Group - Heading` (breadcrumbs, title), then
  `Mionas: Group - Body`, then any call to action as a further group.
- Give content its own section only when it needs a different section width. The last section
  carries the reference's bottom padding.
- When you change the reference, bring every `page.*.json` template to match in the same change.

These pages already follow the layout; copy the one closest to the page you build:

- `page.faq.json`: a call to action as a third group after the body.
- `page.contacto.json`: a body wider than 720px, for its two columns.
- `page.sobre-nosotros.json`: a full-width hero image in its own section between heading and body.
