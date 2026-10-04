import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../snippets/mionas-datadog.liquid', import.meta.url), 'utf8');
const layout = await readFile(new URL('../layout/theme.liquid', import.meta.url), 'utf8');
const popup = await readFile(new URL('../assets/mionas-newsletter-dialog.js', import.meta.url), 'utf8');

/** The snippet's script with its Liquid output replaced, as a logged-in or anonymous page would render it. */
function renderScript({ customerId = null } = {}) {
  const script = source.match(/<script>([\s\S]*)<\/script>/)[1];
  const values = {
    application_id: 'app-id',
    client_token: 'client-token',
    env: 'preview',
    'request.locale.iso_code': 'ca',
  };
  return script
    .replace(/\{% if customer -%\}([\s\S]*?)\{%- else -%\}([\s\S]*?)\{%- endif %\}/, (_, loggedIn, anonymous) =>
      customerId ? loggedIn : anonymous
    )
    .replace(/\{\{ customer\.id \}\}/g, String(customerId))
    .replace(/\{\{ ([\w.]+) \}\}/g, (_, name) => values[name]);
}

/** Runs the rendered script against stub browser, Shopify and Datadog globals. */
function runSnippet({ allowed = false, customerId = null } = {}) {
  const calls = [];
  const listeners = {};
  const record =
    (method) =>
    (...args) =>
      calls.push({ method, args });
  const privacy = { allowed };
  let featuresLoaded;
  const window = {
    DD_RUM: {
      onReady: (callback) => callback(),
      init: record('init'),
      setUser: record('setUser'),
      clearUser: record('clearUser'),
      addAction: record('addAction'),
      setTrackingConsent: record('setTrackingConsent'),
      startSessionReplayRecording: record('startSessionReplayRecording'),
    },
    Shopify: {
      currency: { active: 'EUR' },
      loadFeatures: (features, callback) => (featuresLoaded = () => callback(null)),
      customerPrivacy: { analyticsProcessingAllowed: () => privacy.allowed },
    },
  };
  const document = {
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: record('loadScript') } }],
    addEventListener: (name, listener) => (listeners[name] = listener),
  };
  new Function('window', 'document', renderScript({ customerId }))(window, document);
  return {
    calls,
    window,
    privacy,
    loadFeatures: () => featuresLoaded(),
    emit: (name, event) => listeners[name](event),
  };
}

const actions = (calls) => calls.filter((call) => call.method === 'addAction').map((call) => call.args);
const consents = (calls) => calls.filter((call) => call.method === 'setTrackingConsent').map((call) => call.args[0]);
const flush = () => new Promise((resolve) => setTimeout(resolve));

const productView = (context) => ({
  context,
  product: {
    id: 'gid://shopify/Product/9',
    title: 'Cookie',
    selectedVariant: {
      id: 'gid://shopify/ProductVariant/5',
      title: 'Caja de 6',
      price: { amount: '4.20', currencyCode: 'EUR' },
    },
  },
});

test('outputs nothing in the theme editor or before the credentials are filled in', () => {
  assert.match(source, /^\{% doc %\}/);
  assert.match(source, /request\.design_mode/);
  assert.match(source, /application_id != blank and client_token != blank/);
});

test('the layout renders it after content_for_header, which defines the consent API', () => {
  assert.match(layout, /\{\{ content_for_header \}\}\s*\{%- render 'mionas-datadog' -%\}/);
});

test('starts on the EU site with collection off and replay masking typed input', () => {
  const { calls } = runSnippet();
  const init = calls.find((call) => call.method === 'init').args[0];
  assert.equal(init.site, 'datadoghq.eu');
  assert.equal(init.trackingConsent, 'not-granted');
  assert.equal(init.defaultPrivacyLevel, 'mask-user-input');
  assert.equal(init.sessionReplaySampleRate, 100);
  assert.equal(init.env, 'preview');
  assert.match(source, /eu1\/v7\/datadog-rum-shopify\.js/);
  assert.match(source, /request\.host == shop\.domain/);
});

test('a visitor who never allows analytics is never recorded', async () => {
  const { calls, loadFeatures, emit } = runSnippet();
  emit('shopify:product:view', productView('page'));
  loadFeatures();
  emit('visitorConsentCollected', {});
  await flush();
  assert.deepEqual(consents(calls), ['not-granted', 'not-granted']);
  assert.deepEqual(actions(calls), []);
});

test('holds actions until consent, then sends them; a withdrawal stops collection', async () => {
  const { calls, loadFeatures, privacy, emit, window } = runSnippet();
  emit('shopify:product:view', productView('page'));
  window.mionasDatadog.action('sign_up', { method: 'newsletter_popup' });
  assert.deepEqual(actions(calls), []);

  privacy.allowed = true;
  loadFeatures();
  assert.deepEqual(consents(calls), ['granted']);
  assert.deepEqual(actions(calls), [
    [
      'view_item',
      {
        platform: 'web',
        locale: 'ca',
        currency: 'EUR',
        value: 4.2,
        items: [{ item_id: '9', item_name: 'Cookie', item_variant: 'Caja de 6', price: 4.2, quantity: 1 }],
      },
    ],
    ['sign_up', { platform: 'web', locale: 'ca', method: 'newsletter_popup' }],
  ]);

  privacy.allowed = false;
  emit('visitorConsentCollected', {});
  emit('shopify:product:view', productView('page'));
  assert.deepEqual(consents(calls), ['granted', 'not-granted']);
  assert.equal(actions(calls).length, 2);
});

test('counts a product view only on the product page, not on product cards', () => {
  const { calls, loadFeatures, privacy, emit } = runSnippet({ allowed: true });
  privacy.allowed = true;
  loadFeatures();
  emit('shopify:product:view', productView('collection'));
  emit('shopify:product:view', productView('recommendation'));
  assert.deepEqual(actions(calls), []);
});

test('sends a successful cart add with the added item, and ignores removals and failed adds', async () => {
  const { calls, loadFeatures, emit } = runSnippet({ allowed: true });
  loadFeatures();
  const items = [
    { variant_id: 5, product_id: 9, product_title: 'Cookie', variant_title: null, price: 420, quantity: 3 },
    { variant_id: 6, product_id: 10, product_title: 'Brownie', variant_title: 'Grande', price: 350, quantity: 1 },
  ];
  emit('shopify:cart:lines-update', {
    action: 'add',
    lines: [{ merchandiseId: '5', quantity: 2 }],
    promise: Promise.resolve({ cart: { id: 'c' }, detail: { items } }),
  });
  emit('shopify:cart:lines-update', {
    action: 'remove',
    lines: [{ id: 'line', quantity: 1 }],
    promise: Promise.resolve({ cart: { id: 'c' } }),
  });
  emit('shopify:cart:lines-update', {
    action: 'add',
    lines: [{ merchandiseId: 'gid://shopify/ProductVariant/6', quantity: 1 }],
    promise: Promise.resolve({ cart: { id: 'c' }, userErrors: [{ message: 'Sold out' }] }),
  });
  await flush();
  assert.deepEqual(actions(calls), [
    [
      'add_to_cart',
      {
        platform: 'web',
        locale: 'ca',
        currency: 'EUR',
        value: 8.4,
        items: [{ item_id: '9', item_name: 'Cookie', price: 4.2, quantity: 2 }],
      },
    ],
  ]);
});

test('identifies a logged-in customer by ID only and clears the user otherwise', () => {
  assert.deepEqual(runSnippet({ customerId: 42 }).calls.find((call) => call.method === 'setUser').args, [{ id: '42' }]);
  assert.ok(runSnippet().calls.some((call) => call.method === 'clearUser'));
  assert.doesNotMatch(source, /email/);
});

test('the newsletter dialog sends its funnel through the snippet with GA4 names', () => {
  assert.match(popup, /window\.mionasDatadog\?\.action\(name, params\)/);
  assert.match(popup, /shown: 'view_promotion', closed: 'close_promotion', subscribed: 'sign_up'/);
});
