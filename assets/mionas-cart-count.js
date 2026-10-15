import { StandardEvents } from '@shopify/events';

/**
 * Keeps the cart page's item count current. The title's heading section isn't re-rendered by cart
 * changes, so the count follows the cart's update events instead.
 */
class MionasCartCount extends HTMLElement {
  connectedCallback() {
    document.addEventListener(StandardEvents.cartLinesUpdate, this.#onCartUpdate);
  }

  disconnectedCallback() {
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#onCartUpdate);
  }

  /** @param {Event & { promise?: Promise<{ cart?: { totalQuantity?: number } }> }} event */
  #onCartUpdate = (event) => {
    event.promise
      ?.then(({ cart }) => {
        const count = cart?.totalQuantity;
        if (count === undefined) return;
        this.#show(count);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[mionas-cart-count] update failed:', error);
      });
  };

  /** @param {number} count */
  #show(count) {
    const text = this.querySelector('[data-count]');
    const template = count === 1 ? this.dataset.one : this.dataset.other;
    if (text && template) text.textContent = template.replace('999999', String(count));
    this.hidden = count === 0;
  }
}

if (!customElements.get('mionas-cart-count')) {
  customElements.define('mionas-cart-count', MionasCartCount);
}
