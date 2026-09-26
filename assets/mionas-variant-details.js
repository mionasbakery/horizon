/**
 * Replaces the rendered description with the selected variant's server-rendered content.
 */
class MionasVariantDetails extends HTMLElement {
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
          `mionas-variant-details[data-product-id="${this.dataset.productId}"]`
        );
        if (!updatedDescription) return;

        this.innerHTML = updatedDescription.innerHTML;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('[mionas-variant-details] Event promise rejected:', error);
        }
      });
  };
}

if (!customElements.get('mionas-variant-details')) {
  customElements.define('mionas-variant-details', MionasVariantDetails);
}
