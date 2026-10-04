// Datadog custom pixel. Shopify runs this file from admin → Settings → Customer events, not from the
// theme: paste it there after every change, with permission "Required → Analytics" and "Data
// collected does not qualify as data sale". It sends only the checkout events: Datadog's Shopify plugin
// starts a session only on checkout pages, so snippets/mionas-datadog.liquid sends the storefront ones.

const APPLICATION_ID = '';
const CLIENT_TOKEN = '';
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
  const setUser = (id) => id && rum.onReady(() => rum.setUser({ id }));
  const action = (name, event, properties) => {
    const context = { platform: 'web', locale: pathLocale(event) };
    for (const [key, value] of Object.entries(properties)) if (value != null) context[key] = value;
    rum.onReady(() => rum.addAction(name, context));
  };

  rum.onReady(() =>
    rum.init({
      applicationId: APPLICATION_ID,
      clientToken: CLIENT_TOKEN,
      site: 'datadoghq.eu',
      service: 'mionas-storefront',
      env: 'production',
      sessionSampleRate: 100,
      plugins: [rum.shopifyPlugin({ shopifyAnalytics: analytics })],
      trackingConsent: consent(init.customerPrivacy),
    })
  );
  // Shopify stops delivering events after a withdrawal, but the plugin's own click and error
  // collection only stops when the SDK is told.
  api.customerPrivacy.subscribe('visitorConsentCollected', (event) => {
    rum.onReady(() => rum.setTrackingConsent(consent(event.customerPrivacy)));
  });
  setUser(numericId(init.data?.customer?.id));

  analytics.subscribe('checkout_started', (event) => {
    action('begin_checkout', event, checkoutProperties(event.data?.checkout));
  });

  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data?.checkout;
    const order = checkout?.order;
    // A guest checkout still creates a Shopify customer, so the order ties this session to them.
    setUser(numericId(order?.customer?.id));
    action('purchase', event, {
      transaction_id: numericId(order?.id),
      is_first_order: order?.customer?.isFirstOrder,
      ...checkoutProperties(checkout),
    });
  });
}

if (APPLICATION_ID && CLIENT_TOKEN) start();
