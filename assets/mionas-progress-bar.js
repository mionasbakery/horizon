/**
 * Plays the progress bar's success burst when the bar shows complete: once when a page loads already
 * complete, and again when a cart change crosses the goal. A cart section morphs this element in
 * place, so other cart changes keep it connected and don't replay the burst; data-complete going from
 * false to true is a crossing, which it also announces as a bubbling `mionas-progress-bar:complete`.
 */
class MionasProgressBar extends HTMLElement {
  static observedAttributes = ['data-complete'];

  connectedCallback() {
    if (this.dataset.complete === 'true') this.#celebrate();
  }

  /**
   * @param {string} name
   * @param {string | null} oldValue
   * @param {string | null} newValue
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== 'false' || newValue !== 'true') return;
    this.#celebrate();
    this.dispatchEvent(new CustomEvent('mionas-progress-bar:complete', { bubbles: true }));
  }

  #celebrate() {
    this.classList.remove('is-celebrating');
    requestAnimationFrame(() => this.classList.add('is-celebrating'));
    setTimeout(() => this.classList.remove('is-celebrating'), 1700);
  }
}

if (!customElements.get('mionas-progress-bar')) {
  customElements.define('mionas-progress-bar', MionasProgressBar);
}
