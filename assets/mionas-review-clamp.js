/**
 * Reveals a review card's "Leer más" trigger, but only when the quote is genuinely longer than
 * its CSS line clamp. Liquid cannot know that -- it depends on the rendered column width and the
 * font actually in use -- so it has to be measured on the client.
 *
 * Deliberately NOT a `Component` subclass, and deliberately not named `*-component`:
 * assets/component.js resolves `on:` bindings to the closest ancestor that is a `Component` or
 * whose tag name ends in `-component` (see getClosestComponent). Staying out of that lookup keeps
 * this element from ever intercepting the trigger's click, which belongs to the
 * <dialog-component> wrapping the card. It also needs nothing the base class offers -- no refs,
 * no declarative bindings.
 */
class MionasReviewClamp extends HTMLElement {
  /** @type {HTMLElement | null} */
  #quote = null;

  /** @type {ResizeObserver | null} */
  #observer = null;

  /** @type {number} */
  #lastWidth = 0;

  /** @type {HTMLElement | null} */
  #card = null;

  connectedCallback() {
    this.#quote = this.querySelector('.review-card__quote');
    if (!this.#quote) return;

    // The whole card is a click target for the dialog, not just the "Leer más" button. The
    // listener lives here rather than as an `on:click` attribute on the card because it must be
    // conditional: only a card with something left to read should react, and that is known from
    // this element's own overflow state.
    this.#card = this.closest('.review-card');
    this.#card?.addEventListener('click', this.#handleCardClick);

    // Observe THIS element's width, not the quote's height. The quote's height is pinned by
    // -webkit-line-clamp, so a height-based observer never fires when the column narrows --
    // which is exactly when a review starts or stops overflowing.
    this.#observer = new ResizeObserver(this.#handleResize);
    this.#observer.observe(this);

    // A late webfont swap changes text metrics and can push a review that fitted at fallback
    // metrics past the clamp. Without this re-check those reviews never get their trigger.
    document.fonts?.ready.then(this.#measure);

    this.#measure();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;

    this.#card?.removeEventListener('click', this.#handleCardClick);
    this.#card = null;
  }

  /**
   * Opens the dialog when the card itself is clicked.
   *
   * Three things are deliberately excluded. A card whose quote already fits has nothing more to
   * show, so it stays inert. Clicks that land on a real control (the "Leer más" button, or any
   * link an attribution might carry) are left alone -- that button has its own binding and would
   * otherwise open the dialog twice. And a click that ends a text selection is the user
   * highlighting a quote, not asking to read more.
   *
   * @param {MouseEvent} event
   */
  #handleCardClick = (event) => {
    if (!this.hasAttribute('data-overflowing')) return;

    const target = /** @type {HTMLElement | null} */ (event.target);
    if (target?.closest('a, button')) return;

    if (!window.getSelection()?.isCollapsed) return;

    // `closest` keeps this scoped to the card that was clicked. resource-list.liquid renders every
    // card twice when carousel_on_mobile is on, so anything document-wide would open the wrong one.
    const dialogComponent = /** @type {{ showDialog?: () => void } | null} */ (
      this.closest('dialog-component')
    );
    dialogComponent?.showDialog?.();
  };

  /**
   * #measure writes to the quote's style, which resizes this element, which would re-enter the
   * observer forever. Only a real width change is worth re-measuring.
   * @param {ResizeObserverEntry[]} entries
   */
  #handleResize = (entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (Math.abs(width - this.#lastWidth) < 1) return;

    this.#lastWidth = width;
    this.#measure();
  };

  /**
   * `scrollHeight > clientHeight` is not reliable on a `-webkit-box` with a line clamp: the box
   * can report the two as equal for text that is visibly cut. Measure the quote's natural height
   * with the clamp lifted instead, then restore it.
   *
   * The stylesheet sets both `-webkit-line-clamp` and the standard `line-clamp` on the quote.
   * `display: block` only lifts the `-webkit-box` rendering, not a standard `line-clamp`, so both
   * properties must be unset here -- an engine that honours `line-clamp` independently of the
   * `-webkit-box` display would otherwise stay clamped, always measure zero overflow, and never
   * reveal the trigger. Setting `lineClamp` is a no-op in engines that don't know the property.
   */
  #measure = () => {
    const quote = this.#quote;
    if (!quote || !this.isConnected) return;

    const clampedHeight = quote.clientHeight;

    quote.style.display = 'block';
    quote.style.webkitLineClamp = 'unset';
    quote.style.lineClamp = 'unset';
    const naturalHeight = quote.scrollHeight;
    quote.style.display = '';
    quote.style.webkitLineClamp = '';
    quote.style.lineClamp = '';

    // One pixel of slack absorbs sub-pixel line-height rounding, which would otherwise flag
    // every single quote as overflowing.
    if (naturalHeight - clampedHeight > 1) {
      this.setAttribute('data-overflowing', '');
    } else {
      this.removeAttribute('data-overflowing');
    }
  };
}

if (!customElements.get('mionas-review-clamp')) {
  customElements.define('mionas-review-clamp', MionasReviewClamp);
}
