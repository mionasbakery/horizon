import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../pixels/mionas-datadog.js', import.meta.url), 'utf8');
const configured = source
  .replace(/const APPLICATION_ID = '';/, "const APPLICATION_ID = 'app-id';")
  .replace(/const CLIENT_TOKEN = '';/, "const CLIENT_TOKEN = 'client-token';");

/** Runs the pixel against stub Shopify and Datadog globals, recording every Datadog call. */
function runPixel(pixelSource, customer = null) {
  const calls = [];
  const handlers = {};
  const analytics = {
    subscribe: (name, handler) => (handlers[name] = handler),
  };
  const record =
    (method) =>
    (...args) =>
      calls.push({ method, args });
  const window = {
    DD_RUM: {
      onReady: (callback) => callback(),
      init: record('init'),
      setUser: record('setUser'),
      clearUser: record('clearUser'),
      addAction: record('addAction'),
      shopifyPlugin: (options) => ({ shopifyPlugin: options }),
    },
  };
  const document = {
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: record('loadScript') } }],
  };
  new Function('analytics', 'init', 'window', 'document', pixelSource)(
    analytics,
    { data: { customer } },
    window,
    document
  );
  return { calls, handlers, analytics };
}

const base = {
  id: 'sh-1',
  clientId: 'client-1',
  timestamp: '2026-10-04T10:00:00.000Z',
  context: { document: { location: { pathname: '/ca/products/cookie-box' } } },
};
const actions = (calls) => calls.filter((call) => call.method === 'addAction').map((call) => call.args);

test('loads nothing until the application ID and client token are filled in', () => {
  const { calls, handlers } = runPixel(source);
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(handlers), []);
});

test('starts Datadog on the EU site with the Shopify plugin and the logged-in customer ID only', () => {
  const { calls, analytics } = runPixel(configured, {
    id: 'gid://shopify/Customer/42',
    email: 'a@b.c',
  });
  const init = calls.filter((call) => call.method === 'init');
  assert.equal(init.length, 1);
  assert.equal(init[0].args[0].applicationId, 'app-id');
  assert.equal(init[0].args[0].clientToken, 'client-token');
  assert.equal(init[0].args[0].site, 'datadoghq.eu');
  assert.equal(init[0].args[0].service, 'mionas-storefront');
  assert.equal(init[0].args[0].env, 'production');
  assert.deepEqual(init[0].args[0].plugins, [{ shopifyPlugin: { shopifyAnalytics: analytics } }]);
  assert.deepEqual(calls.find((call) => call.method === 'setUser').args, [{ id: '42' }]);
});

test('sends the Mixpanel tracking plan as Datadog actions', () => {
  const { calls, handlers } = runPixel(configured);
  const variant = {
    id: 'gid://shopify/ProductVariant/5',
    price: { amount: 4.2 },
    product: { id: '9', title: 'Cookie' },
  };
  handlers.product_viewed({ ...base, data: { productVariant: variant } });
  handlers.product_added_to_cart({
    ...base,
    data: { cartLine: { quantity: 2, merchandise: variant } },
  });
  const checkout = {
    currencyCode: 'EUR',
    totalPrice: { amount: '12.5' },
    lineItems: [{ quantity: 2 }, { quantity: 1 }],
    localization: { language: { isoCode: 'EN' } },
  };
  handlers.checkout_started({ ...base, data: { checkout } });
  handlers.newsletter_popup_subscribed({
    ...base,
    customData: { test: 't1', group: 'popup' },
  });

  const product = {
    product_id: '9',
    product_title: 'Cookie',
    variant_id: '5',
    price: 4.2,
  };
  assert.deepEqual(actions(calls), [
    ['product_viewed', { platform: 'web', locale: 'ca', ...product }],
    ['product_added_to_cart', { platform: 'web', locale: 'ca', ...product, quantity: 2 }],
    [
      'checkout_started',
      {
        platform: 'web',
        locale: 'en',
        cart_total: 12.5,
        item_count: 3,
        currency: 'EUR',
      },
    ],
    ['newsletter_subscribed', { platform: 'web', locale: 'ca', test: 't1', group: 'popup' }],
  ]);
});

test('a guest order sets the user from the order customer and omits absent fields', () => {
  const { calls, handlers } = runPixel(configured);
  handlers.checkout_completed({
    ...base,
    context: {
      document: { location: { pathname: '/checkouts/cn/x/thank-you' } },
    },
    data: {
      checkout: {
        currencyCode: 'EUR',
        email: 'guest@example.com',
        totalPrice: { amount: '20' },
        lineItems: [{ quantity: 1 }],
        order: {
          id: 'gid://shopify/Order/77',
          customer: { id: 'gid://shopify/Customer/43', isFirstOrder: null },
        },
      },
    },
  });
  assert.deepEqual(calls.find((call) => call.method === 'setUser').args, [{ id: '43' }]);
  assert.deepEqual(actions(calls), [
    [
      'checkout_completed',
      {
        platform: 'web',
        locale: 'es',
        order_id: '77',
        order_total: 20,
        item_count: 1,
        currency: 'EUR',
      },
    ],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /@/);
});
