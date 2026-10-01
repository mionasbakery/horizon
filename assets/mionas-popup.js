import { DialogComponent, DialogCloseEvent, DialogOpenEvent } from '@theme/dialog';
import { getScrollTop, scrollTo } from '@theme/scroll-container';
import { unlockScroll } from '@theme/utilities';

/** A handle drag closes the sheet past this share of its height, or faster than this in px/ms. */
const DRAG_CLOSE_SHARE = 0.25;
const DRAG_CLOSE_SPEED = 0.5;

/**
 * The popup that is opening or open. DialogComponent opens a frame after open() runs, so an open
 * dialog alone would let two popups that arm together both open.
 * @type {HTMLElement | null}
 */
let activePopup = null;

/**
 * A Mionas popup: a dialog on desktop and a bottom sheet with a handle on phones. It opens only
 * through open(); the caller's scripts decide when. Other parts attach through its public API and
 * its events: `mionas-popup:open` ({ source }) and `mionas-popup:close` ({ method }).
 *
 * @extends DialogComponent
 */
export class MionasPopup extends DialogComponent {
  requiredRefs = ['dialog'];

  /** The popup that is opening or open, so a caller can wait for it before an open of its own. */
  static get active() {
    return activePopup;
  }

  /** Backdrop clicks close through DialogComponent's private handler, so that is the default. */
  #closeMethod = 'backdrop';
  #openSource = 'api';
  /** Set by a handle drag, so the click that follows the pointer release does not close the sheet. */
  #dragMoved = false;
  /** Set from the open until the popup's own close steps ran, to catch a close the browser made alone. */
  #isOpen = false;
  #closeDialog = this.closeDialog;

  /**
   * The popup's own buttons stay clickable while it closes, so a second call is ignored. A handle drag
   * leaves the sheet moved and its exit curve changed, which are cleared once it is closed.
   */
  closeDialog = async () => {
    const { dialog } = this.refs;
    if (!dialog.open || dialog.classList.contains('dialog-closing')) return;
    await this.#closeDialog();
    dialog.style.removeProperty('translate');
    dialog.style.removeProperty('--mionas-popup-easing-out');
  };

  /**
   * A fling keeps moving the page under the scroll lock on phones, and a touch on the dialog cannot
   * stop it. The open pins the page to the position DialogComponent reads here and restores on close,
   * which ends the fling and keeps the close from jumping back.
   */
  showDialog() {
    if (this.refs.dialog.open) return;

    document.addEventListener('touchmove', this.#blockTouchScroll, { capture: true, passive: false });
    const top = getScrollTop();
    this.addEventListener(DialogOpenEvent.eventName, () => scrollTo({ top, behavior: 'instant' }), { once: true });
    super.showDialog();
  }

  /**
   * Opens the popup.
   * @param {{ source?: string }} [options] - `source` goes into the `mionas-popup:open` event.
   */
  open({ source = 'api' } = {}) {
    if (this.refs.dialog.open) return;

    this.#openSource = source;
    activePopup = this;
    this.showDialog();
  }

  /** @param {string} method */
  closeWith(method) {
    this.#closeMethod = method;
    this.closeDialog();
  }

  dismiss = () => this.closeWith('close');

  handleTap = () => {
    if (this.#dragMoved) return;
    this.closeWith('handle');
  };

  /**
   * Points aria-labelledby at the first visible heading in `view`. Headings come from merchant
   * blocks with no fixed id, so the Liquid aria-label is only the fallback.
   * @param {HTMLElement} view
   * @param {string} [suffix]
   */
  labelFrom(view, suffix = 'label') {
    const heading = [...view.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].find(
      (element) => !element.closest('[hidden]')
    );
    if (!heading) return;

    heading.id ||= `${this.id}-${suffix}`;
    this.refs.dialog.setAttribute('aria-labelledby', heading.id);
  }

  connectedCallback() {
    super.connectedCallback();
    this.labelFrom(this.refs.dialog);

    this.addEventListener(DialogOpenEvent.eventName, this.#onOpen);
    this.addEventListener(DialogCloseEvent.eventName, this.#onClose);
    this.addEventListener('keydown', this.#onEscapeCapture, { capture: true });
    this.refs.handle?.addEventListener('pointerdown', this.#onHandleDown);
    this.refs.dialog.addEventListener('cancel', this.#onCancel);
    this.refs.dialog.addEventListener('close', this.#onNativeClose);

    if (window.Shopify?.designMode) {
      document.addEventListener('shopify:section:select', this.#onEditorSelect);
      document.addEventListener('shopify:block:select', this.#onEditorSelect);
      document.addEventListener('shopify:section:deselect', this.#onEditorDeselect);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('touchmove', this.#blockTouchScroll, { capture: true });
    document.removeEventListener('shopify:section:select', this.#onEditorSelect);
    document.removeEventListener('shopify:block:select', this.#onEditorSelect);
    document.removeEventListener('shopify:section:deselect', this.#onEditorDeselect);
  }

  /**
   * Chrome on Android still scrolls the page, or moves its address bar, under the scroll lock from a
   * swipe that started before the popup opened or on the page around it. Nothing inside a popup
   * scrolls, so every cancelable touchmove is cancelled while it is open; the handle drags through
   * pointer events, which this leaves alone.
   * @param {TouchEvent} event
   */
  #blockTouchScroll = (event) => {
    if (event.cancelable) event.preventDefault();
  };

  /**
   * Android's back gesture closes a modal dialog natively, past DialogComponent, which then never
   * releases the scroll lock. The gesture is routed through the popup's own close instead.
   * @param {Event} event
   */
  #onCancel = (event) => {
    event.preventDefault();
    this.closeWith('back');
  };

  /**
   * Chrome does not always let the page cancel the back gesture, and the dialog then closes alone; the
   * scroll lock is released and the popup's close steps run here instead.
   */
  #onNativeClose = () => {
    if (!this.#isOpen) return;
    const { dialog } = this.refs;
    dialog.classList.remove('dialog-closing');
    dialog.style.removeProperty('translate');
    dialog.style.removeProperty('--mionas-popup-easing-out');
    unlockScroll(dialog);
    this.#closeMethod = 'back';
    this.dispatchEvent(new DialogCloseEvent());
  };

  #onOpen = () => {
    this.#isOpen = true;
    this.dispatchEvent(new CustomEvent('mionas-popup:open', { detail: { source: this.#openSource } }));
    this.#openSource = 'api';
  };

  #onClose = () => {
    this.#isOpen = false;
    document.removeEventListener('touchmove', this.#blockTouchScroll, { capture: true });
    if (activePopup === this) activePopup = null;
    this.dispatchEvent(new CustomEvent('mionas-popup:close', { detail: { method: this.#closeMethod } }));
    this.#closeMethod = 'backdrop';
  };

  /** @param {KeyboardEvent} event */
  #onEscapeCapture = (event) => {
    if (event.key === 'Escape') this.#closeMethod = 'escape';
  };

  /**
   * Drags the sheet down by its handle, then closes it past a share of its height or on a quick flick,
   * or springs it back. The drag moves `translate`, which the open and close animations leave alone
   * because they animate `transform`, so a close starts where the finger left the sheet.
   * @param {PointerEvent} event
   */
  #onHandleDown = (event) => {
    const { dialog, handle } = this.refs;
    if (!event.isPrimary || !handle || dialog.classList.contains('dialog-closing')) return;

    const startY = event.clientY;
    const height = dialog.getBoundingClientRect().height;
    let lastY = startY;
    let lastTime = event.timeStamp;
    let speed = 0;
    this.#dragMoved = false;
    dialog.style.transition = 'none';
    handle.setPointerCapture(event.pointerId);

    const drag = new AbortController();
    /** @param {PointerEvent} move */
    const onMove = (move) => {
      const offset = Math.max(0, move.clientY - startY);
      if (offset > 4) this.#dragMoved = true;
      speed = (move.clientY - lastY) / Math.max(1, move.timeStamp - lastTime);
      lastY = move.clientY;
      lastTime = move.timeStamp;
      dialog.style.translate = `0 ${offset}px`;
    };
    const onEnd = () => {
      drag.abort();
      dialog.style.removeProperty('transition');
      const offset = Math.max(0, lastY - startY);
      if (this.#dragMoved && (offset > height * DRAG_CLOSE_SHARE || speed > DRAG_CLOSE_SPEED)) {
        // The exit curve starts from rest, which would stall a sheet the finger just flung.
        dialog.style.setProperty('--mionas-popup-easing-out', 'linear');
        this.closeWith('handle');
      } else {
        dialog.style.removeProperty('translate');
      }
    };
    handle.addEventListener('pointermove', onMove, { signal: drag.signal });
    handle.addEventListener('pointerup', onEnd, { signal: drag.signal });
    handle.addEventListener('pointercancel', onEnd, { signal: drag.signal });
  };

  /**
   * The editor sends a block select from the selected block's element, so a block outside the popup,
   * such as the widget, closes it and is shown alone.
   * @param {CustomEvent} event
   */
  #onEditorSelect = (event) => {
    if (event.detail?.sectionId !== this.dataset.sectionId) return;
    if (event.type === 'shopify:block:select' && !this.contains(/** @type {Node} */ (event.target))) {
      this.closeDialog();
      return;
    }
    this.showDialog();
  };

  /** @param {CustomEvent} event */
  #onEditorDeselect = (event) => {
    if (event.detail?.sectionId !== this.dataset.sectionId) return;
    this.closeDialog();
  };
}

if (!customElements.get('mionas-popup-component')) {
  customElements.define('mionas-popup-component', MionasPopup);
}
