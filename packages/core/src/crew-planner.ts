import { defaultOperatingSafetyOfficerLanes } from './operating-safety'
import type {
  ClassificationArtifact,
  CrewPlanArtifact,
  DeliveryCalibrationArtifact,
  LabInput,
  LaneState,
  OperatingSafetyArtifact,
  ProjectStage,
  Sailor,
} from './schema'

// Intentional local de-dup builder: `list` is always a fresh array owned by the
// caller (`required`/`optional` in planCrew) — never an external/shared reference.
// Kept mutating to avoid 20+ reassignment sites; do NOT pass caller-owned arrays in.
function add(list: Sailor[], sailor: Sailor): void {
  if (!list.includes(sailor)) list.push(sailor)
}

function tierNumber(tier: ClassificationArtifact['complexityTier']): number {
  return Number(tier.slice(1))
}

function laneIdFor(sailor: Sailor): string {
  return sailor.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function ownerRegistryFor(sailor: Sailor): string {
  if (sailor === 'Captain') return 'captain-codex'
  if (sailor === 'StarPom') return 'starpom'
  return `lane-${laneIdFor(sailor)}`
}

const deliveryStagePolicies: Record<ProjectStage, Omit<DeliveryCalibrationArtifact, 'projectStage' | 'outcomeUnit' | 'gateCommand' | 'blocks' | 'nextAction' | 'currentCycle'>> = {
  discovery: {
    deliveryShareTarget: 0.15,
    qualityShareTarget: 0.35,
    safetyShareTarget: 0.2,
    processBudgetMax: 0.55,
    maxPlanningOnlyCycles: 3,
    minClosedOutcomesPerCycle: 0,
    namedDeliverableRequired: false,
  },
  planning: {
    deliveryShareTarget: 0.25,
    qualityShareTarget: 0.35,
    safetyShareTarget: 0.2,
    processBudgetMax: 0.45,
    maxPlanningOnlyCycles: 2,
    minClosedOutcomesPerCycle: 0,
    namedDeliverableRequired: false,
  },
  delivery: {
    deliveryShareTarget: 0.5,
    qualityShareTarget: 0.25,
    safetyShareTarget: 0.15,
    processBudgetMax: 0.25,
    maxPlanningOnlyCycles: 1,
    minClosedOutcomesPerCycle: 1,
    namedDeliverableRequired: true,
  },
  launch_opening: {
    deliveryShareTarget: 0.35,
    qualityShareTarget: 0.25,
    safetyShareTarget: 0.3,
    processBudgetMax: 0.3,
    maxPlanningOnlyCycles: 0,
    minClosedOutcomesPerCycle: 1,
    namedDeliverableRequired: true,
  },
  incident_repair: {
    deliveryShareTarget: 0.2,
    qualityShareTarget: 0.2,
    safetyShareTarget: 0.4,
    processBudgetMax: 0.35,
    maxPlanningOnlyCycles: 0,
    minClosedOutcomesPerCycle: 0,
    namedDeliverableRequired: false,
  },
  maintenance: {
    deliveryShareTarget: 0.35,
    qualityShareTarget: 0.3,
    safetyShareTarget: 0.2,
    processBudgetMax: 0.35,
    maxPlanningOnlyCycles: 2,
    minClosedOutcomesPerCycle: 0,
    namedDeliverableRequired: false,
  },
}

function inferProjectStage(
  input: LabInput,
  classification: ClassificationArtifact,
  operatingSafety?: OperatingSafetyArtifact,
): ProjectStage {
  const explicit = input.context.projectStage ?? input.context.stage
  if (explicit && explicit in deliveryStagePolicies) return explicit as ProjectStage
  if (classification.intentMode === 'incident_repair' || operatingSafety?.operatorDecisionRequired) return 'incident_repair'
  if (operatingSafety?.productionOpeningGoalDetected || operatingSafety?.seoHttp200OnlySignal || operatingSafety?.seoParityMissing) return 'launch_opening'

  const text = `${input.task} ${input.title} ${input.tags.join(' ')} ${Object.values(input.context).join(' ')}`.toLowerCase()
  if (/deploy|launch|opening|indexing|gsc|rampify|sitemap|robots|canonical|production|prod|submit|откры|индексац/.test(text)) return 'launch_opening'
  if (/page closure|ready_with_evidence|not_ready_with_exact_blocker|deliver|delivery|ship|implement|fix|build|route|url|page|cohort|закрыть|страниц|готов/.test(text)) return 'delivery'
  if (/plan|planning|strategy|acceptance|matrix|brief|category|phase|roadmap|план|фаз|категор/.test(text)) return 'planning'
  if (/discover|research|audit|inventory|scan|map|исслед|аудит|инвентар/.test(text)) return 'discovery'
  return classification.complexityTier === 'T0' || classification.complexityTier === 'T1' ? 'maintenance' : 'delivery'
}

function buildDeliveryCalibration(
  input: LabInput,
  classification: ClassificationArtifact,
  operatingSafety?: OperatingSafetyArtifact,
): DeliveryCalibrationArtifact {
  const projectStage = inferProjectStage(input, classification, operatingSafety)
  const policy = deliveryStagePolicies[projectStage]
  const blocks = [
    ...(operatingSafety?.blocks.includes('operator_decision_required_interrupt') ? ['operator_decision_required_interrupt'] : []),
    ...(operatingSafety?.criticalPathMovement === 'adjacent_planning_only' && policy.maxPlanningOnlyCycles === 0 ? ['adjacent_planning_not_delivery'] : []),
  ]
  const outcomeUnit = projectStage === 'delivery' || projectStage === 'launch_opening'
    ? 'named deliverable/page/cohort closed to ready, not_ready_with_exact_blocker, or blocked_owner_decision_required'
    : projectStage === 'incident_repair'
      ? 'named blocker closed or owner decision interrupt raised'
      : 'named learning/spec/evidence artifact with bounded next delivery packet'

  return {
    projectStage,
    outcomeUnit,
    ...policy,
    gateCommand: 'captain-os delivery-calibration',
    blocks,
    nextAction: policy.namedDeliverableRequired
      ? 'Name the next 1-3 deliverables/pages/cohorts and close each to ready, not-ready-with-blocker, or owner-decision-required.'
      : 'Keep planning/process inside the stage budget and bind the next packet to a named deliverable or blocker.',
    currentCycle: {
      id: `unstarted_${projectStage}_cycle`,
      processShare: 0,
      deliveryShare: 0,
      qualityShare: 0,
      safetyShare: 0,
      namedDeliverables: [],
      closedOutcomes: [],
      planningOnlyCycles: 0,
      falseGreenRisk: ['launch_opening', 'incident_repair'].includes(projectStage),
      safetyEvidenceRefs: [],
      qualityEvidenceRefs: [],
      ownerDecisionRequired: false,
      adjacentWorkActive: false,
      nextActionBound: false,
      reportingAttachedToOutcomes: false,
    },
  }
}

function buildLaneState(
  sailor: Sailor,
  index: number,
  executionModel: CrewPlanArtifact['executionModel'],
  input: LabInput,
  writeScopes: string[],
  forbiddenScopes: string[],
): LaneState {
  const laneId = sailor === 'Captain' ? 'captain-orchestration' : laneIdFor(sailor)
  const readOnly = sailor === 'StarPom' || sailor === 'QA' || sailor === 'JudgePool'
  return {
    laneId,
    title: `${sailor} lane`,
    owner: sailor,
    ownerRegistryId: ownerRegistryFor(sailor),
    runtimeId: sailor === 'Captain' ? 'codex' : null,
    laneMode: sailor === 'StarPom'
      ? 'standing_review'
      : readOnly
        ? 'read_only_judge'
        : executionModel === 'parallel_lane_swarm'
          ? 'persistent_owner'
          : 'temporary_contractor',
    status: index === 0 || executionModel === 'parallel_lane_swarm' ? 'active' : 'queued',
    assignmentId: `ASSIGN-${input.id || input.fixtureId || 'TASK'}-${laneId}`.toUpperCase(),
    heartbeatAt: null,
    staleAfterMinutes: 1440,
    allowedScope: writeScopes,
    forbiddenScope: forbiddenScopes,
    locks: [],
    dependencies: [],
    conflictsWith: [],
    contextRefs: input.sourceDocs,
    contextBudgetRefs: [`${laneId}-context-budget`],
    laneMemoryRef: `.captain-os/task-spine.yaml#laneMemory.${laneId}`,
    acceptanceRows: [input.context.acceptanceObject ?? 'Lane acceptance rows must be explicit before execution.'],
    evidenceOwed: readOnly
      ? ['verdict artifact or evidence review note']
      : ['changed files or lane output artifact', 'test/evidence refs for acceptance rows'],
    evidenceRefs: [],
    lastDelta: '',
    decisions: [],
    openQuestions: [],
    blockers: [],
    nextAction: executionModel === 'parallel_lane_swarm'
      ? 'Execute or review the lane packet without waiting on unrelated lanes.'
      : 'Execute the single bounded lane or report why it is blocked.',
    closeoutCriteria: [
      'Lane delta merged into the task spine.',
      'Evidence refs attached or missing evidence recorded as a blocker.',
    ],
    transferCriteria: [
      'Next launch receives lane memory and current blockers.',
    ],
  }
}

export function planCrew(
  input: LabInput,
  classification: ClassificationArtifact,
  operatingSafety?: OperatingSafetyArtifact,
): CrewPlanArtifact {
  const required: Sailor[] = ['Captain']
  const optional: Sailor[] = []
  const judgePool: string[] = []
  const subcrewPermissions: string[] = []
  const writeScopes = ['.ship/lab/runs/<run-id> only']
  const forbiddenScopes = [
    'src/**',
    'docs/process/** outside Captain OS Lab fixtures during shadow run',
    '.ship/repair-ledger.json',
    'GitHub/Notion state',
  ]

  if (classification.intentMode === 'copy_exact') {
    add(required, 'Surface')
    add(required, 'QA')
    add(required, 'Context')
    subcrewPermissions.push('1-3 read-only fidelity judges allowed; no creative implementation sailor')
  }

  if (classification.intentMode === 'preserve_and_repair') {
    add(required, 'Context')
    add(required, 'QA')
    subcrewPermissions.push('1-5 read-only repair critics depending on accepted baseline ambiguity')
  }

  if (classification.intentMode === 'system_refactor') {
    add(required, 'Context')
    add(required, 'Runtime')
    add(required, 'QA')
    add(required, 'Shipping')
    add(required, 'Knowledge')
    judgePool.push('architecture judge', 'runtime contract judge', 'blast-radius judge')
    subcrewPermissions.push('3-5 independent scouts/judges before implementation; disjoint write scopes later')
  }

  if (classification.intentMode === 'incident_repair') {
    add(required, 'StarPom')
    add(required, 'QA')
    add(required, 'Context')
    add(required, 'Knowledge')
    add(required, 'Shipping')
    judgePool.push('root-cause judge', 'evidence judge', 'recurrence judge', 'operator-burden judge', 'domain judge')
    subcrewPermissions.push('5-angle failure panel allowed before repair execution')
  }

  if (classification.intentMode === 'strategy_design') {
    add(required, 'Context')
    add(required, 'Knowledge')
    add(required, 'StarPom')
    add(optional, 'JudgePool')
    judgePool.push('principle engineer', 'CTO architect', 'Head of AI', 'AI coding expert', 'process auditor')
    subcrewPermissions.push('judge synthesis allowed; implementation sailors only after accepted issue/spec')
  }

  const text = `${input.task} ${input.tags.join(' ')} ${Object.values(input.context).join(' ')}`.toLowerCase()
  if (/\bcms\b|notion|source|persistence|publish|save|reload|сохран|публикац/.test(text)) add(required, 'CMS')
  if (/public|studio|auth|security|private|protected|bundle|chunk|безопасн/.test(text)) add(required, 'Security')
  if (/\bpr\b|branch|merge|deploy|ci|dirty worktree|ветк/.test(text)) add(required, 'Shipping')
  if (classification.finalClaimGateRequired) add(required, 'StarPom')
  if (classification.hardWorkRequired || classification.octopusRequired) add(required, 'StarPom')
  if (operatingSafety?.blocks.length) add(required, 'StarPom')
  if (operatingSafety?.officerHierarchyRequired) {
    add(required, 'Context')
    add(required, 'QA')
    add(required, 'Knowledge')
    subcrewPermissions.push('Officer hierarchy required before execution because active rows exceed Captain span-of-control')
  }

  if (classification.complexityTier === 'T1' && required.length === 1) {
    add(optional, 'QA')
  }

  const tier = tierNumber(classification.complexityTier)
  const answerFirstBlock = Boolean(operatingSafety?.answerRequiredBeforeAction)
  const independentLaneCount = required.filter((sailor) => sailor !== 'Captain').length
  const executionModel: CrewPlanArtifact['executionModel'] = classification.captainMode === 'direct_answer'
    ? 'direct_answer'
    : tier >= 2 && !answerFirstBlock && independentLaneCount >= 2
      ? 'parallel_lane_swarm'
      : 'single_lane'
  const parallelLaneTarget = executionModel === 'parallel_lane_swarm'
    ? Math.min(4, Math.max(2, independentLaneCount))
    : 0
  const laneMemoryRequired = executionModel !== 'direct_answer' && tier >= 2
  const falseParallelismBlocks = [
    ...(operatingSafety?.blocks.includes('false_parallelism_no_persistent_lanes') ? ['false_parallelism_no_persistent_lanes'] : []),
    ...(operatingSafety?.blocks.includes('lane_memory_missing') ? ['lane_memory_missing'] : []),
  ]
  const deliveryCalibration = buildDeliveryCalibration(input, classification, operatingSafety)
  const laneOwners = executionModel === 'direct_answer'
    ? []
    : executionModel === 'parallel_lane_swarm'
      ? required.filter((sailor) => sailor !== 'Captain')
      : required.filter((sailor) => sailor !== 'Captain').slice(0, 1)
  const laneStates = laneOwners.map((sailor, index) => buildLaneState(sailor, index, executionModel, input, writeScopes, forbiddenScopes))

  const officerLanes = operatingSafety?.officerHierarchyRequired
    ? operatingSafety.officerLanes.length > 0
      ? operatingSafety.officerLanes
      : defaultOperatingSafetyOfficerLanes()
    : []

  return {
    captainMode: classification.captainMode,
    requiredSailors: required,
    optionalSailors: optional.filter((sailor) => !required.includes(sailor)),
    judgePool: [...new Set(judgePool)],
    starpomRequired: required.includes('StarPom') || classification.complexityTier === 'T3' || classification.complexityTier === 'T4',
    officerLanes,
    contextBudget: operatingSafety?.contextBudgetRows ?? [],
    spanOfControlLimit: 5,
    activeChildCount: operatingSafety?.activeRowCount ?? required.length,
    writeScopes,
    forbiddenScopes,
    subcrewPermissions: subcrewPermissions.length > 0
      ? [...new Set(subcrewPermissions)]
      : ['no subcrew needed for low-risk shadow classification'],
    captainOnlyReason: classification.complexityTier === 'T0' || classification.complexityTier === 'T1'
      ? 'Low-risk shadow classification; no real sailor dispatch in v0.'
      : null,
    executionModel,
    parallelLaneTarget,
    laneMemoryRequired,
    laneStates,
    falseParallelismBlocks,
    deliveryCalibration,
    captainWorkerPolicy: executionModel === 'parallel_lane_swarm'
      ? 'orchestrator_only'
      : 'local_worker_allowed',
    autoDispatch: false,
  }
}
