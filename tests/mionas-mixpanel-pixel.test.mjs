import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../pixels/mionas-mixpanel.js', import.meta.url), 'utf8');

/** Runs the pixel against stub Shopify globals and returns the events and profile updates it posts. */
function runPixel(customer = null, cookies = {}) {
  const sent = [];
  const cookieWrites = [];
  const profiles = [];
  const handlers = {};
  const analytics = { subscribe: (name, handler) => (handlers[name] = handler) };
  const fetch = (url, options) => {
    const record = { url, ...JSON.parse(new URLSearchParams(options.body.toString()).get('data'))[0] };
    (url.includes('/engage') ? profiles : sent).push(record);
    return Promise.resolve();
  };
  const browser = {
    cookie: { get: async (name) => cookies[name] ?? '', set: async (cookie) => cookieWrites.push(cookie) },
  };
  new Function('analytics', 'init', 'browser', 'fetch', source)(analytics, { data: { customer } }, browser, fetch);
  return { sent, profiles, handlers, cookieWrites };
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
const flush = () => new Promise((resolve) => setTimeout(resolve));
const item = { item_id: '9', item_name: 'Cookie', item_variant: 'Caja de 6', price: 4.2 };

test('posts to the EU host with Simplified ID Merge identity and a short insert ID', async () => {
  const { sent, handlers } = runPixel();
  const location = { origin: 'https://mionasbakery.com', pathname: '/ca/products/cookie-box', search: '?email=a@b.c' };
  handlers.page_viewed({ ...base, context: { document: { location } } });
  await flush();
  assert.equal(sent[0].properties.page_location, 'https://mionasbakery.com/ca/products/cookie-box');
  assert.match(sent[0].url, /^https:\/\/api-eu\.mixpanel\.com\/track/);
  assert.equal(sent[0].properties.distinct_id, '$device:client-1');
  assert.equal(sent[0].properties.$insert_id.length, 36);
});

test('sends GA4 names and parameters', async () => {
  const { sent, handlers } = runPixel();
  handlers.page_viewed(base);
  handlers.product_viewed({ ...base, data: { productVariant: variant } });
  handlers.product_added_to_cart({ ...base, data: { cartLine: { quantity: 2, merchandise: variant } } });
  const promotion = { promotion_id: 'newsletter_popup', promotion_name: 'Newsletter popup' };
  handlers.newsletter_popup_shown({ ...base, customData: { ...promotion, trigger: 'auto' } });
  handlers.newsletter_popup_closed({ ...base, customData: { ...promotion, method: 'button' } });
  handlers.newsletter_popup_subscribed({ ...base, customData: { method: 'newsletter_popup' } });
  await flush();

  const events = sent.map(({ event, properties }) => {
    const { token, distinct_id, $device_id, time, $insert_id, theme_version, ...rest } = properties;
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

test('a purchase carries the order as transaction_id and identifies the order customer', async () => {
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
  await flush();
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

test('a purchase sets the order customer\'s name and email on their profile', async () => {
  const { profiles, handlers } = runPixel();
  handlers.checkout_completed({
    ...base,
    data: {
      checkout: {
        email: 'guest@example.com',
        billingAddress: { firstName: 'Laia', lastName: 'Puig' },
        order: { id: 'gid://shopify/Order/77', customer: { id: 'gid://shopify/Customer/43' } },
      },
    },
  });
  assert.equal(profiles.length, 1);
  assert.match(profiles[0].url, /^https:\/\/api-eu\.mixpanel\.com\/engage/);
  assert.equal(profiles[0].$distinct_id, '43');
  assert.deepEqual(profiles[0].$set, { $name: 'Laia Puig', $email: 'guest@example.com' });
});

test('a logged-in customer\'s profile is set once per page, and an anonymous visitor gets none', async () => {
  const { profiles } = runPixel({ id: 'gid://shopify/Customer/42', firstName: 'Laia', email: 'a@b.c' });
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].$distinct_id, '42');
  assert.deepEqual(profiles[0].$set, { $name: 'Laia', $email: 'a@b.c' });
  assert.deepEqual(runPixel().profiles, []);
});

test('every event carries the theme version the storefront left in its cookie, or unknown without one', async () => {
  const versionOf = async (cookies) => {
    const { sent, handlers } = runPixel(null, cookies);
    handlers.page_viewed(base);
    handlers.product_viewed({ ...base, data: { productVariant: variant } });
    await flush();
    return sent.map(({ properties }) => properties.theme_version);
  };
  assert.deepEqual(await versionOf({ mionas_theme_version: '2026.10.06-rc.1' }), ['2026.10.06-rc.1', '2026.10.06-rc.1']);
  assert.deepEqual(await versionOf({}), ['unknown', 'unknown']);
});

test('reads the version for each event, so a release mid-visit shows up at once', async () => {
  const cookies = {};
  const { sent, handlers } = runPixel(null, cookies);
  handlers.page_viewed(base);
  await flush();
  cookies.mionas_theme_version = '2026.10.06';
  handlers.page_viewed(base);
  await flush();
  assert.deepEqual(
    sent.map(({ properties }) => properties.theme_version),
    ['unknown', '2026.10.06']
  );
});

test('leaves clientId in a cookie once, for the storefront replay', async () => {
  const { handlers, cookieWrites } = runPixel();
  handlers.page_viewed(base);
  handlers.product_viewed({ ...base, data: { productVariant: variant } });
  await flush();
  assert.deepEqual(cookieWrites, ['mionas_client_id=client-1; path=/; max-age=31536000; samesite=lax']);
});

/** A page view landing on `search`, arriving from `referrer`. */
function landing(search, referrer = '') {
  const location = { origin: 'https://mionasbakery.com', hostname: 'mionasbakery.com', pathname: '/', search };
  return { ...base, context: { document: { location, referrer } } };
}

test('the page view carries UTM tags, the click ID network and the referring site, and nothing else', async () => {
  const { sent, handlers } = runPixel();
  handlers.page_viewed(
    landing(
      '?utm_source=instagram&utm_medium=social&utm_campaign=panellets&utm_content=bio&email=a@b.c&fbclid=XYZ',
      'https://l.instagram.com/?u=https%3A%2F%2Fmionasbakery.com'
    )
  );
  await flush();
  const { utm_source, utm_medium, utm_campaign, utm_content, click_id_network, $referring_domain } = sent[0].properties;
  assert.deepEqual(
    { utm_source, utm_medium, utm_campaign, utm_content, click_id_network, $referring_domain },
    {
      utm_source: 'instagram',
      utm_medium: 'social',
      utm_campaign: 'panellets',
      utm_content: 'bio',
      click_id_network: 'meta',
      $referring_domain: 'l.instagram.com',
    }
  );
  assert.doesNotMatch(JSON.stringify(sent[0]), /XYZ|a@b\.c/);
});

test('leaves out internal, checkout and payment referrers', async () => {
  const { sent, handlers } = runPixel();
  handlers.page_viewed(landing('', 'https://mionasbakery.com/collections/all'));
  handlers.page_viewed(landing('', 'https://mionas-bakery.myshopify.com/checkouts/1'));
  handlers.page_viewed(landing('', 'https://www.paypal.com/checkoutnow'));
  handlers.page_viewed(landing('', 'not a url'));
  await flush();
  assert.deepEqual(
    sent.map(({ properties }) => properties.$referring_domain),
    [undefined, undefined, undefined, undefined]
  );
});

test('only the page view carries traffic', async () => {
  const { sent, handlers } = runPixel();
  const event = landing('?utm_source=newsletter&gclid=1');
  handlers.product_viewed({ ...event, data: { productVariant: variant } });
  await flush();
  assert.equal(sent[0].properties.utm_source, undefined);
  assert.equal(sent[0].properties.click_id_network, undefined);
});
