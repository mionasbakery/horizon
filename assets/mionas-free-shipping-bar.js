/**
 * Reports the cart crossing the free-shipping threshold as reach_free_shipping, which
 * pixels/mionas-mixpanel.js forwards to Mixpanel. A cart that loads already over it isn't a crossing.
 */
class MionasFreeShippingBar extends HTMLElement {
  /** Whether the latest cart change was an add from a cart upsell. */
  #viaUpsell = false;

  connectedCallback() {
    document.addEventListener('shopify:cart:lines-update', this.#onCartChange);
    this.addEventListener('mionas-progress-bar:complete', this.#onComplete);
  }

  disconnectedCallback() {
    document.removeEventListener('shopify:cart:lines-update', this.#onCartChange);
    this.removeEventListener('mionas-progress-bar:complete', this.#onComplete);
  }

  /** @param {Event} event - A CartLinesUpdateEvent */
  #onCartChange = (event) => {
    const { action } = /** @type {any} */ (event);
    const target = /** @type {Element} */ (event.target);
    this.#viaUpsell = action === 'add' && !!target.closest?.('mionas-product-upsells');
  };

  #onComplete = () => {
    try {
      /** @type {any} */ (window).Shopify?.analytics?.publish?.('reach_free_shipping', {
        currency: /** @type {any} */ (window).Shopify?.currency?.active,
        value: Number(this.dataset.total) / 100,
        free_shipping_threshold: Number(this.dataset.freeShippingThreshold) / 100,
        via_upsell: this.#viaUpsell,
      });
    } catch {
      // Analytics must never break the cart.
    }
  };
}

if (!customElements.get('mionas-free-shipping-bar')) {
  customElements.define('mionas-free-shipping-bar', MionasFreeShippingBar);
}
