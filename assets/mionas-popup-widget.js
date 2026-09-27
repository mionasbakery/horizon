import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The tab or bar that opens the Mionas popup named by its `for` attribute. It knows the popup only
 * through the popup's public API and events, and the popup works without it.
 */
class MionasPopupWidget extends Component {
  /** @type {any} */
  #popup = null;
  /** @type {any} */
  #store = null;
  /** @type {ResizeObserver | undefined} */
  #observer;
  #listeners = new AbortController();
  /** Set while the popup is open, so a slide-out that ends after a quick close does not cover the widget. */
  #popupOpen = false;

  connectedCallback() {
    super.connectedCallback();

    // The widget is fixed over the page end, so the page gets its height as extra room to scroll to
    // the footer; the height changes when the text wraps on narrow phones.
    this.#observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--mionas-popup-widget-height', `${this.getBoundingClientRect().height}px`);
    });
    this.#observer.observe(this);

    if (window.Shopify?.designMode) {
      const { signal } = this.#listeners;
      document.addEventListener('shopify:section:select', this.#onEditorSelect, { signal });
      document.addEventListener('shopify:block:select', this.#onEditorSelect, { signal });
      document.addEventListener('shopify:section:deselect', this.#onEditorDeselect, { signal });
    }

    const popup = document.getElementById(this.getAttribute('for') ?? '');
    if (popup) customElements.whenDefined(popup.localName).then(() => this.#attach(popup));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#listeners.abort();
    this.#observer?.disconnect();
    document.documentElement.style.removeProperty('--mionas-popup-widget-height');
  }

  openPopup = () => {
    this.#popup?.open({ source: 'launcher' });
  };

  dismiss = () => {
    this.#slide('out', () => (this.hidden = true));
    if (window.Shopify?.designMode) return;
    this.#store?.write({ dismissedAt: Date.now() });
    this.dispatchEvent(new CustomEvent('mionas-popup-widget:dismiss', { bubbles: true }));
  };

  /** @param {any} popup */
  #attach(popup) {
    this.#popup = popup;
    this.#store = popup.createStore('widget');

    const { signal } = this.#listeners;
    popup.addEventListener('mionas-popup:open', this.#onOpen, { signal });
    popup.addEventListener('mionas-popup:close', this.#onClose, { signal });
    popup.addEventListener('mionas-popup:complete', () => (this.hidden = true), { signal });

    if (window.Shopify?.designMode) return;
    const showNow = this.dataset.show === 'always' || popup.dataset.autoOpen !== 'true' || popup.closedBefore;
    if (!(showNow && this.#follows())) return;

    // A popup that opens on load, after a signup reload, opens in a frame queued before this one; the
    // widget then stays hidden, since a slide-out mid slide-in would jump back to the resting place.
    requestAnimationFrame(() => {
      if (this.#popupOpen) return;
      this.hidden = false;
      this.#slide('in');
    });
  }

  /** Whether the widget belongs on the page now: never in the editor's automatic flow, for a popup this visitor cannot get, or within its reshow days. */
  #follows() {
    const popup = this.#popup;
    return Boolean(!window.Shopify?.designMode && popup?.available && !popup.completed && !this.#dismissed());
  }

  /** Whether a close of the widget still hides it; 0 days hides it for good. */
  #dismissed() {
    // Before the widget had its own key, its close was stored in the popup's.
    const dismissedAt = this.#store?.read()?.dismissedAt ?? this.#popup?.store?.read()?.widgetDismissedAt;
    if (!dismissedAt) return false;

    const reshowDays = Number(this.dataset.reshowDays) || 0;
    return reshowDays === 0 || Date.now() - dismissedAt < reshowDays * DAY_MS;
  }

  /** Slides the widget out, then covers it: still laid out, so the page padding under it keeps its height. */
  #onOpen = () => {
    this.#popupOpen = true;
    if (this.hidden) {
      this.toggleAttribute('data-covered', true);
      return;
    }
    this.#slide('out', () => this.toggleAttribute('data-covered', this.#popupOpen));
  };

  #onClose = () => {
    this.#popupOpen = false;
    this.removeAttribute('data-covered');
    if (!this.#follows()) return;

    this.hidden = false;
    this.#slide('in');
  };

  /**
   * @param {'in' | 'out'} direction
   * @param {() => void} [done] - Runs in the task the slide ends in, before the next frame.
   */
  #slide(direction, done) {
    this.classList.remove('mionas-popup-widget--sliding-in', 'mionas-popup-widget--sliding-out');
    this.classList.add(`mionas-popup-widget--sliding-${direction}`);
    onAnimationEnd(this, () => {
      this.classList.remove(`mionas-popup-widget--sliding-${direction}`);
      done?.();
    });
  }

  /** @param {CustomEvent} event */
  #onEditorSelect = (event) => {
    if (event.detail?.sectionId === this.dataset.sectionId) this.hidden = false;
  };

  /** @param {CustomEvent} event */
  #onEditorDeselect = (event) => {
    if (event.detail?.sectionId === this.dataset.sectionId) this.hidden = true;
  };
}

if (!customElements.get('mionas-popup-widget')) {
  customElements.define('mionas-popup-widget', MionasPopupWidget);
}
