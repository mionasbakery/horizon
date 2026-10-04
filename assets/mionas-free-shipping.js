/**
 * Celebrates only when a cart change crosses the free-shipping threshold. main-cart morphs this
 * element in place, so data-reached going from false to true is a crossing; a page loaded already
 * over the threshold never fires.
 */
class MionasFreeShipping extends HTMLElement {
  static observedAttributes = ['data-reached'];

  /**
   * @param {string} name
   * @param {string | null} oldValue
   * @param {string | null} newValue
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== 'false' || newValue !== 'true') return;

    this.classList.remove('is-celebrating');
    requestAnimationFrame(() => this.classList.add('is-celebrating'));
    setTimeout(() => this.classList.remove('is-celebrating'), 1400);
  }
}

if (!customElements.get('mionas-free-shipping')) {
  customElements.define('mionas-free-shipping', MionasFreeShipping);
}
