import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { validateReceipt } from './goal-runtime.js';

export const RUNTIME_ADAPTERS = {
  codex: { binary: 'codex', transport: 'process_cli', args: (packet) => ['exec', '--json', receiptPrompt(packet)] },
  'claude-code': { binary: 'claude', transport: 'process_cli', args: (packet) => ['-p', '--output-format', 'json', receiptPrompt(packet)] },
};

export function buildRuntimeInvocation(runtimeId, packet, config = {}) {
  const adapter = RUNTIME_ADAPTERS[runtimeId];
  if (!adapter) throw new Error(`unsupported runtime: ${runtimeId}`);
  const selected = config[runtimeId] || {};
  return { command: selected.executable || adapter.binary, transport: selected.transport || adapter.transport, args: adapter.args(packet) };
}

export function normalizeRuntimeReceipt(runtimeId, raw, binding, packet) {
  const payload = typeof raw === 'string' ? parseProviderOutput(runtimeId, raw) : raw;
  const candidate = payload.receipt || payload.result?.receipt || payload;
  const receipt = {
    schemaVersion: candidate.schemaVersion,
    runtimeId: candidate.runtimeId,
    goalId: candidate.goalId,
    goalRevision: candidate.goalRevision,
    runId: candidate.runId,
    checkpointId: candidate.checkpointId,
    rowId: candidate.rowId,
    attemptId: candidate.attemptId,
    attemptNumber: candidate.attemptNumber,
    packetDigest: candidate.packetDigest,
    outcome: candidate.outcome,
    blocker: candidate.blocker,
    evidence: candidate.evidence || [],
  };
  const expectedDigest = crypto.createHash('sha256').update(packet).digest('hex');
  const validation = validateReceipt(receipt, binding);
  validation.errors = validation.errors.filter((error) => error !== 'trusted_verifier_missing');
  if (receipt.runtimeId !== runtimeId) validation.errors.push('runtime_binding_mismatch');
  if (receipt.packetDigest !== expectedDigest) validation.errors.push('packet_digest_mismatch');
  validation.valid = validation.errors.length === 0;
  return { receipt, validation, acceptance: 'NOT_EVALUATED' };
}

export function launchRuntime({ runtimeId, packet, binding, execute = false, timeoutMs = 300000, config = {} }) {
  const attemptNumber = binding?.attemptNumber ?? 1;
  if (attemptNumber > 2) return { mode: 'rejected', acceptance: 'REJECTED', error: 'attempt_limit_exceeded' };
  if (binding?.reusableLaneAvailable && !binding?.forceNewLaneReason) {
    return { mode: 'rejected', acceptance: 'REJECTED', error: 'reuse_required_before_spawn' };
  }
  const invocation = buildRuntimeInvocation(runtimeId, packet, config);
  if (!execute) return { mode: 'dry_run', invocation };
  if (invocation.transport === 'host_native_receipt') {
    return { mode: 'rejected', acceptance: 'REJECTED', error: 'host_native_receipt_requires_ingest', invocation };
  }
  const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) return { mode: 'executed', execution: 'failed', error: result.error.message, invocation };
  if (result.status !== 0) return { mode: 'executed', execution: 'failed', exitCode: result.status, stderr: result.stderr, invocation };
  try {
    const normalized = normalizeRuntimeReceipt(runtimeId, result.stdout, binding, packet);
    return { mode: 'executed', execution: 'succeeded', acceptance: normalized.validation.valid ? 'NOT_EVALUATED' : 'REJECTED', ...normalized };
  } catch (error) {
    return { mode: 'executed', execution: 'succeeded', acceptance: 'REJECTED', error: `invalid_runtime_output: ${error.message}`, invocation };
  }
}

export function parseProviderOutput(runtimeId, stdout) {
  if (runtimeId === 'claude-code') {
    const wrapper = JSON.parse(stdout);
    return typeof wrapper.result === 'string' ? JSON.parse(wrapper.result) : wrapper;
  }
  if (runtimeId === 'codex') {
    const events = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    for (const event of events.reverse()) {
      if (event.receipt) return event;
      const text = event.item?.text || event.message?.content || event.result;
      if (typeof text === 'string') {
        try { return JSON.parse(text); } catch {}
      }
    }
    throw new Error('Codex JSONL contains no receipt');
  }
  return JSON.parse(stdout);
}

function receiptPrompt(packet) {
  return `${packet}\n\nReturn a single captain-worker-receipt.v1 JSON object. Execution success alone is not PASS; include only independently verifiable evidence artifacts.`;
}

export function runWorkerCommand(args = []) {
  const action = args[0];
  const runtimeId = valueArg(args, '--runtime');
  const packetPath = valueArg(args, '--packet');
  if (!['launch', 'ingest'].includes(action) || !runtimeId || !packetPath) {
    console.error('Usage: captain-os worker <launch|ingest> --runtime <id> --packet <file> --goal <id> --goal-revision <id> --run-id <id> --checkpoint <id> --row <id> --attempt <id> [--receipt <file>|--execute]');
    return 2;
  }
  try {
    const packet = fs.readFileSync(packetPath, 'utf8');
    const binding = {
      runtimeId, goalId: valueArg(args, '--goal'), goalRevision: valueArg(args, '--goal-revision'), runId: valueArg(args, '--run-id'), checkpointId: valueArg(args, '--checkpoint'),
      rowId: valueArg(args, '--row'), attemptId: valueArg(args, '--attempt'),
      attemptNumber: Number(valueArg(args, '--attempt-number') || 1),
      reusableLaneAvailable: args.includes('--reusable-lane'),
      forceNewLaneReason: valueArg(args, '--force-new-lane-reason'),
    };
    if (['goalId', 'goalRevision', 'runId', 'checkpointId', 'rowId', 'attemptId'].some((key) => !binding[key])) {
      throw new Error('goal, goal-revision, run-id, checkpoint, row and attempt bindings are required');
    }
    let result;
    if (action === 'ingest') {
      const receiptPath = valueArg(args, '--receipt');
      if (!receiptPath) throw new Error('--receipt is required for ingest');
      result = normalizeRuntimeReceipt(runtimeId, fs.readFileSync(receiptPath, 'utf8'), binding, packet);
    } else {
      result = launchRuntime({ runtimeId, packet, binding, execute: args.includes('--execute') });
    }
    console.log(JSON.stringify(result, null, 2));
    return result.validation?.valid === false || result.acceptance === 'REJECTED' || result.execution === 'failed' ? 1 : 0;
  } catch (error) {
    console.error(`worker: ${error.message}`);
    return 1;
  }
}

function valueArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
