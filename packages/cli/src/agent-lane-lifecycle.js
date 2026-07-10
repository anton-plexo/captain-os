const DEFAULT_INPUT = {
  automationId: 'live-swarm-watch',
  threadId: 'current-thread',
  program: 'delivery page-closure',
  prRef: 'current PR or issue',
  outcomes: ['named-outcome-1'],
};

export function buildAgentLaneLifecyclePacket(input = DEFAULT_INPUT) {
  const outcomeRows = input.outcomes
    .map((target, index) => {
      const owner = index % 2 === 0 ? 'evidence-lane' : 'repair-lane';
      return `- target=${target};type=outcome;status=not_ready_with_exact_blocker;issueRefs=${input.prRef};reportRefs=${input.prRef};evidenceRefs=pending;owner=${owner};nextAction=attach exact evidence or blocker`;
    })
    .join('\n');

  const packet = [
    'P11L_LIVE_MONITOR_CORRECTIVE_PACKET',
    '',
    `Program: ${input.program}`,
    `Thread: ${input.threadId}`,
    `Automation: ${input.automationId}`,
    '',
    'Hard rule: do not continue broad Captain-local implementation after `agent thread limit reached`.',
    '',
    'Before next product work:',
    '1. Audit active/stale/finished agent lanes.',
    '2. Capture closeout delta for each finished lane: assignment id, artifacts, outcome moved, evidence produced, evidence owed, blocker, next owner.',
    '3. Update `.captain-os/task-spine.yaml` laneMemory and currentLanes.swarmCapacity.',
    '4. Close/archive recyclable finished agent threads only after lane memory is updated.',
    '5. Retry the next bounded lane spawn. If retry fails, label the slice `allowed_not_swarm` and keep Captain work narrow.',
    '',
    'Next execution unit: outcome closure, not phase/process mode.',
    '',
    'Required outcomeRows:',
    outcomeRows,
    '',
    'Required lanes:',
    '- evidence-lane: exact raw/rendered/runtime evidence for named outcomes.',
    '- repair-lane: only fixes exact blockers found by evidence lane.',
    '- review-lane: required before PR-ready/merge/readiness wording.',
    '- starpom-lane: checks P11H/P11K/P11L, claim ceiling, and detached-reporting risk.',
    '',
    'Claim ceiling:',
    '- No production/opening/indexing/distribution/search-visibility success claim without exact evidence.',
    '- `ready_with_evidence` only after evidence refs attach to each outcome row.',
    '- Issue comments and reports are process work unless attached to these outcome rows.',
    '',
    'Closeout required:',
    '- table of named outcomes with status, evidence refs, issue refs, owner, next action.',
    '- swarm score with agentCapacity fields if thread limit was encountered.',
    '- delivery calibration verdict; process-only updates cannot be counted as closure.',
  ].join('\n');

  const checks = {
    hasP11L: packet.includes('P11L_LIVE_MONITOR_CORRECTIVE_PACKET'),
    hasCloseRecycle: packet.includes('Close/archive recyclable') && packet.includes('Retry the next bounded lane spawn'),
    hasOutcomeRows: input.outcomes.every((target) => packet.includes(`target=${target}`)),
    hasClaimCeiling: packet.includes('No production/opening/indexing/distribution/search-visibility success claim'),
    outcomeCount: input.outcomes.length,
  };

  return {
    input,
    packet,
    checks,
    valid:
      checks.hasP11L &&
      checks.hasCloseRecycle &&
      checks.hasOutcomeRows &&
      checks.hasClaimCeiling &&
      checks.outcomeCount > 0,
  };
}

export function runAgentLaneLifecycleCommand(args = []) {
  const result = buildAgentLaneLifecyclePacket(parseArgs(args));
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.packet);
    console.log('');
    console.log(result.valid ? 'PASS - P11L live monitor packet is bounded and outcome-bound.' : 'FAIL - P11L live monitor packet is incomplete.');
  }
  return result.valid ? 0 : 1;
}

function parseArgs(args) {
  return {
    automationId: stringArg(args, '--automation-id', DEFAULT_INPUT.automationId),
    threadId: stringArg(args, '--thread-id', DEFAULT_INPUT.threadId),
    program: stringArg(args, '--program', DEFAULT_INPUT.program),
    prRef: stringArg(args, '--pr', DEFAULT_INPUT.prRef),
    outcomes: listArg(args, '--outcomes', DEFAULT_INPUT.outcomes),
  };
}

function stringArg(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function listArg(args, name, fallback) {
  const raw = stringArg(args, name, fallback.join(','));
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
