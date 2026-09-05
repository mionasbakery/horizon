import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../blocks/mionas-price.liquid', import.meta.url), 'utf8');

test('renders the configured Mionas price inside Horizon’s reactive price wrapper', () => {
  assert.match(source, /assign selected_variant = product\.selected_or_first_available_variant/);
  assert.match(source, /<product-price[\s\S]*data-block-id="\{\{ block\.id \}\}"[\s\S]*data-product-id="\{\{ product\.id \}\}"/);
  assert.match(source, /<div ref="priceContainer">[\s\S]*render 'mionas-text'/);
  assert.match(source, /echo selected_variant\.price \| money/);
  assert.match(source, /echo selected_variant\.compare_at_price \| money/);
});
