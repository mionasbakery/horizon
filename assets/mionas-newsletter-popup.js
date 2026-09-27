import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { getScrollContainer } from '@theme/scroll-container';

const STORAGE_KEY = 'newsletter-popup';
const INTERACTIONS = ['scroll', 'pointerdown', 'keydown', 'touchstart'];
const DAY_MS = 24 * 60 * 60 * 1000;
const SETTLE_MS = 300;

/**
 * Reads the stored popup state.
 * @returns {{ test?: string, group?: string, state?: string, closedAt?: number, widgetDismissed?: boolean } | null} null when local storage
 *   is unusable, since without memory the popup would open on every page.
 */
function readStore() {
  try {
    localStorage.setItem(`${STORAGE_KEY}-probe`, '1');
    localStorage.removeItem(`${STORAGE_KEY}-probe`);
  } catch {
    return null;
  }

  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** @param {{ test?: string, group?: string, state?: string, closedAt?: number, widgetDismissed?: boolean }} patch */
function writeStore(patch) {
  const current = readStore();
  if (!current) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Quota or a storage policy change mid-session: the popup only loses its memory.
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
 * The newsletter popup.
 *
 * @extends DialogComponent
 */
class MionasNewsletterPopup extends DialogComponent {
  requiredRefs = ['dialog', 'formView', 'successView'];

  /** @type {'popup' | 'control' | null} */
  #group = null;
  #subscribed = false;
  /** Set once the visitor opened or closed the popup, so a pending automatic open never fires late. */
  #autoCancelled = false;
  /** Backdrop clicks close through DialogComponent's private handler, so that is the default. */
  #closeMethod = 'backdrop';
  /** @type {ResizeObserver | undefined} */
  #launcherObserver;
  #closeDialog = this.closeDialog;

  /**
   * DialogComponent's backdrop, Escape and resize handlers call this.closeDialog, so all of them
   * minimize. The popup's own buttons stay clickable while it closes, so a second call is ignored.
   */
  closeDialog = async () => {
    if (this.refs.dialog.classList.contains('dialog-closing')) return;
    const minimizing = this.#prepareMinimize();
    await this.#closeDialog();
    if (minimizing) this.#finishMinimize();
  };

  connectedCallback() {
    super.connectedCallback();
    this.#labelDialog(this.refs.formView);

    if (window.Shopify?.designMode) {
      document.addEventListener('shopify:section:select', this.#onEditorSelect);
      document.addEventListener('shopify:block:select', this.#onEditorSelect);
      document.addEventListener('shopify:section:deselect', this.#onEditorDeselect);
      return;
    }

    const store = readStore();
    if (!store) return;

    this.#group = this.dataset.audience === 'testers' ? 'popup' : this.#resolveGroup(store);
    this.#announceGroup();

    if (this.#group !== 'popup') return;

    this.addEventListener(DialogCloseEvent.eventName, this.#onClose);
    this.addEventListener('keydown', this.#onEscapeCapture, { capture: true });

    const outcome = this.#submitOutcome();
    if (outcome === 'success') {
      writeStore({ state: 'subscribed' });
      this.#track('subscribed');
      this.#showSuccess();
      this.showDialog();
      return;
    }
    if (outcome === 'error') {
      this.#autoCancelled = true;
      this.showDialog();
      return;
    }

    if (store.state === 'subscribed') return;

    if (this.#otherSignupSucceeded()) {
      writeStore({ state: 'subscribed' });
      return;
    }

    const autoOpen = this.dataset.autoOpen === 'true';
    this.#toggleLauncher(this.dataset.launcher === 'always' || !autoOpen || store.state === 'closed');

    if (autoOpen && this.#mayAutoOpen(store)) waitForConsent().then(() => this.#arm());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('shopify:section:select', this.#onEditorSelect);
    document.removeEventListener('shopify:block:select', this.#onEditorSelect);
    document.removeEventListener('shopify:section:deselect', this.#onEditorDeselect);
    document.removeEventListener('shopify:cart:lines-update', this.#onCartUpdate);
    this.#launcherObserver?.disconnect();
    document.documentElement.style.removeProperty('--mionas-newsletter-popup-widget-height');
  }

  decline = () => this.#closeWith('button');
  dismiss = () => this.#closeWith('close');
  continueShopping = () => this.#closeWith('button');

  dismissWidget = () => {
    this.#toggleLauncher(false);
    if (window.Shopify?.designMode) return;
    writeStore({ widgetDismissed: true });
    this.#track('widget_dismissed');
  };

  openFromLauncher = () => {
    this.#autoCancelled = true;
    if (!window.Shopify?.designMode) this.#track('shown', { source: 'launcher' });
    this.showDialog();
  };

  /**
   * A new test name draws a new group but keeps `state`, so a visitor who closed or subscribed is
   * still never shown the popup again.
   * @param {{ test?: string, group?: string }} store
   * @returns {'popup' | 'control'}
   */
  #resolveGroup(store) {
    if (this.dataset.abTest !== 'true') return 'popup';

    const test = this.dataset.testName;
    if (store.test === test && (store.group === 'popup' || store.group === 'control')) return store.group;

    const share = Number(this.dataset.popupShare) || 50;
    const group = Math.random() * 100 < share ? 'popup' : 'control';
    writeStore({ test, group });
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

  /** @param {{ state?: string, closedAt?: number }} store */
  #mayAutoOpen(store) {
    if (!store.state) return true;

    const reshowDays = Number(this.dataset.reshowDays) || 0;
    return store.state === 'closed' && reshowDays > 0 && Date.now() - (store.closedAt ?? 0) >= reshowDays * DAY_MS;
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

    // Opening mid-swipe puts the dialog under the finger and mid-scroll over moving content, so the
    // open waits until no finger is down and the page has not scrolled for SETTLE_MS.
    const settle = new AbortController();
    const listen = { signal: settle.signal, capture: true, passive: true };
    let touching = false;
    let lastMove = -Infinity;
    window.addEventListener('touchstart', () => (touching = true), listen);
    for (const type of ['touchend', 'touchcancel']) {
      window.addEventListener(
        type,
        () => {
          touching = false;
          lastMove = performance.now();
        },
        listen
      );
    }
    window.addEventListener('scroll', () => (lastMove = performance.now()), listen);

    /** @param {string} source */
    const open = (source) => {
      if (this.#autoCancelled || this.refs.dialog.open) return settle.abort();

      const wait = touching ? SETTLE_MS : lastMove + SETTLE_MS - performance.now();
      if (wait > 0) {
        setTimeout(() => open(source), wait);
        return;
      }

      settle.abort();
      this.#autoCancelled = true;
      this.#track('shown', { source });
      this.showDialog();
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

  /** @param {boolean} visible */
  #toggleLauncher(visible) {
    const { launcher } = this.refs;
    if (!(launcher instanceof HTMLElement)) return;

    const dismissed = !window.Shopify?.designMode && readStore()?.widgetDismissed;
    launcher.hidden = !visible || !!dismissed;

    // The widget is fixed over the page end, so the page gets its height as extra room to scroll to
    // the footer; the height changes when the text wraps on narrow phones.
    this.#launcherObserver ??= new ResizeObserver(([entry]) => {
      const height = entry?.target.getBoundingClientRect().height ?? 0;
      document.documentElement.style.setProperty('--mionas-newsletter-popup-widget-height', `${height}px`);
    });
    this.#launcherObserver.observe(launcher);
  }

  #showSuccess() {
    const banner = this.querySelector('.mionas-email-signup__success');
    const heading = this.refs.successView.querySelector('h2');
    if (banner && heading) heading.textContent = banner.textContent.trim();

    this.#subscribed = true;
    this.#autoCancelled = true;
    this.#toggleLauncher(false);
    this.refs.formView.hidden = true;
    this.refs.successView.hidden = false;
    this.#labelDialog(this.refs.successView);
    this.addEventListener('dialog:open', () => requestAnimationFrame(() => this.refs.successView.focus()), {
      once: true,
    });
  }

  /**
   * When the widget follows the close, points the closing animation at it. The widget is display: none
   * while the dialog is open, so it is laid out invisibly to be measured.
   * @returns {boolean}
   */
  #prepareMinimize() {
    const { dialog, launcher } = this.refs;
    const widgetFollows =
      dialog.open &&
      launcher instanceof HTMLElement &&
      !window.Shopify?.designMode &&
      !this.#subscribed &&
      this.dataset.launcher !== 'off' &&
      !readStore()?.widgetDismissed;
    if (!widgetFollows) return false;

    launcher.hidden = false;
    this.classList.add('mionas-newsletter-popup--minimizing');
    const from = dialog.getBoundingClientRect();
    const to = launcher.getBoundingClientRect();
    if (!from.width || !from.height || !to.width) {
      this.classList.remove('mionas-newsletter-popup--minimizing');
      return false;
    }

    const x = to.left + to.width / 2 - (from.left + from.width / 2);
    const y = to.top + to.height / 2 - (from.top + from.height / 2);
    dialog.style.setProperty('--mionas-newsletter-popup-minimize-x', `${x}px`);
    dialog.style.setProperty('--mionas-newsletter-popup-minimize-y', `${y}px`);
    dialog.style.setProperty('--mionas-newsletter-popup-minimize-scale-x', `${to.width / from.width}`);
    dialog.style.setProperty('--mionas-newsletter-popup-minimize-scale-y', `${to.height / from.height}`);
    dialog.classList.add('mionas-newsletter-popup__dialog--minimize');
    return true;
  }

  /** Runs after #onClose showed the widget, in the same task, so no frame shows it without its entrance. */
  #finishMinimize() {
    const { dialog, launcher } = this.refs;
    this.classList.remove('mionas-newsletter-popup--minimizing');
    dialog.classList.remove('mionas-newsletter-popup__dialog--minimize');
    for (const axis of ['x', 'y', 'scale-x', 'scale-y']) {
      dialog.style.removeProperty(`--mionas-newsletter-popup-minimize-${axis}`);
    }

    if (!(launcher instanceof HTMLElement) || launcher.hidden) return;
    launcher.classList.add('mionas-newsletter-popup__widget--arriving');
    /** @param {AnimationEvent} event */
    const onArrived = (event) => {
      if (event.target !== launcher) return;
      launcher.classList.remove('mionas-newsletter-popup__widget--arriving');
      launcher.removeEventListener('animationend', onArrived);
    };
    launcher.addEventListener('animationend', onArrived);
  }

  /** @param {string} method */
  #closeWith(method) {
    this.#closeMethod = method;
    this.closeDialog();
  }

  /** @param {KeyboardEvent} event */
  #onEscapeCapture = (event) => {
    if (event.key === 'Escape') this.#closeMethod = 'escape';
  };

  #onClose = () => {
    this.#autoCancelled = true;

    if (!this.#subscribed) {
      writeStore({ state: 'closed', closedAt: Date.now() });
      this.#track('closed', { method: this.#closeMethod });
      if (this.dataset.launcher !== 'off') this.#toggleLauncher(true);
    }
    this.#closeMethod = 'backdrop';
  };

  /**
   * Points aria-labelledby at the first heading of a view. The heading is a merchant block with no
   * fixed id, so the Liquid aria-label is only the fallback.
   * @param {HTMLElement} view
   */
  #labelDialog(view) {
    const heading = view.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (!heading) return;

    const suffix = view === this.refs.successView ? 'success' : 'form';
    heading.id ||= `MionasNewsletterPopup-${this.dataset.sectionId}-${suffix}`;
    this.refs.dialog.setAttribute('aria-labelledby', heading.id);
  }

  /** @param {CustomEvent} event */
  #onEditorSelect = (event) => {
    if (event.detail?.sectionId !== this.dataset.sectionId) return;
    this.#toggleLauncher(true);
    this.showDialog();
  };

  /** @param {CustomEvent} event */
  #onEditorDeselect = (event) => {
    if (event.detail?.sectionId !== this.dataset.sectionId) return;
    this.#toggleLauncher(false);
    this.closeDialog();
  };
}

if (!customElements.get('mionas-newsletter-popup-component')) {
  customElements.define('mionas-newsletter-popup-component', MionasNewsletterPopup);
}
