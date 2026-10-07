# TODO: analytics setup

Manual steps left over from moving session replay and channel tracking to Mixpanel (October 2026).
The code is done; these steps happen in Shopify admin, Mixpanel and GA4, and the code changes only
take effect once they're done.

Tagging guide with the link builder and the Mixpanel formula:
https://claude.ai/artifact/95yyR8QjmH2dvu5fbpDFtw (private; share it from its Share menu if someone
else tags links).

## 1. Release the theme

- [x] Release the theme with `/mionas-release`. Released as `2026.10.08` on 2026-10-08.

That release removes the Datadog snippet, turns off the Clarity app embed and adds
`snippets/mionas-mixpanel-replay.liquid`. Until it is live, the store still loads Datadog and
Clarity and records no Mixpanel replays.

## 2. Shopify admin

- [x] **Paste the updated Mixpanel pixel.** Done 2026-10-08. Settings → Customer events → the Mixpanel custom pixel:
  replace its code with `pixels/mionas-mixpanel.js`. Keep its permission at "Required → Analytics"
  and "Data collected does not qualify as data sale". This one paste brings two changes:
  - It saves Shopify's visitor ID in the `mionas_client_id` cookie. The replay snippet needs that
    ID to tie each recording to the visitor's events. Without it, nothing gets recorded.
  - Page views where a visit lands carry the UTM tags, the click-ID network (`click_id_network`)
    and the referring site (`$referring_domain`).
- [x] **Delete the Datadog custom pixel**, in the same Customer events list. Done 2026-10-08.
- [x] **Uninstall the Microsoft Clarity app** (done 2026-10-08) under Settings → Apps. The release only turns off its
  embed; the app stays installed until you remove it.
- [ ] **Decide whether GA4 should get the newsletter popup events.** GA4 runs through the Google &
  YouTube app, which sends only Shopify's standard events (page views, cart, checkout). The popup's
  own events (`view_promotion`, `close_promotion`, `sign_up`) therefore reach Mixpanel only, although
  the comment in `assets/mionas-newsletter-dialog.js` says a GA4 custom pixel renames them.
  - If the popup funnel in Mixpanel is enough, fix that comment and close this.
  - If GA4 should have it too, add a small GA4 custom pixel in `pixels/` that sends only those three
    events. Page views must stay with the Google app, or GA4 counts them twice.
- [ ] **Check the other admin tracking spots** for anything left over:
  - Customer events: app pixels for Meta, TikTok or Pinterest.
  - Online Store → Preferences: an old Google Analytics or Facebook Pixel field.

## 3. Mixpanel

- [ ] **Turn on Session Replay** in the project settings, if it isn't already. Heatmaps come with it.
  The Free plan is said to include 10,000 replays a month; check the current number on Mixpanel's
  pricing page. The snippet records 100% of storefront sessions after cookie consent. To record
  fewer, add sampling to the snippet.
- [ ] **Check the plan includes Attribution reports.** The channel setup relies on them: the tags are
  only on the page view where a visit lands, and Attribution looks back from each purchase to those
  page views. Without Attribution, the pixel would need to copy the tags onto the purchase event.
- [ ] **Add the Channel computed property.** Lexicon → Custom properties → Create, on events. Map the
  letters A = `utm_source`, B = `utm_medium`, C = Referring Domain, D = `click_id_network`, and paste
  the formula from the tagging guide.
  - It is a shortened copy of GA4's default channel rules.
  - I wrote it from Mixpanel's formula docs but couldn't run it, so check its output on a few
    events and fix any syntax error.
  - Page views without traffic data get no channel on purpose, so pages clicked inside the shop
    never count as a touchpoint.
- [ ] **Set the attribution lookback to 90 days** (Mixpanel's default is 30) and use last touch.
  That matches how GA4 credits a sale.

## 4. GA4 and Google Ads

- [ ] **Link Google Ads to GA4** under GA4 Admin → Product links → Google Ads. Without the link, GA4
  can't file clicks with a Google Ads click ID (`gclid`) as Paid Search. The Mixpanel formula
  assumes it can.
- [ ] **Check how GA4 files Google's free product listings**: tags `google` / `product_sync` /
  `sag_organic`, added by the Google & YouTube app. The Mixpanel formula calls them Organic Shopping.
  If GA4 uses another channel, change the formula to match.

## 5. Tagging links

Orders since June show what is tagged today:
- Shopify Email tags every newsletter link (`shopify_email` / `email`).
- Instagram tags the bio link (`ig` / `social` / `link_in_bio`).
- The Google & YouTube app tags the free product listings.

Leave those three alone.

- [ ] **Tag story, post and reel links** with the guide's link builder. They show up as untagged
  Instagram or Direct today.
- [ ] **Tag the remaining placements** the same way: TikTok, WhatsApp, Google Business Profile, QR
  codes in the shop and on packaging, partner and press links.
  - Use the source names from the guide (`ig`, not `instagram`), so each source stays one line in
    the reports.
  - GA4 has no offline channel, so QR codes land under Unassigned there. Filter them by source `qr`.

## 6. Test after the release

- [ ] Open a tagged link from the guide in a private window, accept cookies and browse two pages.
  Then check in Mixpanel that:
  - the landing `page_view` has the UTM tags and `$referring_domain`;
  - a replay appears under Session Replay, linked to the same visitor as the events.
- [ ] Note the one known gap: a brand-new visitor's first page is recorded only if the pixel's cookie
  arrives within about 10 seconds of accepting cookies. Pages after that are always recorded.
- [ ] After a few weeks, compare revenue by channel in Mixpanel, GA4 and Shopify (Analytics →
  Marketing). Expect the same mix and trends, not identical totals: each tool loses different
  visits to the cookie banner and ad blockers.

## Later, if needed

- [ ] Stop recording right away when a visitor withdraws analytics consent mid-page. Today the
  snippet keeps recording until they leave that page, and Mixpanel's cookie stays in their browser.
- [ ] A finer "Mionas channel" grouping (bio vs story vs QR placement, and so on), defined both as a
  Mixpanel computed property and as a GA4 custom channel group. Hold off until there is a specific
  question it answers; two copies of the rules drift apart unless someone keeps them in sync.
