import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../snippets/mionas-version-cookie.liquid', import.meta.url), 'utf8');
const layout = await readFile(new URL('../layout/theme.liquid', import.meta.url), 'utf8');

test('the layout renders it on every page', () => {
  assert.match(layout, /\{%- render 'mionas-version-cookie' -%\}/);
});

test('reads the theme version from its own snippet', () => {
  assert.match(source, /capture version\s+render 'mionas-version'\s+endcapture\s+assign version = version \| strip/);
});

test('writes the version cookie straight away, before any consent answer', () => {
  const script = source
    .match(/<script>([\s\S]*)<\/script>/)[1]
    .replace(/\{\{ version \| json \}\}/g, JSON.stringify('2026.10.06'));
  const cookies = [];
  const document = {
    set cookie(value) {
      cookies.push(value);
    },
  };
  new Function('document', script)(document);
  assert.deepEqual(cookies, ['mionas_theme_version=2026.10.06; path=/; samesite=lax']);
});
