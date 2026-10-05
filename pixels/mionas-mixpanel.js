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
  const location = event.context?.document?.location;
  const path = location?.pathname ?? '/';
  const first = path.split('/')[1];
  const locale = STORE_LOCALES.includes(first) ? first : 'es';
  const rest = locale === 'es' ? path : path.slice(first.length + 1) || '/';
  const pageType = rest === '/' ? 'home' : (PAGE_TYPES[rest.split('/')[1]] ?? 'other');
  // The query string is left out: a visitor can type anything into it, an email included.
  return { locale, page_location: `${location?.origin ?? ''}${path}`, page_type: pageType };
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

function cents(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}

/** One GA4 item. Shopify names a product's only variant "Default Title", which says nothing. */
function item(product, variant, price, quantity) {
  const fields = {
    item_id: numericId(product?.id),
    item_name: product?.title,
    item_variant: variant?.title === 'Default Title' ? undefined : variant?.title,
    price,
    quantity,
  };
  for (const key of Object.keys(fields)) if (fields[key] == null) delete fields[key];
  return fields;
}

function variantProperties(variant, quantity) {
  const price = amount(variant?.price);
  return {
    currency: variant?.price?.currencyCode,
    value: cents(price * quantity),
    items: [item(variant?.product, variant, price, quantity)],
  };
}

function checkoutProperties(checkout) {
  return {
    currency: checkout?.currencyCode ?? checkout?.totalPrice?.currencyCode,
    value: amount(checkout?.totalPrice),
    items: (checkout?.lineItems ?? []).map((line) =>
      item(
        { id: line.variant?.product?.id, title: line.title },
        line.variant,
        amount(line.variant?.price),
        line.quantity
      )
    ),
    // Checkout URLs carry no language prefix, so the storefront's path rule would always say "es".
    locale: checkout?.localization?.language?.isoCode?.toLowerCase(),
  };
}

const customerId = numericId(init.data?.customer?.id);

analytics.subscribe('page_viewed', (event) => {
  const { page_location, page_type } = pageProperties(event);
  track('page_view', event, { page_location, page_type }, customerId);
});

analytics.subscribe('product_viewed', (event) => {
  track('view_item', event, variantProperties(event.data?.productVariant, 1), customerId);
});

analytics.subscribe('product_added_to_cart', (event) => {
  const line = event.data?.cartLine;
  track('add_to_cart', event, variantProperties(line?.merchandise, line?.quantity), customerId);
});

analytics.subscribe('checkout_started', (event) => {
  track('begin_checkout', event, checkoutProperties(event.data?.checkout), customerId);
});

analytics.subscribe('checkout_completed', (event) => {
  const checkout = event.data?.checkout;
  const order = checkout?.order;
  // A guest checkout still creates a Shopify customer, so the order ties this browser to them.
  const userId = numericId(order?.customer?.id) ?? customerId;
  track(
    'purchase',
    { ...event, id: `order-${numericId(order?.id) ?? event.id}` },
    {
      transaction_id: numericId(order?.id),
      is_first_order: order?.customer?.isFirstOrder,
      ...checkoutProperties(checkout),
    },
    userId
  );
});

// Published by assets/mionas-newsletter-dialog.js with their GA4 parameters already set.
const NEWSLETTER_POPUP_EVENTS = {
  newsletter_popup_shown: 'view_promotion',
  newsletter_popup_closed: 'close_promotion',
  newsletter_popup_subscribed: 'sign_up',
};
Object.entries(NEWSLETTER_POPUP_EVENTS).forEach(([shopifyName, name]) => {
  analytics.subscribe(shopifyName, (event) => track(name, event, event.customData ?? {}, customerId));
});
