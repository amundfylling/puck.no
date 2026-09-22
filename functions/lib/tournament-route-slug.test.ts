import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tournamentRouteSlug } from './tournament-route-slug.ts';

test('Pages tournament route slugs decode Nordic characters', () => {
  assert.equal(tournamentRouteSlug('j%C3%A6ren-open-2027'), 'jæren-open-2027');
  assert.equal(tournamentRouteSlug('jæren-open-2027'), 'jæren-open-2027');
  assert.equal(tournamentRouteSlug('norway-open-2026'), 'norway-open-2026');
});

test('invalid route params are rejected', () => {
  assert.equal(tournamentRouteSlug('%C3'), null);
  assert.equal(tournamentRouteSlug(['j%C3%A6ren-open-2027']), null);
  assert.equal(tournamentRouteSlug(undefined), null);
});
