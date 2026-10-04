// The base class comes from the custom element registry, not an import: Horizon's only import map is
// native, and a relative import would load a second, unversioned copy of mionas-corner-fold.js.
await customElements.whenDefined('mionas-corner-fold');
const MionasCornerFold = /** @type {typeof import('./mionas-corner-fold.js').MionasCornerFold} */ (
  customElements.get('mionas-corner-fold')
);

/**
 * Resolves once the Shopify cookie banner no longer needs an answer. mionas-newsletter-trigger.js holds a
 * copy, because scripts outside the theme's import map cannot share a module.
 * @returns {Promise<boolean>} true when the visitor answered the banner on this page.
 */
function waitForConsent() {
  return new Promise((resolve) => {
    const shopify = window.Shopify;
    if (typeof shopify?.loadFeatures !== 'function') return resolve(false);

    shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], (error) => {
      const privacy = window.Shopify?.customerPrivacy;
      if (error || !privacy) return resolve(false);

      const undecided = privacy.shouldShowBanner?.() && privacy.currentVisitorConsent?.()?.marketing === '';
      if (!undecided) return resolve(false);

      document.addEventListener('visitorConsentCollected', () => resolve(true), { once: true });
    });
  });
}

/**
 * The newsletter dialog's corner fold. It shows from the first page with Always, or once the visitor has
 * closed the dialog, and never before the cookie banner answer. It hides after a signup.
 *
 * @extends MionasCornerFold
 */
class MionasNewsletterCornerFold extends MionasCornerFold {
  #listeners = new AbortController();

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#listeners.abort();
  }

  /** @param {any} dialog */
  dialogConnected(dialog) {
    if (window.Shopify?.designMode) return;

    const { signal } = this.#listeners;
    dialog.addEventListener(
      'mionas-newsletter-dialog:complete',
      () => this.hide(),
      { signal }
    );
    dialog.addEventListener(
      'mionas-dialog:close',
      () => {
        if (dialog.completed) return;
        this.show();
      },
      { signal }
    );

    if (dialog.completed) return;
    if (this.dataset.show !== 'always' && !dialog.closedBefore) return;

    const consent = waitForConsent();
    // A dialog that opens on load, after a signup reload, opens in a frame queued before this one, so
    // show() then finds it open and waits for its close.
    consent.then(() =>
      requestAnimationFrame(() => {
        if (dialog.completed) return;
        this.show();
      })
    );
  }
}

if (!customElements.get('mionas-newsletter-corner-fold')) {
  customElements.define('mionas-newsletter-corner-fold', MionasNewsletterCornerFold);
}
