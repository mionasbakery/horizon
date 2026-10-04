import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';

/**
 * The folded corner that opens the Mionas dialog named by its `for` attribute. It knows the dialog only
 * through the dialog's public API and events, and the dialog works without it. It has no close
 * control; the caller's scripts decide when it shows through show() and hide().
 */
export class MionasCornerFold extends Component {
  requiredRefs = ['square'];

  /** @type {any} */
  #dialog = null;
  /** @type {ResizeObserver | undefined} */
  #observer;
  #listeners = new AbortController();
  /** Set while the dialog is open, so a fold that ends after a quick close does not cover the corner fold. */
  #dialogOpen = false;
  /** Set by show() and cleared by hide(), so a dialog close uncovers only a corner fold that was shown. */
  #shown = false;

  connectedCallback() {
    super.connectedCallback();

    // The fold is fixed over the page end, so the page gets its height as extra room to scroll to the
    // footer. The square is turned 45° about the corner, so the visible triangle is its side over √2
    // tall. offsetWidth ignores transforms; the bounding box would catch the unfold mid-scale.
    const { square } = this.refs;
    this.#observer = new ResizeObserver(() => {
      const height = Math.ceil(square.offsetWidth / Math.SQRT2);
      document.documentElement.style.setProperty('--mionas-corner-fold-height', `${height}px`);
    });
    this.#observer.observe(square);

    if (window.Shopify?.designMode) {
      const { signal } = this.#listeners;
      document.addEventListener('shopify:section:select', this.#onEditorSelect, { signal });
      document.addEventListener('shopify:block:select', this.#onEditorSelect, { signal });
      document.addEventListener('shopify:section:deselect', this.#onEditorDeselect, { signal });
    }

    const dialog = document.getElementById(this.getAttribute('for') ?? '');
    if (dialog) customElements.whenDefined(dialog.localName).then(() => this.#attach(dialog));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#listeners.abort();
    this.#observer?.disconnect();
    document.documentElement.style.removeProperty('--mionas-corner-fold-height');
  }

  openDialog = () => {
    this.#dialog?.open({ source: 'launcher' });
  };

  /** Shows the corner fold; while the dialog is open, it shows when the dialog closes. */
  show() {
    this.#shown = true;
    if (this.#dialogOpen || !this.hidden) return;
    this.hidden = false;
    this.#fold('in');
  }

  hide() {
    this.#shown = false;
    this.hidden = true;
  }

  /**
   * Runs once the corner fold found its dialog. A subclass decides here when the corner fold shows.
   * @param {any} dialog
   */
  dialogConnected(dialog) {}

  /** @param {any} dialog */
  #attach(dialog) {
    this.#dialog = dialog;

    const { signal } = this.#listeners;
    dialog.addEventListener('mionas-dialog:open', this.#onOpen, { signal });
    dialog.addEventListener('mionas-dialog:close', this.#onClose, { signal });
    this.dialogConnected(dialog);
  }

  /** Folds the corner fold away, then covers it: still laid out, so the page padding under it keeps its height. */
  #onOpen = () => {
    this.#dialogOpen = true;
    if (this.hidden) {
      this.toggleAttribute('data-covered', true);
      return;
    }
    this.#fold('out', () => this.toggleAttribute('data-covered', this.#dialogOpen));
  };

  #onClose = () => {
    this.#dialogOpen = false;
    this.removeAttribute('data-covered');
    if (!this.#shown) return;

    this.hidden = false;
    this.#fold('in');
  };

  /**
   * @param {'in' | 'out'} direction
   * @param {() => void} [done] - Runs in the task the fold ends in, before the next frame.
   */
  #fold(direction, done) {
    const name = direction === 'in' ? 'mionas-corner-fold--unfolding' : 'mionas-corner-fold--folding';
    this.classList.remove('mionas-corner-fold--unfolding', 'mionas-corner-fold--folding');
    this.classList.add(name);
    onAnimationEnd(this, () => {
      this.classList.remove(name);
      done?.();
    });
  }

  /** @param {CustomEvent} event */
  #onEditorSelect = (event) => {
    if (event.detail?.sectionId !== this.dataset.sectionId) return;
    // A selected block outside the corner fold is part of the dialog, which the corner fold would sit behind.
    this.hidden = event.type === 'shopify:block:select' && !this.contains(/** @type {Node} */ (event.target));
  };

  /** @param {CustomEvent} event */
  #onEditorDeselect = (event) => {
    if (event.detail?.sectionId === this.dataset.sectionId) this.hidden = true;
  };
}

if (!customElements.get('mionas-corner-fold')) {
  customElements.define('mionas-corner-fold', MionasCornerFold);
}
