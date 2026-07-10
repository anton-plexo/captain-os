import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateGoal, validateGoalGraph, validateReceipt } from './goal-runtime.js';

const digest = 'a'.repeat(64);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'captain-goal-proof-'));
function evidenceFor(checkpointId, rowId) {
  const ref = `${checkpointId}-${rowId}.json`;
  const content = JSON.stringify({ schemaVersion: 'captain-goal-evidence.v1', verified: true, claim: { goalId: 'g1', goalRevision: 'rev1', runId: 'run1', checkpointId, rowId, attemptId: `${checkpointId}-1`, attemptNumber: 1, packetDigest: digest, ref } });
  fs.writeFileSync(path.join(root, ref), content);
  return [{ ref, sha256: crypto.createHash('sha256').update(content).digest('hex'), verified: true }];
}
function row(checkpointId, rowId) {
  const [proof] = evidenceFor(checkpointId, rowId);
  return { rowId, packetDigest: digest, expectedEvidence: { ref: proof.ref, sha256: proof.sha256 } };
}
const goal = () => ({
  goalId: 'g1', goalRevision: 'rev1', runId: 'run1',
  checkpoints: [
    { checkpointId: 'inspect', dependsOn: [], acceptanceRows: [row('inspect', 'inventory')] },
    { checkpointId: 'ship', dependsOn: ['inspect'], acceptanceRows: [row('ship', 'tests')] },
  ],
});
const receipt = (checkpointId, rowId, overrides = {}) => ({
  schemaVersion: 'captain-worker-receipt.v1', runtimeId: 'codex', goalId: 'g1', goalRevision: 'rev1', runId: 'run1', checkpointId, rowId,
  attemptId: `${checkpointId}-1`, attemptNumber: 1, packetDigest: digest, outcome: 'PASS', evidence: evidenceFor(checkpointId, rowId), ...overrides,
});

test('DAG advances deterministically and only becomes complete_candidate after all rows pass', () => {
  assert.deepEqual(evaluateGoal(goal(), [], { projectRoot: root }).currentCheckpoint, 'inspect');
  assert.deepEqual(evaluateGoal(goal(), [receipt('inspect', 'inventory')], { projectRoot: root }).currentCheckpoint, 'ship');
  assert.equal(evaluateGoal(goal(), [receipt('inspect', 'inventory'), receipt('ship', 'tests')], { projectRoot: root }).verdict, 'complete_candidate');
  const reversed = goal(); reversed.checkpoints.reverse();
  assert.equal(evaluateGoal(reversed, [receipt('inspect', 'inventory'), receipt('ship', 'tests')], { projectRoot: root }).verdict, 'complete_candidate');
});

test('invalid graph rejects cycles, self/missing dependencies and duplicate rows', () => {
  const cyclic = goal(); cyclic.checkpoints[0].dependsOn = ['ship'];
  assert.ok(validateGoalGraph(cyclic).includes('checkpoint_cycle'));
  const invalid = goal(); invalid.checkpoints[0].dependsOn = ['inspect', 'missing']; invalid.checkpoints[0].acceptanceRows.push({ rowId: 'inventory' });
  assert.ok(validateGoalGraph(invalid).some((item) => item.startsWith('self_dependency')));
  assert.ok(validateGoalGraph(invalid).some((item) => item.startsWith('unknown_dependency')));
  assert.ok(validateGoalGraph(invalid).some((item) => item.startsWith('acceptance_rows_invalid')));
});

test('PASS rejects empty, unverified, wrong-bound and malformed evidence', () => {
  assert.equal(validateReceipt(receipt('inspect', 'inventory', { evidence: [] }), { goalId: 'g1', checkpointId: 'inspect', rowId: 'inventory' }, { projectRoot: root }).valid, false);
  const unverified = evidenceFor('inspect', 'inventory').map((item) => ({ ...item, verified: false }));
  assert.equal(validateReceipt(receipt('inspect', 'inventory', { evidence: unverified }), { goalId: 'g1', checkpointId: 'inspect', rowId: 'inventory' }, { projectRoot: root }).valid, false);
  assert.equal(validateReceipt(receipt('inspect', 'wrong'), { goalId: 'g1', checkpointId: 'inspect', rowId: 'inventory' }, { projectRoot: root }).valid, false);
  assert.equal(validateReceipt(receipt('inspect', 'inventory', { packetDigest: 'bad' }), { goalId: 'g1', checkpointId: 'inspect', rowId: 'inventory' }, { projectRoot: root }).valid, false);
});

test('BLOCK requires operator or external binding', () => {
  const bad = receipt('inspect', 'inventory', { outcome: 'BLOCK', evidence: [], blocker: { kind: 'internal', reason: 'x' } });
  const good = { ...bad, blocker: { kind: 'external_access', reason: 'access required', impasseAttempts: 2 } };
  assert.equal(validateReceipt(bad, { goalId: 'g1', checkpointId: 'inspect', rowId: 'inventory' }).valid, false);
  assert.equal(validateReceipt(good, { goalId: 'g1', checkpointId: 'inspect', rowId: 'inventory' }, { projectRoot: root }).valid, true);
});

test('duplicate receipt replay invalidates the evaluation', () => {
  const item = receipt('inspect', 'inventory');
  assert.deepEqual(evaluateGoal(goal(), [item, structuredClone(item)], { projectRoot: root }).errors, ['duplicate_receipt_replay']);
});

test('schema, runtime, run, revision, attempt and packet provenance are strict', () => {
  const cases = [
    { schemaVersion: undefined }, { runtimeId: 'evil-runtime' }, { runId: 'old-run' },
    { goalRevision: 'old-revision' }, { attemptNumber: 3 }, { packetDigest: 'd'.repeat(64) },
  ];
  for (const overrides of cases) {
    const result = evaluateGoal(goal(), [receipt('inspect', 'inventory', overrides)], { projectRoot: root });
    assert.equal(result.verdict, 'invalid', JSON.stringify(overrides));
  }
});

test('a future dependency-closed checkpoint cannot block the ready checkpoint', () => {
  const futureBlock = receipt('ship', 'tests', { outcome: 'BLOCK', evidence: [], blocker: { kind: 'external_access', reason: 'access', impasseAttempts: 2 } });
  const result = evaluateGoal(goal(), [futureBlock], { projectRoot: root });
  assert.equal(result.verdict, 'active');
  assert.equal(result.currentCheckpoint, 'inspect');
});
