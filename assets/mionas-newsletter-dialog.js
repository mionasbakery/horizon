import { DialogOpenEvent } from '@theme/dialog';

// The base class comes from the custom element registry, not an import: Horizon's only import map is
// native, and a relative import would load a second, unversioned copy of mionas-dialog.js.
await customElements.whenDefined('mionas-dialog-component');
const MionasDialog = /** @type {typeof import('./mionas-dialog.js').MionasDialog} */ (
  customElements.get('mionas-dialog-component')
);

/** Sources of an open that count as the dialog being shown, for the funnel, as their GA4 `trigger`. */
const SHOWN_TRIGGERS = { auto: 'auto', launcher: 'corner_fold' };
/** The GA4 name of each funnel step. GA4 has no recommended event for a close, so close_promotion is custom. */
const FUNNEL_EVENTS = { shown: 'view_promotion', closed: 'close_promotion', subscribed: 'sign_up' };
const PROMOTION = { promotion_id: 'newsletter_popup', promotion_name: 'Newsletter popup' };

/** One dialog's memory in the visitor's local storage. */
class DialogStore {
  #key;

  /** @param {string} key */
  constructor(key) {
    this.#key = key;
  }

  /**
   * @returns {Record<string, any> | null} null when the storage is unusable, since without memory a
   *   dialog would open on every page.
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

    try {
      localStorage.setItem(this.#key, JSON.stringify({ ...current, ...patch }));
    } catch {
      // Quota or a storage policy change mid-session: the dialog only loses its memory.
    }
  }

  /** @returns {string | null} */
  #readRaw() {
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
 * The newsletter dialog: a Mionas dialog with funnel analytics and the signup result.
 *
 * @extends MionasDialog
 */
class MionasNewsletterDialog extends MionasDialog {
  requiredRefs = ['dialog', 'formView', 'successView'];

  decline = () => this.closeWith('button');
  continueShopping = () => this.closeWith('button');

  /** True once complete() ran, on this page view or an earlier one. */
  completed = false;
  /** True when the visitor closed the dialog on an earlier page view. */
  closedBefore = false;
  /** True once the dialog opened, closed or completed on this page view; an automatic open then never fires. */
  doneOnPage = false;
  /** @type {DialogStore | undefined} */
  store;

  /** @param {{ source?: string }} [options] */
  open(options) {
    this.doneOnPage = true;
    super.open(options);
  }

  /** Marks the dialog done for this visitor, so it never opens by itself again. */
  complete() {
    this.completed = true;
    this.doneOnPage = true;
    this.store?.write({ state: 'completed' });
    this.dispatchEvent(new CustomEvent('mionas-newsletter-dialog:complete'));
  }

  connectedCallback() {
    super.connectedCallback();
    if (window.Shopify?.designMode) return;

    this.store = new DialogStore(this.dataset.storageKey ?? this.id);

    // Without memory the dialog would open on every page, so blocked storage keeps it from opening by itself.
    const stored = this.store.read();
    if (!stored) return;

    this.completed = stored.state === 'completed';
    this.closedBefore = stored.state === 'closed';

    this.addEventListener('mionas-dialog:open', this.#onOpen);
    this.addEventListener('mionas-dialog:close', this.#onClose);
    this.addEventListener('submit', this.#onSubmit);

    const outcome = this.#takeOwnPost() ? this.#submitOutcome() : null;
    if (outcome === 'success') {
      this.#track('subscribed', { method: 'newsletter_popup' });
      this.#showSuccess();
      this.complete();
      this.open({ source: 'signup' });
      return;
    }
    if (outcome === 'error') {
      this.open({ source: 'signup' });
      return;
    }

    if (document.querySelector('.mionas-email-signup__success')) this.complete();
  }

  /** @param {CustomEvent} event */
  #onOpen = (event) => {
    const { source } = event.detail;
    this.doneOnPage = true;
    const trigger = SHOWN_TRIGGERS[/** @type {keyof typeof SHOWN_TRIGGERS} */ (source)];
    if (trigger) this.#track('shown', { ...PROMOTION, trigger });
  };

  /** @param {CustomEvent} event */
  #onClose = (event) => {
    const { method } = event.detail;
    this.doneOnPage = true;
    if (this.completed) return;
    this.store?.write({ state: 'closed', closedAt: Date.now() });
    this.#track('closed', { ...PROMOTION, method });
  };

  /**
   * Sends a funnel step with its GA4 name and parameters. Shopify customer events carry it as
   * newsletter_popup_{step}, which the GA4 and Mixpanel custom pixels rename.
   * @param {keyof typeof FUNNEL_EVENTS} step
   * @param {Record<string, string>} params
   */
  #track(step, params) {
    const name = FUNNEL_EVENTS[step];
    try {
      window.Shopify?.analytics?.publish?.(`newsletter_popup_${step}`, params);
      // Datadog's pixel has no session outside checkout, so snippets/mionas-datadog.liquid sends it.
      window.mionasDatadog?.action(name, params);
    } catch {
      // Analytics must never break the dialog.
    }

    window.clarity?.('event', name);
  }

  get #postedKey() {
    return `${this.dataset.storageKey ?? this.id}-posted`;
  }

  /**
   * Marks a post from this dialog's form, since the customer endpoint gives every signup on the page
   * the same result. It ignores defaultPrevented, because Shopify's captcha can cancel the submit
   * and post the form itself; invalid forms never get here, since the validation script stops them.
   */
  #onSubmit = () => {
    try {
      sessionStorage.setItem(this.#postedKey, '1');
    } catch {
      // Without the mark the dialog stays closed after its post, and the block shows the result in place.
    }
  };

  /** @returns {boolean} True once, on the page load after this dialog's own post. */
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
   * Reads this dialog's own signup block after its own post.
   * @returns {'success' | 'error' | null}
   */
  #submitOutcome() {
    if (this.querySelector('.mionas-email-signup__success')) return 'success';
    if (this.querySelector('.mionas-form-field--error')) return 'error';
    return null;
  }

  #showSuccess() {
    this.refs.formView.hidden = true;
    this.refs.successView.hidden = false;
    this.labelFrom(this.refs.successView, 'success');
    this.addEventListener(DialogOpenEvent.eventName, () => requestAnimationFrame(() => this.refs.successView.focus()), {
      once: true,
    });
  }
}

if (!customElements.get('mionas-newsletter-dialog-component')) {
  customElements.define('mionas-newsletter-dialog-component', MionasNewsletterDialog);
}
