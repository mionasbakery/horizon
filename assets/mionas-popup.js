import { DialogComponent, DialogCloseEvent, DialogOpenEvent } from '@theme/dialog';
import { getScrollContainer, getScrollTop, scrollTo } from '@theme/scroll-container';
import { DrawerCloseEvent } from '@theme/theme-drawer';
import { unlockScroll } from '@theme/utilities';

const INTERACTIONS = ['scroll', 'pointerdown', 'keydown', 'touchstart'];
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long the page must be still before an automatic open: longer than a fling's tail and than the
 * fade of a phone's overlay scrollbar, which otherwise still shows over the popup.
 */
const SETTLE_MS = 800;
/** A handle drag closes the sheet past this share of its height, or faster than this in px/ms. */
const DRAG_CLOSE_SHARE = 0.25;
const DRAG_CLOSE_SPEED = 0.5;

/** Session keys already cleared on this page load, so a second store on one key keeps its writes. */
const clearedOnReload = new Set();

/**
 * The popup that is opening or open. DialogComponent opens a frame after open() runs, so an open
 * dialog alone would let two popups that arm together both open.
 * @type {HTMLElement | null}
 */
let activePopup = null;

/**
 * Fingers and scrolling, tracked from module load. A finger latches the page as its scroller, and
 * Chrome keeps scrolling it through the scroll lock, so an automatic open waits for every finger to
 * lift. A touch fires pointerdown before touchstart, and pointerdown is also a first interaction that
 * can trigger the open, so it counts as a finger; only touchend releases it, since Chrome cancels the
 * pointer once the page scrolls.
 */
const gesture = { touching: false, lastMove: -Infinity };
window.addEventListener(
  'pointerdown',
  (event) => {
    if (event.pointerType === 'touch') gesture.touching = true;
  },
  { capture: true, passive: true }
);
for (const type of ['touchstart', 'touchmove']) {
  window.addEventListener(
    type,
    () => {
      gesture.touching = true;
      gesture.lastMove = performance.now();
    },
    { capture: true, passive: true }
  );
}
for (const type of ['touchend', 'touchcancel']) {
  window.addEventListener(
    type,
    (event) => {
      if (!(/** @type {TouchEvent} */ (event).touches.length)) gesture.touching = false;
      gesture.lastMove = performance.now();
    },
    { capture: true, passive: true }
  );
}
window.addEventListener('scroll', () => (gesture.lastMove = performance.now()), { capture: true, passive: true });

/**
 * One popup's memory in the visitor's browser: local storage, or with the testers audience a session
 * cookie, which the browser deletes when it closes and a page reload clears, so testers can replay the
 * first visit on demand.
 */
export class PopupStore {
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
 * Resolves once the Shopify cookie banner no longer needs an answer. showModal() makes the rest of
 * the page inert, so opening over an unanswered banner would block it.
 * @returns {Promise<void>}
 */
function waitForConsent() {
  return new Promise((resolve) => {
    const shopify = window.Shopify;
    if (typeof shopify?.loadFeatures !== 'function') return resolve();

    shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], (error) => {
      const privacy = window.Shopify?.customerPrivacy;
      if (error || !privacy) return resolve();

      const undecided = privacy.shouldShowBanner?.() && privacy.currentVisitorConsent?.()?.marketing === '';
      if (!undecided) return resolve();

      document.addEventListener('visitorConsentCollected', () => resolve(), { once: true });
    });
  });
}

/**
 * How far down the page the visitor has scrolled, 0 to 1. On desktop Horizon scrolls .page-wrapper,
 * not the window, so the window's scroll position stays 0 there.
 * @returns {number}
 */
function scrolledShare() {
  const container = getScrollContainer();
  const scrollable = container.scrollHeight - container.clientHeight;
  // Zoom and high-density screens can stop scrollTop a fraction of a pixel short of the end, which
  // would make a 100% depth unreachable.
  return scrollable <= 1 ? 1 : Math.min(1, (container.scrollTop + 1) / scrollable);
}

/**
 * A Mionas popup: a dialog on desktop and a bottom sheet with a handle on phones. It opens by itself
 * after the section's triggers, or through open(). Other parts attach through its public API and its
 * events: `mionas-popup:open` ({ source }), `mionas-popup:close` ({ method }) and
 * `mionas-popup:complete`.
 *
 * @extends DialogComponent
 */
export class MionasPopup extends DialogComponent {
  requiredRefs = ['dialog'];

  /** False when this visitor must never get the popup, from isAvailable(). */
  available = true;
  /** True once complete() ran, on this page view or an earlier one. */
  completed = false;
  /** True when the visitor closed the popup on an earlier page view. */
  closedBefore = false;
  /** @type {PopupStore | undefined} */
  store;

  /** Set once the visitor opened or closed the popup, so a pending automatic open never fires late. */
  #autoCancelled = false;
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

    this.#autoCancelled = true;
    this.#openSource = source;
    activePopup = this;
    this.showDialog();
  }

  /** Marks the popup done for this visitor, so it never opens by itself again. */
  complete() {
    this.completed = true;
    this.#autoCancelled = true;
    this.store?.write({ state: 'completed' });
    this.dispatchEvent(new CustomEvent('mionas-popup:complete'));
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
   * Another store beside this popup's, under `<storage key>-<suffix>`, with the same session rule.
   * @param {string} suffix
   */
  createStore(suffix) {
    return new PopupStore(`${this.#storageKey}-${suffix}`, this.dataset.audience === 'testers');
  }

  /**
   * Whether this visitor may ever get the popup. Subclasses decide; an unavailable popup never opens
   * by itself.
   * @param {Record<string, any>} stored
   * @returns {boolean}
   */
  isAvailable(stored) {
    return true;
  }

  /**
   * Runs once after the storage is read and before the automatic open is armed. A subclass may open
   * or complete the popup here, which cancels the automatic open.
   * @param {Record<string, any>} stored
   */
  prepare(stored) {}

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

  get #storageKey() {
    return this.dataset.storageKey || this.id;
  }

  connectedCallback() {
    super.connectedCallback();
    this.store = new PopupStore(this.#storageKey, this.dataset.audience === 'testers');
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
      return;
    }

    const stored = this.store.read();
    if (!stored) return;

    this.completed = stored.state === 'completed';
    this.closedBefore = stored.state === 'closed';
    this.available = this.isAvailable(stored);
    if (!this.available) return;

    this.prepare(stored);
    if (this.completed || this.#autoCancelled) return;
    if (this.dataset.autoOpen === 'true' && this.#mayAutoOpen(stored)) waitForConsent().then(() => this.#arm());
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
    this.#autoCancelled = true;
    this.dispatchEvent(new CustomEvent('mionas-popup:open', { detail: { source: this.#openSource } }));
    this.#openSource = 'api';
  };

  #onClose = () => {
    this.#isOpen = false;
    document.removeEventListener('touchmove', this.#blockTouchScroll, { capture: true });
    this.#autoCancelled = true;
    if (activePopup === this) activePopup = null;
    if (!this.completed && !window.Shopify?.designMode) {
      this.store?.write({ state: 'closed', closedAt: Date.now() });
    }
    this.dispatchEvent(new CustomEvent('mionas-popup:close', { detail: { method: this.#closeMethod } }));
    this.#closeMethod = 'backdrop';
  };

  /** @param {KeyboardEvent} event */
  #onEscapeCapture = (event) => {
    if (event.key === 'Escape') this.#closeMethod = 'escape';
  };

  /** @param {{ state?: string, closedAt?: number }} stored */
  #mayAutoOpen(stored) {
    if (!stored.state) return true;

    const reshowDays = Number(this.dataset.reshowDays) || 0;
    return stored.state === 'closed' && reshowDays > 0 && Date.now() - (stored.closedAt ?? 0) >= reshowDays * DAY_MS;
  }

  /**
   * Opens after the delay and, when required, the first interaction or scroll depth. With exit intent
   * on, those conditions only make the visitor eligible, and the exit signal opens it instead.
   */
  #arm() {
    const delay = Math.max(0, Number(this.dataset.delay) || 0) * 1000;
    const depth = (Number(this.dataset.scrollDepth) || 0) / 100;
    const exitIntent = this.dataset.exitIntent === 'true';
    let delayDone = false;
    let interacted = this.dataset.waitForInteraction !== 'true';

    /**
     * Opening mid-swipe puts the dialog under the finger and mid-scroll over moving content, so the
     * open waits until no finger is down and the page has not scrolled for SETTLE_MS.
     * @param {string} source
     */
    const open = (source) => {
      if (this.#autoCancelled || this.refs.dialog.open) return;

      const cart = document.querySelector('theme-drawer#cart-drawer');
      if (cart?.hasAttribute('open')) {
        cart.addEventListener(DrawerCloseEvent.eventName, () => open(source), { once: true });
        return;
      }

      if (activePopup && activePopup !== this && activePopup.isConnected) {
        activePopup.addEventListener('mionas-popup:close', () => open(source), { once: true });
        return;
      }

      const wait = gesture.touching ? SETTLE_MS : gesture.lastMove + SETTLE_MS - performance.now();
      if (wait > 0) {
        setTimeout(() => open(source), wait);
        return;
      }

      this.open({ source });
    };

    const openIfReady = () => {
      if (exitIntent || !delayDone || !interacted) return;
      open('auto');
    };

    if (exitIntent) this.#watchExit(() => delayDone && interacted, () => open('exit'));

    /** @param {Event} event */
    const onInteraction = (event) => {
      if (depth > 0 && (event.type !== 'scroll' || scrolledShare() < depth)) return;

      interacted = true;
      for (const type of INTERACTIONS) window.removeEventListener(type, onInteraction, { capture: true });
      openIfReady();
    };

    if (!interacted) {
      for (const type of INTERACTIONS) window.addEventListener(type, onInteraction, { capture: true, passive: true });
    }

    setTimeout(() => {
      delayDone = true;
      openIfReady();
    }, delay);
  }

  /**
   * Calls `onExit` once the visitor looks about to leave: the pointer leaving the top of the window on
   * desktop, or a fast scroll back up on touch screens. The back button is never intercepted.
   * @param {() => boolean} isEngaged
   * @param {() => void} onExit
   */
  #watchExit(isEngaged, onExit) {
    const controller = new AbortController();
    const { signal } = controller;
    const fire = () => {
      if (!isEngaged()) return;
      controller.abort();
      onExit();
    };

    document.addEventListener(
      'mouseout',
      (event) => {
        if (!event.relatedTarget && event.clientY <= 0) fire();
      },
      { signal }
    );

    // A wheel or trackpad flick up on desktop is ordinary reading, not an exit.
    if (!window.matchMedia('(hover: none)').matches) return;

    // A quarter of the screen upwards within half a second, after reading past the first screen.
    let lastTop = getScrollContainer().scrollTop;
    let lastTime = performance.now();
    window.addEventListener(
      'scroll',
      () => {
        const top = getScrollContainer().scrollTop;
        const now = performance.now();
        if (now - lastTime > 500 || top > lastTop) {
          lastTop = top;
          lastTime = now;
          return;
        }
        if (lastTop > window.innerHeight && lastTop - top > window.innerHeight / 4) fire();
      },
      { signal, capture: true, passive: true }
    );
  }

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

  /** @param {CustomEvent} event */
  #onEditorSelect = (event) => {
    if (event.detail?.sectionId !== this.dataset.sectionId) return;
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
