import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../snippets/mionas-mixpanel-replay.liquid', import.meta.url), 'utf8');
const layout = await readFile(new URL('../layout/theme.liquid', import.meta.url), 'utf8');

/** Runs the rendered script against stub browser and Shopify globals, recording every Mixpanel call. */
function runSnippet({ customerId = null, cookie = '', allowed = true } = {}) {
  const script = source
    .match(/<script>([\s\S]*)<\/script>/)[1]
    .replace('{{ customer.id | json }}', JSON.stringify(customerId));
  const calls = [];
  const appended = [];
  const listeners = {};
  const timers = [];
  const document = {
    cookie,
    createElement: () => ({}),
    head: { appendChild: (element) => appended.push(element) },
    addEventListener: (name, handler) => (listeners[name] = handler),
  };
  const window = {
    Shopify: {
      customerPrivacy: { analyticsProcessingAllowed: () => allowed },
      loadFeatures: (features, callback) => callback(null),
    },
  };
  const setTimeout = (callback) => timers.push(callback);
  new Function('window', 'document', 'setTimeout', script)(window, document, setTimeout);

  /** Plays the SDK's part: once loaded, it calls the config's loaded hook with the instance. */
  function loadSdk() {
    const [token, config] = window.mixpanel._i[0];
    const record = (name) => (...args) => calls.push([name, ...args]);
    config.loaded({
      register: record('register'),
      unregister: record('unregister'),
      start_session_recording: record('start_session_recording'),
    });
    return { token, config };
  }
  return { window, document, appended, listeners, timers, calls, loadSdk };
}

test('the layout renders it after the consent API', () => {
  assert.match(layout, /\{\{ content_for_header \}\}\s*\{%- render 'mionas-version-cookie' -%\}\s*\{%- render 'mionas-mixpanel-replay' -%\}/);
});

test('loads nothing until the visitor allows analytics', () => {
  const run = runSnippet({ cookie: 'mionas_client_id=client-1', allowed: false });
  assert.equal(run.window.mixpanel, undefined);
  assert.deepEqual(run.appended, []);
});

test('records on the EU host with heatmaps, pinned SDK and form fields masked', () => {
  const run = runSnippet({ cookie: 'mionas_client_id=client-1' });
  const { token, config } = run.loadSdk();
  assert.equal(token, '273df65673c4c4ddd67d25a8b5ceb539');
  assert.equal(config.api_host, 'https://api-eu.mixpanel.com');
  assert.equal(config.record_heatmap_data, true);
  assert.equal(config.record_sessions_percent, 0);
  assert.equal(config.record_mask_all_inputs, undefined);
  assert.match(run.appended[0].src, /mixpanel-browser@\d+\.\d+\.\d+\/dist\/mixpanel\.min\.js$/);
});

test('uses the pixel’s visitor before it starts recording', () => {
  const run = runSnippet({ cookie: 'other=1; mionas_client_id=client-1' });
  run.loadSdk();
  assert.deepEqual(run.calls, [
    ['register', { distinct_id: '$device:client-1', $device_id: 'client-1' }],
    ['unregister', '$user_id'],
    ['start_session_recording'],
  ]);
});

test('uses the customer ID for a logged-in customer, as the pixel does', () => {
  const run = runSnippet({ customerId: 42, cookie: 'mionas_client_id=client-1' });
  run.loadSdk();
  assert.deepEqual(run.calls.slice(0, 2), [
    ['register', { distinct_id: '42', $device_id: 'client-1' }],
    ['register', { $user_id: '42' }],
  ]);
});

test('waits for the pixel’s cookie, and gives up rather than record under another visitor', () => {
  const run = runSnippet();
  assert.equal(run.window.mixpanel, undefined);
  run.document.cookie = 'mionas_client_id=client-1';
  run.timers.shift()();
  assert.ok(run.window.mixpanel);

  const never = runSnippet();
  while (never.timers.length) never.timers.shift()();
  assert.equal(never.window.mixpanel, undefined);
});

test('starts once, however many times consent is reported', () => {
  const run = runSnippet({ cookie: 'mionas_client_id=client-1' });
  run.listeners.visitorConsentCollected();
  assert.equal(run.appended.length, 1);
});
