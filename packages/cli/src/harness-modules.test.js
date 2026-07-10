import test from 'node:test';
import assert from 'node:assert';

import { swarmScoreFixtures, scoreSwarmScenario } from './swarm-runtime-score.js';
import { deliveryCalibrationFixtures, calibrateDeliveryScenario } from './delivery-calibration.js';
import { buildAgentLaneLifecyclePacket } from './agent-lane-lifecycle.js';
import { classifyIntent } from './intent-router.js';

// Each module ships a fixture truth-table. Before this file those tables were only
// exercised by the CLI commands in the `test` npm chain — this gives them explicit,
// per-fixture unit coverage so a single regression names the exact scenario.

test('swarm-runtime-score: every fixture matches its expected verdict and minScore', () => {
  assert.ok(swarmScoreFixtures.length >= 14, `expected >=14 swarm fixtures, got ${swarmScoreFixtures.length}`);
  for (const fixture of swarmScoreFixtures) {
    const result = scoreSwarmScenario(fixture);
    assert.strictEqual(
      result.verdict,
      fixture.expectedVerdict,
      `${fixture.id}: expected ${fixture.expectedVerdict}, got ${result.verdict}`,
    );
    if (fixture.minScore !== undefined) {
      assert.ok(
        result.score >= fixture.minScore,
        `${fixture.id}: expected score >= ${fixture.minScore}, got ${result.score}`,
      );
    }
  }
});

test('swarm-runtime-score: openingOrIndexingRisk is optional but never a non-boolean', () => {
  // The field defaults to false (not opening/indexing work) — some fixtures legitimately
  // omit it. Guard: when present it must be a boolean so it cannot quietly read as
  // truthy/falsy and corrupt the SEO-evidence gate.
  for (const fixture of swarmScoreFixtures) {
    if (fixture.openingOrIndexingRisk !== undefined) {
      assert.strictEqual(
        typeof fixture.openingOrIndexingRisk,
        'boolean',
        `${fixture.id}: openingOrIndexingRisk, when present, must be boolean`,
      );
    }
  }
  // A scenario flagged as opening/indexing risk without opening evidence must not pass.
  const opening = swarmScoreFixtures.find((f) => f.openingOrIndexingRisk === true);
  assert.ok(opening, 'expected at least one opening/indexing fixture');
});

test('delivery-calibration: every fixture matches its expected verdict', () => {
  assert.ok(deliveryCalibrationFixtures.length >= 10, `expected >=10 delivery fixtures, got ${deliveryCalibrationFixtures.length}`);
  for (const fixture of deliveryCalibrationFixtures) {
    const result = calibrateDeliveryScenario(fixture);
    assert.strictEqual(
      result.verdict,
      fixture.expectedVerdict,
      `${fixture.id}: expected ${fixture.expectedVerdict}, got ${result.verdict}`,
    );
  }
});

test('agent-lane-lifecycle: default packet is valid and outcome-bound', () => {
  const result = buildAgentLaneLifecyclePacket();
  assert.strictEqual(result.valid, true, 'default packet must be valid');
  assert.ok(result.checks.hasP11L, 'packet must carry the P11L corrective header');
  assert.ok(result.checks.hasCloseRecycle, 'packet must require close/recycle + retry spawn');
  assert.ok(result.checks.hasClaimCeiling, 'packet must carry the claim ceiling');
});

test('agent-lane-lifecycle: custom outcomes are all bound into outcome rows', () => {
  const result = buildAgentLaneLifecyclePacket({
    automationId: 'a',
    threadId: 't',
    program: 'p',
    prRef: 'PR#1',
    outcomes: ['alpha', 'beta', 'gamma'],
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.checks.outcomeCount, 3);
  for (const target of ['alpha', 'beta', 'gamma']) {
    assert.ok(result.packet.includes(`target=${target}`), `outcome ${target} must appear in a row`);
  }
});

test('intent-router: classifyIntent routes trivial vs architectural work', () => {
  assert.strictEqual(classifyIntent(''), 'FAST_PATH', 'empty intent is trivial');
  assert.strictEqual(classifyIntent('   '), 'FAST_PATH', 'whitespace intent is trivial');
  assert.strictEqual(classifyIntent('поправь опечатку'), 'FAST_PATH', 'short simple intent is trivial');
  assert.strictEqual(classifyIntent('спроектируй модуль авторизации'), 'DEEP_PATH', 'architectural keyword escalates');
  assert.strictEqual(classifyIntent('нужен рефакторинг слоя данных'), 'DEEP_PATH', 'refactor keyword escalates');
  assert.strictEqual(
    classifyIntent('a'.repeat(81)),
    'DEEP_PATH',
    'intent longer than 80 chars is treated as a complex spec',
  );
});
