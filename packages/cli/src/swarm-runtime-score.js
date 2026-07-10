import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FRESH_MINUTES = 30;

const PRODUCTIVE_ARTIFACTS = new Set([
  'patch',
  'test_evidence',
  'blocked_verdict',
  'issue_update',
  'report',
  'pr',
]);

const REVIEW_ARTIFACTS = new Set([
  'review_verdict',
  'process_verdict',
  'blocked_verdict',
  'report',
]);

const ENUMS = {
  laneKind: new Set(['implementation', 'evidence', 'review', 'starpom', 'claude_review', 'adjacent_planning']),
  artifact: new Set(['none', 'packet', 'patch', 'test_evidence', 'review_verdict', 'process_verdict', 'blocked_verdict', 'issue_update', 'report', 'pr']),
  captainRole: new Set(['orchestrator', 'direct_executor']),
  criticalPathState: new Set(['moving', 'blocked_owner_decision', 'idle']),
  nextPacket: new Set(['started', 'scheduled', 'text_only', 'none']),
  verdict: new Set(['pass_9_of_10', 'allowed_not_swarm', 'fail_false_swarm']),
};

function defaultOutcomeBinding(id, artifact, criticalPath) {
  if (!criticalPath || !PRODUCTIVE_ARTIFACTS.has(artifact)) return null;
  return {
    issueRef: `ISSUE-${id}`,
    outcomeId: `OUTCOME-${id}`,
    outcomeState: 'ready_with_evidence',
    evidenceRefs: [`evidence-${id}`],
  };
}

function lane(id, owner, kind, artifact, criticalPath, persistentMemory = true, minutesSinceOutput = 5, outcomeBinding = undefined) {
  return {
    id,
    owner,
    kind,
    artifact,
    criticalPath,
    persistentMemory,
    minutesSinceOutput,
    outcomeBinding: outcomeBinding === undefined ? defaultOutcomeBinding(id, artifact, criticalPath) : outcomeBinding,
  };
}

function capacity({
  threadLimitReached = false,
  staleAgentThreads = 0,
  recyclableAgentThreads = 0,
  closeoutDeltaCaptured = true,
  laneMemoryUpdated = true,
  closeAgentsAttempted = false,
  retrySpawnScheduled = true,
} = {}) {
  return {
    threadLimitReached,
    staleAgentThreads,
    recyclableAgentThreads,
    closeoutDeltaCaptured,
    laneMemoryUpdated,
    closeAgentsAttempted,
    retrySpawnScheduled,
  };
}

export const swarmScoreFixtures = [
  {
    id: 'valid_portfolio_swarm_9_plus',
    description: 'Captain orchestrates; four bounded lanes produce fresh critical-path artifacts.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.18,
    prBound: true,
    openingOrIndexingRisk: true,
    officerSplit: true,
    criticalPath: { state: 'moving', adjacentWorkActive: true },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'pass_9_of_10',
    minScore: 9,
    lanes: [
      lane('gibbs-619-620-625', 'Gibbs', 'implementation', 'issue_update', true),
      lane('einstein-623', 'Einstein', 'implementation', 'report', true),
      lane('feynman-621-622-627', 'Feynman', 'evidence', 'test_evidence', true),
      lane('volta-624', 'Volta', 'implementation', 'issue_update', true),
      lane('claude-review', 'Claude Code', 'claude_review', 'review_verdict', false),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'allowed_captain_direct_tiny_glue',
    description: 'Captain does a narrow direct glue fix and does not claim swarm.',
    claimsSwarm: false,
    captainRole: 'direct_executor',
    captainImplementationShare: 1,
    prBound: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'scheduled',
    agentCapacity: capacity(),
    expectedVerdict: 'allowed_not_swarm',
    lanes: [lane('starpom-lite', 'StarPom', 'starpom', 'process_verdict', false)],
  },
  {
    id: 'captain_does_work_but_labels_swarm',
    description: 'Captain writes most implementation while lane names exist only around the work.',
    claimsSwarm: true,
    captainRole: 'direct_executor',
    captainImplementationShare: 0.74,
    prBound: true,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('reviewer', 'Claude Code', 'claude_review', 'review_verdict', false),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'sequential_one_shot_reviewers',
    description: 'One-shot reviewers and planners are reported as a swarm.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.2,
    prBound: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'scheduled',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('reviewer-1', 'Bohr', 'review', 'review_verdict', false, false),
      lane('reviewer-2', 'Hume', 'review', 'review_verdict', false, false),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'stale_lane_outputs',
    description: 'Lanes exist, but no lane has a fresh artifact inside the 30-minute window.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.3,
    prBound: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('old-impl-a', 'Gibbs', 'implementation', 'patch', true, true, 47),
      lane('old-impl-b', 'Einstein', 'implementation', 'report', true, true, 62),
      lane('old-starpom', 'StarPom', 'starpom', 'process_verdict', false, true, 44),
    ],
  },
  {
    id: 'adjacent_work_while_critical_path_idle',
    description: 'Agents are busy on adjacent planning while the production blocker is idle.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.25,
    prBound: false,
    officerSplit: false,
    criticalPath: { state: 'idle', adjacentWorkActive: true },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('phase-adjacent-a', 'Marlowe', 'adjacent_planning', 'packet', false),
      lane('phase-adjacent-b', 'Hume', 'adjacent_planning', 'packet', false),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'missing_review_lanes_on_pr_bound_work',
    description: 'PR-bound swarm lacks the standing Claude review lane and StarPom lane.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.15,
    prBound: true,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('impl-a', 'Gibbs', 'implementation', 'patch', true),
      lane('impl-b', 'Einstein', 'implementation', 'report', true),
    ],
  },
  {
    id: 'over_wide_span_without_officer_split',
    description: 'Captain runs too many lanes without an officer split.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.2,
    prBound: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('impl-a', 'Gibbs', 'implementation', 'patch', true),
      lane('impl-b', 'Einstein', 'implementation', 'report', true),
      lane('impl-c', 'Feynman', 'evidence', 'test_evidence', true),
      lane('impl-d', 'Volta', 'implementation', 'issue_update', true),
      lane('impl-e', 'Marlowe', 'implementation', 'issue_update', true),
      lane('impl-f', 'Hume', 'implementation', 'report', true),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'planning_only_ready_for_execution',
    description: 'Planning-only packets are reported as ready without started/scheduled execution.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.1,
    prBound: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'text_only',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('planner-a', 'Marlowe', 'adjacent_planning', 'packet', false),
      lane('planner-b', 'Hume', 'adjacent_planning', 'packet', false),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'seo_false_green_without_exact_evidence',
    description: 'Opening/indexing work claims progress without an exact evidence lane.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.2,
    prBound: true,
    openingOrIndexingRisk: true,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('impl-a', 'Gibbs', 'implementation', 'patch', true),
      lane('impl-b', 'Einstein', 'implementation', 'report', true),
      lane('claude-review', 'Claude Code', 'claude_review', 'review_verdict', false),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'agent_thread_limit_recycled_and_retried',
    description: 'Runtime hit agent thread limit, captured lane deltas, closed stale threads, then resumed a real swarm.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.28,
    prBound: false,
    openingOrIndexingRisk: false,
    officerSplit: true,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity({
      threadLimitReached: true,
      staleAgentThreads: 2,
      recyclableAgentThreads: 2,
      closeoutDeltaCaptured: true,
      laneMemoryUpdated: true,
      closeAgentsAttempted: true,
      retrySpawnScheduled: true,
    }),
    expectedVerdict: 'pass_9_of_10',
    minScore: 9,
    lanes: [
      lane('url-crawl-evidence', 'Feynman', 'evidence', 'test_evidence', true),
      lane('commercial-gtm', 'Marlowe', 'implementation', 'issue_update', true),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'agent_thread_limit_no_recycle_fail',
    description: 'Runtime hits agent thread limit and keeps Captain-local execution without closing stale lane threads.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.42,
    prBound: false,
    openingOrIndexingRisk: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity({
      threadLimitReached: true,
      staleAgentThreads: 3,
      recyclableAgentThreads: 0,
      closeoutDeltaCaptured: false,
      laneMemoryUpdated: false,
      closeAgentsAttempted: false,
      retrySpawnScheduled: false,
    }),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'swarm_detached_issue_update_without_outcome_fail',
    description: 'Critical lanes produce issue/report artifacts, but those artifacts are not bound to a named outcome row.',
    claimsSwarm: true,
    captainRole: 'orchestrator',
    captainImplementationShare: 0.22,
    prBound: false,
    openingOrIndexingRisk: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity(),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('issue-update-floating', 'Marlowe', 'implementation', 'issue_update', true, true, 4, null),
      lane('report-floating', 'Feynman', 'evidence', 'report', true, true, 4, null),
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
  {
    id: 'thread_limit_downgraded_to_captain_local_fake_progress_fail',
    description: 'Thread limit is hit, swarm label is downgraded, but broad Captain-local progress continues without capacity replan.',
    claimsSwarm: false,
    captainRole: 'direct_executor',
    captainImplementationShare: 0.82,
    prBound: false,
    openingOrIndexingRisk: false,
    officerSplit: false,
    criticalPath: { state: 'moving', adjacentWorkActive: false },
    nextPacket: 'started',
    agentCapacity: capacity({
      threadLimitReached: true,
      staleAgentThreads: 3,
      recyclableAgentThreads: 0,
      closeoutDeltaCaptured: false,
      laneMemoryUpdated: false,
      closeAgentsAttempted: false,
      retrySpawnScheduled: false,
    }),
    expectedVerdict: 'fail_false_swarm',
    lanes: [
      lane('starpom', 'StarPom', 'starpom', 'process_verdict', false),
    ],
  },
];

export function scoreSwarmScenario(scenario) {
  const deductions = [];
  const deduct = (id, points, message, hard = false) => {
    deductions.push({ id, points, hard, message });
  };
  const freshLanes = scenario.lanes.filter((lane) => lane.minutesSinceOutput <= FRESH_MINUTES);
  const productiveCriticalLanes = freshLanes.filter(
    (lane) => lane.criticalPath && PRODUCTIVE_ARTIFACTS.has(lane.artifact),
  );
  const reviewOnlyLanes = freshLanes.filter((lane) => ['review', 'starpom', 'claude_review'].includes(lane.kind));
  const hasStarPom = freshLanes.some((lane) => lane.kind === 'starpom' && REVIEW_ARTIFACTS.has(lane.artifact));
  const hasClaudeReview = freshLanes.some((lane) => lane.kind === 'claude_review' && REVIEW_ARTIFACTS.has(lane.artifact));
  const hasOpeningEvidence = freshLanes.some(
    (lane) => lane.kind === 'evidence' && lane.criticalPath && ['test_evidence', 'blocked_verdict', 'report'].includes(lane.artifact),
  );

  if (!scenario.claimsSwarm) {
    const capacityScore = scoreCapacityLifecycle(scenario.agentCapacity, deduct, false);
    if (
      scenario.agentCapacity?.threadLimitReached &&
      scenario.captainImplementationShare > 0.5 &&
      !scenario.agentCapacity.closeAgentsAttempted
    ) {
      deduct(
        'thread_limit_captain_local_broad_work',
        3,
        'Agent thread limit cannot be converted into broad Captain-local progress without close/recycle or explicit replan.',
        true,
      );
    }
    const hardBlockers = deductions.filter((deduction) => deduction.hard).map((deduction) => deduction.id);
    if (hardBlockers.length > 0) {
      const score = Math.max(0, Math.min(capacityScore, 10 - deductions.reduce((total, deduction) => total + deduction.points, 0)));
      return { id: scenario.id, score, verdict: 'fail_false_swarm', hardBlockers, deductions };
    }
    const baseScore = scenario.prBound && (!hasClaudeReview || !hasStarPom) ? 7 : 8;
    const score = Math.min(baseScore, capacityScore);
    return { id: scenario.id, score, verdict: 'allowed_not_swarm', hardBlockers: [], deductions };
  }

  if (scenario.captainRole !== 'orchestrator') {
    deduct('captain_direct_executor_claimed_as_swarm', 4, 'Captain is direct executor while the packet claims swarm.', true);
  }
  if (scenario.captainImplementationShare > 0.5) {
    deduct('captain_implementation_share_too_high', 3, 'Captain implementation share is above the 50% swarm ceiling.', true);
  }
  if (productiveCriticalLanes.length < 2) {
    deduct('insufficient_productive_critical_lanes', 3, 'Swarm needs at least two fresh non-review critical-path lane artifacts.', true);
  }
  const unboundProductiveLanes = productiveCriticalLanes.filter((lane) => !hasOutcomeBinding(lane));
  if (unboundProductiveLanes.length > 0) {
    deduct(
      'critical_lane_outcome_binding_missing',
      3,
      'Every productive critical-path lane must bind its artifact to an issue, outcome id, outcome state, and evidence refs.',
      true,
    );
  }
  if (productiveCriticalLanes.length === 0 && reviewOnlyLanes.length > 0) {
    deduct('review_only_false_swarm', 2, 'Review/process lanes are useful, but they are not implementation swarm lanes.', true);
  }
  if (freshLanes.some((lane) => !lane.persistentMemory)) {
    deduct('missing_persistent_lane_memory', 1, 'Every active lane needs persistent lane memory, not a cold one-shot.', true);
  }
  if (scenario.lanes.length > 0 && freshLanes.length === 0) {
    deduct('no_fresh_lane_output', 3, 'No lane output is fresh inside the 30-minute swarm window.', true);
  }
  if (scenario.criticalPath.state === 'idle' && scenario.criticalPath.adjacentWorkActive) {
    deduct('adjacent_work_over_idle_critical_path', 3, 'Adjacent work is active while the critical path is idle.', true);
  }
  if (!['started', 'scheduled'].includes(scenario.nextPacket)) {
    deduct('next_packet_not_bound', 2, 'Next packet must be started or scheduled; text-only planning is not execution.', true);
  }
  if (scenario.prBound && !hasClaudeReview) {
    deduct('missing_claude_review_lane', 2, 'PR-bound swarm requires the standing Claude Code read-only review lane.', true);
  }
  if (!hasStarPom) {
    deduct('missing_starpom_lane', 2, 'Swarm packet requires a fresh StarPom process lane.', true);
  }
  if (scenario.lanes.length > 5 && !scenario.officerSplit) {
    deduct('span_of_control_over_five', 2, 'More than five active lanes requires officer split or an explicit red flag.', true);
  }
  if (scenario.openingOrIndexingRisk && !hasOpeningEvidence) {
    deduct('opening_indexing_evidence_missing', 3, 'SEO opening/indexing work needs exact evidence before green wording.', true);
  }
  scoreCapacityLifecycle(scenario.agentCapacity, deduct, true);

  const score = Math.max(0, 10 - deductions.reduce((total, deduction) => total + deduction.points, 0));
  const hardBlockers = deductions.filter((deduction) => deduction.hard).map((deduction) => deduction.id);
  const verdict = hardBlockers.length === 0 && score >= 9 ? 'pass_9_of_10' : 'fail_false_swarm';
  return { id: scenario.id, score, verdict, hardBlockers, deductions };
}

function hasOutcomeBinding(lane) {
  const binding = lane.outcomeBinding;
  return Boolean(
    binding &&
      typeof binding.issueRef === 'string' &&
      binding.issueRef.length > 0 &&
      typeof binding.outcomeId === 'string' &&
      binding.outcomeId.length > 0 &&
      CLOSED_OUTCOME_STATES.has(binding.outcomeState) &&
      Array.isArray(binding.evidenceRefs) &&
      binding.evidenceRefs.length > 0,
  );
}

const CLOSED_OUTCOME_STATES = new Set([
  'ready_with_evidence',
  'not_ready_with_exact_blocker',
  'blocked_owner_decision_required',
]);

function scoreCapacityLifecycle(agentCapacity, deduct, hardWhenClaimingSwarm) {
  if (!agentCapacity?.threadLimitReached) return 10;

  let score = 8;
  const hard = Boolean(hardWhenClaimingSwarm);

  if (agentCapacity.staleAgentThreads > 0 && agentCapacity.recyclableAgentThreads < 1) {
    deduct('stale_agent_threads_not_recyclable', 2, 'Agent thread limit was hit, but no stale/recyclable agent threads were identified.', hard);
    score -= 2;
  }
  if (!agentCapacity.closeoutDeltaCaptured) {
    deduct('agent_closeout_delta_missing', 2, 'Before closing agent threads, Captain must capture lane deltas/evidence owed.', hard);
    score -= 2;
  }
  if (!agentCapacity.laneMemoryUpdated) {
    deduct('agent_lane_memory_not_updated', 2, 'Lane memory must be updated before agent threads are closed or recycled.', hard);
    score -= 2;
  }
  if (!agentCapacity.closeAgentsAttempted) {
    deduct('agent_thread_recycle_not_attempted', 2, 'Agent thread limit requires close_agent/archive of finished lanes before Captain-local fallback.', hard);
    score -= 2;
  }
  if (!agentCapacity.retrySpawnScheduled) {
    deduct('agent_spawn_retry_not_scheduled', 1, 'After recycling capacity, Captain must schedule a retry spawn or record a bounded not_swarm fallback.', hard);
    score -= 1;
  }

  return Math.max(0, score);
}

function assertShape(value, index) {
  if (!value || typeof value !== 'object') throw new Error(`scenario[${index}] must be an object`);
  const id = requireString(value.id, `scenario[${index}].id`);
  requireString(value.description, `${id}.description`);
  requireBoolean(value.claimsSwarm, `${id}.claimsSwarm`);
  requireEnum(value.captainRole, ENUMS.captainRole, `${id}.captainRole`);
  requireNumber(value.captainImplementationShare, `${id}.captainImplementationShare`);
  requireBoolean(value.prBound, `${id}.prBound`);
  requireBoolean(value.officerSplit, `${id}.officerSplit`);
  // Optional (defaults to false = not opening/indexing work). Validate-if-present so a
  // non-boolean value can't quietly read as truthy/falsy and corrupt the SEO-evidence gate (~line 441).
  if (value.openingOrIndexingRisk !== undefined) {
    requireBoolean(value.openingOrIndexingRisk, `${id}.openingOrIndexingRisk`);
  }
  if (!value.criticalPath || typeof value.criticalPath !== 'object') throw new Error(`${id}.criticalPath must be an object`);
  requireEnum(value.criticalPath.state, ENUMS.criticalPathState, `${id}.criticalPath.state`);
  requireBoolean(value.criticalPath.adjacentWorkActive, `${id}.criticalPath.adjacentWorkActive`);
  requireEnum(value.nextPacket, ENUMS.nextPacket, `${id}.nextPacket`);
  if (value.agentCapacity !== undefined) assertCapacity(value.agentCapacity, id);
  if (!Array.isArray(value.lanes)) throw new Error(`${id}.lanes must be an array`);
  value.lanes.forEach((lane, laneIndex) => {
    if (!lane || typeof lane !== 'object') throw new Error(`${id}.lanes[${laneIndex}] must be an object`);
    requireString(lane.id, `${id}.lanes[${laneIndex}].id`);
    requireString(lane.owner, `${id}.lanes[${laneIndex}].owner`);
    requireEnum(lane.kind, ENUMS.laneKind, `${id}.lanes[${laneIndex}].kind`);
    requireEnum(lane.artifact, ENUMS.artifact, `${id}.lanes[${laneIndex}].artifact`);
    requireBoolean(lane.criticalPath, `${id}.lanes[${laneIndex}].criticalPath`);
    requireBoolean(lane.persistentMemory, `${id}.lanes[${laneIndex}].persistentMemory`);
    requireNumber(lane.minutesSinceOutput, `${id}.lanes[${laneIndex}].minutesSinceOutput`);
    if (lane.outcomeBinding !== null && lane.outcomeBinding !== undefined) assertOutcomeBinding(lane.outcomeBinding, `${id}.lanes[${laneIndex}].outcomeBinding`);
  });
  if (value.expectedVerdict !== undefined) requireEnum(value.expectedVerdict, ENUMS.verdict, `${id}.expectedVerdict`);
  if (value.minScore !== undefined) requireNumber(value.minScore, `${id}.minScore`);
  return value;
}

function assertOutcomeBinding(binding, path) {
  if (!binding || typeof binding !== 'object') throw new Error(`${path} must be an object`);
  requireString(binding.issueRef, `${path}.issueRef`);
  requireString(binding.outcomeId, `${path}.outcomeId`);
  requireEnum(binding.outcomeState, CLOSED_OUTCOME_STATES, `${path}.outcomeState`);
  if (!Array.isArray(binding.evidenceRefs) || binding.evidenceRefs.length === 0) throw new Error(`${path}.evidenceRefs must be a non-empty array`);
}

function assertCapacity(agentCapacity, id) {
  if (!agentCapacity || typeof agentCapacity !== 'object') throw new Error(`${id}.agentCapacity must be an object`);
  requireBoolean(agentCapacity.threadLimitReached, `${id}.agentCapacity.threadLimitReached`);
  requireNumber(agentCapacity.staleAgentThreads, `${id}.agentCapacity.staleAgentThreads`);
  requireNumber(agentCapacity.recyclableAgentThreads, `${id}.agentCapacity.recyclableAgentThreads`);
  requireBoolean(agentCapacity.closeoutDeltaCaptured, `${id}.agentCapacity.closeoutDeltaCaptured`);
  requireBoolean(agentCapacity.laneMemoryUpdated, `${id}.agentCapacity.laneMemoryUpdated`);
  requireBoolean(agentCapacity.closeAgentsAttempted, `${id}.agentCapacity.closeAgentsAttempted`);
  requireBoolean(agentCapacity.retrySpawnScheduled, `${id}.agentCapacity.retrySpawnScheduled`);
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function requireNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
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

function parseScenarios(args) {
  const inputIndex = args.indexOf('--input');
  if (inputIndex === -1) return swarmScoreFixtures;
  const rawPath = args[inputIndex + 1];
  if (!rawPath) throw new Error('--input requires a JSON path');
  const input = JSON.parse(readFileSync(resolve(rawPath), 'utf8'));
  const scenarios = Array.isArray(input) ? input : [input];
  return scenarios.map(assertShape);
}

export function runSwarmRuntimeScoreCommand(args = process.argv.slice(3)) {
  const asJson = args.includes('--json');
  let scenarios;
  try {
    scenarios = parseScenarios(args);
  } catch (error) {
    console.error(`swarm-runtime-score: ${error.message}`);
    return 2;
  }

  const scores = scenarios.map(scoreSwarmScenario);
  const failures = [];
  scenarios.forEach((scenario, index) => {
    const score = scores[index];
    if (scenario.expectedVerdict && score.verdict !== scenario.expectedVerdict) {
      failures.push(`${scenario.id}: expected ${scenario.expectedVerdict}, got ${score.verdict}`);
    }
    if (scenario.minScore !== undefined && score.score < scenario.minScore) {
      failures.push(`${scenario.id}: expected score >= ${scenario.minScore}, got ${score.score}`);
    }
    if (!scenario.expectedVerdict && score.verdict === 'fail_false_swarm') {
      failures.push(`${scenario.id}: ${score.verdict} score=${score.score}`);
    }
  });

  if (asJson) {
    console.log(JSON.stringify({ scenarios, scores, failures }, null, 2));
  } else {
    console.log(`swarm-runtime-score: ${scores.length} scenario(s)`);
    scores.forEach((score) => {
      const label = score.verdict === 'fail_false_swarm' ? 'FAIL_EXPECTED' : 'PASS';
      console.log(`${label} ${score.id}: score=${score.score} verdict=${score.verdict}`);
      if (score.hardBlockers.length > 0) console.log(`  blockers=${score.hardBlockers.join(',')}`);
    });
    if (failures.length === 0) {
      console.log('PASS - swarm 9/10 fixtures hold.');
    } else {
      console.error('FAIL - swarm runtime regression detected:');
      failures.forEach((failure) => console.error(`  - ${failure}`));
    }
  }

  return failures.length === 0 ? 0 : 1;
}
