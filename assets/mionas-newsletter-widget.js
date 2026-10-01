// The base class comes from the custom element registry, not an import: Horizon's only import map is
// native, and a relative import would load a second, unversioned copy of mionas-popup-widget.js.
await customElements.whenDefined('mionas-popup-widget');
const MionasPopupWidget = /** @type {typeof import('./mionas-popup-widget.js').MionasPopupWidget} */ (
  customElements.get('mionas-popup-widget')
);

/**
 * Resolves once the Shopify cookie banner no longer needs an answer. mionas-newsletter-trigger.js holds a
 * copy, because scripts outside the theme's import map cannot share a module.
 * @param {() => void} onWait - Runs when the banner still needs an answer.
 * @returns {Promise<boolean>} true when the visitor answered the banner on this page.
 */
function waitForConsent(onWait) {
  return new Promise((resolve) => {
    const shopify = window.Shopify;
    if (typeof shopify?.loadFeatures !== 'function') return resolve(false);

    shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], (error) => {
      const privacy = window.Shopify?.customerPrivacy;
      if (error || !privacy) return resolve(false);

      const undecided = privacy.shouldShowBanner?.() && privacy.currentVisitorConsent?.()?.marketing === '';
      if (!undecided) return resolve(false);

      onWait();
      document.addEventListener('visitorConsentCollected', () => resolve(true), { once: true });
    });
  });
}

/**
 * The newsletter popup's widget. It shows from the first page with Always, or once the visitor has
 * closed the popup; with Wait for the cookie banner answer on, only after that answer. It hides after
 * a signup and never shows to the A/B control group.
 *
 * @extends MionasPopupWidget
 */
class MionasNewsletterWidget extends MionasPopupWidget {
  /** @type {any} */
  #popup = null;
  #listeners = new AbortController();

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#listeners.abort();
  }

  /** @param {...any} parts */
  debug(...parts) {
    this.#popup?.debug?.('widget:', ...parts);
  }

  /** @param {any} popup */
  popupConnected(popup) {
    this.#popup = popup;
    if (window.Shopify?.designMode || !popup.available) return;

    const { signal } = this.#listeners;
    popup.addEventListener(
      'mionas-newsletter-popup:complete',
      () => {
        if (!this.hidden) this.debug('hidden after the signup');
        this.hide();
      },
      { signal }
    );
    popup.addEventListener(
      'mionas-popup:close',
      () => {
        if (popup.completed) return;
        if (this.hidden) this.debug('shows after the close');
        this.show();
      },
      { signal }
    );

    if (popup.completed) {
      this.debug('not shown: signed up');
      return;
    }
    if (this.dataset.show !== 'always' && !popup.closedBefore) {
      this.debug('waits for the first close of the popup');
      return;
    }

    const consent =
      this.dataset.waitForConsent === 'true'
        ? waitForConsent(() => this.debug('waits for the cookie banner answer'))
        : Promise.resolve(false);
    // A popup that opens on load, after a signup reload, opens in a frame queued before this one, so
    // show() then finds it open and waits for its close.
    consent.then(() =>
      requestAnimationFrame(() => {
        if (popup.completed) return;
        this.debug(this.dataset.show === 'always' ? 'shows (Always)' : 'shows (the popup was closed before)');
        this.show();
      })
    );
  }
}

if (!customElements.get('mionas-newsletter-widget')) {
  customElements.define('mionas-newsletter-widget', MionasNewsletterWidget);
}
