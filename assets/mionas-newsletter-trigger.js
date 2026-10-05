import { getScrollContainer } from '@theme/scroll-container';
import { DrawerCloseEvent, DrawerOpenEvent } from '@theme/theme-drawer';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long the page must be still before an automatic open: longer than a fling's tail and than the
 * fade of a phone's overlay scrollbar, which otherwise still shows over the dialog.
 */
const SETTLE_MS = 800;
/**
 * How long a release may wait for its click. The dialog opens after that click, since a page made
 * inert between press and click loses the click.
 */
const CLICK_WAIT_MS = 100;
/** The fields in which a visitor types; a key press elsewhere is an ordinary action. */
const TEXT_ENTRY =
  'input:is([type="text"], [type="email"], [type="search"], [type="tel"], [type="password"], [type="number"], :not([type])), textarea';
/** Plain words for the debug log. */
const ACTIVITY_NAMES = {
  click: 'click or tap',
  keydown: 'key press',
  change: 'form control change',
  input: 'typing in a field',
  scroll: 'page scroll',
  mousemove: 'mouse movement',
};
const PAUSE_NAMES = { typing: 'the visitor is typing in a field', hidden: 'the tab is hidden', cart: 'the cart drawer is open' };
/** @param {number} ms */
const formatDate = (ms) => new Date(ms).toLocaleString();

/**
 * Fingers, the mouse button and scrolling, tracked from module load. A finger latches the page as its
 * scroller, and Chrome keeps scrolling it through the scroll lock, so an automatic open waits for
 * every finger to lift. A touch fires pointerdown before touchstart, so pointerdown already counts as
 * a finger; only touchend releases it, since Chrome cancels the pointer once the page scrolls. A mouse
 * button still down when the count ends delays the open until after its click.
 */
const gesture = { touching: false, mouseDown: false, lastMove: -Infinity };
window.addEventListener(
  'pointerdown',
  (event) => {
    if (event.pointerType === 'touch') gesture.touching = true;
    if (event.pointerType === 'mouse') gesture.mouseDown = true;
  },
  { capture: true, passive: true }
);
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(
    type,
    (event) => {
      if (event.pointerType === 'mouse') gesture.mouseDown = false;
    },
    { capture: true, passive: true }
  );
}
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
 * Opens the dialog once nothing is in progress, for an open the visitor did not ask for. It waits for
 * every finger and mouse button to lift and for the click that follows, since a page made inert
 * between press and click loses the click. Then it waits for a still page and for any other dialog
 * to close, because an open mid-swipe puts the dialog under the finger and over moving content.
 * @param {any} dialog
 */
function openWhenStill(dialog) {
  if (dialog.doneOnPage || dialog.refs.dialog.open) return;
  const retry = () => openWhenStill(dialog);

  if (gesture.touching || gesture.mouseDown) {
    dialog.log('open', 'idle time reached, waiting for the finger or mouse button to lift so the click still works');
    const release = new AbortController();
    const onRelease = () => {
      if (gesture.touching || gesture.mouseDown) return;
      release.abort();
      let retried = false;
      const later = () => {
        if (retried) return;
        retried = true;
        setTimeout(retry);
      };
      window.addEventListener('click', later, { capture: true, once: true });
      setTimeout(later, CLICK_WAIT_MS);
    };
    for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) {
      window.addEventListener(type, onRelease, { capture: true, passive: true, signal: release.signal });
    }
    return;
  }

  const active = dialog.constructor.active;
  if (active && active !== dialog && active.isConnected) {
    dialog.log('open', 'idle time reached, waiting for another dialog (such as the cart drawer) to close');
    active.addEventListener('mionas-dialog:close', retry, { once: true });
    return;
  }

  const wait = gesture.lastMove + SETTLE_MS - performance.now();
  if (wait > 0) {
    dialog.log('open', 'idle time reached, waiting for the page to stop scrolling', { waitMs: Math.round(wait) });
    setTimeout(retry, wait);
    return;
  }

  dialog.log('open', 'opening the popup by itself now');
  dialog.open({ source: 'auto' });
}

/**
 * Resolves once the Shopify cookie banner no longer needs an answer. An open dialog makes the rest of
 * the page inert, so a dialog over an unanswered banner would block it. mionas-newsletter-corner-fold.js holds
 * a copy, because scripts outside the theme's import map cannot share a module.
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
 * Counts down the visitor's idle time. A reset starts the count again; a pause stops it until every
 * pause reason has ended, and the count then starts again from the full time.
 */
class IdleTimer {
  #ms;
  #onDone;
  #log;
  #timeout = 0;
  #running = false;
  /** @type {Set<string>} */
  #pauses = new Set();

  /**
   * @param {number} ms
   * @param {() => void} onDone
   * @param {(area: string, event: string, details?: Record<string, any>) => void} log
   */
  constructor(ms, onDone, log) {
    this.#ms = ms;
    this.#onDone = onDone;
    this.#log = log;
  }

  get started() {
    return this.#running;
  }

  start() {
    this.#log('count', 'idle countdown started, the popup opens after this long without activity', { seconds: this.#ms / 1000 });
    this.#running = true;
    this.#schedule();
  }

  /** @param {string} cause */
  reset(cause) {
    this.#log('count', 'visitor was active, idle countdown starts over', {
      activity: ACTIVITY_NAMES[/** @type {keyof typeof ACTIVITY_NAMES} */ (cause)] ?? cause,
    });
    this.#schedule();
  }

  /** @param {string} reason */
  pause(reason) {
    this.#pauses.add(reason);
    this.#log('count', 'idle countdown paused', { while: PAUSE_NAMES[/** @type {keyof typeof PAUSE_NAMES} */ (reason)] ?? reason });
    clearTimeout(this.#timeout);
  }

  /** @param {string} reason */
  resume(reason) {
    if (!this.#pauses.delete(reason)) return;
    this.#log('count', 'pause ended, idle countdown starts over from the full time', {
      after: PAUSE_NAMES[/** @type {keyof typeof PAUSE_NAMES} */ (reason)] ?? reason,
    });
    this.#schedule();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#timeout);
  }

  #schedule() {
    clearTimeout(this.#timeout);
    if (!this.#running || this.#pauses.size) return;
    this.#timeout = setTimeout(() => {
      this.stop();
      this.#onDone();
    }, this.#ms);
  }
}

/**
 * Opens the newsletter dialog named by its `for` attribute by itself once the visitor has been idle for
 * the section's idle time, counted from the first action on the page or, on a page with the cookie
 * banner, from the first action after the answer. It knows the dialog only
 * through the dialog's public API and events, and the dialog works without it.
 */
class MionasNewsletterTrigger extends HTMLElement {
  #listeners = new AbortController();

  connectedCallback() {
    if (window.Shopify?.designMode) return;

    const dialog = document.getElementById(this.getAttribute('for') ?? '');
    if (dialog) customElements.whenDefined(dialog.localName).then(() => this.#attach(dialog));
  }

  disconnectedCallback() {
    this.#listeners.abort();
  }

  /** @param {any} dialog */
  async #attach(dialog) {
    if (dialog.completed) {
      dialog.log('schedule', 'this browser already signed up, the popup never opens by itself');
      return;
    }
    if (dialog.doneOnPage || !this.#due(dialog)) return;

    dialog.log('banner', 'waiting for the visitor to answer the cookie banner (goes on at once when there is no banner)');
    // Armed only after the answer, so the answer's click and anything done while the banner was up
    // never start the count.
    await waitForConsent();
    if (!this.isConnected || dialog.doneOnPage) return;
    dialog.log('count', 'ready, the idle countdown starts at the next scroll, tap, click or key press');
    this.#arm(dialog);
  }

  /**
   * Whether this visitor may get the automatic open: never shown it, or shown or closed it at least the
   * section's reshow days ago. A close stored before shownAt existed counts through closedAt.
   * @param {any} dialog
   */
  #due(dialog) {
    const stored = dialog.store?.read();
    if (!stored || stored.state === 'completed') return false;

    const last = Math.max(stored.shownAt ?? 0, stored.closedAt ?? 0);
    if (!last) {
      dialog.log('schedule', 'never shown in this browser, the popup may open by itself');
      return true;
    }
    const reshowDays = Number(this.dataset.reshowDays) || 0;
    const nextAt = last + reshowDays * DAY_MS;
    if (reshowDays === 0 || Date.now() < nextAt) {
      if (reshowDays === 0) {
        dialog.log('schedule', 'already shown once and the setting allows only one automatic open', {
          lastShown: formatDate(last),
        });
      } else {
        dialog.log('schedule', 'shown too recently, the popup does not open by itself yet', {
          lastShown: formatDate(last),
          opensAgainFrom: formatDate(nextAt),
        });
      }
      return false;
    }
    dialog.log('schedule', `last shown over ${reshowDays} days ago, the popup may open by itself again`, {
      lastShown: formatDate(last),
    });
    return true;
  }

  /** @param {any} dialog */
  #arm(dialog) {
    const flag = (/** @type {string} */ name) => this.dataset[name] === 'true';
    const idle = Math.max(1, Number(this.dataset.idle) || 8) * 1000;
    const { signal } = this.#listeners;
    /**
     * @param {EventTarget} target
     * @param {string} type
     * @param {(event: any) => void} handler
     */
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal, capture: true, passive: true });

    const timer = new IdleTimer(idle, () => openWhenStill(dialog), (area, event, details) => dialog.log(area, event, details));

    /** @param {Event} event */
    const isPageScroll = (event) =>
      event.target === document || event.target === document.documentElement || event.target === getScrollContainer();

    /** @param {Event} event */
    const onAction = (event) => {
      if (!event.isTrusted) return;
      if (!timer.started) {
        timer.start();
        return;
      }
      if (event.type === 'scroll' && isPageScroll(event)) {
        if (flag('resetOnScroll')) timer.reset('scroll');
        return;
      }
      if (flag('resetOnPress')) timer.reset(event.type);
    };

    // Before the count starts these begin it; afterwards they reset it. A finger's pointerdown is left
    // out, because every touch scroll starts with one and a page scroll must not reset.
    for (const type of ['click', 'keydown', 'scroll', 'change', 'input']) listen(window, type, onAction);
    listen(window, 'touchend', (event) => {
      if (event.isTrusted && !timer.started) timer.start();
    });
    if (flag('resetOnScroll')) {
      listen(window, 'pointermove', (event) => {
        if (event.pointerType === 'mouse' && timer.started) timer.reset('mousemove');
      });
    }

    if (flag('pauseWhileTyping')) {
      listen(document, 'focusin', (event) => {
        if (event.target instanceof Element && event.target.matches(TEXT_ENTRY)) timer.pause('typing');
      });
      listen(document, 'focusout', () => timer.resume('typing'));
      if (document.activeElement?.matches(TEXT_ENTRY)) timer.pause('typing');
    }

    if (flag('pauseWhileHidden')) {
      const onVisibility = () => (document.visibilityState === 'hidden' ? timer.pause('hidden') : timer.resume('hidden'));
      listen(document, 'visibilitychange', onVisibility);
      onVisibility();
    }

    const cart = document.querySelector('theme-drawer#cart-drawer');
    if (flag('pauseForCart') && cart) {
      listen(cart, DrawerOpenEvent.eventName, () => timer.pause('cart'));
      listen(cart, DrawerCloseEvent.eventName, () => timer.resume('cart'));
      if (cart.hasAttribute('open')) timer.pause('cart');
    }

    dialog.addEventListener(
      'mionas-dialog:open',
      () => {
        timer.stop();
        this.#listeners.abort();
      },
      { once: true, signal }
    );

    // The count never starts at page load: a dialog on an untouched page can become its LCP element,
    // and Google's crawler, which never acts, would see it.
  }
}

if (!customElements.get('mionas-newsletter-trigger')) {
  customElements.define('mionas-newsletter-trigger', MionasNewsletterTrigger);
}
