const LIST = { item_list_id: 'cart_upsells', item_list_name: 'Cart upsells' };

/**
 * Publishes a GA4 event to Shopify customer events, which pixels/mionas-mixpanel.js forwards to Mixpanel.
 * @param {string} name
 * @param {Record<string, unknown>} params
 */
function publish(name, params) {
  try {
    /** @type {any} */ (window).Shopify?.analytics?.publish?.(name, params);
  } catch {
    // Analytics must never break the upsells.
  }
}

/**
 * One GA4 item for a card, with its position in the list.
 * @param {HTMLElement} card
 * @param {number} index
 */
function item(card, index) {
  return {
    item_id: card.dataset.productId,
    item_name: card.dataset.title,
    price: Number(card.dataset.price) / 100,
    index,
  };
}

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
  /** @type {HTMLElement[]} */
  #cards = [];
  /** Cents left to free shipping when the cards were ranked. */
  #gap = 0;
  #threshold = 0;
  /** The product IDs last reported as viewed, so a re-render of the same list isn't counted again. */
  #listed = '';

  connectedCallback() {
    this.host = /** @type {HTMLElement} */ (this.parentElement);

    this.#cartObserver = new MutationObserver(() => this.#load());
    this.#cartObserver.observe(this.host, { attributes: true, attributeFilter: ['data-product-ids', 'data-total'] });

    // data-skip-node-update keeps this element's attributes through the cart section's morph, but the morph
    // still empties its children; putting the cards back before the next paint avoids a blank flash.
    this.#morphObserver = new MutationObserver(() => {
      if (!this.#isPainted()) this.#paint();
    });
    this.#morphObserver.observe(this, { childList: true, subtree: true, characterData: true });

    this.addEventListener('shopify:cart:lines-update', this.#onAdd);

    this.#load();
  }

  disconnectedCallback() {
    this.#cartObserver?.disconnect();
    this.#morphObserver?.disconnect();
    this.#controller?.abort();
    this.removeEventListener('shopify:cart:lines-update', this.#onAdd);
  }

  async #load() {
    const { productIds, total } = this.host?.dataset ?? {};
    const sources = (productIds ?? '').split(',').filter(Boolean);
    // Without a free-shipping bar on the page there is no threshold, and the upsells stay hidden.
    const threshold = Number(document.querySelector('[data-free-shipping-threshold]')?.getAttribute('data-free-shipping-threshold') ?? 0);
    const gap = threshold - Number(total);
    this.#gap = gap;
    this.#threshold = threshold;
    if (sources.length === 0 || threshold <= 0 || gap <= 0) return this.#show([]);

    this.#controller?.abort();
    this.#controller = new AbortController();
    const { signal } = this.#controller;

    try {
      // One failed request shouldn't empty the card while the others answered.
      const results = await Promise.allSettled(sources.map((productId) => this.#fetchRelated(productId, total ?? '', signal)));
      const docs = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      if (signal.aborted) return;
      if (docs.length === 0) throw results.find((result) => result.status === 'rejected')?.reason;
      this.#rank(docs, gap);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      this.#show([]);
      console.warn('[mionas-product-upsells]', error);
    }
  }

  /**
   * @param {string} productId
   * @param {string} total - Cart total in cents
   * @param {AbortSignal} signal
   */
  async #fetchRelated(productId, total, signal) {
    const params = new URLSearchParams({
      product_id: productId,
      limit: '10',
      section_id: this.dataset.sectionId ?? '',
      intent: 'related',
      // The section filters out what is already in the cart, so the URL varies with the cart to
      // avoid a cached response from before the last change.
      total,
    });
    const response = await fetch(`${this.dataset.url}?${params}`, { signal });
    if (!response.ok) throw new Error(`Recommendations returned ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  /**
   * Merges the related products of up to three cart items. Products that reach free shipping with one unit come first, cheapest first so the
   * order goes over the threshold as little as possible; then those that reach it with two units;
   * then the rest. Within the last two groups, a product related to more cart items goes first,
   * then Shopify's order. The cart section's CSS shows as many as its layout fits, at most four.
   * @param {Document[]} docs - One recommendations response per cart item
   * @param {number} gap - Cents left to the free-shipping threshold, above 0
   */
  #rank(docs, gap) {
    /** @type {Map<string, { card: HTMLElement, matches: number, position: number, price: number }>} */
    const found = new Map();

    for (const doc of docs) {
      [...doc.querySelectorAll('.mionas-product-upsell')].forEach((element, position) => {
        const card = /** @type {HTMLElement} */ (element);
        const id = card.dataset.productId ?? '';
        const entry = found.get(id);
        if (entry) {
          entry.matches += 1;
          entry.position = Math.min(entry.position, position);
        } else {
          found.set(id, { card, matches: 1, position, price: Number(card.dataset.price) });
        }
      });
    }

    const units = (/** @type {{ price: number }} */ { price }) => (price >= gap ? 1 : price * 2 >= gap ? 2 : 3);
    const shown = [...found.values()]
      .sort(
        (a, b) =>
          units(a) - units(b) ||
          (units(a) === 1 ? a.price - b.price : 0) ||
          b.matches - a.matches ||
          a.position - b.position
      )
      .slice(0, 4)
      .map(({ card }) => /** @type {HTMLElement} */ (card));

    this.#show(shown);
  }

  /** @param {HTMLElement[]} cards */
  #show(cards) {
    this.#cards = cards;
    this.#paint();
    this.#reportList();
  }

  /** Reports the suggestions as a GA4 item list each time a different set of them shows. */
  #reportList() {
    const listed = this.#cards.map((card) => card.dataset.productId).join(',');
    if (listed === this.#listed) return;
    this.#listed = listed;
    if (!listed) return;

    publish('view_item_list', {
      ...LIST,
      items: this.#cards.map((card, index) => item(card, index)),
      free_shipping_threshold: this.#threshold / 100,
      free_shipping_remaining: this.#gap / 100,
    });
  }

  /**
   * Reports an add from one of the cards as a GA4 select_item once the cart accepts it. Shopify's own
   * add_to_cart still counts it among all adds.
   * @param {Event} event - A CartLinesUpdateEvent from a card's add-to-cart form
   */
  #onAdd = (event) => {
    const { action, lines, promise } = /** @type {any} */ (event);
    const card = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.mionas-product-upsell'));
    if (action !== 'add' || !card) return;

    const index = this.#cards.indexOf(card);
    const quantity = lines?.[0]?.quantity ?? 1;
    const remaining = this.#gap / 100;
    promise?.then((/** @type {any} */ result) => {
      if (result?.detail?.didError) return;
      const added = { ...item(card, index), quantity };
      publish('select_item', {
        ...LIST,
        currency: /** @type {any} */ (window).Shopify?.currency?.active,
        value: Math.round(added.price * quantity * 100) / 100,
        items: [added],
        free_shipping_remaining: remaining,
      });
    }, () => {});
  };

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
