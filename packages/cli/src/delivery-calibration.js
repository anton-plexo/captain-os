import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STAGE_POLICIES = {
  discovery: {
    minDeliveryShare: 0.15,
    minQualityShare: 0.35,
    minSafetyShare: 0.2,
    maxProcessShare: 0.55,
    maxPlanningOnlyCycles: 3,
    minClosedOutcomes: 0,
    namedDeliverableRequired: false,
  },
  planning: {
    minDeliveryShare: 0.25,
    minQualityShare: 0.35,
    minSafetyShare: 0.2,
    maxProcessShare: 0.45,
    maxPlanningOnlyCycles: 2,
    minClosedOutcomes: 0,
    namedDeliverableRequired: false,
  },
  delivery: {
    minDeliveryShare: 0.5,
    minQualityShare: 0.25,
    minSafetyShare: 0.15,
    maxProcessShare: 0.25,
    maxPlanningOnlyCycles: 1,
    minClosedOutcomes: 1,
    namedDeliverableRequired: true,
  },
  launch_opening: {
    minDeliveryShare: 0.35,
    minQualityShare: 0.25,
    minSafetyShare: 0.3,
    maxProcessShare: 0.3,
    maxPlanningOnlyCycles: 0,
    minClosedOutcomes: 1,
    namedDeliverableRequired: true,
  },
  incident_repair: {
    minDeliveryShare: 0.2,
    minQualityShare: 0.2,
    minSafetyShare: 0.4,
    maxProcessShare: 0.35,
    maxPlanningOnlyCycles: 0,
    minClosedOutcomes: 0,
    namedDeliverableRequired: false,
  },
  maintenance: {
    minDeliveryShare: 0.35,
    minQualityShare: 0.3,
    minSafetyShare: 0.2,
    maxProcessShare: 0.35,
    maxPlanningOnlyCycles: 2,
    minClosedOutcomes: 0,
    namedDeliverableRequired: false,
  },
};

const ENUMS = {
  stage: new Set(Object.keys(STAGE_POLICIES)),
  verdict: new Set(['pass_calibrated', 'fail_recalibrate']),
};

const CLOSED_OUTCOME_STATUSES = new Set([
  'ready_with_evidence',
  'not_ready_with_exact_blocker',
  'blocked_owner_decision_required',
]);

function fixture(
  id,
  stage,
  {
    processShare,
    deliveryShare,
    qualityShare,
    safetyShare,
    namedDeliverables,
    closedOutcomes,
    planningOnlyCycles,
    falseGreenRisk = false,
    safetyEvidence = false,
    qualityEvidence = false,
    ownerDecisionRequired = false,
    adjacentWorkActive = false,
    nextActionBound = true,
    reportingAttachedToOutcomes = true,
    expectedVerdict,
    minScore,
  },
) {
  return {
    id,
    stage,
    processShare,
    deliveryShare,
    qualityShare,
    safetyShare,
    namedDeliverables,
    closedOutcomes,
    planningOnlyCycles,
    falseGreenRisk,
    safetyEvidence,
    qualityEvidence,
    ownerDecisionRequired,
    adjacentWorkActive,
    nextActionBound,
    reportingAttachedToOutcomes,
    expectedVerdict,
    minScore,
  };
}

export const deliveryCalibrationFixtures = [
  fixture('discovery_source_map_allowed', 'discovery', {
    processShare: 0.42,
    deliveryShare: 0.18,
    qualityShare: 0.4,
    safetyShare: 0.25,
    namedDeliverables: 1,
    closedOutcomes: 0,
    planningOnlyCycles: 2,
    qualityEvidence: true,
    expectedVerdict: 'pass_calibrated',
    minScore: 8,
  }),
  fixture('planning_acceptance_matrix_allowed', 'planning', {
    processShare: 0.4,
    deliveryShare: 0.28,
    qualityShare: 0.38,
    safetyShare: 0.22,
    namedDeliverables: 2,
    closedOutcomes: 0,
    planningOnlyCycles: 2,
    qualityEvidence: true,
    expectedVerdict: 'pass_calibrated',
    minScore: 8,
  }),
  fixture('delivery_three_pages_closed', 'delivery', {
    processShare: 0.18,
    deliveryShare: 0.58,
    qualityShare: 0.28,
    safetyShare: 0.18,
    namedDeliverables: 3,
    closedOutcomes: 3,
    planningOnlyCycles: 0,
    safetyEvidence: true,
    qualityEvidence: true,
    expectedVerdict: 'pass_calibrated',
    minScore: 9,
  }),
  fixture('delivery_phase_reports_only_fail', 'delivery', {
    processShare: 0.62,
    deliveryShare: 0.18,
    qualityShare: 0.18,
    safetyShare: 0.12,
    namedDeliverables: 0,
    closedOutcomes: 0,
    planningOnlyCycles: 3,
    qualityEvidence: true,
    expectedVerdict: 'fail_recalibrate',
  }),
  fixture('launch_named_readiness_with_safety', 'launch_opening', {
    processShare: 0.22,
    deliveryShare: 0.38,
    qualityShare: 0.28,
    safetyShare: 0.36,
    namedDeliverables: 2,
    closedOutcomes: 1,
    planningOnlyCycles: 0,
    falseGreenRisk: true,
    safetyEvidence: true,
    qualityEvidence: true,
    expectedVerdict: 'pass_calibrated',
    minScore: 9,
  }),
  fixture('launch_false_green_without_evidence_fail', 'launch_opening', {
    processShare: 0.24,
    deliveryShare: 0.44,
    qualityShare: 0.24,
    safetyShare: 0.18,
    namedDeliverables: 2,
    closedOutcomes: 1,
    planningOnlyCycles: 0,
    falseGreenRisk: true,
    safetyEvidence: false,
    qualityEvidence: true,
    expectedVerdict: 'fail_recalibrate',
  }),
  fixture('incident_owner_interrupt_bypassed_fail', 'incident_repair', {
    processShare: 0.3,
    deliveryShare: 0.24,
    qualityShare: 0.2,
    safetyShare: 0.46,
    namedDeliverables: 1,
    closedOutcomes: 0,
    planningOnlyCycles: 1,
    ownerDecisionRequired: true,
    adjacentWorkActive: true,
    safetyEvidence: true,
    expectedVerdict: 'fail_recalibrate',
  }),
  fixture('incident_repair_safety_first_allowed', 'incident_repair', {
    processShare: 0.24,
    deliveryShare: 0.22,
    qualityShare: 0.22,
    safetyShare: 0.48,
    namedDeliverables: 1,
    closedOutcomes: 0,
    planningOnlyCycles: 0,
    ownerDecisionRequired: true,
    adjacentWorkActive: false,
    safetyEvidence: true,
    expectedVerdict: 'pass_calibrated',
    minScore: 8,
  }),
  fixture('maintenance_small_doc_gate_allowed', 'maintenance', {
    processShare: 0.3,
    deliveryShare: 0.36,
    qualityShare: 0.32,
    safetyShare: 0.22,
    namedDeliverables: 1,
    closedOutcomes: 0,
    planningOnlyCycles: 1,
    qualityEvidence: true,
    expectedVerdict: 'pass_calibrated',
    minScore: 8,
  }),
  fixture('delivery_fast_shipping_quality_under_budget_fail', 'delivery', {
    processShare: 0.12,
    deliveryShare: 0.68,
    qualityShare: 0.08,
    safetyShare: 0.12,
    namedDeliverables: 2,
    closedOutcomes: 2,
    planningOnlyCycles: 0,
    safetyEvidence: true,
    qualityEvidence: false,
    expectedVerdict: 'fail_recalibrate',
  }),
  fixture('delivery_detached_issue_reporting_fail', 'delivery', {
    processShare: 0.24,
    deliveryShare: 0.52,
    qualityShare: 0.28,
    safetyShare: 0.18,
    namedDeliverables: 3,
    closedOutcomes: 3,
    planningOnlyCycles: 0,
    safetyEvidence: true,
    qualityEvidence: true,
    reportingAttachedToOutcomes: false,
    expectedVerdict: 'fail_recalibrate',
  }),
];

export function calibrateDeliveryScenario(scenario) {
  const value = assertShape(scenario, 0);
  const policy = STAGE_POLICIES[value.stage];
  const deductions = [];
  const deduct = (id, points, message, hard = false) => {
    deductions.push({ id, points, hard, message });
  };

  if (value.processShare > policy.maxProcessShare) {
    deduct(
      'process_over_budget_for_stage',
      2,
      `Process share ${value.processShare} exceeds ${value.stage} max ${policy.maxProcessShare}.`,
      ['delivery', 'launch_opening'].includes(value.stage),
    );
  }
  if (value.planningOnlyCycles > policy.maxPlanningOnlyCycles) {
    deduct(
      'planning_only_budget_exceeded',
      2,
      `Planning-only cycles ${value.planningOnlyCycles} exceed ${value.stage} max ${policy.maxPlanningOnlyCycles}.`,
      ['delivery', 'launch_opening', 'incident_repair'].includes(value.stage),
    );
  }
  if (policy.namedDeliverableRequired && value.namedDeliverables < 1) {
    deduct('named_deliverable_missing', 3, `${value.stage} stage requires named deliverables/outcomes.`, true);
  }
  if (value.closedOutcomes < policy.minClosedOutcomes) {
    deduct(
      'closed_outcome_missing',
      3,
      `${value.stage} stage requires at least ${policy.minClosedOutcomes} closed outcome(s) per cycle.`,
      true,
    );
  }
  if (value.deliveryShare < policy.minDeliveryShare) {
    deduct(
      'delivery_under_budget_for_stage',
      2,
      `Delivery share ${value.deliveryShare} is below ${value.stage} minimum ${policy.minDeliveryShare}.`,
      policy.minClosedOutcomes > 0,
    );
  }
  if (value.closedOutcomes > 0 && value.qualityShare < policy.minQualityShare) {
    deduct(
      'quality_under_budget_for_closed_work',
      2,
      `Closed work needs quality budget ${policy.minQualityShare}; got ${value.qualityShare}.`,
      true,
    );
  }
  if (value.closedOutcomes > 0 && !value.qualityEvidence) {
    deduct('quality_evidence_missing_for_closed_work', 2, 'Closed outcomes need quality evidence.', true);
  }
  if ((value.falseGreenRisk || ['launch_opening', 'incident_repair'].includes(value.stage)) && value.safetyShare < policy.minSafetyShare) {
    deduct(
      'safety_under_budget_for_risk',
      2,
      `Safety share ${value.safetyShare} is below ${value.stage} minimum ${policy.minSafetyShare}.`,
      true,
    );
  }
  if (value.falseGreenRisk && !value.safetyEvidence) {
    deduct('false_green_safety_evidence_missing', 3, 'False-green risk requires exact safety/evidence proof.', true);
  }
  if (value.ownerDecisionRequired && value.adjacentWorkActive) {
    deduct('owner_decision_interrupt_bypassed', 3, 'Owner decision required but adjacent work is still active.', true);
  }
  if (!value.nextActionBound) {
    deduct('next_action_not_bound_to_deliverable', 2, 'Next action must name the next deliverable or blocker.', true);
  }
  if (['delivery', 'launch_opening'].includes(value.stage) && value.closedOutcomes > 0 && !value.reportingAttachedToOutcomes) {
    deduct(
      'reporting_detached_from_named_outcomes',
      2,
      'Issue/reporting work must attach to the named outcomes closed in the current cycle.',
      true,
    );
  }

  const score = Math.max(0, 10 - deductions.reduce((total, deduction) => total + deduction.points, 0));
  const hardBlockers = deductions.filter((deduction) => deduction.hard).map((deduction) => deduction.id);
  const verdict = hardBlockers.length === 0 && score >= 8 ? 'pass_calibrated' : 'fail_recalibrate';

  return {
    id: value.id,
    stage: value.stage,
    score,
    verdict,
    hardBlockers,
    deductions,
    policy,
  };
}

function assertShape(value, index) {
  if (!value || typeof value !== 'object') throw new Error(`scenario[${index}] must be an object`);
  const id = requireString(value.id, `scenario[${index}].id`);
  requireEnum(value.stage, ENUMS.stage, `${id}.stage`);
  requireShare(value.processShare, `${id}.processShare`);
  requireShare(value.deliveryShare, `${id}.deliveryShare`);
  requireShare(value.qualityShare, `${id}.qualityShare`);
  requireShare(value.safetyShare, `${id}.safetyShare`);
  requireNumber(value.namedDeliverables, `${id}.namedDeliverables`);
  requireNumber(value.closedOutcomes, `${id}.closedOutcomes`);
  requireNumber(value.planningOnlyCycles, `${id}.planningOnlyCycles`);
  requireBoolean(value.falseGreenRisk, `${id}.falseGreenRisk`);
  requireBoolean(value.safetyEvidence, `${id}.safetyEvidence`);
  requireBoolean(value.qualityEvidence, `${id}.qualityEvidence`);
  requireBoolean(value.ownerDecisionRequired, `${id}.ownerDecisionRequired`);
  requireBoolean(value.adjacentWorkActive, `${id}.adjacentWorkActive`);
  requireBoolean(value.nextActionBound, `${id}.nextActionBound`);
  requireBoolean(value.reportingAttachedToOutcomes, `${id}.reportingAttachedToOutcomes`);
  if (value.expectedVerdict !== undefined) requireEnum(value.expectedVerdict, ENUMS.verdict, `${id}.expectedVerdict`);
  if (value.minScore !== undefined) requireNumber(value.minScore, `${id}.minScore`);
  return value;
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function requireNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number`);
  }
  return value;
}

function requireShare(value, path) {
  requireNumber(value, path);
  if (value > 1) throw new Error(`${path} must be between 0 and 1`);
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function requireEnum(value, allowed, path) {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`${path} has unsupported value`);
  return value;
}

function readYamlSection(raw, sectionName, baseIndent = -1) {
  const lines = raw.split(/\r?\n/);
  let start = -1;
  let indent = -1;
  const matcher = new RegExp(`^(\\s*)${escapeRegExp(sectionName)}:\\s*(?:#.*)?$`);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(matcher);
    if (!match) continue;
    const currentIndent = match[1].length;
    if (currentIndent <= baseIndent) continue;
    start = index + 1;
    indent = currentIndent;
    break;
  }

  if (start === -1) return null;

  const section = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      section.push(line);
      continue;
    }
    const currentIndent = line.match(/^\s*/)[0].length;
    if (currentIndent <= indent) break;
    section.push(line);
  }

  return { raw: section.join('\n'), indent };
}

function parseYamlMap(section) {
  const output = {};
  const lines = section.raw.split(/\r?\n/);
  const directIndent = section.indent + 2;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent !== directIndent) continue;

    const match = line.trim().match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = stripComment(match[2] ?? '');
    // This is a minimal flow-style parser: it does not support YAML block scalars
    // (`|`, `>` and their chomping/indent indicators), anchors, or aliases. Fail
    // loudly instead of silently dropping a multi-line value as an empty string.
    if (/^[|>][+-]?\d*\s*$/.test(rawValue)) {
      throw new Error(`unsupported_yaml_feature: block scalar at key "${key}" is not supported by the task-spine reader`);
    }
    if (rawValue.length > 0) {
      output[key] = parseYamlScalar(rawValue);
      continue;
    }

    const values = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      if (!childLine.trim()) continue;
      const childIndent = childLine.match(/^\s*/)[0].length;
      if (childIndent <= indent) break;
      const itemMatch = childLine.trim().match(/^-\s*(.*)$/);
      if (itemMatch) values.push(parseYamlScalar(stripComment(itemMatch[1])));
    }
    output[key] = values;
  }

  return output;
}

function scenarioFromTaskSpine(spinePath) {
  const resolved = resolve(spinePath);
  const raw = readFileSync(resolved, 'utf8');
  const deliverySection = readYamlSection(raw, 'deliveryCalibration');
  if (!deliverySection) throw new Error(`${spinePath} missing deliveryCalibration`);

  const delivery = parseYamlMap(deliverySection);
  const stage = delivery.projectStage;
  requireEnum(stage, ENUMS.stage, 'deliveryCalibration.projectStage');

  const currentCycleSection = readYamlSection(deliverySection.raw, 'currentCycle', deliverySection.indent);
  if (!currentCycleSection) {
    return assertShape({
      id: `task_spine_${stage}_current_cycle_missing`,
      stage,
      processShare: 1,
      deliveryShare: 0,
      qualityShare: 0,
      safetyShare: 0,
      namedDeliverables: 0,
      closedOutcomes: 0,
      planningOnlyCycles: Number(delivery.maxPlanningOnlyCycles ?? 0) + 1,
      falseGreenRisk: ['launch_opening', 'incident_repair'].includes(stage),
      safetyEvidence: false,
      qualityEvidence: false,
    ownerDecisionRequired: false,
    adjacentWorkActive: false,
    nextActionBound: false,
    reportingAttachedToOutcomes: false,
  }, 0);
  }

  const currentCycle = parseYamlMap(currentCycleSection);
  const outcomeRows = parseOutcomeRows(currentCycle.outcomeRows);
  const closedOutcomeRows = outcomeRows.filter((row) => CLOSED_OUTCOME_STATUSES.has(row.status));
  const allClosedRowsAttached = closedOutcomeRows.every(hasAttachedReporting);
  const scenario = {
    id: String(currentCycle.id || `task_spine_${stage}_current_cycle`),
    stage,
    processShare: shareOrDefault(currentCycle.processShare, 'processShare', 1),
    deliveryShare: shareOrDefault(currentCycle.deliveryShare, 'deliveryShare', 0),
    qualityShare: shareOrDefault(currentCycle.qualityShare, 'qualityShare', 0),
    safetyShare: shareOrDefault(currentCycle.safetyShare, 'safetyShare', 0),
    namedDeliverables: outcomeRows.length || countOrNumber(currentCycle.namedDeliverables ?? currentCycle.namedOutcomes),
    closedOutcomes: closedOutcomeRows.length || countOrNumber(currentCycle.closedOutcomes),
    planningOnlyCycles: numberOrDefault(currentCycle.planningOnlyCycles, 'planningOnlyCycles', 0),
    falseGreenRisk: booleanOrDefault(currentCycle.falseGreenRisk, false),
    safetyEvidence: booleanOrDefault(currentCycle.safetyEvidence, false) || countOrNumber(currentCycle.safetyEvidenceRefs) > 0,
    qualityEvidence: booleanOrDefault(currentCycle.qualityEvidence, false) || countOrNumber(currentCycle.qualityEvidenceRefs) > 0,
    ownerDecisionRequired: booleanOrDefault(currentCycle.ownerDecisionRequired, false),
    adjacentWorkActive: booleanOrDefault(currentCycle.adjacentWorkActive, false),
    nextActionBound: booleanOrDefault(currentCycle.nextActionBound, Boolean(currentCycle.nextAction)),
    reportingAttachedToOutcomes: outcomeRows.length > 0
      ? allClosedRowsAttached
      : booleanOrDefault(currentCycle.reportingAttachedToOutcomes, true),
  };

  return assertShape(scenario, 0);
}

function parseOutcomeRows(value) {
  if (!Array.isArray(value)) return [];
  return value.map(parseOutcomeRow).filter(Boolean);
}

function parseOutcomeRow(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  const row = {};
  for (const part of value.split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = rawKey?.trim();
    const rawValue = rawValueParts.join('=').trim();
    if (!key || !rawValue) continue;
    row[key] = rawValue.includes('|') ? rawValue.split('|').map((item) => item.trim()).filter(Boolean) : rawValue;
  }
  return row;
}

function hasAttachedReporting(row) {
  return hasValue(row.issueRefs) && (hasValue(row.evidenceRefs) || hasValue(row.reportRefs));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

function stripComment(value) {
  return String(value).replace(/\s+#.*$/, '').trim();
}

function parseYamlScalar(rawValue) {
  const value = rawValue.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === '[]') return [];
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseYamlScalar(item.trim()));
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^["']|["']$/g, '');
}

function shareOrDefault(value, path, fallback) {
  if (value === undefined || value === null) return fallback;
  requireShare(value, `deliveryCalibration.currentCycle.${path}`);
  return value;
}

function numberOrDefault(value, path, fallback) {
  if (value === undefined || value === null) return fallback;
  requireNumber(value, `deliveryCalibration.currentCycle.${path}`);
  return value;
}

function booleanOrDefault(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') return Boolean(value);
  return value;
}

function countOrNumber(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.length > 0) return 1;
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseScenarios(args) {
  if (args.includes('--fixtures')) return deliveryCalibrationFixtures;

  const inputIndex = args.indexOf('--input');
  if (inputIndex !== -1) {
    const rawPath = args[inputIndex + 1];
    if (!rawPath) throw new Error('--input requires a JSON path');
    const input = JSON.parse(readFileSync(resolve(rawPath), 'utf8'));
    const scenarios = Array.isArray(input) ? input : [input];
    return scenarios.map(assertShape);
  }

  const spineIndex = args.indexOf('--spine');
  const explicitSpinePath = spineIndex === -1 ? null : args[spineIndex + 1] || '.captain-os/task-spine.yaml';
  const defaultSpinePath = '.captain-os/task-spine.yaml';
  const spinePath = explicitSpinePath || (existsSync(resolve(defaultSpinePath)) ? defaultSpinePath : null);
  if (!spinePath) return deliveryCalibrationFixtures;

  return [scenarioFromTaskSpine(spinePath)];
}

export function runDeliveryCalibrationCommand(args = process.argv.slice(3)) {
  const asJson = args.includes('--json');
  let scenarios;
  try {
    scenarios = parseScenarios(args);
  } catch (error) {
    console.error(`delivery-calibration: ${error.message}`);
    return 2;
  }

  const scores = scenarios.map(calibrateDeliveryScenario);
  const failures = [];
  scenarios.forEach((scenario, index) => {
    const score = scores[index];
    if (scenario.expectedVerdict && score.verdict !== scenario.expectedVerdict) {
      failures.push(`${scenario.id}: expected ${scenario.expectedVerdict}, got ${score.verdict}`);
    }
    if (scenario.minScore !== undefined && score.score < scenario.minScore) {
      failures.push(`${scenario.id}: expected score >= ${scenario.minScore}, got ${score.score}`);
    }
    if (!scenario.expectedVerdict && score.verdict === 'fail_recalibrate') {
      failures.push(`${scenario.id}: ${score.verdict} score=${score.score}`);
    }
  });

  if (asJson) {
    console.log(JSON.stringify({ status: failures.length === 0 ? 'pass' : 'fail', failures, scores }, null, 2));
  } else {
    for (const score of scores) {
      console.log(`${score.id}: ${score.verdict} score=${score.score} stage=${score.stage}`);
      for (const blocker of score.hardBlockers) console.log(`  hard: ${blocker}`);
    }
    console.log(`delivery-calibration: ${failures.length === 0 ? 'PASS' : 'FAIL'} (${scores.length} scenarios)`);
    for (const failure of failures) console.log(`  ${failure}`);
  }

  return failures.length === 0 ? 0 : 1;
}
