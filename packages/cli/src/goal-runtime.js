import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;

export function validateReceipt(receipt, binding, { projectRoot } = {}) {
  const errors = [];
  if (receipt?.schemaVersion !== 'captain-worker-receipt.v1') errors.push('invalid_schema_version');
  for (const key of ['runtimeId', 'goalId', 'goalRevision', 'runId', 'checkpointId', 'rowId', 'attemptId', 'attemptNumber', 'packetDigest']) {
    if (!receipt?.[key]) errors.push(`missing_${key}`);
  }
  if (receipt?.goalId !== binding.goalId) errors.push('goal_binding_mismatch');
  if (!['codex', 'claude-code'].includes(receipt?.runtimeId)) errors.push('runtime_not_configured');
  if (binding.runtimeId && receipt?.runtimeId !== binding.runtimeId) errors.push('runtime_binding_mismatch');
  if (binding.attemptId && receipt?.attemptId !== binding.attemptId) errors.push('attempt_binding_mismatch');
  if (binding.goalRevision && receipt?.goalRevision !== binding.goalRevision) errors.push('goal_revision_mismatch');
  if (binding.runId && receipt?.runId !== binding.runId) errors.push('run_binding_mismatch');
  if (binding.packetDigest && receipt?.packetDigest !== binding.packetDigest) errors.push('packet_digest_mismatch');
  if (!Number.isInteger(receipt?.attemptNumber) || receipt.attemptNumber < 1 || receipt.attemptNumber > 2) errors.push('attempt_limit_exceeded');
  if (receipt?.checkpointId !== binding.checkpointId) errors.push('checkpoint_binding_mismatch');
  if (receipt?.rowId !== binding.rowId) errors.push('row_binding_mismatch');
  if (!SHA256.test(receipt?.packetDigest || '')) errors.push('invalid_packet_digest');
  if (!['PASS', 'FAIL', 'BLOCK'].includes(receipt?.outcome)) errors.push('invalid_outcome');
  if (receipt?.outcome === 'PASS') {
    if (!projectRoot) errors.push('trusted_verifier_missing');
    if (!receipt.evidence?.length) errors.push('evidence_missing');
    for (const item of receipt.evidence || []) {
      if (!item.ref) errors.push('evidence_ref_missing');
      if (!SHA256.test(item.sha256 || '')) errors.push('evidence_digest_invalid');
      if (item.verified !== true) errors.push('evidence_unverified');
      if (projectRoot && !verifyEvidenceArtifact(item, projectRoot, binding)) errors.push('evidence_artifact_mismatch');
    }
  }
  if (receipt?.outcome === 'BLOCK') {
    if (!['operator', 'external_access'].includes(receipt.blocker?.kind)) errors.push('invalid_blocker_kind');
    if (!receipt.blocker?.reason) errors.push('blocker_reason_missing');
    if ((receipt.blocker?.impasseAttempts || 0) < 2) errors.push('blocker_impasse_threshold_missing');
  }
  return { valid: errors.length === 0, errors };
}

export function evaluateGoal(goal, receipts = [], options = {}) {
  const errors = validateGoalGraph(goal);
  if (errors.length) return { verdict: 'invalid', errors };
  const byId = new Map(goal.checkpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint]));
  const passed = new Set();
  const rows = [];
  const receiptKeys = receipts.map((receipt) => `${receipt.runtimeId}:${receipt.attemptId}:${receipt.checkpointId}:${receipt.rowId}`);
  if (new Set(receiptKeys).size !== receiptKeys.length) return { verdict: 'invalid', errors: ['duplicate_receipt_replay'] };
  const attemptKeys = receipts.map((receipt) => `${receipt.goalId}:${receipt.runId}:${receipt.checkpointId}:${receipt.rowId}:${receipt.attemptNumber}`);
  if (new Set(attemptKeys).size !== attemptKeys.length) return { verdict: 'invalid', errors: ['conflicting_attempt_receipts'] };

  let changed = true;
  while (changed) {
    changed = false;
    for (const checkpoint of goal.checkpoints) {
      if (passed.has(checkpoint.checkpointId) || !checkpoint.dependsOn.every((id) => passed.has(id))) continue;
      const checkpointPass = checkpoint.acceptanceRows.every((row) => {
        const candidates = currentReceipts(receipts, goal.goalId, checkpoint.checkpointId, row.rowId);
        return candidates.some((receipt) => validateReceipt(receipt, rowBinding(goal, checkpoint, row, receipt), options).valid && receipt.outcome === 'PASS');
      });
      if (checkpointPass) { passed.add(checkpoint.checkpointId); changed = true; }
    }
  }

  for (const checkpoint of goal.checkpoints) {
    let checkpointPass = checkpoint.acceptanceRows.length > 0;
    for (const row of checkpoint.acceptanceRows) {
      const candidates = currentReceipts(receipts, goal.goalId, checkpoint.checkpointId, row.rowId);
      const checked = candidates.map((receipt) => ({ receipt, result: validateReceipt(receipt, rowBinding(goal, checkpoint, row, receipt), options) }));
      const rejected = checked.flatMap(({ result }) => result.errors);
      if (rejected.length) return { verdict: 'invalid', errors: [...new Set(rejected)] };
      const valid = checked.filter(({ result }) => result.valid);
      const pass = valid.find(({ receipt }) => receipt.outcome === 'PASS');
      const block = valid.find(({ receipt }) => receipt.outcome === 'BLOCK');
      if (!pass) checkpointPass = false;
      rows.push({ checkpointId: checkpoint.checkpointId, rowId: row.rowId, status: pass ? 'passed' : block ? 'blocked' : 'pending' });
    }
  }

  if (passed.size === byId.size) return { verdict: 'complete_candidate', currentCheckpoint: null, rows, errors: [] };
  const ready = goal.checkpoints.find((checkpoint) =>
    !passed.has(checkpoint.checkpointId) && checkpoint.dependsOn.every((id) => passed.has(id)),
  );
  if (ready) {
    const block = ready.acceptanceRows.flatMap((row) => currentReceipts(receipts, goal.goalId, ready.checkpointId, row.rowId))
      .find((receipt) => receipt.outcome === 'BLOCK' && validateReceipt(receipt, rowBinding(goal, ready, ready.acceptanceRows.find((row) => row.rowId === receipt.rowId), receipt), options).valid);
    if (block) {
      const verdict = block.blocker.kind === 'operator' ? 'needs_operator' : 'external_access_requested';
      return { verdict, currentCheckpoint: ready.checkpointId, blocker: block.blocker, rows, errors: [] };
    }
  }
  return { verdict: ready ? 'active' : 'waiting_dependencies', currentCheckpoint: ready?.checkpointId || null, rows, errors: [] };
}

export function validateGoalGraph(goal) {
  const errors = [];
  if (!goal?.goalId) errors.push('missing_goal_id');
  if (!goal?.goalRevision) errors.push('missing_goal_revision');
  if (!goal?.runId) errors.push('missing_run_id');
  if (!Array.isArray(goal?.checkpoints) || !goal.checkpoints.length) return [...errors, 'checkpoints_missing'];
  const ids = goal.checkpoints.map((item) => item.checkpointId);
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) errors.push('checkpoint_ids_invalid');
  const known = new Set(ids);
  for (const checkpoint of goal.checkpoints) {
    checkpoint.dependsOn ||= [];
    checkpoint.acceptanceRows ||= [];
    if (checkpoint.dependsOn.includes(checkpoint.checkpointId)) errors.push(`self_dependency:${checkpoint.checkpointId}`);
    if (checkpoint.dependsOn.some((id) => !known.has(id))) errors.push(`unknown_dependency:${checkpoint.checkpointId}`);
    const rows = checkpoint.acceptanceRows.map((row) => row.rowId);
    if (!rows.length || new Set(rows).size !== rows.length || rows.some((id) => !id)) errors.push(`acceptance_rows_invalid:${checkpoint.checkpointId}`);
    if (checkpoint.acceptanceRows.some((row) => !SHA256.test(row.packetDigest || ''))) errors.push(`row_packet_digest_invalid:${checkpoint.checkpointId}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle = (goal.checkpoints.find((item) => item.checkpointId === id)?.dependsOn || []).some(visit);
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  if (ids.some(visit)) errors.push('checkpoint_cycle');
  return [...new Set(errors)];
}

export function runGoalRuntimeCommand(args = []) {
  const goalPath = valueArg(args, '--goal');
  if (!goalPath) {
    console.error('Usage: captain-os goal-runtime --goal goal.json [--receipts receipts.json]');
    return 2;
  }
  try {
    const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));
    const receiptsPath = valueArg(args, '--receipts');
    const receipts = receiptsPath ? JSON.parse(fs.readFileSync(receiptsPath, 'utf8')) : [];
    const result = evaluateGoal(goal, receipts, { projectRoot: process.cwd() });
    console.log(JSON.stringify(result, null, 2));
    return result.verdict === 'invalid' ? 1 : 0;
  } catch (error) {
    console.error(`goal-runtime: ${error.message}`);
    return 1;
  }
}

function verifyEvidenceArtifact(item, projectRoot, binding) {
  if (item.ref !== binding.expectedEvidence?.ref || item.sha256 !== binding.expectedEvidence?.sha256) return false;
  if (!item.ref || path.isAbsolute(item.ref) || item.ref.includes('\\')) return false;
  const root = fs.realpathSync(projectRoot);
  const candidate = path.resolve(root, item.ref);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return false;
  try {
    const real = fs.realpathSync(candidate);
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) return false;
    if (!fs.statSync(real).isFile()) return false;
    const bytes = fs.readFileSync(real);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) return false;
    const proof = JSON.parse(bytes.toString('utf8'));
    return proof.schemaVersion === 'captain-goal-evidence.v1' && proof.verified === true &&
      proof.claim?.goalId === binding.goalId && proof.claim?.goalRevision === binding.goalRevision &&
      proof.claim?.runId === binding.runId && proof.claim?.packetDigest === binding.packetDigest &&
      proof.claim?.checkpointId === binding.checkpointId && proof.claim?.rowId === binding.rowId &&
      proof.claim?.attemptId === binding.attemptId && proof.claim?.attemptNumber === binding.attemptNumber &&
      proof.claim?.ref === item.ref;
  } catch {
    return false;
  }
}

function currentReceipts(receipts, goalId, checkpointId, rowId) {
  const matches = receipts.filter((receipt) => receipt.goalId === goalId && receipt.checkpointId === checkpointId && receipt.rowId === rowId);
  if (!matches.length) return [];
  return [matches.sort((a, b) => b.attemptNumber - a.attemptNumber)[0]];
}

function rowBinding(goal, checkpoint, row, receipt) {
  return {
    goalId: goal.goalId,
    goalRevision: goal.goalRevision,
    runId: goal.runId,
    checkpointId: checkpoint.checkpointId,
    rowId: row.rowId,
    packetDigest: row.packetDigest,
    expectedEvidence: row.expectedEvidence,
    attemptId: receipt?.attemptId,
    attemptNumber: receipt?.attemptNumber,
  };
}

function valueArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
