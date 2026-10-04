/**
 * Fills the cart suggestions from the recommendations endpoint and keeps them in step with the cart.
 * The parent block re-renders with main-cart on every change, so its data attributes are the trigger.
 */
class MionasCartSuggestions extends HTMLElement {
  /** @type {MutationObserver | undefined} */
  #cartObserver;
  /** @type {MutationObserver | undefined} */
  #morphObserver;
  /** @type {AbortController | undefined} */
  #controller;
  /** @type {Element[]} */
  #cards = [];
  #heading = '';

  connectedCallback() {
    this.host = /** @type {HTMLElement} */ (this.parentElement);

    this.#cartObserver = new MutationObserver(() => this.#load());
    this.#cartObserver.observe(this.host, { attributes: true, attributeFilter: ['data-product-id', 'data-total'] });

    // data-skip-node-update keeps this element's attributes through main-cart's morph, but the morph
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
    // Without a free-shipping card on the page there is no threshold, and Shopify's order stands.
    const threshold = document.querySelector('mionas-free-shipping')?.getAttribute('data-threshold') ?? '0';
    if (!productId) return this.#show([], '');

    this.#controller?.abort();
    this.#controller = new AbortController();

    const params = new URLSearchParams({
      product_id: productId,
      limit: '10',
      section_id: 'mionas-suggestion-list',
      intent: 'related',
      // The section filters out what is already in the cart, so the URL varies with the cart to
      // avoid a cached response from before the last change.
      total: total ?? '',
    });

    try {
      const response = await fetch(`${this.dataset.url}?${params}`, { signal: this.#controller.signal });
      if (!response.ok) throw new Error(`Recommendations returned ${response.status}`);

      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      this.#rank(doc, Number(total), Number(threshold));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      this.#show([], '');
      console.warn('[mionas-cart-suggestions]', error);
    }
  }

  /**
   * Puts the products that reach free shipping with one or two units first, each group in Shopify's
   * order; once the threshold is met, Shopify's order alone.
   * @param {Document} doc
   * @param {number} total - Cart total in cents
   * @param {number} threshold - Free-shipping threshold in cents; 0 when unknown
   */
  #rank(doc, total, threshold) {
    const gap = threshold > 0 ? threshold - total : 0;
    const cards = /** @type {HTMLElement[]} */ ([...doc.querySelectorAll('.mionas-suggestion-card')]);
    const closes = (/** @type {HTMLElement} */ card) => gap > 0 && Number(card.dataset.price) * 2 >= gap;
    const ranked = gap > 0 ? [...cards.filter(closes), ...cards.filter((card) => !closes(card))] : cards;
    const shown = ranked.slice(0, Number(this.dataset.limit) || 6);

    for (const card of shown) {
      const button = card.querySelector('.mionas-button');
      if (!button) continue;
      button.classList.toggle('mionas-button--primary', closes(card));
      button.classList.toggle('mionas-button--secondary', !closes(card));
    }

    this.#show(shown, (gap > 0 ? this.dataset.headingUnder : this.dataset.headingReached) ?? '');
  }

  /**
   * @param {Element[]} cards
   * @param {string} heading
   */
  #show(cards, heading) {
    this.#cards = cards;
    this.#heading = heading;
    this.#paint();
  }

  #paint() {
    const list = this.querySelector('[data-list]');
    const heading = this.querySelector('[data-heading]');

    if (heading && heading.textContent !== this.#heading) heading.textContent = this.#heading;
    if (list && !this.#listMatches(list)) list.replaceChildren(...this.#cards);
    this.hidden = this.#cards.length === 0;

    // Our own writes are not a morph; drop them so the observer doesn't answer itself.
    this.#morphObserver?.takeRecords();
  }

  #isPainted() {
    const list = this.querySelector('[data-list]');
    const heading = this.querySelector('[data-heading]');
    return !!list && this.#listMatches(list) && heading?.textContent === this.#heading;
  }

  /** @param {Element} list */
  #listMatches(list) {
    return list.children.length === this.#cards.length && this.#cards.every((card, i) => list.children[i] === card);
  }
}

if (!customElements.get('mionas-cart-suggestions')) {
  customElements.define('mionas-cart-suggestions', MionasCartSuggestions);
}
