import assert from 'node:assert/strict';
import test from 'node:test';

class FakeHTMLElement {
  dataset = {};
  innerHTML = '';

  closest() {
    return this.section;
  }
}

globalThis.HTMLElement = FakeHTMLElement;

const definitions = new Map();
globalThis.customElements = {
  define(name, constructor) {
    definitions.set(name, constructor);
  },
  get(name) {
    return definitions.get(name);
  },
};

await import('../assets/mionas-variant-description.js');

test('updates the dedicated Mionas variant description from the selected variant response', async () => {
  const listeners = new Map();
  const section = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener() {},
  };

  const ProductVariantDescription = definitions.get('mionas-variant-description');
  const description = new ProductVariantDescription();
  description.section = section;
  description.dataset.productId = '15945324167499';
  description.innerHTML = '<p>12 cookies</p>';
  description.connectedCallback();

  const replacement = { innerHTML: '<p>24 cookies</p>' };
  listeners.get('shopify:product:select')({
    promise: Promise.resolve({
      detail: {
        productId: '15945324167499',
        html: {
          querySelector(selector) {
            assert.equal(
              selector,
              'mionas-variant-description[data-product-id="15945324167499"]'
            );
            return replacement;
          },
        },
      },
    }),
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(description.innerHTML, '<p>24 cookies</p>');
});
