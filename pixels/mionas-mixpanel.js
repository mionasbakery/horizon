// Mixpanel custom pixel. Shopify runs this file from admin → Settings → Customer events, not from the
// theme: paste it there after every change, with permission "Required → Analytics" so it only runs
// after cookie consent, and "Data collected does not qualify as data sale".

const TOKEN = '273df65673c4c4ddd67d25a8b5ceb539';
// The project stores its data in the EU, so events must go to the EU host.
const HOST = 'https://api-eu.mixpanel.com';
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

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
// fbclid rides on organic Instagram and Facebook links too, so a click ID names the network, not paid traffic.
const CLICK_ID_NETWORKS = {
  gclid: 'google',
  gbraid: 'google',
  wbraid: 'google',
  dclid: 'google',
  fbclid: 'meta',
  ttclid: 'tiktok',
  msclkid: 'microsoft',
};
// Checkout and PayPal send visitors back here; GA4 would count them as referrals unless excluded too.
const OWN_REFERRERS = /(^|\.)(myshopify\.com|shopify\.com|paypal\.com)$/;

/** Shopify IDs arrive as numbers or as gid://shopify/Customer/123; Mixpanel needs one stable form. */
function numericId(id) {
  return id == null ? undefined : String(id).split('/').pop();
}

function amount(money) {
  const value = Number(money?.amount);
  return Number.isFinite(value) ? value : undefined;
}

/** A customer's name and email, leaving out whatever Shopify didn't provide. */
function profile(firstName, lastName, email) {
  const name = [firstName, lastName].filter(Boolean).join(' ');
  const fields = { $name: name || undefined, $email: email || undefined };
  for (const key of Object.keys(fields)) if (fields[key] == null) delete fields[key];
  return fields;
}

function post(path, record) {
  fetch(`${HOST}${path}?ip=1`, {
    method: 'POST',
    mode: 'no-cors',
    keepalive: true,
    body: new URLSearchParams({ data: JSON.stringify([record]) }),
  }).catch(() => {});
}

/**
 * The release snippets/mionas-version-cookie.liquid leaves in a cookie on every storefront page; a checkout
 * opened without visiting the store has none. Read per event, so a release mid-visit shows up at once.
 */
function themeVersion() {
  return browser.cookie
    .get('mionas_theme_version')
    .then((value) => decodeURIComponent(value) || 'unknown')
    .catch(() => 'unknown');
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

let clientIdShared = false;

/**
 * Leaves clientId in a cookie for snippets/mionas-mixpanel-replay.liquid, which can't read it, so each
 * replay joins the same visitor as these events.
 */
function shareClientId(clientId) {
  if (clientIdShared || !clientId) return;
  clientIdShared = true;
  browser.cookie
    .set(`mionas_client_id=${encodeURIComponent(clientId)}; path=/; max-age=31536000; samesite=lax`)
    .catch(() => {});
}

/**
 * How the visitor reached the page, for Mixpanel's attribution: UTM tags as GA4 reads them, the network
 * behind a click ID and the referring site. The rest of the query string and the click ID itself stay out.
 */
function trafficProperties(event) {
  const document = event.context?.document;
  const params = new URLSearchParams(document?.location?.search ?? '');
  const properties = {};
  for (const key of UTM_KEYS) if (params.get(key)) properties[key] = params.get(key);
  const clickId = Object.keys(CLICK_ID_NETWORKS).find((key) => params.has(key));
  if (clickId) properties.click_id_network = CLICK_ID_NETWORKS[clickId];

  let referrer;
  try {
    referrer = new URL(document?.referrer).hostname;
  } catch {
    referrer = undefined;
  }
  if (referrer && referrer !== document?.location?.hostname && !OWN_REFERRERS.test(referrer)) {
    properties.$referring_domain = referrer;
  }
  return properties;
}

/**
 * Sends one event over HTTP with Shopify's clientId as the device, rather than through the browser
 * SDK: clientId is the one visitor ID the storefront, the pixel and checkout all share.
 */
function track(name, event, properties, userId) {
  const deviceId = event.clientId;
  shareClientId(deviceId);
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

  themeVersion().then((theme_version) => post('/track', { event: name, properties: { ...payload, theme_version } }));
}

/** Mixpanel shows a person's name and email from their profile, not from their events. */
function identify(userId, fields) {
  if (userId && Object.keys(fields).length) post('/engage', { $token: TOKEN, $distinct_id: userId, $set: fields });
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

const customer = init.data?.customer;
const customerId = numericId(customer?.id);
identify(customerId, profile(customer?.firstName, customer?.lastName, customer?.email));

analytics.subscribe('page_viewed', (event) => {
  const { page_location, page_type } = pageProperties(event);
  // Only the page view carries traffic: Mixpanel's attribution reads each one as a touchpoint.
  track('page_view', event, { page_location, page_type, ...trafficProperties(event) }, customerId);
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
  const billing = checkout?.billingAddress;
  identify(userId, profile(billing?.firstName, billing?.lastName, checkout?.email));
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
