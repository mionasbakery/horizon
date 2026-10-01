import { DialogOpenEvent } from '@theme/dialog';

// The base class comes from the custom element registry, not an import: Horizon's only import map is
// native, and a relative import would load a second, unversioned copy of mionas-popup.js.
await customElements.whenDefined('mionas-popup-component');
const MionasPopup = /** @type {typeof import('./mionas-popup.js').MionasPopup} */ (
  customElements.get('mionas-popup-component')
);

/** Sources of an open that count as the popup being shown, for the funnel. */
const SHOWN_SOURCES = ['auto', 'launcher'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Console logs of the popup's rules, for testers and for a tab opened with ?popup-debug in its
 * address; ?popup-debug=off stops them.
 */
const DEBUG_KEY = 'mionas-popup-debug';
const debugRequested = (() => {
  const value = new URLSearchParams(location.search).get('popup-debug');
  try {
    if (value === 'off') sessionStorage.removeItem(DEBUG_KEY);
    else if (value !== null) sessionStorage.setItem(DEBUG_KEY, '1');
    return sessionStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return value !== null && value !== 'off';
  }
})();

/** Session keys already cleared on this page load, so a second store on one key keeps its writes. */
const clearedOnReload = new Set();

/**
 * One popup's memory in the visitor's browser: local storage, or with the testers audience a session
 * cookie, which the browser deletes when it closes and a page reload clears, so testers can replay the
 * first visit on demand.
 */
class PopupStore {
  #key;
  #session;

  /**
   * @param {string} key
   * @param {boolean} session
   */
  constructor(key, session) {
    this.#key = key;
    this.#session = session;
    if (session && !clearedOnReload.has(key) && performance.getEntriesByType('navigation')[0]?.type === 'reload') {
      document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
    }
    clearedOnReload.add(key);
  }

  /**
   * @returns {Record<string, any> | null} null when the storage is unusable, since without memory a
   *   popup would open on every page.
   */
  read() {
    const raw = this.#readRaw();
    if (raw === null) return null;

    try {
      const value = JSON.parse(raw || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  /** @param {Record<string, any>} patch */
  write(patch) {
    const current = this.read();
    if (!current) return;

    const value = JSON.stringify({ ...current, ...patch });
    if (this.#session) {
      document.cookie = `${this.#key}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
      return;
    }

    try {
      localStorage.setItem(this.#key, value);
    } catch {
      // Quota or a storage policy change mid-session: the popup only loses its memory.
    }
  }

  /** @returns {string | null} */
  #readRaw() {
    if (this.#session) {
      if (!navigator.cookieEnabled) return null;
      const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(`${this.#key}=`));
      return cookie ? decodeURIComponent(cookie.slice(this.#key.length + 1)) : '';
    }

    try {
      localStorage.setItem(`${this.#key}-probe`, '1');
      localStorage.removeItem(`${this.#key}-probe`);
      return localStorage.getItem(this.#key) ?? '';
    } catch {
      return null;
    }
  }
}

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

  /** False when this visitor must never get the popup. */
  available = true;
  /** True once complete() ran, on this page view or an earlier one. */
  completed = false;
  /** True when the visitor closed the popup on an earlier page view. */
  closedBefore = false;
  /** True once the popup opened, closed or completed on this page view; an automatic open then never fires. */
  doneOnPage = false;
  /** @type {PopupStore | undefined} */
  store;
  #debug = false;

  /**
   * Logs a rule that fired to the console, when debugging is on. The trigger and the widget log
   * through it too.
   * @param {...any} parts
   */
  debug(...parts) {
    if (!this.#debug) return;
    console.info(`[${this.dataset.storageKey}] ${(performance.now() / 1000).toFixed(1)}s`, ...parts);
  }

  /** @param {{ source?: string }} [options] */
  open(options) {
    this.doneOnPage = true;
    super.open(options);
  }

  /** Marks the popup done for this visitor, so it never opens by itself again. */
  complete() {
    this.debug('done for this visitor: never opens by itself again');
    this.completed = true;
    this.doneOnPage = true;
    this.store?.write({ state: 'completed' });
    this.dispatchEvent(new CustomEvent('mionas-newsletter-popup:complete'));
  }

  connectedCallback() {
    super.connectedCallback();
    if (window.Shopify?.designMode) return;

    const testers = this.dataset.audience === 'testers';
    this.store = new PopupStore(this.dataset.storageKey ?? this.id, testers);
    this.#debug = testers || debugRequested;

    const stored = this.store.read();
    if (!stored) {
      this.debug('browser storage blocked: the popup never opens by itself');
      return;
    }
    this.debug('memory:', this.#describe(stored), testers ? '(testers: cleared on reload)' : '');

    this.completed = stored.state === 'completed';
    this.closedBefore = stored.state === 'closed';
    if (testers) {
      this.#group = 'popup';
      this.debug('audience: testers, so no A/B test');
    } else {
      this.#group = this.#resolveGroup(stored);
    }
    this.#announceGroup();
    this.available = this.#group === 'popup';
    if (!this.available) {
      this.debug('control group: no popup and no widget');
      return;
    }

    if (this.dataset.pageRule) {
      this.debug(`this page never opens it by itself: ${this.dataset.pageRule}`);
    } else if (!document.querySelector(`mionas-newsletter-trigger[for="${this.id}"]`)) {
      this.debug('Open automatically is off');
    }

    this.addEventListener('mionas-popup:open', this.#onOpen);
    this.addEventListener('mionas-popup:close', this.#onClose);
    this.addEventListener('submit', this.#onSubmit);

    const outcome = this.#takeOwnPost() ? this.#submitOutcome() : null;
    if (outcome === 'success') {
      this.debug('signup succeeded');
      this.#track('subscribed');
      this.#showSuccess();
      this.complete();
      this.open({ source: 'signup' });
      return;
    }
    if (outcome === 'error') {
      this.debug('signup failed: the popup opens with the error');
      this.open({ source: 'signup' });
      return;
    }

    // `subscribed` is the state stored before popups shared the `completed` state.
    if (stored.state === 'subscribed') {
      this.debug('subscribed earlier');
      this.complete();
    } else if (document.querySelector('.mionas-email-signup__success')) {
      this.debug('signup succeeded in another form on this page');
      this.complete();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('shopify:cart:lines-update', this.#onCartUpdate);
  }

  /** @param {CustomEvent} event */
  #onOpen = (event) => {
    const { source } = event.detail;
    this.debug(`opened by ${source}`);
    this.doneOnPage = true;
    if (SHOWN_SOURCES.includes(source)) this.#track('shown', { source });
  };

  /** @param {CustomEvent} event */
  #onClose = (event) => {
    const { method } = event.detail;
    this.debug(`closed by ${method}`);
    this.doneOnPage = true;
    if (this.completed) return;
    this.store?.write({ state: 'closed', closedAt: Date.now() });
    this.#track('closed', { method });
  };

  /** @param {Record<string, any>} stored */
  #describe(stored) {
    if (stored.state === 'closed') return `closed ${((Date.now() - (stored.closedAt ?? 0)) / DAY_MS).toFixed(1)} days ago`;
    return stored.state ?? 'first visit';
  }

  /**
   * A new test name draws a new group but keeps `state`, so a visitor who closed or subscribed is
   * still never shown the popup again.
   * @param {{ test?: string, group?: string }} stored
   * @returns {'popup' | 'control'}
   */
  #resolveGroup(stored) {
    if (this.dataset.abTest !== 'true') {
      this.debug('A/B test off: every visitor gets the popup');
      return 'popup';
    }

    const test = this.dataset.testName;
    if (stored.test === test && (stored.group === 'popup' || stored.group === 'control')) {
      this.debug(`group: ${stored.group} (kept from an earlier visit, test ${test})`);
      return stored.group;
    }

    const share = Number(this.dataset.popupShare);
    const percent = Number.isNaN(share) ? 50 : share;
    const group = Math.random() * 100 < percent ? 'popup' : 'control';
    this.debug(`group: ${group} (new draw, ${percent}% get the popup, test ${test})`);
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

  get #postedKey() {
    return `${this.dataset.storageKey ?? this.id}-posted`;
  }

  /**
   * Marks a post from this popup's form, since the customer endpoint gives every signup on the page
   * the same result. It ignores defaultPrevented, because Shopify's captcha can cancel the submit
   * and post the form itself; invalid forms never get here, since the validation script stops them.
   */
  #onSubmit = () => {
    try {
      sessionStorage.setItem(this.#postedKey, '1');
    } catch {
      // Without the mark the popup stays closed after its post, and the block shows the result in place.
    }
  };

  /** @returns {boolean} True once, on the page load after this popup's own post. */
  #takeOwnPost() {
    try {
      const posted = sessionStorage.getItem(this.#postedKey) === '1';
      sessionStorage.removeItem(this.#postedKey);
      return posted;
    } catch {
      return false;
    }
  }

  /**
   * Reads this popup's own signup block after its own post.
   * @returns {'success' | 'error' | null}
   */
  #submitOutcome() {
    if (this.querySelector('.mionas-email-signup__success')) return 'success';
    if (this.querySelector('.mionas-form-field--error')) return 'error';
    return null;
  }

  #showSuccess() {
    const title = this.querySelector('.mionas-email-signup__success .mionas-form-success__title');
    const heading = this.refs.successView.querySelector('h2');
    if (title && heading) heading.textContent = title.textContent.trim();

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
