import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../snippets/mionas-mixpanel-replay.liquid', import.meta.url), 'utf8');
const layout = await readFile(new URL('../layout/theme.liquid', import.meta.url), 'utf8');

/** Runs the rendered script against stub browser, Shopify and SDK globals, recording every Mixpanel call. */
function runSnippet({ customerId = null, cookie = '', allowed = true, recordSessionsPercent = 100 } = {}) {
  const script = source
    .match(/<script>([\s\S]*)<\/script>/)[1]
    .replace('{{ customer.id | json }}', JSON.stringify(customerId))
    .replace('{{ settings.mionas_replay_sessions_percent | json }}', JSON.stringify(recordSessionsPercent))
    .replace('import(', 'loadSdk(');
  const calls = [];
  const imports = [];
  const listeners = {};
  const timers = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const mixpanel = {
    init: record('init'),
    register: record('register'),
    unregister: record('unregister'),
  };
  /** Plays the browser's part in import(): resolves the module once the test lets it load. */
  let finishLoad;
  const loadSdk = (url) => {
    imports.push(url);
    return new Promise((resolve) => (finishLoad = () => resolve({ default: mixpanel })));
  };
  const document = {
    cookie,
    addEventListener: (name, handler) => (listeners[name] = handler),
  };
  const window = {
    Shopify: {
      customerPrivacy: { analyticsProcessingAllowed: () => allowed },
      loadFeatures: (features, callback) => callback(null),
    },
  };
  const setTimeout = (callback) => timers.push(callback);
  new Function('window', 'document', 'setTimeout', 'loadSdk', script)(window, document, setTimeout, loadSdk);

  async function loadSdkNow() {
    finishLoad();
    await new Promise((resolve) => globalThis.setTimeout(resolve));
    return calls;
  }
  return { document, imports, listeners, timers, calls, loadSdk: loadSdkNow };
}

test('the layout renders it after the consent API', () => {
  assert.match(layout, /\{\{ content_for_header \}\}\s*\{%- render 'mionas-version-cookie' -%\}\s*\{%- render 'mionas-mixpanel-replay' -%\}/);
});

test('loads nothing until the visitor allows analytics', () => {
  const run = runSnippet({ cookie: 'mionas_client_id=client-1', allowed: false });
  assert.deepEqual(run.imports, []);
});

test('records on the EU host with heatmaps, pinned SDK and form fields masked', async () => {
  const run = runSnippet({ cookie: 'mionas_client_id=client-1', recordSessionsPercent: 30 });
  assert.match(run.imports[0], /mixpanel-browser@\d+\.\d+\.\d+\/dist\/mixpanel\.module\.min\.js$/);
  const [[name, token, config]] = await run.loadSdk();
  assert.equal(name, 'init');
  assert.equal(token, '273df65673c4c4ddd67d25a8b5ceb539');
  assert.equal(config.api_host, 'https://api-eu.mixpanel.com');
  assert.equal(config.record_heatmap_data, true);
  assert.equal(config.record_sessions_percent, 30);
  assert.equal(config.record_mask_all_inputs, undefined);
});

test('uses the pixel’s visitor straight after init', async () => {
  const run = runSnippet({ cookie: 'other=1; mionas_client_id=client-1' });
  await run.loadSdk();
  assert.deepEqual(run.calls.slice(1), [
    ['register', { distinct_id: '$device:client-1', $device_id: 'client-1' }],
    ['unregister', '$user_id'],
  ]);
});

test('uses the customer ID for a logged-in customer, as the pixel does', async () => {
  const run = runSnippet({ customerId: 42, cookie: 'mionas_client_id=client-1' });
  await run.loadSdk();
  assert.deepEqual(run.calls.slice(1, 3), [
    ['register', { distinct_id: '42', $device_id: 'client-1' }],
    ['register', { $user_id: '42' }],
  ]);
});

test('waits for the pixel’s cookie, and gives up rather than record under another visitor', () => {
  const run = runSnippet();
  assert.deepEqual(run.imports, []);
  run.document.cookie = 'mionas_client_id=client-1';
  run.timers.shift()();
  assert.equal(run.imports.length, 1);

  const never = runSnippet();
  while (never.timers.length) never.timers.shift()();
  assert.deepEqual(never.imports, []);
});

test('starts once, however many times consent is reported', () => {
  const run = runSnippet({ cookie: 'mionas_client_id=client-1' });
  run.listeners.visitorConsentCollected();
  assert.equal(run.imports.length, 1);
});

test('skips the snippet when the theme setting is 0, and outside the theme editor only', () => {
  assert.match(source, /\{%- unless request\.design_mode or settings\.mionas_replay_sessions_percent == 0 -%\}/);
});
