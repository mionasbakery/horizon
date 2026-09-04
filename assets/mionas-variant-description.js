/**
 * Replaces the rendered description with the selected variant's server-rendered content.
 */
class MionasVariantDescription extends HTMLElement {
  connectedCallback() {
    this.section = this.closest('[id*="ProductInformation-"], featured-product-information');
    this.section?.addEventListener('shopify:product:select', this.handleProductSelect);
  }

  disconnectedCallback() {
    this.section?.removeEventListener('shopify:product:select', this.handleProductSelect);
  }

  handleProductSelect = (event) => {
    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;
        if (detail.productId && detail.productId !== this.dataset.productId) return;

        const updatedDescription = detail.html.querySelector(
          `mionas-variant-description[data-product-id="${this.dataset.productId}"]`
        );
        if (!updatedDescription) return;

        this.innerHTML = updatedDescription.innerHTML;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('[mionas-variant-description] Event promise rejected:', error);
        }
      });
  };
}

if (!customElements.get('mionas-variant-description')) {
  customElements.define('mionas-variant-description', MionasVariantDescription);
}
