/**
 * Fills the cart upsells from the recommendations endpoint and keeps them in step with the cart.
 * The parent block re-renders with the cart section on every change, so its data attributes are the trigger.
 */
class MionasProductUpsells extends HTMLElement {
  /** @type {MutationObserver | undefined} */
  #cartObserver;
  /** @type {MutationObserver | undefined} */
  #morphObserver;
  /** @type {AbortController | undefined} */
  #controller;
  /** @type {Element[]} */
  #cards = [];

  connectedCallback() {
    this.host = /** @type {HTMLElement} */ (this.parentElement);

    this.#cartObserver = new MutationObserver(() => this.#load());
    this.#cartObserver.observe(this.host, { attributes: true, attributeFilter: ['data-product-id', 'data-total'] });

    // data-skip-node-update keeps this element's attributes through the cart section's morph, but the morph
    // still empties its children; putting the cards back before the next paint avoids a blank flash.
    this.#morphObserver = new MutationObserver(() => {
      if (!this.#isPainted()) this.#paint();
    });
    this.#morphObserver.observe(this, { childList: true, subtree: true, characterData: true });

    this.#load();
  }

  disconnectedCallback() {
    this.#cartObserver?.disconnect();
    this.#morphObserver?.disconnect();
    this.#controller?.abort();
  }

  async #load() {
    const { productId, total } = this.host?.dataset ?? {};
    // Without a free-shipping bar on the page there is no threshold, and the upsells stay hidden.
    const threshold = Number(document.querySelector('[data-free-shipping-threshold]')?.getAttribute('data-free-shipping-threshold') ?? 0);
    const gap = threshold - Number(total);
    if (!productId || threshold <= 0 || gap <= 0) return this.#show([]);

    this.#controller?.abort();
    this.#controller = new AbortController();

    const params = new URLSearchParams({
      product_id: productId,
      limit: '10',
      section_id: 'mionas-upsell-list',
      intent: 'related',
      // The section filters out what is already in the cart, so the URL varies with the cart to
      // avoid a cached response from before the last change.
      total: total ?? '',
    });

    try {
      const response = await fetch(`${this.dataset.url}?${params}`, { signal: this.#controller.signal });
      if (!response.ok) throw new Error(`Recommendations returned ${response.status}`);

      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      this.#rank(doc, gap);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      this.#show([]);
      console.warn('[mionas-product-upsells]', error);
    }
  }

  /**
   * Keeps the cards from the block's collections, then puts the products that reach free shipping
   * with one or two units first, each group in Shopify's order. The cart section's CSS shows as
   * many as its layout fits, at most four.
   * @param {Document} doc
   * @param {number} gap - Cents left to the free-shipping threshold, above 0
   */
  #rank(doc, gap) {
    const allowed = (this.dataset.collections ?? '').split(',').filter(Boolean);
    const rows = /** @type {HTMLElement[]} */ ([...doc.querySelectorAll('.mionas-product-upsell-card')]).filter(
      (row) => allowed.length === 0 || (row.dataset.collections ?? '').split(',').some((handle) => allowed.includes(handle))
    );
    const closes = (/** @type {HTMLElement} */ row) => Number(row.dataset.price) * 2 >= gap;
    const shown = [...rows.filter(closes), ...rows.filter((row) => !closes(row))].slice(0, 4);

    // The rows' add-to-cart block renders with its default settings, so the row look is set here.
    for (const row of shown) {
      row.querySelector('.mionas-add-to-cart')?.classList.add('mionas-add-to-cart--no-icon');
      const button = row.querySelector('.mionas-button');
      button?.classList.remove('mionas-button--primary');
      button?.classList.add('mionas-button--secondary', 'mionas-button--sm');
    }

    this.#show(shown);
  }

  /** @param {Element[]} cards */
  #show(cards) {
    this.#cards = cards;
    this.#paint();
  }

  #paint() {
    const list = this.querySelector('[data-list]');

    if (list && !this.#listMatches(list)) list.replaceChildren(...this.#cards);
    this.hidden = this.#cards.length === 0;

    // Our own writes are not a morph; drop them so the observer doesn't answer itself.
    this.#morphObserver?.takeRecords();
  }

  #isPainted() {
    const list = this.querySelector('[data-list]');
    return !!list && this.#listMatches(list);
  }

  /** @param {Element} list */
  #listMatches(list) {
    return list.children.length === this.#cards.length && this.#cards.every((card, i) => list.children[i] === card);
  }
}

if (!customElements.get('mionas-product-upsells')) {
  customElements.define('mionas-product-upsells', MionasProductUpsells);
}
