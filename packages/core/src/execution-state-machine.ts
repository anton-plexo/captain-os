import type {
  AdvisoryMetricsArtifact,
  AdvisoryReportArtifact,
  ExecutabilityValidationArtifact,
  ExecutionDecision,
  ExecutionState,
  ExecutionStateMachineArtifact,
  LabRunArtifacts,
} from './schema'

function statusFromBlockers(blockers: string[]): ExecutionState['status'] {
  return blockers.length > 0 ? 'blocked' : 'pass'
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function continuationBlocks(artifacts: LabRunArtifacts): string[] {
  return artifacts.evidenceMatrix.rows
    .map((row) => row.id)
    .filter((id) => (
      id.includes('open_work') ||
      id.includes('broad_done') ||
      id.includes('next_packet') ||
      id.includes('premature_stop') ||
      id.includes('route_checklist')
    ))
}

function decisionFor(
  artifacts: LabRunArtifacts,
  executability?: ExecutabilityValidationArtifact,
): { decision: ExecutionDecision; reason: string; nextAction: string } {
  const blockingRows = artifacts.evidenceMatrix.rows.filter((row) => row.blocking && row.verdict === 'blocked')
  const openRouteRows = artifacts.diamond.routeChecklistCoverage.openRows
  const continuation = continuationBlocks(artifacts)
  const p9dBlocks = executability?.p9dBlocks ?? []
  const operatingSafetyBlocks = artifacts.operatingSafety.blocks
  const contextRuntimeBlocks = artifacts.contextRuntime.blocks
  const splashRadiusBlocks = artifacts.splashRadius.blocks
  const crossLlmBlocks = artifacts.crossLlmSla.blocks
  const evidenceAggregationBlocks = artifacts.evidenceAggregation.blocks

  if (operatingSafetyBlocks.length > 0) {
    if (operatingSafetyBlocks.includes('operator_decision_required_interrupt')) {
      return {
        decision: 'operator_decision_required',
        reason: 'Original goal is blocked on Anton/operator decision; adjacent planning is not default progress.',
        nextAction: artifacts.operatingSafety.nextAction,
      }
    }
    return {
      decision: 'blocked_external',
      reason: artifacts.operatingSafety.answerRequiredBeforeAction
        ? 'Operating safety requires a direct answer before edits, tool calls, or repair execution.'
        : 'Operating safety has P0 blocks before StarPom/final claim.',
      nextAction: artifacts.operatingSafety.nextAction,
    }
  }

  if (contextRuntimeBlocks.length > 0 || splashRadiusBlocks.length > 0) {
    return {
      decision: 'blocked_external',
      reason: 'P10G context/radius runtime prerequisites are missing before packet, crew, or final claim.',
      nextAction: [...contextRuntimeBlocks, ...splashRadiusBlocks].includes('rag_context_pack_missing')
        ? artifacts.contextRuntime.nextAction
        : artifacts.splashRadius.nextAction,
    }
  }

  if (crossLlmBlocks.length > 0) {
    return {
      decision: 'blocked_external',
      reason: 'P10G cross-LLM SLA requires Claude Code verdict evidence before final claim.',
      nextAction: artifacts.crossLlmSla.nextAction,
    }
  }

  if (evidenceAggregationBlocks.length > 0) {
    return {
      decision: 'blocked_external',
      reason: 'P10G unified evidence aggregation is missing.',
      nextAction: artifacts.evidenceAggregation.nextAction,
    }
  }

  if (p9dBlocks.length > 0) {
    return {
      decision: 'blocked_external',
      reason: 'Executable spec has P9D executability blocks; final claim and StarPom closeout must stay blocked.',
      nextAction: 'Fix executability-validation P9D blocks or record a bounded accepted risk before StarPom/final claim.',
    }
  }

  if (continuation.length > 0) {
    return {
      decision: 'accepted_partial_next_packet',
      reason: 'Open work or false-done risk exists; partial closure needs a bound next packet or continued execution.',
      nextAction: 'Bind every open row to next packet owners/evidence, or continue now until rows close.',
    }
  }

  if (blockingRows.length > 0) {
    return {
      decision: 'blocked_external',
      reason: 'Blocking evidence rows remain open.',
      nextAction: artifacts.starpomVerdict.requiredRepairs[0] ?? 'Close evidence rows or record accepted risk.',
    }
  }

  if (openRouteRows > 0) {
    return {
      decision: 'continue_now',
      reason: 'Route checklist has open rows even though no policy block was emitted.',
      nextAction: 'Continue the route checklist or bind a next packet before any broad final claim.',
    }
  }

  return {
    decision: 'ready_for_owner_review_planning_only',
    reason: 'No blocking advisory rows remain, but no scoped supersession/execution authority was attached.',
    nextAction: 'Present the planning-only packet for owner review before execution or attach a scoped supersession record.',
  }
}

export function buildExecutionStateMachine(
  artifacts: LabRunArtifacts,
  executability?: ExecutabilityValidationArtifact,
): ExecutionStateMachineArtifact {
  const diamondBlocks = artifacts.diamond.blockIds
  const evidenceBlocks = artifacts.evidenceMatrix.rows.filter((row) => row.blocking && row.verdict === 'blocked').map((row) => row.id)
  const continuation = continuationBlocks(artifacts)
  const p9dBlocks = executability?.p9dBlocks ?? []
  const operatingSafetyBlocks = artifacts.operatingSafety.blocks
  const contextRuntimeBlocks = artifacts.contextRuntime.blocks
  const splashRadiusBlocks = artifacts.splashRadius.blocks
  const crossLlmBlocks = artifacts.crossLlmSla.blocks
  const evidenceAggregationBlocks = artifacts.evidenceAggregation.blocks
  const { decision, reason, nextAction } = decisionFor(artifacts, executability)

  const states: ExecutionState[] = [
    {
      id: 'intake',
      status: 'pass',
      owner: 'Captain',
      artifacts: ['run.json'],
      blockers: [],
      nextAction: 'Task entered advisory state machine.',
    },
    {
      id: 'operating_safety',
      status: statusFromBlockers(operatingSafetyBlocks),
      owner: 'StarPom',
      artifacts: ['operating-safety.json'],
      blockers: operatingSafetyBlocks,
      nextAction: operatingSafetyBlocks.length > 0
        ? artifacts.operatingSafety.nextAction
        : 'No stop-and-answer, visible-acceptance, span, or context-budget blocks.',
    },
    {
      id: 'classification',
      status: 'pass',
      owner: 'Captain',
      artifacts: ['classification.json'],
      blockers: [],
      nextAction: `Use ${artifacts.classification.intentMode} ${artifacts.classification.complexityTier}/${artifacts.classification.planDepth}.`,
    },
    {
      id: 'context_envelope',
      status: statusFromBlockers(contextRuntimeBlocks),
      owner: 'Context',
      artifacts: ['context-runtime.json'],
      blockers: contextRuntimeBlocks,
      nextAction: artifacts.contextRuntime.nextAction,
    },
    {
      id: 'splash_radius',
      status: statusFromBlockers(splashRadiusBlocks),
      owner: 'Context',
      artifacts: ['splash-radius.json'],
      blockers: splashRadiusBlocks,
      nextAction: artifacts.splashRadius.nextAction,
    },
    {
      id: 'packet',
      status: 'pass',
      owner: 'Captain',
      artifacts: ['packet-preview.json'],
      blockers: [],
      nextAction: 'Respect allowed scope, forbidden scope, acceptance objects, evidence, and stop conditions.',
    },
    {
      id: 'crew',
      status: artifacts.crewPlan.requiredSailors.length > 0 ? 'pass' : 'warning',
      owner: 'Captain',
      artifacts: ['crew-plan.json'],
      blockers: artifacts.crewPlan.requiredSailors.length > 0 ? [] : ['no_required_sailors'],
      nextAction: 'Dispatch required sailors only with ownership envelopes and evidence owed.',
    },
    {
      id: 'diamond',
      status: statusFromBlockers(diamondBlocks),
      owner: 'Knowledge',
      artifacts: [
        'diamond-required.json',
        'research-context.json',
        'findings-ledger.json',
        'artifact-specs.json',
        'priority-checklists.json',
        'autonomy-envelope.json',
      ],
      blockers: diamondBlocks,
      nextAction: diamondBlocks.length > 0
        ? 'Resolve Diamond research/spec/checklist blocks before broad closure.'
        : 'Diamond preservation has no current advisory blocks.',
    },
    {
      id: 'evidence',
      status: statusFromBlockers(evidenceBlocks),
      owner: 'QA',
      artifacts: ['evidence-matrix.json', 'fix-queue.json', 'route-checklist-coverage.json'],
      blockers: evidenceBlocks,
      nextAction: evidenceBlocks.length > 0
        ? 'Close evidence rows with fresh artifacts or keep final claim blocked.'
        : 'Evidence matrix has no blocking rows.',
    },
    {
      id: 'executability',
      status: executability ? statusFromBlockers(p9dBlocks) : 'pass',
      owner: 'Runtime',
      artifacts: executability ? ['executability-validation.json'] : [],
      blockers: p9dBlocks,
      nextAction: !executability
        ? 'No executable spec attached; P9D validators were not evaluated in this advisory run.'
        : p9dBlocks.length > 0
          ? 'Resolve P9D blocks before StarPom/final claim.'
          : 'Executable spec has no P9D executability blocks.',
    },
    {
      id: 'cross_llm_sla',
      status: crossLlmBlocks.length > 0
        ? 'blocked'
        : artifacts.crossLlmSla.requiredPhases.length > 0 && artifacts.crossLlmSla.verdictRefs.length === 0
          ? 'pending'
          : 'pass',
      owner: 'JudgePool',
      artifacts: ['cross-llm-sla.json'],
      blockers: crossLlmBlocks,
      nextAction: artifacts.crossLlmSla.nextAction,
    },
    {
      id: 'starpom',
      status: operatingSafetyBlocks.length > 0 ||
        contextRuntimeBlocks.length > 0 ||
        splashRadiusBlocks.length > 0 ||
        crossLlmBlocks.length > 0 ||
        evidenceAggregationBlocks.length > 0 ||
        p9dBlocks.length > 0
        ? 'blocked'
        : artifacts.starpomVerdict.finalClaimAllowed ? 'pass' : 'blocked',
      owner: 'StarPom',
      artifacts: ['starpom-verdict.json'],
      blockers: unique([
        ...operatingSafetyBlocks,
        ...contextRuntimeBlocks,
        ...splashRadiusBlocks,
        ...crossLlmBlocks,
        ...evidenceAggregationBlocks,
        ...p9dBlocks,
        ...artifacts.starpomVerdict.blockedClaims,
      ]),
      nextAction: operatingSafetyBlocks.length > 0
        ? 'StarPom closeout is blocked by operating-safety P0 gates.'
        : contextRuntimeBlocks.length > 0
          ? 'StarPom closeout is blocked by missing P10G RAG/session context.'
        : splashRadiusBlocks.length > 0
          ? 'StarPom closeout is blocked by missing P10G splash/blast radius.'
        : crossLlmBlocks.length > 0
          ? 'StarPom closeout is blocked by missing P10G Claude Code verdict evidence.'
        : evidenceAggregationBlocks.length > 0
          ? 'StarPom closeout is blocked by missing P10G evidence aggregation.'
        : p9dBlocks.length > 0
        ? 'StarPom closeout is blocked by executable spec P9D blocks.'
        : artifacts.starpomVerdict.finalClaimAllowed
        ? 'Final claim is only advisory-scoped; product closure still needs later gates.'
        : 'Remove broad final claim or satisfy StarPom required repairs.',
    },
    {
      id: 'evidence_aggregation',
      status: statusFromBlockers(evidenceAggregationBlocks),
      owner: 'QA',
      artifacts: ['evidence-aggregation.json'],
      blockers: evidenceAggregationBlocks,
      nextAction: artifacts.evidenceAggregation.nextAction,
    },
    {
      id: 'continuation',
      status: continuation.length > 0 || artifacts.diamond.routeChecklistCoverage.openRows > 0 ? 'blocked' : 'pass',
      owner: 'Captain',
      artifacts: ['closure-matrix.json', 'route-checklist-coverage.json'],
      blockers: unique([...continuation, ...artifacts.diamond.routeChecklistCoverage.openBlockingRows.map((row) => row.id)]),
      nextAction: continuation.length > 0 || artifacts.diamond.routeChecklistCoverage.openRows > 0
        ? 'Continue now, record accepted risk, or bind next packet.'
        : 'No continuation pressure in this advisory run.',
    },
    {
      id: 'next_packet',
      status: decision === 'ready_for_execution'
        ? 'pass'
        : decision === 'blocked_external' || decision === 'operator_decision_required'
          ? 'blocked'
          : 'pending',
      owner: 'Shipping',
      artifacts: ['captain-synthesis.md'],
      blockers: decision === 'ready_for_execution' || decision === 'ready_for_owner_review_planning_only' ? [] : unique([
        ...operatingSafetyBlocks,
        ...contextRuntimeBlocks,
        ...splashRadiusBlocks,
        ...crossLlmBlocks,
        ...evidenceAggregationBlocks,
        ...p9dBlocks,
        ...continuation,
        ...evidenceBlocks,
      ]),
      nextAction,
    },
  ]

  return {
    version: 'p10g-universal-advisory-v1',
    universal: true,
    runId: artifacts.run.runId,
    decision,
    allowedFinalClaim: false,
    reason,
    states,
    openWork: {
      operatingSafetyBlocks,
      contextRuntimeBlocks,
      splashRadiusBlocks,
      crossLlmBlocks,
      evidenceAggregationBlocks,
      blockingEvidenceRows: evidenceBlocks,
      p9dBlocks,
      fixQueueRows: artifacts.fixQueue.findings.map((finding) => finding.id),
      routeChecklistOpenRows: artifacts.diamond.routeChecklistCoverage.openRows,
      nextPacketRequired: decision === 'accepted_partial_next_packet',
    },
    requiredNextAction: nextAction,
  }
}

export function buildAdvisoryMetrics(
  artifacts: LabRunArtifacts,
  stateMachine: ExecutionStateMachineArtifact,
  executability?: ExecutabilityValidationArtifact,
): AdvisoryMetricsArtifact {
  const p9dBlocks = executability?.p9dBlocks ?? []
  const operatingSafetyBlocks = artifacts.operatingSafety.blocks
  const contextRuntimeBlocks = artifacts.contextRuntime.blocks
  const splashRadiusBlocks = artifacts.splashRadius.blocks
  const crossLlmBlocks = artifacts.crossLlmSla.blocks
  const evidenceAggregationBlocks = artifacts.evidenceAggregation.blocks
  const openBlockingCount = unique([
    ...stateMachine.openWork.blockingEvidenceRows,
    ...p9dBlocks,
    ...operatingSafetyBlocks,
    ...contextRuntimeBlocks,
    ...splashRadiusBlocks,
    ...crossLlmBlocks,
    ...evidenceAggregationBlocks,
  ]).length
  const missingEvidenceCount = artifacts.evidenceMatrix.missingEvidence.length
  const preventedFailureSignals = unique([
    ...artifacts.starpomVerdict.blockedClaims,
    ...operatingSafetyBlocks,
    ...contextRuntimeBlocks,
    ...splashRadiusBlocks,
    ...crossLlmBlocks,
    ...evidenceAggregationBlocks,
    ...artifacts.diamond.blockIds,
    ...p9dBlocks,
    ...continuationBlocks(artifacts),
  ])

  return {
    mode: 'advisory',
    universal: true,
    falsePositiveRisk: openBlockingCount === 0 ? 'low' : openBlockingCount > 8 ? 'medium' : 'low',
    falseNegativeRisk: artifacts.classification.confidence === 'low' ? 'medium' : 'low',
    operatorBurdenRisk: openBlockingCount > 6 || missingEvidenceCount > 20 ? 'high' : openBlockingCount > 2 ? 'medium' : 'low',
    preventedFailureSignals,
    openBlockingCount,
    operatingSafetyBlockCount: operatingSafetyBlocks.length,
    contextRuntimeBlockCount: contextRuntimeBlocks.length,
    splashRadiusBlockCount: splashRadiusBlocks.length,
    crossLlmBlockCount: crossLlmBlocks.length,
    evidenceAggregationBlockCount: evidenceAggregationBlocks.length,
    p9dBlockCount: p9dBlocks.length,
    missingEvidenceCount,
    routeChecklistOpenRows: artifacts.diamond.routeChecklistCoverage.openRows,
  }
}

export function buildAdvisoryReport(
  artifacts: LabRunArtifacts,
  executability?: ExecutabilityValidationArtifact,
): AdvisoryReportArtifact {
  const stateMachine = buildExecutionStateMachine(artifacts, executability)
  const metrics = buildAdvisoryMetrics(artifacts, stateMachine, executability)

  return {
    status: 'advisory_ready',
    blocking: false,
    stateMachine,
    metrics,
    message: stateMachine.decision === 'ready_for_owner_review_planning_only'
      ? 'Advisory run found no blocking guidance; packet is ready for owner review only, not execution authority.'
      : stateMachine.decision === 'ready_for_execution'
        ? 'Advisory run found scoped execution authority; this still does not grant product accepted_full.'
      : `Advisory recommends ${stateMachine.decision}: ${stateMachine.requiredNextAction}`,
  }
}
