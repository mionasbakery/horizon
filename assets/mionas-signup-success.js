// The base class comes from the custom element registry, not an import: Horizon's only import map is
// native, and a relative import would load a second, unversioned copy of mionas-popup.js.
await customElements.whenDefined('mionas-popup-component');
const MionasPopup = /** @type {typeof import('./mionas-popup.js').MionasPopup} */ (
  customElements.get('mionas-popup-component')
);

/**
 * The popup that confirms a newsletter signup made in a page's own form. The block's inline script
 * marks it with data-open only on the page load after that form's post.
 *
 * @extends MionasPopup
 */
class MionasSignupSuccess extends MionasPopup {
  continueShopping = () => this.closeWith('button');

  connectedCallback() {
    super.connectedCallback();
    if (this.hasAttribute('data-open') && !window.Shopify?.designMode) this.open({ source: 'signup' });
  }
}

if (!customElements.get('mionas-signup-success-component')) {
  customElements.define('mionas-signup-success-component', MionasSignupSuccess);
}
