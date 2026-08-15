import assert from 'node:assert/strict';
import test from 'node:test';
import { planIllustrationFromDescription } from './description-illustration-planner.mjs';
import { validateIllustrationScene } from './illustrations.mjs';

function trick(slug, description) {
  return {
    slug,
    name: slug,
    players: ['right-wing'],
    description: { no: description, en: description },
  };
}

test('creates a valid direct right-wing shot draft', () => {
  const plan = planIllustrationFromDescription(trick('direkteskudd', 'Høyreving skyter direkte i mål'));
  assert.deepEqual(plan.recognizedRoute.map((stop) => stop.role), ['right-wing', 'goal']);
  assert.equal(plan.scene.paths.at(-1).kind, 'shot');
  assert.deepEqual(validateIllustrationScene(plan.scene), []);
});

test('preserves a multi-player passing sequence', () => {
  const plan = planIllustrationFromDescription(trick('example', 'Pasning fra høyreving til venstreving som sender videre til senter som scorer'));
  assert.deepEqual(plan.recognizedRoute.map((stop) => stop.role), ['right-wing', 'left-wing', 'center', 'goal']);
  assert.deepEqual(plan.scene.paths.map((path) => path.kind), ['pass', 'pass', 'shot']);
});

test('adds a rail route and flags specialist technique for review', () => {
  const plan = planIllustrationFromDescription(trick('example', 'Høyreving scorer med kioskskudd via høyre vant'));
  assert.ok(plan.warnings.some((warning) => warning.includes('Kioskskudd')));
  assert.equal(plan.confidence, 'needs-review');
  assert.ok(plan.scene.paths[0].points.length > 2);
});

test('curves a pass only when it follows the wall behind a goal', () => {
  const plan = planIllustrationFromDescription(trick('velodrom', 'Høyreving passer langs vantet bak mål til venstreving'));
  assert.equal(plan.scene.paths[0].kind, 'pass');
  assert.equal(plan.scene.paths[0].curve, true);
  assert.equal(plan.scene.paths[0].followsWall, true);
  assert.deepEqual(validateIllustrationScene(plan.scene), []);
});

test('does not turn setup positions into extra passes', () => {
  const plan = planIllustrationFromDescription(trick('hagerup', 'Høyreving og senter står helt bak i sporet, og høyreving passer inn til senter som skyter direkte i høyre hjørne'));
  assert.deepEqual(plan.recognizedRoute.map((stop) => stop.role), ['right-wing', 'center', 'goal']);
});
