import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProductionHostname } from '../_middleware.ts';

test('isProductionHostname recognizes production and preview hostnames correctly', () => {
  // Production hostnames (indexed)
  assert.equal(isProductionHostname('www.puck.no'), true);
  assert.equal(isProductionHostname('puck.no'), true);
  assert.equal(isProductionHostname('localhost'), true);
  assert.equal(isProductionHostname('127.0.0.1'), true);

  // Preview & staging hostnames (noindexed)
  assert.equal(isProductionHostname('puck-no.pages.dev'), false);
  assert.equal(isProductionHostname('feature-name.puck-no.pages.dev'), false);
  assert.equal(isProductionHostname('staging.puck.no'), false);
});
