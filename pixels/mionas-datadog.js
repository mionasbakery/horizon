// Datadog custom pixel. Shopify runs this file from admin → Settings → Customer events, not from the
// theme: paste it there after every change, with permission "Required → Analytics" and "Data
// collected does not qualify as data sale". It sends only the checkout events: Datadog's Shopify plugin
// starts a session only on checkout pages, so snippets/mionas-datadog.liquid sends the storefront ones.

const APPLICATION_ID = '3cfcdfbf-c542-4a44-984c-86817696fa70';
const CLIENT_TOKEN = 'pub59bd54eb9ba2058b8cefef1f0cf0ed78';
const REMOTE_CONFIGURATION_ID = '924379f5-1d49-4513-911f-9f8187d8be0a';
const STORE_LOCALES = ['ca', 'en'];

/** Shopify IDs arrive as numbers or as gid://shopify/Customer/123; Datadog needs one stable form. */
function numericId(id) {
  return id == null ? undefined : String(id).split('/').pop();
}

function amount(money) {
  const value = Number(money?.amount);
  return Number.isFinite(value) ? value : undefined;
}

function pathLocale(event) {
  const first = (event.context?.document?.location?.pathname ?? '/').split('/')[1];
  return STORE_LOCALES.includes(first) ? first : 'es';
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

/** A customer's name and email, leaving out whatever Shopify didn't provide. */
function profile(firstName, lastName, email) {
  const name = [firstName, lastName].filter(Boolean).join(' ');
  const fields = { name: name || undefined, email: email || undefined };
  for (const key of Object.keys(fields)) if (fields[key] == null) delete fields[key];
  return fields;
}

/** The release snippets/mionas-version-cookie.liquid leaves in a cookie; a checkout opened without visiting the store has none. */
function themeVersion() {
  return browser.cookie
    .get('mionas_theme_version')
    .then((value) => decodeURIComponent(value) || 'unknown')
    .catch(() => 'unknown');
}

function consent(customerPrivacy) {
  return customerPrivacy?.analyticsProcessingAllowed ? 'granted' : 'not-granted';
}

function start() {
  (function (h, o, u, n, d) {
    h = h[d] = h[d] || {
      q: [],
      onReady: function (c) {
        h.q.push(c);
      },
    };
    d = o.createElement(u);
    d.src = n;
    d.crossOrigin = 'anonymous';
    n = o.getElementsByTagName(u)[0];
    n.parentNode.insertBefore(d, n);
  })(window, document, 'script', 'https://www.datadoghq-browser-agent.com/eu1/v7/datadog-rum-shopify.js', 'DD_RUM');

  const rum = window.DD_RUM;
  const versionRead = themeVersion();
  // Every call waits on the same version read, so they still reach Datadog in order, init first.
  const ready = (callback) => rum.onReady(() => versionRead.then(callback));
  const setUser = (id, fields) => id && ready(() => rum.setUser({ id, ...fields }));
  const action = (name, event, properties) => {
    const context = { platform: 'web', locale: pathLocale(event) };
    for (const [key, value] of Object.entries(properties)) if (value != null) context[key] = value;
    ready(() => rum.addAction(name, context));
  };

  ready((version) =>
    rum.init({
      applicationId: APPLICATION_ID,
      clientToken: CLIENT_TOKEN,
      site: 'datadoghq.eu',
      service: 'mionas-storefront',
      env: 'production',
      version,
      sessionSampleRate: 100,
      remoteConfiguration: { id: REMOTE_CONFIGURATION_ID },
      plugins: [rum.shopifyPlugin({ shopifyAnalytics: analytics })],
      trackingConsent: consent(init.customerPrivacy),
    })
  );
  // Shopify stops delivering events after a withdrawal, but the plugin's own click and error
  // collection only stops when the SDK is told.
  api.customerPrivacy.subscribe('visitorConsentCollected', (event) => {
    ready(() => rum.setTrackingConsent(consent(event.customerPrivacy)));
  });
  const customer = init.data?.customer;
  const customerId = numericId(customer?.id);
  setUser(customerId, profile(customer?.firstName, customer?.lastName, customer?.email));

  analytics.subscribe('checkout_started', (event) => {
    action('begin_checkout', event, checkoutProperties(event.data?.checkout));
  });

  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data?.checkout;
    const order = checkout?.order;
    // A guest checkout still creates a Shopify customer, so the order ties this session to them.
    const billing = checkout?.billingAddress;
    setUser(
      numericId(order?.customer?.id) ?? customerId,
      profile(billing?.firstName, billing?.lastName, checkout?.email)
    );
    action('purchase', event, {
      transaction_id: numericId(order?.id),
      is_first_order: order?.customer?.isFirstOrder,
      ...checkoutProperties(checkout),
    });
  });
}

if (APPLICATION_ID && CLIENT_TOKEN) start();
