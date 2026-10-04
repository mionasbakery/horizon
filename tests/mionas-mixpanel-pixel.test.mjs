import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../pixels/mionas-mixpanel.js', import.meta.url), 'utf8');

/** Runs the pixel against stub Shopify globals and returns the events it posts to Mixpanel. */
function runPixel(customer = null) {
  const sent = [];
  const handlers = {};
  const analytics = { subscribe: (name, handler) => (handlers[name] = handler) };
  const fetch = (url, options) => {
    sent.push({ url, ...JSON.parse(new URLSearchParams(options.body.toString()).get('data'))[0] });
    return Promise.resolve();
  };
  new Function('analytics', 'init', 'fetch', source)(analytics, { data: { customer } }, fetch);
  return { sent, handlers };
}

const base = {
  id: 'sh-88153c5a-8F2D-4CCA-3231-EF5C032A4C3B',
  clientId: 'client-1',
  timestamp: '2026-10-04T10:00:00.000Z',
  context: {
    document: { location: { origin: 'https://mionasbakery.com', pathname: '/ca/products/cookie-box', search: '' } },
  },
};
const variant = {
  id: 'gid://shopify/ProductVariant/5',
  title: 'Caja de 6',
  price: { amount: 4.2, currencyCode: 'EUR' },
  product: { id: '9', title: 'Cookie' },
};
const item = { item_id: '9', item_name: 'Cookie', item_variant: 'Caja de 6', price: 4.2 };

test('posts to the EU host with Simplified ID Merge identity and a short insert ID', () => {
  const { sent, handlers } = runPixel();
  const location = { origin: 'https://mionasbakery.com', pathname: '/ca/products/cookie-box', search: '?email=a@b.c' };
  handlers.page_viewed({ ...base, context: { document: { location } } });
  assert.equal(sent[0].properties.page_location, 'https://mionasbakery.com/ca/products/cookie-box');
  assert.match(sent[0].url, /^https:\/\/api-eu\.mixpanel\.com\/track/);
  assert.equal(sent[0].properties.distinct_id, '$device:client-1');
  assert.equal(sent[0].properties.$insert_id.length, 36);
});

test('sends GA4 names and parameters', () => {
  const { sent, handlers } = runPixel();
  handlers.page_viewed(base);
  handlers.product_viewed({ ...base, data: { productVariant: variant } });
  handlers.product_added_to_cart({ ...base, data: { cartLine: { quantity: 2, merchandise: variant } } });
  const promotion = { promotion_id: 'newsletter_popup', promotion_name: 'Newsletter popup' };
  handlers.newsletter_popup_shown({ ...base, customData: { ...promotion, trigger: 'auto' } });
  handlers.newsletter_popup_closed({ ...base, customData: { ...promotion, method: 'button' } });
  handlers.newsletter_popup_subscribed({ ...base, customData: { method: 'newsletter_popup' } });

  const events = sent.map(({ event, properties }) => {
    const { token, distinct_id, $device_id, time, $insert_id, ...rest } = properties;
    return [event, rest];
  });
  assert.deepEqual(events, [
    [
      'page_view',
      {
        platform: 'web',
        locale: 'ca',
        page_location: 'https://mionasbakery.com/ca/products/cookie-box',
        page_type: 'product',
      },
    ],
    ['view_item', { platform: 'web', locale: 'ca', currency: 'EUR', value: 4.2, items: [{ ...item, quantity: 1 }] }],
    ['add_to_cart', { platform: 'web', locale: 'ca', currency: 'EUR', value: 8.4, items: [{ ...item, quantity: 2 }] }],
    ['view_promotion', { platform: 'web', locale: 'ca', ...promotion, trigger: 'auto' }],
    ['close_promotion', { platform: 'web', locale: 'ca', ...promotion, method: 'button' }],
    ['sign_up', { platform: 'web', locale: 'ca', method: 'newsletter_popup' }],
  ]);
});

test('a purchase carries the order as transaction_id and identifies the order customer', () => {
  const { sent, handlers } = runPixel();
  handlers.checkout_completed({
    ...base,
    context: { document: { location: { origin: 'https://mionasbakery.com', pathname: '/checkouts/cn/x/thank-you' } } },
    data: {
      checkout: {
        currencyCode: 'EUR',
        email: 'guest@example.com',
        totalPrice: { amount: '12.5' },
        localization: { language: { isoCode: 'EN' } },
        lineItems: [
          {
            title: 'Cookie',
            quantity: 2,
            variant: { title: 'Default Title', price: { amount: '4.2' }, product: { id: '9' } },
          },
        ],
        order: { id: 'gid://shopify/Order/77', customer: { id: 'gid://shopify/Customer/43', isFirstOrder: true } },
      },
    },
  });
  const { event, properties } = sent[0];
  assert.equal(event, 'purchase');
  assert.equal(properties.$user_id, '43');
  assert.equal(properties.$insert_id, 'order-77');
  assert.equal(properties.transaction_id, '77');
  assert.equal(properties.value, 12.5);
  assert.equal(properties.locale, 'en');
  assert.equal(properties.is_first_order, true);
  assert.deepEqual(properties.items, [{ item_id: '9', item_name: 'Cookie', price: 4.2, quantity: 2 }]);
  assert.doesNotMatch(JSON.stringify(sent), /@/);
});
