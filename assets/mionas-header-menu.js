// FORKED FROM: assets/header-menu.js @ cd022a3 (Horizon v4.1.3, 2026-07-16)
//
// RE-SYNC AFTER EVERY UPSTREAM MERGE. Git will never conflict here - this is a separate file,
// so upstream's changes to header-menu.js land silently and this copy quietly goes stale.
// That file saw 10 upstream commits in the last 12 months, so assume it moved.
//
//     git log  cd022a3..HEAD -- assets/header-menu.js   // empty? nothing to do
//     git diff cd022a3..HEAD -- assets/header-menu.js   // else: replay these hunks here
//
// Then bump the sha above. The delta list below tells you which lines are intentionally ours
// and must survive the replay.
//
// FORK OF assets/header-menu.js. Keep this file a near-verbatim copy: the ONLY intended
// deltas are listed below, and `diff assets/header-menu.js assets/mionas-header-menu.js`
// should show nothing else. Do not tidy, reformat, or modernise the copied code.
//
//   1. customElements.define('mionas-header-menu', ...) instead of 'header-menu'.
//   2. Hover activation removed: HOVER_COMMIT_DELAY_MS, the #hoverDispatchTimer, and the
//      #onPointerMove pointer tracking. The design opens on click.
//   3. New public toggle() method, bound from the Liquid via on:click="/toggle". It bails out on
//      presses originating inside [ref="submenu[]"], without which the panel's own links cannot
//      navigate - the panel is a descendant of the <li> carrying the binding. It reads the pressed
//      node from composedPath(), because component.js hands delegated handlers a proxied event
//      whose target is the <li>, not the real one.
//   4. Outside pointerdown and Escape close the panel.
//   4b. #resizeListener also calls #deactivate(). Click activation means an open panel outlives a
//      resize that hides the list it belongs to; hover activation could not.
//   5. activate() normalises event.target to the closest <li> before calling findMenuItem():
//      pointerenter always fired with the <li> as target, but click's target is the deepest
//      element hit (e.g. the link's inner <span>).
//   6. #onKeyDown's Escape handler focuses #state.activeItem directly (it IS the
//      <a ref="menuitem">, not the <li> - findMenuItem() is a descendant lookup), instead of
//      querying it for a '.menu-list__link' descendant that doesn't exist.
//
// WHY A COPY AND NOT A SUBCLASS: HeaderMenu is not exported from header-menu.js.
// WHY A COPY AND NOT A REWRITE: this class carries far more than hover - overflow/"More"
// collapsing, the --submenu-height variable driven by a MutationObserver that catches
// deferred section hydration, --submenu-opacity, and image preloading. Reimplementing that
// is how header-height jitter gets introduced.

import { Component } from '@theme/component';
import { debounce, onDocumentLoaded, setHeaderMenuStyle } from '@theme/utilities';
import { MegaMenuHoverEvent } from '@theme/events';

/**
 * A custom element that manages a header menu.
 *
 * @typedef {Object} State
 * @property {HTMLElement | null} activeItem - The currently active menu item.
 * @property {HTMLElement | null} activeOverflowItem - The overflow item shown when the More trigger is active.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} overflowMenu - The overflow menu.
 * @property {HTMLElement[]} [submenu] - The submenu in each respective menu item.
 *
 * @extends {Component<Refs>}
 */
class HeaderMenu extends Component {
  requiredRefs = ['overflowMenu'];

  /**
   * @type {MutationObserver | null}
   */
  #submenuMutationObserver = null;

  connectedCallback() {
    super.connectedCallback();

    onDocumentLoaded(this.#preloadImages);
    window.addEventListener('resize', this.#resizeListener);
    this.overflowMenu?.addEventListener('pointerleave', this.#overflowSubmenuListener);
    document.addEventListener('pointerdown', this.#onDocumentPointerDown);
    this.addEventListener('keydown', this.#onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#resizeListener);
    this.overflowMenu?.removeEventListener('pointerleave', this.#overflowSubmenuListener);
    this.#cleanupMutationObserver();
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown);
    this.removeEventListener('keydown', this.#onKeyDown);
  }

  /**
   * Debounced resize event listener to recalculate menu style
   */
  #resizeListener = debounce(() => {
    // FORK DELTA: close before recalculating.
    //
    // setHeaderMenuStyle() flips headerComponent.dataset.menuStyle between 'menu' and 'drawer',
    // which swaps which menu is visible -- but it does not touch --submenu-height or
    // --submenu-opacity. Upstream never needed it to: hover activation meant a resize was always
    // preceded by the pointer leaving the item, which closed the panel. This fork opens on click,
    // so the panel survived the flip and rendered as an open, full-height, EMPTY surface once the
    // desktop list it belonged to was hidden.
    //
    // Unconditional rather than "only when the style actually changed": setHeaderMenuStyle defers
    // its write to requestAnimationFrame, so the new value is not readable here, and closing an
    // open panel on resize is the unsurprising behaviour anyway. #deactivate() no-ops when nothing
    // is open, so this costs nothing on the common case.
    this.#deactivate();
    setHeaderMenuStyle();
  }, 100);

  #overflowSubmenuListener = () => {
    this.#deactivate();
  };

  /** @param {PointerEvent} event */
  #onDocumentPointerDown = (event) => {
    if (!this.#state.activeItem) return;
    if (event.target instanceof Node && this.contains(event.target)) return;
    this.#deactivate();
  };

  /** @param {KeyboardEvent} event */
  #onKeyDown = (event) => {
    if (event.key !== 'Escape' || !this.#state.activeItem) return;
    // FORK DELTA: #state.activeItem IS the <a ref="menuitem">, not the <li> - focus it directly
    // rather than querying it for a '.menu-list__link' descendant (which would find nothing).
    const trigger = this.#state.activeItem;
    this.#deactivate();
    if (trigger instanceof HTMLElement) trigger.focus();
  };

  /**
   * @type {State}
   */
  #state = {
    activeItem: null,
    activeOverflowItem: null,
  };

  /**
   * @type {ReturnType<typeof setTimeout> | undefined}
   */
  #pointerIdleTimer;

  /**
   * Last known pointer position for Safari hit-test reconciliation.
   * @type {{ x: number, y: number }}
   */
  #lastPointer = { x: 0, y: 0 };

  /**
   * Check if the pointer is over a different menu item and trigger activation if so.
   * Works around Safari not re-evaluating hit targets after pseudo-element changes.
   */
  #reconcilePointerTarget() {
    const { x, y } = this.#lastPointer;
    requestAnimationFrame(() => {
      const target = document.elementFromPoint(x, y);
      if (!target) return;
      const listItem = target.closest('.menu-list__list-item');
      if (listItem && !listItem.contains(this.#state.activeItem)) {
        listItem.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      }
    });
  }

  /**
   * Begin pointer tracking for the safety box on the newly active item.
   * @param {HTMLElement} item
   * @param {HTMLElement | null} previousItem
   */
  #startPointerTracking(item, previousItem) {
    const rect = item.getBoundingClientRect();
    const isOverlap = this.headerComponent?.hasAttribute('data-submenu-overlap-bottom-row');
    const boundary = isOverlap ? this.headerComponent?.querySelector('.header__row--top') : this.headerComponent;
    item.style.setProperty('--box-height', `${(boundary?.getBoundingClientRect().bottom ?? 0) - rect.top}px`);
  }

  /**
   * Get the overflow menu
   */
  get overflowMenu() {
    return /** @type {HTMLElement | null} */ (this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow"]'));
  }

  /**
   * Whether the overflow list is hovered
   * @returns {boolean}
   */
  get overflowListHovered() {
    return this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow-list"]')?.matches(':hover') ?? false;
  }

  /**
   * Find the first overflowing menu item shown by the More trigger.
   * @returns {HTMLElement | null}
   */
  #getFirstOverflowMenuItem() {
    const menuItem = this.refs.overflowMenu?.querySelector('[slot="overflow"] [ref="menuitem"]');
    return menuItem instanceof HTMLElement ? menuItem : null;
  }

  get headerComponent() {
    return /** @type {HTMLElement | null} */ (this.closest('header-component'));
  }

  /**
   * Activate the selected menu item immediately
   * @param {PointerEvent | FocusEvent} event
   */
  activate = (event) => {
    if (!(event.target instanceof Element) || !this.headerComponent) return;

    // FORK DELTA: normalise to the <li> so findMenuItem() and the .slot reads below behave exactly
    // as they did on hover.
    //
    // This is belt-and-braces, not the load-bearing step an earlier comment here claimed. That
    // comment said "a click's event.target is the deepest element hit (usually the link's inner
    // <span>)" - which is NOT true of the event this receives. assets/component.js proxies the
    // event and rewrites `target` to the element carrying on:click (component.js:250), i.e. the
    // <li> already, so this closest() is normally a no-op. Keeping it costs nothing and still
    // holds if activate() is ever called with an unproxied event. Do not infer from this line
    // that event.target is the real hit target - see the note in toggle() for why that matters.
    const listItem = event.target.closest('.menu-list__list-item, [slot="more"]') ?? event.target;

    const isMoreTrigger = listItem.slot === 'more';
    const item = findMenuItem(listItem);
    const overflowItem = isMoreTrigger ? this.#getFirstOverflowMenuItem() : null;

    if (!item || item == this.#state.activeItem) return;

    const isDefaultSlot = listItem.slot === '';

    this.dataset.overflowExpanded = (!isDefaultSlot).toString();

    const previouslyActiveItem = this.#state.activeItem;
    const previouslyActiveOverflowItem = this.#state.activeOverflowItem;

    if (previouslyActiveItem) {
      previouslyActiveItem.ariaExpanded = 'false';
    }
    if (previouslyActiveOverflowItem && previouslyActiveOverflowItem !== previouslyActiveItem) {
      previouslyActiveOverflowItem.ariaExpanded = 'false';
    }

    this.#state.activeItem = item;
    this.#state.activeOverflowItem = overflowItem;
    this.ariaExpanded = 'true';
    item.ariaExpanded = 'true';
    if (overflowItem && overflowItem !== item) {
      overflowItem.ariaExpanded = 'true';
    }

    const overflowItemSubmenu = isMoreTrigger ? findSubmenu(overflowItem) : null;
    let submenu = findSubmenu(item) || (overflowItemSubmenu ? this.overflowMenu : null);
    const hasSubmenu = Boolean(submenu);

    if (!hasSubmenu && !isDefaultSlot) {
      submenu = this.overflowMenu;
    }

    if (submenu) {
      // Activation is now click-driven, so there is nothing to debounce - dispatch immediately.
      this.dispatchEvent(new MegaMenuHoverEvent());

      // Mark submenu as active for content-visibility optimization
      submenu.dataset.active = '';

      // Cleanup any existing mutation observer from previous menu activations
      this.#cleanupMutationObserver();

      // Monitor DOM mutations to catch deferred content injection (from section hydration)
      this.#submenuMutationObserver = new MutationObserver(() => {
        requestAnimationFrame(() => {
          // Double requestAnimationFrame to ensure the height is properly calculated and not defaulting to the contain-intrinsic-size
          requestAnimationFrame(() => {
            if (submenu.offsetHeight > 0) {
              this.headerComponent?.style.setProperty('--submenu-height', `${submenu.offsetHeight}px`);
              this.#cleanupMutationObserver();
            }
          });
        });
      });
      this.#submenuMutationObserver.observe(submenu, { childList: true, subtree: true });

      // Auto-disconnect after 500ms to prevent memory leaks
      setTimeout(() => {
        this.#cleanupMutationObserver();
      }, 500);
    }

    let finalHeight = submenu?.offsetHeight || 0;

    // For overflow menu, the height needs to be either content of the submenu or the total height of the menu list links
    if (!isDefaultSlot) {
      const overflowListHeight = this.#getOverflowListLinksHeight();
      if (hasSubmenu) {
        /* Note: When the submenu is inside the overflow menu, its offsetHeight is not valid due to the lack of padding
         * we could add the padding variables to the submenu.offsetHeight, but measuring the overflowMenu.offsetHeight is just easier */
        const overflowHeight = this.overflowMenu?.offsetHeight || 0;
        finalHeight = Math.max(overflowHeight, overflowListHeight);
      } else {
        finalHeight = overflowListHeight;
      }
    }

    if (!submenu) {
      // If there is no content to open, don't try to open it
      finalHeight = 0;
    }

    const headerVisibleHeight = this.#getHeaderVisibleHeight();

    this.headerComponent.style.setProperty('--submenu-height', `${finalHeight}px`);
    this.#setFullOpenHeaderHeight(finalHeight, headerVisibleHeight);
    this.style.setProperty('--submenu-opacity', '1');
    this.#startPointerTracking(item, previouslyActiveItem);
  };

  /**
   * Toggle the panel for the clicked menu item.
   *
   * Bound from the Liquid via on:click="/toggle". Because click is claimed here, a parent item
   * with children no longer navigates, and there is deliberately NO "view all" link in the
   * panel - so a parent item's own page is not reachable from the nav. That is intentional:
   * on this store the only such item is "Tienda", which is a FRONTPAGE link, so the link led
   * to the homepage and earned nothing. If a parent item is ever pointed at a real collection,
   * revisit this - it becomes a genuine dead end.
   *
   * NOTE: #state.activeItem holds the <a ref="menuitem">, NOT the <li> - findMenuItem() is a
   * descendant lookup. Comparing the <li> here would never match and the second click would
   * never close the panel.
   *
   * @param {Event} event
   */
  toggle = (event) => {
    if (!(event.target instanceof Element)) return;

    // FORK DELTA: clicks from INSIDE the panel are not this trigger's business.
    //
    // The panel is rendered inside the trigger's own <li> (the .menu-list__submenu div in
    // blocks/mionas-header-menu.liquid), so a click on a mega menu card bubbles up to the
    // on:click="/toggle" binding on that <li>. Without this guard the closest() below resolves to
    // that same <li>, findMenuItem() returns the PARENT link's <a ref="menuitem">, findSubmenu()
    // finds the panel, so the "plain links must still navigate" check passes -- and then
    // preventDefault() cancels the card's own navigation while #deactivate() closes the panel.
    // One cause, two symptoms: cards did nothing, and the menu shut on every attempt.
    //
    // READ THE PATH, NOT event.target. assets/component.js's delegated on:* dispatcher does not
    // hand handlers the raw event: when the pressed node is not itself the element carrying the
    // attribute, it wraps the event in a Proxy whose `target` is REWRITTEN to that element
    // (component.js:250). Here that is always the <li>, never the node actually pressed - so
    // `event.target.closest(...)` walks UP from the <li> and can never see the panel, which is
    // BELOW it. The first version of this guard did exactly that and silently did nothing.
    //
    // The proxy forwards method calls bound to the original event, so composedPath() still reports
    // the real hit path and [0] is the true deepest target. That is how component.js's own
    // getElement() recovers it, so the two agree by construction.
    //
    // Guarding on [ref="submenu[]"] rather than on the panel's own class keeps this true for any
    // submenu content, native mega menu markup included.
    const pressed = event.composedPath?.()[0] ?? event.target;
    if (pressed instanceof Element && pressed.closest('[ref="submenu[]"]')) return;

    const listItem = event.target.closest('.menu-list__list-item, [slot="more"]');
    if (!listItem) return;

    const item = findMenuItem(listItem);
    // Plain links with no panel must still navigate.
    if (!item || (!findSubmenu(item) && !listItem.closest('[slot="more"]'))) return;

    event.preventDefault();

    if (this.#state.activeItem === item) {
      this.#deactivate(item);
    } else {
      this.activate(event);
    }
  };

  /**
   * Deactivate the active item after a delay
   * @param {PointerEvent | FocusEvent} event
   */
  deactivate(event) {
    if (!(event.target instanceof Element)) return;

    const menu = findSubmenu(this.#state.activeItem);
    const isMovingWithinMenu = event.relatedTarget instanceof Node && menu?.contains(document.activeElement);
    const isMovingToSubmenu =
      event.relatedTarget instanceof Node && event.type === 'blur' && menu?.contains(event.relatedTarget);
    const isMovingToOverflowMenu =
      event.relatedTarget instanceof Element && Boolean(event.relatedTarget.closest('[slot="overflow"]'));

    if (isMovingWithinMenu || isMovingToOverflowMenu || isMovingToSubmenu) {
      return;
    }

    this.#deactivate();
  }

  /**
   * Deactivate the active item immediately
   * @param {HTMLElement | null} [item]
   */
  #deactivate = (item = this.#state.activeItem) => {
    if (!item || item != this.#state.activeItem) return;

    this.headerComponent?.style.setProperty('--submenu-height', '0px');
    this.#setFullOpenHeaderHeight(0, 0);
    this.style.setProperty('--submenu-opacity', '0');
    this.dataset.overflowExpanded = 'false';

    const submenu = findSubmenu(item) || (item.closest('[slot="more"]') ? this.overflowMenu : null);
    const activeOverflowItem = this.#state.activeOverflowItem;

    this.#state.activeItem = null;
    this.#state.activeOverflowItem = null;
    this.ariaExpanded = 'false';
    item.ariaExpanded = 'false';
    if (activeOverflowItem && activeOverflowItem !== item) {
      activeOverflowItem.ariaExpanded = 'false';
    }

    // Remove active state from submenu after animation completes
    if (submenu) {
      delete submenu.dataset.active;
    }
  };

  #getOverflowListLinksHeight() {
    const slottedMenuLinks = this.overflowMenu?.querySelector('slot')?.assignedElements();
    if (!slottedMenuLinks) return this.overflowMenu?.offsetHeight || 0;

    /**
     * @param {(submenu: HTMLElement) => void} cb
     */
    const mapSubmenus = (cb) => {
      slottedMenuLinks.forEach((link) => {
        const submenu = /** @type {HTMLElement | null} */ (link.querySelector('[ref="submenu[]"]'));
        if (submenu) {
          cb(submenu);
        }
      });
    };

    mapSubmenus((submenu) => {
      submenu.style.setProperty('display', 'none');
    });
    const height = this.overflowMenu?.offsetHeight || 0;
    mapSubmenus((submenu) => {
      submenu.style.removeProperty('display');
    });
    return height;
  }

  /**
   * Read the visible header height before submenu height writes invalidate layout.
   * @returns {number}
   */
  #getHeaderVisibleHeight() {
    if (!this.headerComponent) return 0;

    const isOverlapSituation = this.headerComponent.hasAttribute('data-submenu-overlap-bottom-row');

    return isOverlapSituation && this.headerComponent.offsetHeight > 0
      ? /** @type {HTMLElement | null} */ (this.headerComponent.querySelector('.header__row--top'))?.offsetHeight ?? 0
      : this.headerComponent.offsetHeight;
  }

  /**
   * Calculate and set the full open header height. If the submenu is not open, the full open header height is 0.
   * @param {number} submenuHeight
   * @param {number} headerVisibleHeight
   */
  #setFullOpenHeaderHeight(submenuHeight, headerVisibleHeight) {
    if (!this.headerComponent) return;

    const nothingToOpen = submenuHeight === 0;
    const fullOpenHeaderHeight = nothingToOpen ? 0 : submenuHeight + headerVisibleHeight;

    this.headerComponent?.style.setProperty('--full-open-header-height', `${fullOpenHeaderHeight}px`);
  }

  /**
   * Preload images that are set to load lazily.
   */
  #preloadImages = () => {
    const images = this.querySelectorAll('img[loading="lazy"]');
    images?.forEach((image) => image.removeAttribute('loading'));
  };

  #cleanupMutationObserver() {
    this.#submenuMutationObserver?.disconnect();
    this.#submenuMutationObserver = null;
  }
}

if (!customElements.get('mionas-header-menu')) {
  customElements.define('mionas-header-menu', HeaderMenu);
}

/**
 * Find the closest menu item.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findMenuItem(element) {
  if (!(element instanceof Element)) return null;

  return element?.querySelector('[ref="menuitem"]');
}

/**
 * Find the closest submenu.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findSubmenu(element) {
  const submenu = element?.parentElement?.querySelector('[ref="submenu[]"]');
  return submenu instanceof HTMLElement ? submenu : null;
}
