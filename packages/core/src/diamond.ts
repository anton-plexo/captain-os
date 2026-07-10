import type {
  ArtifactSpecsArtifact,
  AutonomyEnvelopeArtifact,
  ClassificationArtifact,
  ClosureMatrixArtifact,
  CrewPlanArtifact,
  DiamondArtifacts,
  DiamondRequiredArtifact,
  ExecutionPlanValidationArtifact,
  FindingsLedgerArtifact,
  LabInput,
  PriorityChecklistsArtifact,
  ResearchContextArtifact,
  Sailor,
  AcceptedRiskValidationArtifact,
} from './schema'
import { atLeastDepth } from './schema'
import { buildRouteChecklistCoverage } from './route-checklist'

function bool(value: string | undefined): boolean {
  return value === 'true' || value === 'yes' || value === 'pass'
}

function includesAny(values: string[], needles: string[]): boolean {
  return values.some((value) => needles.includes(value))
}

function sourceType(path: string): ResearchContextArtifact['corpusMap'][number]['type'] {
  if (path.includes('/fixtures/')) return 'fixture'
  if (path.includes('/reports/')) return 'report'
  if (path.includes('docs/process/')) return 'canonical_doc'
  if (path.includes('scripts/') || path.includes('src/')) return 'code'
  if (path.includes('issue')) return 'issue'
  return 'unknown'
}

function diamondRequired(input: LabInput, classification: ClassificationArtifact): DiamondRequiredArtifact {
  const required =
    atLeastDepth(classification.planDepth, 'D3') ||
    classification.intentMode === 'system_refactor' ||
    classification.intentMode === 'incident_repair' ||
    includesAny(input.tags, ['diamond_protocol', 'research_to_execution', 'methodology', 'enterprise'])

  return {
    required,
    reason: required
      ? 'D3+ or repeated/system/methodology work must preserve research depth through executable acceptance.'
      : 'Low-risk task does not need the Diamond Protocol.',
    minimumDepth: required ? 'D3' : 'D0',
    requiredArtifacts: required
      ? [
        'research-context.json',
        'findings-ledger.json',
        'artifact-specs.json',
        'priority-checklists.json',
        'autonomy-envelope.json',
        'execution-plan-validation.json',
        'accepted-risk-validation.json',
        'closure-matrix.json',
      ]
      : [],
    status: required ? 'required' : 'not_required',
  }
}

function buildResearchContext(input: LabInput, required: boolean): ResearchContextArtifact {
  const corpusComplete = !required || bool(input.context.diamondCorpusComplete)
  return {
    corpusMap: input.sourceDocs.map((path) => ({
      path,
      type: sourceType(path),
      freshness: bool(input.context.sourceFreshnessCurrent) ? 'current' : required ? 'unknown' : 'current',
      used: true,
    })),
    excludedSources: input.context.excludedSources ? input.context.excludedSources.split(',').map((item) => item.trim()) : [],
    confidenceLimits: corpusComplete
      ? []
      : ['Research corpus has not been proven fresh, complete, and bounded for execution.'],
    corpusComplete,
  }
}

function buildFindingsLedger(input: LabInput, required: boolean): FindingsLedgerArtifact {
  if (!required) return { findings: [], parkingLot: [] }

  const missingTrace = !bool(input.context.researchTraceComplete)
  const artifactSpecRefs = missingTrace ? [] : ['SPEC-001']

  return {
    findings: [
      {
        id: 'F-001',
        source: input.sourceCase ?? input.sourceDocs[0] ?? 'ad-hoc-task',
        claim: input.context.findingClaim ?? 'Research must compile into a concrete acceptance object before execution.',
        affectedObjects: [input.context.acceptanceObject ?? input.context.targetObject ?? input.id],
        severity: 'P0',
        failureClass: includesAny(input.tags, ['methodology', 'diamond_protocol']) ? 'methodology' : 'evidence',
        mustBecome: input.context.mustBecome ?? 'Executable spec with owner, forbidden scope, evidence, and StarPom closure.',
        ownerLane: (input.context.ownerLane as Sailor | undefined) ?? 'Captain',
        evidenceRequired: ['artifact spec', 'priority checklist', 'claim-bound evidence'],
        artifactSpecRefs,
      },
    ],
    parkingLot: input.context.parkingLot ? input.context.parkingLot.split(',').map((item) => item.trim()) : [],
  }
}

function buildArtifactSpecs(input: LabInput, required: boolean, traced: boolean): ArtifactSpecsArtifact {
  if (!required || bool(input.context.noArtifactSpecs)) return { specs: [] }

  return {
    specs: [
      {
        id: 'SPEC-001',
        object: input.context.affectedObject ?? input.context.targetObject ?? input.id,
        objectType: (input.context.objectType as ArtifactSpecsArtifact['specs'][number]['objectType'] | undefined) ?? 'task',
        audience: (input.context.audience as ArtifactSpecsArtifact['specs'][number]['audience'] | undefined) ?? 'Anton',
        currentState: input.context.currentState ?? 'Research exists as prose or scattered findings.',
        targetState: input.context.targetState ?? 'Research is compiled into executable acceptance rows.',
        acceptanceObject: input.context.acceptanceObject ?? input.context.userInspectionObject ?? 'user-inspected result',
        nonGoals: ['micromanage implementation tactics', 'turn methodology readiness into product readiness'],
        forbiddenDrift: ['checklist theatre', 'review prose as evidence', 'stale research closure'],
        checklistRefs: traced && !bool(input.context.proseChecklistOnly) ? ['CHK-001'] : [],
        evidenceRefs: [],
      },
    ],
  }
}

function buildPriorityChecklists(input: LabInput, required: boolean, hasSpec: boolean): PriorityChecklistsArtifact {
  if (!required || !hasSpec || bool(input.context.proseChecklistOnly)) return { items: [] }

  const missingOwnerEvidence = bool(input.context.checklistWithoutEvidence)
  const checklistEvidenceComplete = bool(input.context.checklistEvidenceComplete)
  return {
    items: [
      {
        id: 'CHK-001',
        sourceRequirement: 'F-001',
        owner: missingOwnerEvidence ? 'Captain' : ((input.context.ownerLane as Sailor | undefined) ?? 'QA'),
        scope: [input.context.affectedObject ?? input.context.targetObject ?? input.id],
        forbiddenScope: ['unowned closure', 'evidence-free pass', 'product accepted_full overclaim'],
        acceptanceObject: input.context.acceptanceObject ?? input.context.userInspectionObject ?? 'user-inspected result',
        requiredEvidence: missingOwnerEvidence ? [] : ['fresh evidence bound to acceptance object', 'rerun after fix when changed'],
        negativeProofRequired: bool(input.context.negativeProofRequired),
        status: checklistEvidenceComplete ? 'pass' : missingOwnerEvidence ? 'blocked' : 'pending',
        blocking: true,
        evidenceRefs: checklistEvidenceComplete ? ['closure-matrix.json'] : [],
        rerunStatus: bool(input.context.rerunComplete) ? 'complete' : bool(input.context.rerunMissing) ? 'required' : 'not_required',
      },
    ],
  }
}

function buildAutonomyEnvelope(input: LabInput, crewPlan: CrewPlanArtifact, required: boolean): AutonomyEnvelopeArtifact {
  if (!required) return { envelopes: [] }

  const overlapping = bool(input.context.ownerOverlapNoResolution)
  return {
    envelopes: crewPlan.requiredSailors.map((sailor, index) => ({
      sailor,
      owns: overlapping && index < 2 ? ['SPEC-001', 'CHK-001'] : sailor === 'Captain' ? ['SPEC-001'] : ['CHK-001'],
      mayDecide: ['implementation tactics inside the accepted target state'],
      mustNotChange: ['acceptance object', 'forbidden scope', 'source truth without Captain resolution'],
      mustEscalateIf: ['acceptance object changes', 'forbidden scope becomes necessary', 'evidence cannot be produced'],
      evidenceOwed: sailor === 'StarPom' ? ['claim-bound closeout verdict'] : ['artifact or evidence note'],
    })),
  }
}

function buildExecutionPlanValidation(input: LabInput, required: boolean): ExecutionPlanValidationArtifact {
  if (!required) return { verdict: 'pass', missingFields: [], blockingClaims: [] }

  const missingFields = bool(input.context.executionPlanComplete)
    ? []
    : ['owners', 'dependencies', 'allowed scope', 'forbidden scope', 'evidence per phase', 'stop conditions']

  return {
    verdict: missingFields.length === 0 ? 'pass' : 'blocked',
    missingFields,
    blockingClaims: missingFields.length === 0 ? [] : ['execution_plan_missing_required_fields'],
  }
}

function buildAcceptedRiskValidation(input: LabInput): AcceptedRiskValidationArtifact {
  if (!bool(input.context.acceptedRiskPresent)) {
    return { verdict: 'pass', acceptedRisks: [], blockingClaims: [] }
  }

  const complete = bool(input.context.acceptedRiskComplete)
  const acceptedRisk = {
    id: 'RISK-001',
    owner: complete ? ((input.context.ownerLane as Sailor | undefined) ?? 'StarPom') : null,
    consequence: complete ? 'Scoped partial closure only; does not permit accepted_full.' : null,
    expiry: complete ? 'Next advisory or blocking rollout review.' : null,
    tracking: complete ? 'REPAIR-20260513-CAPTAIN-LIVING-SYSTEM' : null,
    compensatingControl: complete ? 'StarPom blocks final product closure.' : null,
    doesNotPermit: ['accepted_full', 'security/source/persistence overclaim'],
  }

  return {
    verdict: complete ? 'accepted_risk' : 'blocked',
    acceptedRisks: [acceptedRisk],
    blockingClaims: complete ? [] : ['accepted_risk_without_controls'],
  }
}

function buildClosureMatrix(
  required: boolean,
  checklists: PriorityChecklistsArtifact,
  acceptedRisk: AcceptedRiskValidationArtifact,
): ClosureMatrixArtifact {
  const blockedChecklistClaims = checklists.items
    .filter((item) => item.blocking && item.status !== 'pass' && item.status !== 'accepted_risk')
    .map((item) => item.id)
  const blockedClaims = [...blockedChecklistClaims, ...acceptedRisk.blockingClaims]

  return {
    closureStatus: !required ? 'ready_for_owner_review_planning_only' : blockedClaims.length === 0 ? 'accepted_partial' : 'blocked',
    claimBindings: checklists.items.map((item) => ({
      claimId: item.id,
      artifactRef: 'priority-checklists.json',
      evidenceRef: item.evidenceRefs[0] ?? null,
      verdict: item.status === 'pass' ? 'pass' : item.status === 'accepted_risk' ? 'accepted_risk' : 'blocked',
    })),
    finalClaimAllowed: !required || blockedClaims.length === 0,
    blockedClaims,
  }
}

function validationBlocks(
  input: LabInput,
  required: boolean,
  research: ResearchContextArtifact,
  findings: FindingsLedgerArtifact,
  specs: ArtifactSpecsArtifact,
  checklists: PriorityChecklistsArtifact,
  autonomy: AutonomyEnvelopeArtifact,
  executionPlan: ExecutionPlanValidationArtifact,
  acceptedRisk: AcceptedRiskValidationArtifact,
  closure: ClosureMatrixArtifact,
  routeChecklist: DiamondArtifacts['routeChecklistCoverage'],
): string[] {
  if (!required) return []

  const blocks: string[] = []
  if (!research.corpusComplete) blocks.push('missing_diamond_research_corpus')
  if (findings.findings.some((finding) => finding.artifactSpecRefs.length === 0)) blocks.push('missing_research_to_spec_trace')
  if (specs.specs.length === 0 || specs.specs.some((spec) => spec.checklistRefs.length === 0)) {
    blocks.push('artifact_spec_without_acceptance_matrix')
  }
  if (checklists.items.some((item) => item.requiredEvidence.length === 0 || !item.owner)) {
    blocks.push('checklist_row_without_owner_evidence')
  }
  if (bool(input.context.sailorVerdictNoArtifact)) blocks.push('sailor_verdict_without_artifact')
  if (bool(input.context.ownerOverlapNoResolution) || autonomy.envelopes.length === 0) blocks.push('sailor_ownership_gap')
  if (checklists.items.some((item) => item.rerunStatus === 'required')) blocks.push('evidence_closure_without_rerun')
  if (bool(input.context.starpomCloseoutNoBinding) || (required && closure.claimBindings.length === 0)) {
    blocks.push('starpom_closeout_without_claim_binding')
  }
  blocks.push(...acceptedRisk.blockingClaims)
  if (bool(input.context.methodologyOverclaimsProduct)) blocks.push('methodology_overclaims_product')
  if (executionPlan.blockingClaims.length > 0) blocks.push('execution_plan_missing_required_fields')
  if (bool(input.context.routeChecklistRequired) && !routeChecklist.parsed) blocks.push('route_checklist_missing')
  const routeChecklistOpen = routeChecklist.openBlockingRows.length > 0
  const openWorkRemaining = bool(input.context.openWorkRemaining) || routeChecklistOpen
  const openWorkInventoryComplete = bool(input.context.openWorkInventoryComplete) || routeChecklist.parsed
  if (openWorkRemaining && !openWorkInventoryComplete) blocks.push('open_work_inventory_missing')
  if (openWorkRemaining && bool(input.context.broadDoneClaim)) blocks.push('broad_done_claim_with_open_work')
  if (openWorkRemaining && !bool(input.context.nextPacketBound)) blocks.push('partial_done_without_next_packet')
  if (openWorkRemaining && bool(input.context.agentStopped) && !bool(input.context.stopConditionRecorded)) {
    blocks.push('premature_stop_with_open_work')
  }
  return [...new Set(blocks)]
}

export function buildDiamondArtifacts(
  input: LabInput,
  classification: ClassificationArtifact,
  crewPlan: CrewPlanArtifact,
): DiamondArtifacts {
  const diamondRequiredArtifact = diamondRequired(input, classification)
  const researchContext = buildResearchContext(input, diamondRequiredArtifact.required)
  const findingsLedger = buildFindingsLedger(input, diamondRequiredArtifact.required)
  const traced = findingsLedger.findings.every((finding) => finding.artifactSpecRefs.length > 0)
  const artifactSpecs = buildArtifactSpecs(input, diamondRequiredArtifact.required, traced)
  const priorityChecklists = buildPriorityChecklists(input, diamondRequiredArtifact.required, artifactSpecs.specs.length > 0)
  const autonomyEnvelope = buildAutonomyEnvelope(input, crewPlan, diamondRequiredArtifact.required)
  const executionPlanValidation = buildExecutionPlanValidation(input, diamondRequiredArtifact.required)
  const acceptedRiskValidation = buildAcceptedRiskValidation(input)
  const closureMatrix = buildClosureMatrix(diamondRequiredArtifact.required, priorityChecklists, acceptedRiskValidation)
  const routeChecklistCoverage = buildRouteChecklistCoverage(input)

  return {
    diamondRequired: diamondRequiredArtifact,
    researchContext,
    findingsLedger,
    artifactSpecs,
    priorityChecklists,
    autonomyEnvelope,
    executionPlanValidation,
    acceptedRiskValidation,
    closureMatrix,
    routeChecklistCoverage,
    blockIds: validationBlocks(
      input,
      diamondRequiredArtifact.required,
      researchContext,
      findingsLedger,
      artifactSpecs,
      priorityChecklists,
      autonomyEnvelope,
      executionPlanValidation,
      acceptedRiskValidation,
      closureMatrix,
      routeChecklistCoverage,
    ),
  }
}
