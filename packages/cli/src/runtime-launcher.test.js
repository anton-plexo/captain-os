import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildRuntimeInvocation, launchRuntime, normalizeRuntimeReceipt, parseProviderOutput } from './runtime-launcher.js';

const packet = 'Do bounded work: spaces, unicode Привет; $(never-shell)';
const packetDigest = crypto.createHash('sha256').update(packet).digest('hex');
const binding = { goalId: 'g1', goalRevision: 'rev1', runId: 'run1', checkpointId: 'c1', rowId: 'r1', attemptId: 'a1', attemptNumber: 1, packetDigest };
const raw = (runtimeId) => ({
  schemaVersion: 'captain-worker-receipt.v1', runtimeId, ...binding, outcome: 'PASS',
  evidence: [{ ref: 'proof.json', sha256: 'c'.repeat(64), verified: true }],
});

test('Codex and Claude use argv arrays and normalize to identical acceptance semantics', () => {
  const codex = buildRuntimeInvocation('codex', packet);
  const claude = buildRuntimeInvocation('claude-code', packet);
  assert.ok(codex.args.at(-1).startsWith(packet));
  assert.ok(claude.args.at(-1).startsWith(packet));
  for (const runtimeId of ['codex', 'claude-code']) {
    const result = normalizeRuntimeReceipt(runtimeId, raw(runtimeId), { ...binding, runtimeId }, packet);
    assert.equal(result.validation.valid, true);
    assert.equal(result.acceptance, 'NOT_EVALUATED');
    assert.equal(result.receipt.outcome, 'PASS');
  }
});

test('realistic Claude JSON wrapper and Codex JSONL yield the same receipt payload', () => {
  const body = JSON.stringify(raw('codex'));
  assert.deepEqual(parseProviderOutput('codex', `${JSON.stringify({ type: 'started' })}\n${JSON.stringify({ item: { text: body } })}\n`), raw('codex'));
  const claudeBody = JSON.stringify(raw('claude-code'));
  assert.deepEqual(parseProviderOutput('claude-code', JSON.stringify({ type: 'result', result: claudeBody })), raw('claude-code'));
});

test('host-native transport requires receipt ingestion instead of fake process parity', () => {
  const result = launchRuntime({ runtimeId: 'codex', packet, binding, execute: true, config: { codex: { transport: 'host_native_receipt' } } });
  assert.equal(result.error, 'host_native_receipt_requires_ingest');
});

test('execution success cannot bypass missing evidence or wrong packet digest', () => {
  const noEvidence = normalizeRuntimeReceipt('codex', { ...raw('codex'), evidence: [] }, binding, packet);
  const wrongDigest = normalizeRuntimeReceipt('codex', { ...raw('codex'), packetDigest: 'd'.repeat(64) }, binding, packet);
  assert.equal(noEvidence.validation.valid, false);
  assert.ok(wrongDigest.validation.errors.includes('packet_digest_mismatch'));
});

test('normalizer rejects missing schema and does not manufacture runtime provenance', () => {
  const schemaLess = { ...raw('codex') }; delete schemaLess.schemaVersion;
  assert.ok(normalizeRuntimeReceipt('codex', schemaLess, binding, packet).validation.errors.includes('invalid_schema_version'));
  assert.ok(normalizeRuntimeReceipt('codex', raw('evil-runtime'), binding, packet).validation.errors.includes('runtime_binding_mismatch'));
});

test('dry-run is default and unsupported runtime rejects', () => {
  assert.equal(launchRuntime({ runtimeId: 'codex', packet, binding }).mode, 'dry_run');
  assert.throws(() => buildRuntimeInvocation('unknown', packet), /unsupported runtime/);
});

test('third attempt and cold spawn with reusable lane reject', () => {
  assert.equal(launchRuntime({ runtimeId: 'codex', packet, binding: { ...binding, attemptNumber: 3 } }).error, 'attempt_limit_exceeded');
  assert.equal(launchRuntime({ runtimeId: 'codex', packet, binding: { ...binding, reusableLaneAvailable: true } }).error, 'reuse_required_before_spawn');
});

test('unavailable executable returns failed execution, never acceptance PASS', () => {
  const result = launchRuntime({ runtimeId: 'codex', packet, binding, execute: true, timeoutMs: 50, config: { codex: { executable: '/definitely/missing/captain-codex' } } });
  if (result.execution === 'failed') assert.notEqual(result.acceptance, 'PASS');
});
