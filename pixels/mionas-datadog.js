// Datadog custom pixel. Shopify runs this file from admin → Settings → Customer events, not from the
// theme: paste it there after every change, with permission "Required → Analytics" and "Data
// collected does not qualify as data sale". snippets/mionas-datadog.liquid covers the storefront.

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
    })
  );
  setUser(numericId(init.data?.customer?.id));

  analytics.subscribe('product_viewed', (event) => {
    action('product_viewed', event, variantProperties(event.data?.productVariant));
  });

  analytics.subscribe('product_added_to_cart', (event) => {
    const line = event.data?.cartLine;
    action('product_added_to_cart', event, {
      ...variantProperties(line?.merchandise),
      quantity: line?.quantity,
    });
  });

  analytics.subscribe('checkout_started', (event) => {
    const checkout = event.data?.checkout;
    action('checkout_started', event, {
      cart_total: amount(checkout?.totalPrice),
      ...checkoutProperties(checkout),
    });
  });

  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data?.checkout;
    const order = checkout?.order;
    // A guest checkout still creates a Shopify customer, so the order ties this session to them.
    setUser(numericId(order?.customer?.id));
    action('checkout_completed', event, {
      order_id: numericId(order?.id),
      order_total: amount(checkout?.totalPrice),
      is_first_order: order?.customer?.isFirstOrder,
      ...checkoutProperties(checkout),
    });
  });

  // Published by assets/mionas-newsletter-popup.js; the prefix is the section's "Measurement name".
  analytics.subscribe('newsletter_popup_subscribed', (event) => {
    action('newsletter_subscribed', event, {
      test: event.customData?.test,
      group: event.customData?.group,
    });
  });
}

if (APPLICATION_ID && CLIENT_TOKEN) start();
