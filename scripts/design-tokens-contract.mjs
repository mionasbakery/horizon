// The contract between ../design-system and this theme's snippets/design-system-bridge.liquid
// (with the assets/mionas-base.css it links): every token the bridge spends, and the exact value it must carry.
//
// This is the ONLY place the theme hardcodes design-system token names or values. If the design
// system renames or revalues a token, change it here and in the bridge snippet's var() references.
//
// Values are asserted, not just presence, and that is deliberate. A token can exist, be spelled
// correctly, match the contract by name, and still be wrong: --text-role-*-letter-spacing once
// rendered 0.06em instead of 0.02em because the design system emitted var(--letter-spacing-sm)
// and this theme declares that same name with its own value. Only a value check catches that.
// That specific collision is dormant now, but it is why the source is dist/tokens.flat.css and not
// dist/tokens.css: flat resolves every reference to a literal, so a name both sides declare can
// never quietly bind to the theme's value. Repointing at the unflattened file brings the whole
// class of bug back.
export const EXPECTED_TOKENS = {
  // The five variants pinned in full are the ones assets/mionas-base.css builds Horizon's h1-h6
  // ladder and paragraph from. A revalue upstream reshapes every native heading on the store, so
  // it should fail the sync and be looked at rather than land silently.
  "--text-role-display-font-size": "clamp(36px, 30.86px + 1.429vw, 48px)",
  "--text-role-display-line-height": "clamp(40px, 34.86px + 1.429vw, 52px)",
  "--text-role-display-letter-spacing": "-0.02em",
  "--text-role-heading-font-size": "clamp(28px, 26.29px + 0.476vw, 32px)",
  "--text-role-heading-line-height": "clamp(34px, 32.29px + 0.476vw, 38px)",
  "--text-role-heading-letter-spacing": "-0.01em",
  "--text-role-subheading-font-size": "22px",
  "--text-role-subheading-line-height": "28px",
  "--text-role-subheading-letter-spacing": "0",
  "--text-role-title-font-size": "18px",
  "--text-role-title-line-height": "24px",
  "--text-role-title-letter-spacing": "0",
  "--text-role-body-font-size": "16px",
  "--text-role-body-line-height": "24px",
  "--text-role-body-letter-spacing": "0",
  // blocks/mionas-text.liquid exposes all seven variants, so the theme spends every axis of every
  // one. Pinning them all would make this file a copy of the token file, so beyond the ladder only
  // what is load-bearing for another reason is pinned: the 500 label weight below, the title weight
  // the native card price takes, and the label sizes the form mirrors spend directly.
  "--text-role-label-font-weight": "500",
  "--text-role-title-font-weight": "700",
  // Button metrics, not type presets.
  "--button-size-md-height": "48px",
  "--button-size-md-padding": "24px",
  // Not a button token any more -- the bridge's button rule now spends --button-base-font-weight.
  // Still pinned because blocks/mionas-contact-form.liquid and sections/product-information.liquid
  // spend it directly.
  "--font-weight-semibold": "600",
  // The design system's two font-family primitives, repointed at the theme's loaded faces by
  // snippets/design-system-bridge.liquid. Pinned by value, because the bridge's mapping is a
  // judgement about which physical typeface each one names: if the design system re-points
  // --font-family-archivo at some other stack, mapping it to --font-body--family may well be the
  // wrong answer, and that should fail the sync rather than keep quietly resolving.
  //
  // Only these two. Every component family token (--link-base-font-family,
  // --card-base-font-family, --button-base-font-family, --text-field-base-font-family) is a
  // var() reference to one of them in tokens.flat.css -- fontFamily is the one type the design
  // system deliberately leaves unflattened, precisely so consumers override two names instead of
  // every component's own. Pinning those here would assert a literal against a var() and fail.
  "--font-family-archivo": "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif",
  "--font-family-oswald": "Oswald, 'Arial Narrow', sans-serif",
  // Link: the weight is spent by snippets/mionas-link.liquid, which the breadcrumbs and the footer
  // links render.
  "--link-base-font-weight": "500",
  // Every "500" above is load-bearing beyond its own colour/size: snippets/design-system-bridge
  // .liquid emits an extra Archivo 500 @font-face solely because these tokens ask for a weight
  // none of the theme's four font settings load. Should the design system move any of them off
  // 500, this contract fails, and the question to re-ask is whether that font-face is still
  // needed at all -- not just what number to retype here.
  "--button-base-font-weight": "500",
  // Product card surface + layout, spent by the product card rules in
  // assets/mionas-base.css and templates/*.json. --card-base-* are
  // Card's tokens, reused because ProductCard renders inside a Card.
  "--card-base-background": "#ffffff",
  "--card-base-border-width": "1px",
  "--card-base-border-color": "#ece8e2",
  "--card-base-radius": "16px",
  "--card-base-shadow": "0 1px 2px rgba(0, 0, 0, 0.08)",
  "--card-base-padding": "16px",
  "--card-title-font-weight": "600",
  "--card-title-foreground": "#101413",
  "--product-card-base-media-inset": "12px",
  "--product-card-base-media-radius": "12px",
  "--product-card-base-gap": "16px",
  "--product-card-base-padding-inline": "16px",
  // --product-card-base-media-height was pinned here for a Mionas card block that owned its own
  // media height. That block has been deleted and no file spends the token any more, so the pin is
  // gone with it. The two media tokens above (--product-card-base-media-inset and
  // --product-card-base-media-radius) are a different case: they are still pinned but deliberately
  // unspent -- the theme frames card media flush and square-cornered rather than inset, a knowing
  // divergence documented in assets/mionas-base.css's media comment. They
  // stay pinned so that divergence is measured against a known value rather than a moving one.
  //
  // --card-state-pressed-opacity IS spent, by assets/mionas-base.css's :active rule.
  "--card-state-pressed-opacity": "0.92",
  // Secondary body text, spent by blocks/mionas-contact-form.liquid's note and
  // blocks/mionas-divider.liquid. Card's own token rather than a borrowed --form-label-* one, since
  // neither is a form label.
  "--card-description-foreground": "#687076",
  // The foundation secondary-text colour, spent by Text's secondary colour in
  // snippets/mionas-text.liquid, which the breadcrumb separator, the map's empty state and the
  // submit-button note render.
  "--text-color-secondary": "#687076",
  // Form surface, spent by the snippets/mionas-form*.liquid, mionas-text-field.liquid and
  // mionas-checkbox.liquid family (blocks/mionas-contact-form.liquid composes them and no longer
  // spends these directly). Every one of Form, FormField, FormLabel, FormError, FormActions,
  // TextField and Checkbox in ../design-system/src/components/ now has a mirror here, so the whole
  // --form-* / --text-field-* / --checkbox-* group is spent rather than the subset one block needed.
  //
  // --form-field-state-focused-foreground is no longer "redundant with the label's focused
  // foreground": snippets/mionas-form-field.liquid assigns it to --form-label-focus-color on
  // :focus-within, which is the design system's own mechanism for colouring a label that precedes
  // its control in the DOM. --form-label-base-padding and --text-field-state-disabled-opacity are
  // likewise spent now, by mionas-form-label.liquid and mionas-text-field.liquid respectively.
  //
  // --text-field-base-font-family is absent for the same reason every component family token is:
  // it resolves through --font-family-archivo, pinned above, which the bridge repoints.
  "--form-field-base-border-width": "1px",
  "--form-field-base-border-color": "rgba(11, 7, 140, 0.14)",
  "--form-field-base-padding": "8px",
  "--form-field-state-focused-border-color": "#0b078c",
  "--form-field-state-focused-foreground": "#0b078c",
  "--form-field-state-error-border-color": "#af200b",
  "--form-label-base-foreground": "#687076",
  "--form-label-base-padding": "16px",
  "--form-label-state-focused-foreground": "#0b078c",
  "--form-label-state-error-foreground": "#af200b",
  "--form-error-base-foreground": "#af200b",
  "--form-error-base-padding": "16px",
  "--form-actions-base-padding": "16px",
  "--text-field-base-foreground": "#101413",
  "--text-field-base-font-size": "16px",
  "--text-field-base-line-height": "24px",
  "--text-field-base-padding": "16px",
  "--text-field-state-disabled-opacity": "0.5",
  // Checkbox, spent by snippets/mionas-checkbox.liquid. --checkbox-checked-* has no "unchecked"
  // counterpart on purpose: the base tokens above are the unchecked look.
  "--checkbox-base-size": "20px",
  "--checkbox-base-radius": "6px",
  "--checkbox-base-border-width": "1px",
  "--checkbox-base-border-color": "rgba(17, 24, 28, 0.08)",
  "--checkbox-base-background": "#ffffff",
  "--checkbox-base-padding": "4px",
  "--checkbox-row-padding": "8px",
  "--checkbox-start-padding": "16px",
  "--checkbox-checked-background": "#0b078c",
  "--checkbox-checked-border-color": "#0b078c",
  "--checkbox-checked-foreground": "#ffffff",
  "--checkbox-state-disabled-opacity": "0.5",
  "--checkbox-state-focused-border-color": "#0b078c",
  // Completes the label and body variants, which the form mirrors render through
  // snippets/mionas-text.liquid: FormLabel.tsx and FormError.tsx render <Text variant="label">, and
  // Checkbox.tsx renders its text label at variant="body". The axes already pinned above are not
  // repeated here; a duplicate key would silently shadow the earlier entry.
  "--text-role-label-font-size": "13px",
  "--text-role-label-line-height": "18px",
  "--text-role-label-letter-spacing": "0.02em",
  "--text-role-body-font-weight": "400",
  // Stamp, spent by snippets/mionas-stamp.liquid. Each --stamp-size-* pair is a Text variant's
  // font-size and line-height. The stored stamps use body, label and note, so those are pinned:
  // a revalue there resizes every eyebrow and date on the site.
  //
  // --stamp-base-font-family is absent for the reason every component family token is: it is a
  // var() reference to --font-family-oswald, which the bridge repoints, so pinning it would
  // assert a literal against a var() and fail.
  "--stamp-base-font-weight": "600",
  "--stamp-base-letter-spacing": "0.05em",
  "--stamp-base-text-transform": "uppercase",
  "--stamp-size-body-font-size": "16px",
  "--stamp-size-body-line-height": "24px",
  "--stamp-size-label-font-size": "13px",
  "--stamp-size-label-line-height": "18px",
  "--stamp-size-note-font-size": "11px",
  "--stamp-size-note-line-height": "14px",
  // The note variant, spent by snippets/mionas-text.liquid (the price tax note, the signup consent
  // text) and snippets/mionas-link.liquid.
  "--text-role-note-font-size": "11px",
  "--text-role-note-line-height": "14px",
  "--text-role-note-font-weight": "500",
  "--text-role-note-letter-spacing": "0.02em",
  "--link-note-font-weight": "600",
  // HeadingGroup, spent by blocks/mionas-heading-group.liquid.
  "--heading-group-base-gap": "8px",
  // The three foundation font-size steps the theme spends raw, outside any role: the corporate
  // form, figure and offer card fine print, and the localization form. The steps are named for their px value
  // now (--font-size-xs became --font-size-13), so the name asserts the value -- a --font-size-13
  // that stopped being 13px is worth failing the sync over in a way --font-size-xs never was.
  "--font-size-13": "13px",
  "--font-size-18": "18px",
  "--font-size-22": "22px",
  // The mega menu, spent by blocks/mionas-header-menu.liquid (the desktop dropdown and the
  // drawer's card rows) via snippets/mionas-header-menu-panel.liquid.
  //
  // This whole group replaces the --nav-*/--nav-link-* tokens the design system deleted in
  // b6bc96d when it split Nav into Navbar + MegaMenu. Only ONE of those was ever spent here
  // (--nav-link-state-hover-foreground, in the card's label-hover rule) and it was not in this
  // contract, so the sync that removed it passed clean and the hover colour silently stopped
  // applying. That is the argument for pinning the replacements: the contract can only fail
  // loudly on tokens it knows about.
  //
  // ONLY THE GAP IS LEFT OF --mega-menu-base-*. This group briefly held -shadow, -border-width,
  // -border-color and -padding as well. They were pruned when the panel stopped painting a surface
  // of its own: it has no background, no drop shadow and no hairline, and it takes its padding from
  // the native .menu-list__submenu-inner. Nothing in the theme spends those four any more, and the
  // rule for this file is that an entry exists only while the theme actually spends the token --
  // keeping them would make the sync fail over a token no block reads. --mega-menu-base-background
  // was never here for a related reason.
  //
  // Also absent: every --mega-menu-link-*, which the theme does not spend because the mobile
  // overflow list runs on Horizon's own --menu-* settings.
  //
  // The top-level bar takes its size from the body variant and its weight from NavbarItem's own
  // token, which blocks/mionas-header-menu.liquid spends. NavbarItem's foregrounds stay unspent so
  // the nav's colours remain the merchant's, and its family stays on Shopify's font settings so
  // Shopify keeps hosting and preloading the face.
  //
  // Nor is there a label-to-chevron gap entry any more. --navbar-item-base-gap fed one until the
  // split removed that token, then --space-2xs did; both read as too much space on the rendered nav,
  // because .svg-wrapper's box is already wider than the caret it draws. The chevron rule in
  // blocks/mionas-header-menu.liquid now sets no gap at all. If the separated disclosure component
  // ever ships its own gap token, check it against the real nav before adopting it -- this is a case
  // where the design system's value and this theme's icon asset disagree about who owns the spacing.
  "--mega-menu-base-gap": "16px",
  "--navbar-item-base-font-weight": "600",
  // The drawer's group heading and the category rail beneath it, spent by
  // blocks/mionas-header-menu.liquid. No --mega-menu-base-padding-inline: MegaMenu insets both the
  // heading and the rail by it, but every row in this drawer sits at the list edge, so the theme
  // zeroes the pair rather than adopting the 8px on one side only.
  "--mega-menu-heading-height": "44px",
  "--mega-menu-heading-font-weight": "600",
  "--mega-menu-heading-foreground": "#101413",
  "--mega-menu-categories-border-width": "2px",
  "--mega-menu-categories-border-color": "#ece8e2",
  "--mega-menu-categories-padding": "12px",
  // Pinned by value because both are load-bearing past their own rule: the item gap is the only
  // thing setting the card's media-to-label rhythm now that the tagline is gone, and the media
  // radius is deliberately radius.md against the card's radius.lg -- collapsing them back to one
  // value is the mistake this entry exists to catch.
  "--mega-menu-item-base-gap": "12px",
  "--mega-menu-item-base-padding": "8px",
  "--mega-menu-item-base-radius": "12px",
  "--mega-menu-item-base-media-height": "110px",
  // The drawer thumbnail. Pinned by value because snippets/mionas-header-menu-panel.liquid asks
  // the browser for this exact width in its `sizes` attribute and cannot read the token, so a
  // revalue here silently leaves that request wrong.
  "--mega-menu-item-base-media-size": "44px",
  "--mega-menu-item-base-media-radius": "8px",
  "--mega-menu-item-base-media-background": "#ece8e2",
  // 600, over the body variant's 400. Pinned for the font-face reason the "every 500 above is
  // load-bearing" note gives: a change here is a question about which Archivo faces the theme
  // loads, not just a number to retype.
  "--mega-menu-item-label-font-weight": "600",
  "--mega-menu-item-label-foreground": "#101413",
  // No --mega-menu-item-description-foreground: MegaMenuItem dropped its description slot and the
  // theme's card dropped its tagline with it, so nothing spends a secondary colour here now.
  "--mega-menu-item-state-hover-foreground": "#0b078c",
  "--mega-menu-item-state-hover-scale": "1.05",
  "--mega-menu-item-state-pressed-opacity": "0.92",
  // FAQ accordion, spent by blocks/mionas-faq.liquid (dividers) and
  // blocks/_mionas-faq-question.liquid (layout + caret). Mirrors
  // ../design-system/src/components/Faq + FaqQuestion. Question and answer both render
  // at the body variant (pinned above); the header's only own type token is the
  // question's semibold weight, and the caret centering spends
  // --text-role-body-line-height directly.
  "--faq-base-divider-color": "#ece8e2",
  "--faq-base-divider-width": "1px",
  "--faq-question-header-font-weight": "600",
  "--faq-question-header-padding-block": "16px",
  "--faq-question-header-gap": "12px",
  "--faq-question-header-icon-size": "16px",
  "--faq-question-content-padding-block-end": "16px",
  // Button press, spent by snippets/mionas-button-class.liquid, which every button and icon button
  // renders. Pinned because the opacity's meaning depends on the model: it is the
  // strength of a currentColor tint, and was once the whole button's opacity at 0.92.
  "--button-state-pressed-opacity": "0.16",
  "--button-state-pressed-scale": "0.97",
  "--button-state-pressed-duration": "80ms",
  "--button-base-duration": "220ms",
  // Hover and focus, spent by the same snippet. The hover opacity is the same currentColor tint.
  "--button-state-hover-opacity": "0.08",
  "--button-state-focused-border-width": "2px",
  "--button-state-focused-border-color": "#0b078c",
  "--button-state-focused-inverse-border-color": "#ffffff",
  // The IconButton sizes the theme spends: sm on the dialog close and the social links, md as the
  // Mionas: Icon Button default. Their box heights are the Button heights.
  "--icon-button-size-sm-icon-size": "20px",
  "--icon-button-size-md-icon-size": "24px",
  // BottomSheet, Dialog and CornerFold, spent by snippets/mionas-bottom-sheet.liquid,
  // mionas-dialog.liquid and mionas-corner-fold.liquid, which the newsletter dialog, the signup
  // confirmation and the newsletter's corner fold render. Pinned because a block that loses one of
  // these does not error: the dialog or the fold just renders without its surface or its motion.
  "--bottom-sheet-base-background": "#f7f2e3",
  "--bottom-sheet-base-foreground": "#101413",
  "--bottom-sheet-base-radius": "16px",
  "--bottom-sheet-base-shadow": "0 18px 36px rgba(17, 24, 28, 0.14)",
  "--bottom-sheet-frame-padding": "8px",
  "--bottom-sheet-backdrop-background": "rgba(16, 20, 19, 0.66)",
  "--bottom-sheet-handle-height": "40px",
  "--bottom-sheet-handle-padding": "4px",
  "--bottom-sheet-grabber-width": "36px",
  "--bottom-sheet-grabber-height": "5px",
  "--bottom-sheet-grabber-radius": "999px",
  "--bottom-sheet-grabber-background": "#cfcac2",
  "--bottom-sheet-state-focused-border-width": "2px",
  "--bottom-sheet-state-focused-border-color": "#0b078c",
  "--bottom-sheet-state-entering-duration": "500ms",
  "--bottom-sheet-state-entering-easing": "cubic-bezier(0.2, 0, 0, 1)",
  "--bottom-sheet-state-exiting-duration": "300ms",
  "--bottom-sheet-state-exiting-easing": "cubic-bezier(0.5, 0, 0.75, 0)",
  "--dialog-close-padding": "16px",
  "--dialog-close-foreground": "#101413",
  "--dialog-state-entering-duration": "300ms",
  "--dialog-state-entering-easing": "cubic-bezier(0.2, 0, 0, 1)",
  "--dialog-state-entering-scale": "0.96",
  "--dialog-state-exiting-duration": "220ms",
  "--dialog-state-exiting-easing": "cubic-bezier(0.5, 0, 0.75, 0)",
  "--corner-fold-base-background": "#0b078c",
  "--corner-fold-base-foreground": "#ffffff",
  "--corner-fold-base-padding": "8px",
  "--corner-fold-base-shadow": "0 4px 8px rgba(17, 24, 28, 0.11)",
  "--corner-fold-state-hover-scale": "1.1",
  "--corner-fold-state-hover-shadow": "0 18px 36px rgba(17, 24, 28, 0.14)",
  "--corner-fold-state-hover-duration": "220ms",
  "--corner-fold-state-hover-easing": "cubic-bezier(0.34, 1.56, 0.64, 1)",
  "--corner-fold-state-focused-border-width": "2px",
  "--corner-fold-state-focused-border-color": "#0b078c",
  "--corner-fold-state-entering-duration": "500ms",
  "--corner-fold-state-entering-easing": "cubic-bezier(0.2, 0, 0, 1)",
  "--corner-fold-state-exiting-duration": "300ms",
  "--corner-fold-state-exiting-easing": "cubic-bezier(0.5, 0, 0.75, 0)",
};

export const REQUIRED_TOKENS = Object.keys(EXPECTED_TOKENS);

// Matches a custom-property DECLARATION (`--name:`), not a var() reference, so a token that the
// theme merely mentions is never mistaken for one the design system provides. Captures the
// declared value (up to the terminating `;` or `}`) so callers can check it, not just its presence.
const DECLARATION_PATTERN = /(?:^|[{;])\s*(--[\w-]+)\s*:\s*([^;}]+?)\s*(?=[;}])/g;

function parseDeclarations(css) {
  const declared = new Map();
  for (const match of css.matchAll(DECLARATION_PATTERN)) {
    declared.set(match[1], match[2].trim());
  }
  return declared;
}

export function findMissingTokens(css, required = REQUIRED_TOKENS) {
  const declared = parseDeclarations(css);
  return required.filter((token) => !declared.has(token));
}

// Reports every required token whose declared value differs from the expected literal. Tokens
// that are absent entirely are not reported here -- that is findMissingTokens' job, and
// double-reporting the same problem in two lists makes the failure output harder to read.
export function findWrongValues(css, expected = EXPECTED_TOKENS) {
  const declared = parseDeclarations(css);
  const wrong = [];
  for (const [token, expectedValue] of Object.entries(expected)) {
    if (!declared.has(token)) continue;
    const actual = declared.get(token);
    if (actual !== expectedValue) {
      wrong.push({ token, expected: expectedValue, actual });
    }
  }
  return wrong;
}
