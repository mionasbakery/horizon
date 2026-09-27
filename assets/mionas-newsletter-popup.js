import { DialogOpenEvent } from '@theme/dialog';

// The base class comes from the custom element registry, not an import: Horizon's only import map is
// native, and a relative import would load a second, unversioned copy of mionas-popup.js.
await customElements.whenDefined('mionas-popup-component');
const MionasPopup = /** @type {typeof import('./mionas-popup.js').MionasPopup} */ (
  customElements.get('mionas-popup-component')
);

/** Sources of an open that count as the popup being shown, for the funnel. */
const SHOWN_SOURCES = ['auto', 'exit', 'launcher'];

/**
 * The newsletter popup: a Mionas popup with an A/B test, funnel analytics and the signup result.
 *
 * @extends MionasPopup
 */
class MionasNewsletterPopup extends MionasPopup {
  requiredRefs = ['dialog', 'formView', 'successView'];

  /** @type {'popup' | 'control' | null} */
  #group = null;

  decline = () => this.closeWith('button');
  continueShopping = () => this.closeWith('button');

  /** @param {Record<string, any>} stored */
  isAvailable(stored) {
    this.#group = this.dataset.audience === 'testers' ? 'popup' : this.#resolveGroup(stored);
    this.#announceGroup();
    return this.#group === 'popup';
  }

  /** @param {Record<string, any>} stored */
  prepare(stored) {
    this.addEventListener('mionas-popup:open', this.#onOpen);
    this.addEventListener('mionas-popup:close', this.#onClose);
    document.addEventListener('mionas-popup-widget:dismiss', this.#onWidgetDismiss);

    const outcome = this.#submitOutcome();
    if (outcome === 'success') {
      this.#track('subscribed');
      this.#showSuccess();
      this.complete();
      this.open({ source: 'signup' });
      return;
    }
    if (outcome === 'error') {
      this.open({ source: 'signup' });
      return;
    }

    // `subscribed` is the state stored before popups shared the `completed` state.
    if (stored.state === 'subscribed' || this.#otherSignupSucceeded()) this.complete();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('shopify:cart:lines-update', this.#onCartUpdate);
    document.removeEventListener('mionas-popup-widget:dismiss', this.#onWidgetDismiss);
  }

  /** @param {CustomEvent} event */
  #onOpen = (event) => {
    const { source } = event.detail;
    if (SHOWN_SOURCES.includes(source)) this.#track('shown', { source });
  };

  /** @param {CustomEvent} event */
  #onClose = (event) => {
    if (!this.completed) this.#track('closed', { method: event.detail.method });
  };

  /** @param {Event} event */
  #onWidgetDismiss = (event) => {
    if (event.target instanceof Element && event.target.getAttribute('for') === this.id) this.#track('widget_dismissed');
  };

  /**
   * A new test name draws a new group but keeps `state`, so a visitor who closed or subscribed is
   * still never shown the popup again.
   * @param {{ test?: string, group?: string }} stored
   * @returns {'popup' | 'control'}
   */
  #resolveGroup(stored) {
    if (this.dataset.abTest !== 'true') return 'popup';

    const test = this.dataset.testName;
    if (stored.test === test && (stored.group === 'popup' || stored.group === 'control')) return stored.group;

    const share = Number(this.dataset.popupShare);
    const group = Math.random() * 100 < (Number.isNaN(share) ? 50 : share) ? 'popup' : 'control';
    this.store?.write({ test, group });
    return group;
  }

  /**
   * Publishes a funnel event to Shopify customer events (read by the GA4 custom pixel) and to Clarity.
   * @param {string} name - Without the event prefix.
   * @param {Record<string, string>} [data]
   */
  #track(name, data = {}) {
    const eventName = `${this.dataset.eventPrefix}${name}`;

    try {
      window.Shopify?.analytics?.publish?.(eventName, { test: this.dataset.testName, group: this.#group, ...data });
    } catch {
      // Analytics must never break the popup.
    }

    window.clarity?.('event', eventName);
  }

  /** The group qualified by the test, so orders and Clarity sessions from different tests stay apart. */
  get #groupLabel() {
    return `${this.dataset.testName}:${this.#group}`;
  }

  /**
   * Runs on every eligible page view: events published before cookie consent never reach a pixel,
   * so a once-per-browser event could be lost.
   */
  #announceGroup() {
    if (!this.#group) return;

    window.clarity?.('set', this.dataset.clarityTag, this.#groupLabel);
    this.#track('eligible');
    document.addEventListener('shopify:cart:lines-update', this.#onCartUpdate);
  }

  /**
   * Stamps the group on each cart, so every order carries it. Shopify starts a new cart after each
   * order, and stamping on page view instead would create a cart for every visitor and bot.
   * @param {Event & { promise?: Promise<unknown> }} event
   */
  #onCartUpdate = async (event) => {
    try {
      await event.promise;

      const root = window.Shopify?.routes?.root ?? '/';
      const cart = await (await fetch(`${root}cart.js`)).json();
      const attribute = this.dataset.cartAttribute;
      if (!cart.item_count || !attribute || cart.attributes?.[attribute] === this.#groupLabel) return;

      await fetch(`${root}cart/update.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ attributes: { [attribute]: this.#groupLabel } }),
      });
    } catch {
      // A failed stamp loses one order's attribution, never the cart itself.
    }
  };

  /**
   * Reads this popup's own signup block after a submit reload. The block renders its success banner
   * or field error only for its own form, so no URL parsing is needed.
   * @returns {'success' | 'error' | null}
   */
  #submitOutcome() {
    if (this.querySelector('.mionas-email-signup__success')) return 'success';
    if (this.querySelector('.mionas-form-field--error')) return 'error';
    return null;
  }

  #otherSignupSucceeded() {
    return [...document.querySelectorAll('.mionas-email-signup__success')].some((element) => !this.contains(element));
  }

  #showSuccess() {
    const banner = this.querySelector('.mionas-email-signup__success');
    const heading = this.refs.successView.querySelector('h2');
    if (banner && heading) heading.textContent = banner.textContent.trim();

    this.refs.formView.hidden = true;
    this.refs.successView.hidden = false;
    this.labelFrom(this.refs.successView, 'success');
    this.addEventListener(DialogOpenEvent.eventName, () => requestAnimationFrame(() => this.refs.successView.focus()), {
      once: true,
    });
  }
}

if (!customElements.get('mionas-newsletter-popup-component')) {
  customElements.define('mionas-newsletter-popup-component', MionasNewsletterPopup);
}
