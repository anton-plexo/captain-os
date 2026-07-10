import type {
  ContextBudgetRow,
  CriticalPathMovement,
  LabInput,
  OfficerLane,
  OperatingSafetyArtifact,
  Sailor,
  UserIntentRow,
  VisibleAcceptanceRow,
} from './schema'

const spanOfControlLimit = 5

function bool(value: string | undefined): boolean {
  return /^(true|yes|1)$/i.test(value ?? '')
}

function numberValue(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function splitList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[;\n|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function criticalPathMovementFrom(value: string | undefined): CriticalPathMovement {
  const normalized = (value ?? '').trim()
  const allowed: CriticalPathMovement[] = [
    'moves_original_goal',
    'adjacent_planning_only',
    'evidence_only',
    'blocked_waiting_owner',
    'unknown',
  ]
  return allowed.includes(normalized as CriticalPathMovement) ? normalized as CriticalPathMovement : 'unknown'
}

function sailorFrom(value: string | undefined, fallback: Sailor): Sailor {
  const normalized = (value ?? '').trim()
  const allowed: Sailor[] = [
    'Captain',
    'StarPom',
    'Context',
    'QA',
    'Surface',
    'CMS',
    'Runtime',
    'Security',
    'Shipping',
    'Knowledge',
    'JudgePool',
  ]
  return allowed.includes(normalized as Sailor) ? normalized as Sailor : fallback
}

function buildUserIntentRows(input: LabInput, missingVisibleObjects: string[]): UserIntentRow[] {
  const explicitRows = splitList(input.context.userIntentRows)
  if (explicitRows.length > 0) {
    return explicitRows.map((row, index) => ({
      id: `USR-${String(index + 1).padStart(3, '0')}`,
      userSaid: row,
      targetSurface: input.context.targetSurface ?? null,
      visibleObject: input.context.visibleObject ?? missingVisibleObjects[index] ?? null,
      requiredChange: input.context.requiredChange ?? row,
      askIfAmbiguous: bool(input.context.askIfAmbiguous),
      status: missingVisibleObjects.length > index ? 'open' : 'closed',
    }))
  }

  return missingVisibleObjects.map((object, index) => ({
    id: `USR-${String(index + 1).padStart(3, '0')}`,
    userSaid: input.task,
    targetSurface: input.context.targetSurface ?? null,
    visibleObject: object,
    requiredChange: input.context.requiredChange ?? `Close visible acceptance for ${object}`,
    askIfAmbiguous: bool(input.context.askIfAmbiguous),
    status: 'open',
  }))
}

function buildVisualRows(input: LabInput, missingVisibleObjects: string[]): VisibleAcceptanceRow[] {
  const closedObjects = splitList(input.context.closedVisibleObjects)
  const allObjects = [...new Set([...splitList(input.context.visibleAcceptanceObjects), ...missingVisibleObjects, ...closedObjects])]
  return allObjects.map((object, index) => ({
    id: `VIS-${String(index + 1).padStart(3, '0')}`,
    visibleObject: object,
    expectedState: input.context.expectedVisibleState ?? 'visible acceptance row closed',
    currentState: missingVisibleObjects.includes(object)
      ? input.context.currentVisibleState ?? 'missing or mismatched'
      : input.context.currentVisibleState ?? null,
    evidenceRequired: ['fresh screenshot or explicit visual proof', 'user-request/result diff'],
    status: missingVisibleObjects.includes(object) ? 'open' : 'closed',
  }))
}

function defaultOfficerLanes(): OfficerLane[] {
  return [
    {
      id: 'intent-scope',
      owner: 'Captain',
      scope: ['user intent rows', 'scope boundaries', 'direct question handling'],
      maxChildren: spanOfControlLimit,
      contextBudgetRefs: ['captain-summary', 'user-intent-rows'],
    },
    {
      id: 'context-rag',
      owner: 'Context',
      scope: ['source docs', 'freshness', 'context radius'],
      maxChildren: spanOfControlLimit,
      contextBudgetRefs: ['source-pack', 'freshness-pack'],
    },
    {
      id: 'domain-surface',
      owner: 'Surface',
      scope: ['visible acceptance objects', 'precedent', 'UI/product inspection surface'],
      maxChildren: spanOfControlLimit,
      contextBudgetRefs: ['visual-pack', 'precedent-pack'],
    },
    {
      id: 'execution',
      owner: 'Runtime',
      scope: ['implementation lanes', 'runtime artifacts', 'fixture execution'],
      maxChildren: spanOfControlLimit,
      contextBudgetRefs: ['execution-pack'],
    },
    {
      id: 'starpom-acceptance',
      owner: 'StarPom',
      scope: ['final claim gate', 'user request diff', 'accepted-risk boundary'],
      maxChildren: spanOfControlLimit,
      contextBudgetRefs: ['acceptance-pack', 'evidence-pack'],
    },
  ]
}

function buildOfficerLanes(input: LabInput): OfficerLane[] {
  const explicit = splitList(input.context.officerLanes)
  if (explicit.length === 0) return []
  return explicit.map((lane, index) => {
    const [ownerText, scopeText] = lane.includes(':') ? lane.split(/:(.+)/) : ['Captain', lane]
    const scopedItems = splitList(scopeText)
    return {
      id: `officer-${index + 1}`,
      owner: sailorFrom(ownerText, 'Captain'),
      scope: scopedItems.length > 0 ? scopedItems : [lane.trim()],
      maxChildren: spanOfControlLimit,
      contextBudgetRefs: [`officer-${index + 1}-budget`],
    }
  })
}

function buildContextBudgetRows(input: LabInput, officerLanes: OfficerLane[], broadcastViolation: boolean): ContextBudgetRow[] {
  const lanes = officerLanes.length > 0 ? officerLanes : defaultOfficerLanes()
  return lanes.map((lane) => ({
    laneId: lane.id,
    owner: lane.owner,
    allowedContext: splitList(input.context.allowedContext).length > 0
      ? splitList(input.context.allowedContext)
      : lane.contextBudgetRefs,
    forbiddenContext: splitList(input.context.forbiddenContext).length > 0
      ? splitList(input.context.forbiddenContext)
      : ['full chat history', 'all docs broadcast', 'unscoped screenshots outside lane'],
    tokenBudgetHint: input.context.tokenBudgetHint ?? 'scoped packet only; no broadcast context',
    violation: broadcastViolation || splitList(input.context.contextBudgetViolations).includes(lane.id),
  }))
}

export function buildOperatingSafety(input: LabInput): OperatingSafetyArtifact {
  const text = `${input.title}\n${input.task}\n${input.tags.join(' ')}\n${Object.values(input.context).join(' ')}`.toLowerCase()
  const directQuestionDetected = bool(input.context.directQuestion) || hasAny(text, [
    /(^|\s)ответь(те)?($|\s|[?!.:,;])/,
    /(^|\s)почему($|\s|[?!.:,;])/,
    /какого\s+х/,
    /что\s+было\s+непонятно/,
    /не\s+понимаешь/,
    /why\s+(did|didn|was|is|are)\b/,
    /what\s+was\s+unclear/,
    /answer\s+(me|first)/,
  ])
  const angerIncidentMode = bool(input.context.angerIncidentMode) || hasAny(text, [
    /болван/,
    /кретин/,
    /долб/,
    /бляд/,
    /проеб/,
    /нахер/,
    /ху[йяе]/,
  ])
  const answerRequiredBeforeAction = directQuestionDetected || angerIncidentMode || bool(input.context.answerRequiredBeforeAction)
  const missingVisibleObjects = splitList(input.context.missingVisibleObjects)
  const testsGreenButVisibleOpen = bool(input.context.testsGreen) && (missingVisibleObjects.length > 0 || bool(input.context.visibleAcceptanceOpen))
  const visualAcceptanceRows = buildVisualRows(input, missingVisibleObjects)
  const userIntentRows = buildUserIntentRows(input, missingVisibleObjects)
  const activeRowCount = numberValue(input.context.activeRowCount) ?? Math.max(userIntentRows.length, visualAcceptanceRows.length)
  const officerLanes = buildOfficerLanes(input)
  const officerHierarchyRequired = activeRowCount > spanOfControlLimit || bool(input.context.officerHierarchyRequired)
  const officerHierarchyPresent = officerLanes.length > 0 || bool(input.context.officerHierarchyPresent)
  const spanOfControlViolation = activeRowCount > spanOfControlLimit && !officerHierarchyPresent
  const broadcastViolation = bool(input.context.broadcastContext) || bool(input.context.contextBroadcast) || splitList(input.context.contextBudgetViolations).length > 0
  const contextBudgetRows = buildContextBudgetRows(input, officerLanes, broadcastViolation)
  const contextBudgetViolations = contextBudgetRows.filter((row) => row.violation).map((row) => row.laneId)
  const requestResultMismatch = bool(input.context.userRequestResultMismatch) ||
    Boolean(input.context.userInspectionObject && input.context.agentAcceptanceObject && input.context.userInspectionObject !== input.context.agentAcceptanceObject)
  const productionOpeningGoalDetected = bool(input.context.productionOpeningGoal) ||
    bool(input.context.mainGoalProductionOpeningIndexing) ||
    hasAny(text, [
      /production|prod\b|deploy|opening|indexing|indexed|crawlable|crawler|google|gsc|search console|rampify|sitemap/,
      /продакшн|депло[йя]|индексац|индексир|гугл|кроул|sitemap|карта сайта/,
    ])
  const operatorDecisionRequired = bool(input.context.operatorDecisionRequired) ||
    hasAny(text, [
      /operator_decision_required/,
      /owner decision required/,
      /operator decision required/,
      /decision required/,
      /anton.*choose|choose.*anton/,
      /нуж(ен|на).*выбор.*(anton|антон|owner|operator|оператор)/,
      /решени[ея].*(anton|антон|owner|operator|оператор)/,
    ])
  const ownerChoices = splitList(input.context.ownerChoices)
  const criticalPathMovement = criticalPathMovementFrom(input.context.criticalPathMovement)
  const adjacentPlanningSlicesAfterBlocker = numberValue(input.context.adjacentPlanningSlicesAfterBlocker ?? input.context.planningOnlyPacketsAfterBlocker) ?? 0
  const hoursAfterBlocker = numberValue(input.context.hoursAfterBlocker) ?? 0
  const adjacentPlanningContinues = bool(input.context.adjacentPlanningContinues) ||
    criticalPathMovement === 'adjacent_planning_only' ||
    criticalPathMovement === 'evidence_only'
  const timeboxedBypassRequested = bool(input.context.timeboxedBypassRequested)
  const explicitTimeboxedBypass = timeboxedBypassRequested && bool(input.context.ownerVisibleWarning)
  const seoHttp200OnlySignal = bool(input.context.http200Only) ||
    hasAny(text, [
      /http\s*200.*(success|green|ready|pass|ок|успех)/,
      /status_200_false_green/,
      /200.*false[-_ ]green/,
    ])
  const seoParityPresent = bool(input.context.rawRenderedCanonicalRobotsH1SitemapParity) ||
    (
      bool(input.context.rawHtmlProof) &&
      bool(input.context.renderedHtmlProof) &&
      bool(input.context.canonicalProof) &&
      bool(input.context.robotsProof) &&
      bool(input.context.h1Proof) &&
      bool(input.context.sitemapProof)
    )
  const seoParityMissing = bool(input.context.missingRawRenderedCanonicalRobotsH1SitemapParity) ||
    (seoHttp200OnlySignal && !seoParityPresent)
  const claimedSwarm = bool(input.context.claimedSwarm) || hasAny(text, [/swarm|parallel lane|parallel work|multi[- ]lane|роев|параллель/])
  const swarmRuntimeScore = numberValue(input.context.swarmRuntimeScore ?? input.context.swarmScore)
  const captainImplementationShare = numberValue(input.context.captainImplementationShare)
  const productiveCriticalLaneArtifacts = numberValue(input.context.productiveCriticalLaneArtifacts ?? input.context.activeNonReviewCriticalLaneArtifacts)
  const freshLaneOutputs = numberValue(input.context.freshLaneOutputs)
  const activeLaneCount = numberValue(input.context.activeLaneCount)
  const nextPacketState = (input.context.nextPacketState ?? '').trim() || null
  const freshClaudeReviewLane = bool(input.context.freshClaudeReviewLane) || bool(input.context.claudeReviewFresh)
  const freshStarPomLane = bool(input.context.freshStarPomLane) || bool(input.context.starpomFresh)
  const prBoundSwarm = bool(input.context.prBound) || bool(input.context.prBoundSwarm) || hasAny(text, [/pr[- ]?bound|pull request|ready_for_pr|ready for pr/])
  const officerSplitPresent = officerHierarchyPresent || bool(input.context.officerSplit) || bool(input.context.officerSplitPresent)
  const openingIndexingEvidenceLaneProof = bool(input.context.openingIndexingEvidenceLaneProof) ||
    bool(input.context.exactOpeningEvidenceLane) ||
    seoParityPresent
  const p11hScoreGateActive = bool(input.context.p11hSwarmScoreGate) ||
    bool(input.context.enforceSwarmScore) ||
    swarmRuntimeScore !== null ||
    captainImplementationShare !== null ||
    productiveCriticalLaneArtifacts !== null ||
    freshLaneOutputs !== null ||
    activeLaneCount !== null ||
    nextPacketState !== null
  const oneShotReviewersOnly = bool(input.context.oneShotReviewersOnly)
  const missingLaneMemory = bool(input.context.missingLaneMemory)
  const sequentialAgentWait = bool(input.context.sequentialAgentWait)
  const captainAsPrimaryWorker = bool(input.context.captainAsPrimaryWorker)
  const falseParallelismNoPersistentLanes = claimedSwarm && (
    oneShotReviewersOnly ||
    missingLaneMemory ||
    sequentialAgentWait ||
    captainAsPrimaryWorker
  )
  const blocks: string[] = []

  if (answerRequiredBeforeAction) blocks.push('stop_and_answer_required')
  if (angerIncidentMode) blocks.push('anger_incident_answer_required')
  if (missingVisibleObjects.length > 0 || testsGreenButVisibleOpen) blocks.push('visible_acceptance_missing')
  if (requestResultMismatch) blocks.push('user_request_result_mismatch')
  if (spanOfControlViolation) blocks.push('span_of_control_violation')
  if (officerHierarchyRequired && !officerHierarchyPresent) blocks.push('officer_hierarchy_missing')
  if (contextBudgetViolations.length > 0) blocks.push('context_budget_violation')
  if (productionOpeningGoalDetected && operatorDecisionRequired) blocks.push('operator_decision_required_interrupt')
  if (operatorDecisionRequired && (
    criticalPathMovement === 'unknown' ||
    adjacentPlanningContinues ||
    (adjacentPlanningSlicesAfterBlocker > 0 && criticalPathMovement !== 'moves_original_goal')
  )) {
    blocks.push('critical_path_vs_adjacent_work')
  }
  if (operatorDecisionRequired && !explicitTimeboxedBypass && (adjacentPlanningSlicesAfterBlocker > 2 || hoursAfterBlocker > 2)) {
    blocks.push('blocked_but_continuing_budget')
  }
  if (productionOpeningGoalDetected && seoHttp200OnlySignal && seoParityMissing) blocks.push('seo_http_200_false_green_parity_missing')
  if (falseParallelismNoPersistentLanes) blocks.push('false_parallelism_no_persistent_lanes')
  if (claimedSwarm && missingLaneMemory) blocks.push('lane_memory_missing')
  if (claimedSwarm && p11hScoreGateActive && swarmRuntimeScore !== null && swarmRuntimeScore < 9) blocks.push('swarm_runtime_score_below_9')
  if (claimedSwarm && p11hScoreGateActive && captainImplementationShare !== null && captainImplementationShare > 0.5) blocks.push('captain_implementation_share_too_high')
  if (claimedSwarm && p11hScoreGateActive && productiveCriticalLaneArtifacts !== null && productiveCriticalLaneArtifacts < 2) blocks.push('insufficient_productive_critical_lanes')
  if (claimedSwarm && p11hScoreGateActive && freshLaneOutputs !== null && freshLaneOutputs === 0) blocks.push('no_fresh_lane_output')
  if (claimedSwarm && p11hScoreGateActive && prBoundSwarm && !freshClaudeReviewLane) blocks.push('missing_claude_review_lane')
  if (claimedSwarm && p11hScoreGateActive && !freshStarPomLane) blocks.push('missing_starpom_lane')
  if (claimedSwarm && p11hScoreGateActive && nextPacketState !== null && !['started', 'scheduled'].includes(nextPacketState)) blocks.push('next_packet_not_bound')
  if (claimedSwarm && p11hScoreGateActive && activeLaneCount !== null && activeLaneCount > 5 && !officerSplitPresent) blocks.push('span_of_control_over_five')
  if (claimedSwarm && p11hScoreGateActive && criticalPathMovement === 'adjacent_planning_only' && bool(input.context.criticalPathIdle)) blocks.push('adjacent_work_over_idle_critical_path')
  if (claimedSwarm && p11hScoreGateActive && productionOpeningGoalDetected && !openingIndexingEvidenceLaneProof) blocks.push('opening_indexing_evidence_missing')

  const operatorChoicesText = ownerChoices.length >= 2 && ownerChoices.length <= 3
    ? ` Choices: ${ownerChoices.join(' | ')}.`
    : ' Name exactly 2-3 owner choices before any continuation.'

  return {
    directQuestionDetected,
    answerRequiredBeforeAction,
    angerIncidentMode,
    productionOpeningGoalDetected,
    operatorDecisionRequired,
    ownerChoices,
    criticalPathMovement,
    adjacentPlanningSlicesAfterBlocker,
    hoursAfterBlocker,
    timeboxedBypassRequested,
    seoHttp200OnlySignal,
    seoParityMissing,
    claimedSwarm,
    p11hScoreGateActive,
    swarmRuntimeScore,
    captainImplementationShare,
    productiveCriticalLaneArtifacts,
    freshLaneOutputs,
    activeLaneCount,
    nextPacketState,
    userIntentRows,
    visualAcceptanceRows,
    missingVisibleObjects,
    activeRowCount,
    spanOfControlLimit,
    spanOfControlViolation,
    officerHierarchyRequired,
    officerHierarchyPresent,
    officerLanes: officerHierarchyPresent ? officerLanes : [],
    contextBudgetRows,
    contextBudgetViolations,
    blocks: [...new Set(blocks)],
    nextAction: answerRequiredBeforeAction
      ? 'Answer the direct user question first; no edits, tool calls, or repair execution until the answer exists.'
      : blocks.includes('operator_decision_required_interrupt')
        ? `Stop the critical path and request an Anton/operator decision before adjacent planning continues.${operatorChoicesText}`
      : blocks.includes('blocked_but_continuing_budget')
        ? 'StarPom red flag: more than two planning-only packets or more than two hours elapsed after a major blocker without owner decision.'
      : blocks.includes('seo_http_200_false_green_parity_missing')
        ? 'Do not count HTTP 200 as SEO/prod success; collect raw/rendered/canonical/robots/H1/sitemap parity evidence.'
      : blocks.includes('swarm_runtime_score_below_9')
        ? 'Downgrade swarm claim or repair the packet until the P11H swarm runtime score is at least 9/10.'
      : blocks.length > 0
        ? 'Resolve operating-safety blocks before StarPom/final claim.'
        : 'Operating safety has no P0 blocks.',
  }
}

export function defaultOperatingSafetyOfficerLanes(): OfficerLane[] {
  return defaultOfficerLanes()
}
