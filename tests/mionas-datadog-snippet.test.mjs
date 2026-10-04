import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../snippets/mionas-datadog.liquid', import.meta.url), 'utf8');
const layout = await readFile(new URL('../layout/theme.liquid', import.meta.url), 'utf8');

test('outputs nothing in the theme editor or before the credentials are filled in', () => {
  assert.match(source, /^\{%- doc -%\}|^\{% doc %\}/);
  assert.match(source, /request\.design_mode/);
  assert.match(source, /application_id != blank and client_token != blank/);
});

test('loads the EU Shopify bundle with collection off and replay masking typed input', () => {
  assert.match(source, /eu1\/v7\/datadog-rum-shopify\.js/);
  assert.match(source, /site: 'datadoghq\.eu'/);
  assert.match(source, /trackingConsent: 'not-granted'/);
  assert.match(source, /defaultPrivacyLevel: 'mask-user-input'/);
  assert.match(source, /sessionReplaySampleRate: 100/);
  assert.match(source, /request\.host == shop\.domain/);
});

test('follows the cookie banner on load and whenever the visitor answers it', () => {
  assert.match(source, /loadFeatures\?\.\(\[\{ name: 'consent-tracking-api', version: '0\.1' \}\]/);
  assert.match(source, /analyticsProcessingAllowed\?\.\(\) === true/);
  assert.match(source, /if \(!error\) applyConsent\(\);/);
  assert.match(source, /addEventListener\('visitorConsentCollected', function \(\) \{\s*applyConsent\(\);/);
  assert.match(source, /setTrackingConsent\(/);
});

test('identifies a logged-in customer by ID only and clears the user otherwise', () => {
  assert.match(source, /setUser\(\{ id: '\{\{ customer\.id \}\}' \}\)/);
  assert.match(source, /clearUser\(\)/);
  assert.doesNotMatch(source, /email/);
});

test('the layout renders it after content_for_header, which defines the consent API', () => {
  assert.match(layout, /\{\{ content_for_header \}\}\s*\{%- render 'mionas-datadog' -%\}/);
});
