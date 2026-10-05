import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pixel = await readFile(new URL('../pixels/mionas-datadog.js', import.meta.url), 'utf8');
const withKeys = (applicationId, clientToken) =>
  pixel
    .replace(/const APPLICATION_ID = '[^']*';/, `const APPLICATION_ID = '${applicationId}';`)
    .replace(/const CLIENT_TOKEN = '[^']*';/, `const CLIENT_TOKEN = '${clientToken}';`);
const source = withKeys('', '');
const configured = withKeys('app-id', 'client-token');

/** Runs the pixel against stub Shopify and Datadog globals, recording every Datadog call. */
function runPixel(pixelSource, customer = null, analyticsProcessingAllowed = true, cookies = {}) {
  const calls = [];
  const handlers = {};
  const privacyHandlers = {};
  const api = { customerPrivacy: { subscribe: (name, handler) => (privacyHandlers[name] = handler) } };
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
      setTrackingConsent: record('setTrackingConsent'),
      shopifyPlugin: (options) => ({ shopifyPlugin: options }),
    },
  };
  const document = {
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: record('loadScript') } }],
  };
  const browser = { cookie: { get: async (name) => cookies[name] ?? '' } };
  new Function('analytics', 'init', 'api', 'browser', 'window', 'document', pixelSource)(
    analytics,
    { data: { customer }, customerPrivacy: { analyticsProcessingAllowed } },
    api,
    browser,
    window,
    document
  );
  return { calls, handlers, privacyHandlers, analytics };
}

const base = {
  id: 'sh-1',
  clientId: 'client-1',
  timestamp: '2026-10-04T10:00:00.000Z',
  context: { document: { location: { pathname: '/ca/products/cookie-box' } } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve));
const actions = (calls) => calls.filter((call) => call.method === 'addAction').map((call) => call.args);

test('loads nothing until the application ID and client token are filled in', async () => {
  const { calls, handlers } = runPixel(source);
  await flush();
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(handlers), []);
});

test('starts Datadog on the EU site with the Shopify plugin and the logged-in customer', async () => {
  const { calls, analytics } = runPixel(configured, {
    id: 'gid://shopify/Customer/42',
    firstName: 'Laia',
    lastName: 'Puig',
    email: 'a@b.c',
    phone: '+34600000000',
  });
  await flush();
  const init = calls.filter((call) => call.method === 'init');
  assert.equal(init.length, 1);
  assert.equal(init[0].args[0].applicationId, 'app-id');
  assert.equal(init[0].args[0].clientToken, 'client-token');
  assert.equal(init[0].args[0].site, 'datadoghq.eu');
  assert.equal(init[0].args[0].service, 'mionas-storefront');
  assert.equal(init[0].args[0].env, 'production');
  assert.deepEqual(init[0].args[0].plugins, [{ shopifyPlugin: { shopifyAnalytics: analytics } }]);
  assert.deepEqual(calls.find((call) => call.method === 'setUser').args, [
    { id: '42', name: 'Laia Puig', email: 'a@b.c' },
  ]);
});

test('follows the page consent at start and when the visitor changes it in checkout', async () => {
  const allowed = runPixel(configured);
  await flush();
  assert.equal(allowed.calls.find((call) => call.method === 'init').args[0].trackingConsent, 'granted');

  const { calls, privacyHandlers } = runPixel(configured, null, false);
  await flush();
  assert.equal(calls.find((call) => call.method === 'init').args[0].trackingConsent, 'not-granted');
  privacyHandlers.visitorConsentCollected({ customerPrivacy: { analyticsProcessingAllowed: true } });
  privacyHandlers.visitorConsentCollected({ customerPrivacy: { analyticsProcessingAllowed: false } });
  await flush();
  assert.deepEqual(
    calls.filter((call) => call.method === 'setTrackingConsent').map((call) => call.args[0]),
    ['granted', 'not-granted']
  );
});

test('handles only checkout events, since the plugin starts a session only on checkout pages', async () => {
  const { calls, handlers } = runPixel(configured);
  assert.deepEqual(Object.keys(handlers).sort(), ['checkout_completed', 'checkout_started']);
  const line = (title, variantTitle, productId, price, quantity) => ({
    title,
    quantity,
    variant: { title: variantTitle, price: { amount: price }, product: { id: `gid://shopify/Product/${productId}` } },
  });
  const checkout = {
    currencyCode: 'EUR',
    totalPrice: { amount: '12.5' },
    lineItems: [line('Cookie', 'Default Title', 9, 4.2, 2), line('Brownie', 'Grande', 10, 4.1, 1)],
    localization: { language: { isoCode: 'EN' } },
  };
  handlers.checkout_started({ ...base, data: { checkout } });
  await flush();
  assert.deepEqual(actions(calls), [
    [
      'begin_checkout',
      {
        platform: 'web',
        locale: 'en',
        currency: 'EUR',
        value: 12.5,
        items: [
          { item_id: '9', item_name: 'Cookie', price: 4.2, quantity: 2 },
          { item_id: '10', item_name: 'Brownie', item_variant: 'Grande', price: 4.1, quantity: 1 },
        ],
      },
    ],
  ]);
});

test('a guest order sets the user from the order customer and checkout, omitting absent fields', async () => {
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
        lineItems: [{ title: 'Cookie', quantity: 1, variant: { price: { amount: '20' }, product: { id: '9' } } }],
        order: {
          id: 'gid://shopify/Order/77',
          customer: { id: 'gid://shopify/Customer/43', isFirstOrder: null },
        },
      },
    },
  });
  await flush();
  assert.deepEqual(calls.find((call) => call.method === 'setUser').args, [{ id: '43', email: 'guest@example.com' }]);
  assert.deepEqual(actions(calls), [
    [
      'purchase',
      {
        platform: 'web',
        locale: 'es',
        transaction_id: '77',
        currency: 'EUR',
        value: 20,
        items: [{ item_id: '9', item_name: 'Cookie', price: 20, quantity: 1 }],
      },
    ],
  ]);
  assert.doesNotMatch(JSON.stringify(actions(calls)), /@/);
});

test('a purchase without an order customer keeps the logged-in customer as the user', async () => {
  const { calls, handlers } = runPixel(configured, { id: 'gid://shopify/Customer/42' });
  handlers.checkout_completed({
    ...base,
    data: { checkout: { email: 'a@b.c', billingAddress: { firstName: 'Laia' }, order: { id: '77' } } },
  });
  await flush();
  const users = calls.filter((call) => call.method === 'setUser').map((call) => call.args[0]);
  assert.deepEqual(users.at(-1), { id: '42', name: 'Laia', email: 'a@b.c' });
});

test('reports the theme version the storefront left in its cookie, or unknown without one', async () => {
  const versionOf = async (cookies) => {
    const { calls } = runPixel(configured, null, true, cookies);
    await flush();
    return calls.find((call) => call.method === 'init').args[0].version;
  };
  assert.equal(await versionOf({ mionas_theme_version: '2026.10.06' }), '2026.10.06');
  assert.equal(await versionOf({}), 'unknown');
});

test('starts Datadog only once the version is read, keeping the order of its calls', async () => {
  const { calls, handlers } = runPixel(configured, { id: '42' }, true, { mionas_theme_version: '2026.10.06' });
  handlers.checkout_started({ ...base, data: { checkout: {} } });
  await flush();
  assert.deepEqual(
    calls.filter((call) => call.method !== 'loadScript').map((call) => call.method),
    ['init', 'setUser', 'addAction']
  );
});
