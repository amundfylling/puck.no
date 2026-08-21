import assert from 'node:assert/strict';
import test from 'node:test';
import { publicIllustration } from '../../src/lib/illustrations.ts';

const entry = (published) => ({ data: { published } });

test('keeps the legacy diagram until its editable replacement is explicitly published', () => {
  const draft = entry(false);
  const approved = entry(true);

  assert.equal(publicIllustration(draft, '/media/images/legacy.png'), undefined);
  assert.equal(publicIllustration(approved, '/media/images/legacy.png'), approved);
});

test('uses an editable scene when no legacy diagram exists', () => {
  const draft = entry(false);

  assert.equal(publicIllustration(draft, null), draft);
  assert.equal(publicIllustration(undefined, '/media/images/legacy.png'), undefined);
});
