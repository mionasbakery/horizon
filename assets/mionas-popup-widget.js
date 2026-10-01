import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';

/**
 * The tab or bar that opens the Mionas popup named by its `for` attribute. It knows the popup only
 * through the popup's public API and events, and the popup works without it. It has no close
 * control; the caller's scripts decide when it shows through show() and hide().
 */
export class MionasPopupWidget extends Component {
  /** @type {any} */
  #popup = null;
  /** @type {ResizeObserver | undefined} */
  #observer;
  #listeners = new AbortController();
  /** Set while the popup is open, so a slide-out that ends after a quick close does not cover the widget. */
  #popupOpen = false;
  /** Set by show() and cleared by hide(), so a popup close uncovers only a widget that was shown. */
  #shown = false;

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

  /** Shows the widget; while the popup is open, it shows when the popup closes. */
  show() {
    this.#shown = true;
    if (this.#popupOpen || !this.hidden) return;
    this.hidden = false;
    this.#slide('in');
  }

  hide() {
    this.#shown = false;
    this.hidden = true;
  }

  /**
   * Runs once the widget found its popup. A subclass decides here when the widget shows.
   * @param {any} popup
   */
  popupConnected(popup) {}

  /** @param {any} popup */
  #attach(popup) {
    this.#popup = popup;

    const { signal } = this.#listeners;
    popup.addEventListener('mionas-popup:open', this.#onOpen, { signal });
    popup.addEventListener('mionas-popup:close', this.#onClose, { signal });
    this.popupConnected(popup);
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
    if (!this.#shown) return;

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
    if (event.detail?.sectionId !== this.dataset.sectionId) return;
    // A selected block outside the widget is part of the popup, which the widget would sit behind.
    this.hidden = event.type === 'shopify:block:select' && !this.contains(/** @type {Node} */ (event.target));
  };

  /** @param {CustomEvent} event */
  #onEditorDeselect = (event) => {
    if (event.detail?.sectionId === this.dataset.sectionId) this.hidden = true;
  };
}

if (!customElements.get('mionas-popup-widget')) {
  customElements.define('mionas-popup-widget', MionasPopupWidget);
}
