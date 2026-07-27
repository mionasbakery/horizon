// The contract between ../design-system and this theme's snippets/design-system-bridge.liquid:
// every token the bridge spends, and the exact value it must carry.
//
// This is the ONLY place the theme hardcodes design-system token names or values. If the design
// system renames or revalues a token, change it here and in the bridge snippet's var() references.
//
// Values are asserted, not just presence, and that is deliberate. A token can exist, be spelled
// correctly, match the contract by name, and still be wrong: --text-role-*-letter-spacing once
// rendered 0.06em instead of 0.02em because the design system emitted var(--letter-spacing-sm)
// and this theme declares that same name with its own value. Only a value check catches that.
export const EXPECTED_TOKENS = {
  "--text-role-hero-font-size": "48px",
  "--text-role-hero-line-height": "58px",
  "--text-role-hero-font-weight": "800",
  "--text-role-hero-letter-spacing": "0.02em",
  "--text-role-title-font-size": "28px",
  "--text-role-title-line-height": "36px",
  "--text-role-title-letter-spacing": "0.02em",
  "--text-role-heading-font-size": "22px",
  "--text-role-heading-line-height": "28px",
  "--text-role-heading-letter-spacing": "0.02em",
  "--text-role-subheading-font-size": "18px",
  "--text-role-subheading-line-height": "24px",
  "--text-role-subheading-letter-spacing": "0.02em",
  "--text-role-caption-font-size": "15px",
  "--text-role-caption-line-height": "20px",
  "--text-role-caption-letter-spacing": "0.02em",
  "--text-role-body-font-size": "16px",
  "--text-role-body-line-height": "24px",
  "--text-role-body-letter-spacing": "0",
  // The sizes above serve the six type roles snippets/design-system-bridge.liquid consumes (hero,
  // title, heading, subheading, caption, body). blocks/mionas-text.liquid additionally spends the
  // subtitle, lead, label and stamp role *weights*; only the two valued 500 are pinned here, for
  // the font-face reason spelled out below -- the rest are ordinary weights the theme already
  // loads, and pinning every role's every axis would make this a copy of the token file.
  "--text-role-caption-font-weight": "500",
  "--text-role-label-font-weight": "500",
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
  // Link, spent by blocks/mionas-link.liquid and sections/mionas-breadcrumbs.liquid.
  "--link-base-foreground": "#0b078c",
  "--link-base-font-weight": "500",
  "--link-size-md-font-size": "16px",
  "--link-size-sm-font-size": "15px",
  "--link-inverse-primary-foreground": "#ffffff",
  "--link-inverse-primary-muted-foreground": "#cfcac2",
  // Every "500" above is load-bearing beyond its own colour/size: snippets/design-system-bridge
  // .liquid emits an extra Archivo 500 @font-face solely because these tokens ask for a weight
  // none of the theme's four font settings load. Should the design system move any of them off
  // 500, this contract fails, and the question to re-ask is whether that font-face is still
  // needed at all -- not just what number to retype here.
  "--button-base-font-weight": "500",
  // Product card surface + layout, spent by blocks/mionas-product-card.liquid (these moved there
  // when snippets/product-card-bridge.liquid was deleted). --card-base-* are
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
  "--product-card-price-font-weight": "600",
  "--product-card-price-foreground": "#101413",
  // Spent by blocks/mionas-product-card.liquid, which is a standalone card the merchant places
  // rather than a restyle of Horizon's grid card -- so unlike the deleted product-card-bridge it
  // does own its media height and its pressed state, and both need guarding.
  "--product-card-base-media-height": "200px",
  "--card-state-pressed-opacity": "0.92",
  // Secondary body text, spent by blocks/mionas-contact-form.liquid's note and
  // blocks/mionas-map.liquid's empty state. Card's own token rather than a borrowed --form-label-*
  // one, since neither is a form label.
  "--card-description-foreground": "#687076",
  // Form surface, spent by the snippets/mionas-form*.liquid, mionas-text-field.liquid and
  // mionas-checkbox.liquid family (blocks/mionas-contact-form.liquid composes them and no longer
  // spends these directly). Every one of Form, FormField, FormLabel, FormError, FormActions,
  // TextField and Checkbox in ../design-system/src/react/ now has a mirror here, so the whole
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
  // Completes the label and body type scales. The comment near the top of this file explains why
  // only the *weights* of the label role were pinned until now: nothing spent its other axes.
  // snippets/mionas-form-label.liquid and mionas-form-error.liquid do, because FormLabel.tsx and
  // FormError.tsx both render through <Text role="label">, and mionas-checkbox's text label needs
  // the body weight for the same reason (Checkbox.tsx renders it as role="body"). The three axes
  // already pinned above -- label-font-weight, body-font-size/line-height/letter-spacing -- are not
  // repeated here; a duplicate key would silently shadow the earlier entry rather than error.
  "--text-role-label-font-size": "13px",
  "--text-role-label-line-height": "18px",
  "--text-role-label-letter-spacing": "0.02em",
  "--text-role-body-font-weight": "400",
  // The stamp role, spent by blocks/mionas-text.liquid and blocks/mionas-header-menu.liquid. It
  // was an unguarded spend until now, which is the same silent-fallback exposure that let
  // --nav-link-state-hover-foreground rot in the header menu unnoticed: a removed role would
  // simply stop applying. Pinned in full because unlike the other roles, nothing else in this
  // contract already covers any of its axes.
  "--text-role-stamp-font-size": "16px",
  "--text-role-stamp-line-height": "18px",
  "--text-role-stamp-font-weight": "600",
  "--text-role-stamp-letter-spacing": "0.05em",
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
  // --mega-menu-base-shadow is pinned by value for the reason the pruned --shadow-lg entry gave
  // before it -- the panel's separation from the page depends on the blur radius, not on some
  // shadow existing. It is a DIFFERENT radius now (shadow.md, not shadow.lg); adopting that was
  // the deliberate outcome of this sync, not a mechanical rename.
  //
  // Absent on purpose: --mega-menu-base-background (the panel's surface is a merchant colour
  // setting, not a token), --mega-menu-item-base-media-size (the drawer keeps its own 56px
  // thumbnail -- see the comment on that rule), and every --mega-menu-link-*/--navbar-*, which
  // the theme does not spend: the mobile overflow list and the top-level bar run on Horizon's
  // own --menu-* settings so Shopify keeps hosting and preloading the nav faces.
  "--mega-menu-base-shadow": "0 4px 8px rgba(17, 24, 28, 0.11)",
  "--mega-menu-base-border-width": "1px",
  "--mega-menu-base-border-color": "#ece8e2",
  "--mega-menu-base-padding": "16px",
  "--mega-menu-base-gap": "16px",
  // Pinned by value because both are load-bearing past their own rule: the item gap is what the
  // desktop card's media-to-text rhythm now depends on (it was 8px before this sync, and the
  // __text wrapper still carries its own 8px between label and tagline, so the two are no longer
  // the same number and a revalue here changes only one of them), and the media radius is
  // deliberately radius.md against the card's radius.lg -- collapsing them back to one value is
  // the mistake this entry exists to catch.
  "--mega-menu-item-base-gap": "12px",
  "--mega-menu-item-base-padding": "8px",
  "--mega-menu-item-base-radius": "12px",
  "--mega-menu-item-base-media-height": "110px",
  "--mega-menu-item-base-media-radius": "8px",
  "--mega-menu-item-base-media-background": "#ece8e2",
  // 700, where the caption role this label otherwise follows is 500. Pinned for the font-face
  // reason the "every 500 above is load-bearing" note gives: it asks the theme's Archivo for a
  // weight none of the four font settings is guaranteed to load, so a change here is a question
  // about which faces the bridge emits, not just a number to retype.
  "--mega-menu-item-label-font-weight": "700",
  "--mega-menu-item-label-foreground": "#101413",
  "--mega-menu-item-description-foreground": "#687076",
  "--mega-menu-item-state-hover-foreground": "#0b078c",
  "--mega-menu-item-state-hover-scale": "1.05",
  "--mega-menu-item-state-pressed-opacity": "0.92",
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
