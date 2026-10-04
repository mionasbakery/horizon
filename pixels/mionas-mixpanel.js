// Mixpanel custom pixel. Shopify runs this file from admin → Settings → Customer events, not from the
// theme: paste it there after every change, with permission "Required → Analytics" so it only runs
// after cookie consent, and "Data collected does not qualify as data sale".

const TOKEN = '273df65673c4c4ddd67d25a8b5ceb539';
// The project stores its data in the EU, so events must go to the EU host.
const ENDPOINT = 'https://api-eu.mixpanel.com/track?ip=1';
const STORE_LOCALES = ['ca', 'en'];
const PAGE_TYPES = {
  products: 'product',
  collections: 'collection',
  pages: 'page',
  cart: 'cart',
  search: 'search',
  blogs: 'blog',
  checkouts: 'checkout',
  account: 'account',
};

/** Shopify IDs arrive as numbers or as gid://shopify/Customer/123; Mixpanel needs one stable form. */
function numericId(id) {
  return id == null ? undefined : String(id).split('/').pop();
}

function amount(money) {
  const value = Number(money?.amount);
  return Number.isFinite(value) ? value : undefined;
}

function pageProperties(event) {
  const path = event.context?.document?.location?.pathname ?? '/';
  const first = path.split('/')[1];
  const locale = STORE_LOCALES.includes(first) ? first : 'es';
  const rest = locale === 'es' ? path : path.slice(first.length + 1) || '/';
  const pageType = rest === '/' ? 'home' : (PAGE_TYPES[rest.split('/')[1]] ?? 'other');
  return { locale, url_path: rest, page_type: pageType };
}

/**
 * Sends one event over HTTP with Shopify's clientId as the device, rather than through the browser
 * SDK: clientId is the one visitor ID the storefront, the pixel and checkout all share.
 */
function track(name, event, properties, userId) {
  const deviceId = event.clientId;
  const page = pageProperties(event);
  const payload = {
    token: TOKEN,
    distinct_id: userId ?? `$device:${deviceId}`,
    $device_id: deviceId,
    $user_id: userId,
    time: Date.parse(event.timestamp) || Date.now(),
    // Mixpanel accepts at most 36 characters; Shopify's event IDs carry an extra "sh-" prefix.
    $insert_id: String(event.id)
      .replace(/[^A-Za-z0-9-]/g, '')
      .slice(-36),
    platform: 'web',
    locale: page.locale,
  };
  // Mixpanel stores an absent field better than a null one, and a missing value must not erase a default.
  for (const [key, value] of Object.entries(properties)) if (value != null) payload[key] = value;
  for (const key of Object.keys(payload)) if (payload[key] == null) delete payload[key];

  fetch(ENDPOINT, {
    method: 'POST',
    mode: 'no-cors',
    keepalive: true,
    body: new URLSearchParams({
      data: JSON.stringify([{ event: name, properties: payload }]),
    }),
  }).catch(() => {});
}

function variantProperties(variant) {
  return {
    product_id: numericId(variant?.product?.id),
    product_title: variant?.product?.title,
    variant_id: numericId(variant?.id),
    price: amount(variant?.price),
  };
}

function checkoutProperties(checkout) {
  return {
    item_count: (checkout?.lineItems ?? []).reduce((sum, line) => sum + (line.quantity ?? 0), 0),
    currency: checkout?.currencyCode ?? checkout?.totalPrice?.currencyCode,
    // Checkout URLs carry no language prefix, so the storefront's path rule would always say "es".
    locale: checkout?.localization?.language?.isoCode?.toLowerCase(),
  };
}

const customerId = numericId(init.data?.customer?.id);

analytics.subscribe('page_viewed', (event) => {
  const { url_path, page_type } = pageProperties(event);
  track('page_viewed', event, { url_path, page_type }, customerId);
});

analytics.subscribe('product_viewed', (event) => {
  track('product_viewed', event, variantProperties(event.data?.productVariant), customerId);
});

analytics.subscribe('product_added_to_cart', (event) => {
  const line = event.data?.cartLine;
  track(
    'product_added_to_cart',
    event,
    { ...variantProperties(line?.merchandise), quantity: line?.quantity },
    customerId
  );
});

analytics.subscribe('checkout_started', (event) => {
  const checkout = event.data?.checkout;
  track(
    'checkout_started',
    event,
    {
      cart_total: amount(checkout?.totalPrice),
      ...checkoutProperties(checkout),
    },
    customerId
  );
});

analytics.subscribe('checkout_completed', (event) => {
  const checkout = event.data?.checkout;
  const order = checkout?.order;
  // A guest checkout still creates a Shopify customer, so the order ties this browser to them.
  const userId = numericId(order?.customer?.id) ?? customerId;
  track(
    'checkout_completed',
    { ...event, id: `order-${numericId(order?.id) ?? event.id}` },
    {
      order_id: numericId(order?.id),
      order_total: amount(checkout?.totalPrice),
      is_first_order: order?.customer?.isFirstOrder,
      ...checkoutProperties(checkout),
    },
    userId
  );
});

// Published by assets/mionas-newsletter-popup.js; the prefix is the section's "Measurement name".
analytics.subscribe('newsletter_popup_subscribed', (event) => {
  track('newsletter_subscribed', event, { test: event.customData?.test, group: event.customData?.group }, customerId);
});
