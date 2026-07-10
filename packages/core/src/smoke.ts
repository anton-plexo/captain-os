import { compileArtifactSpec } from './artifact-compiler'
import { buildAdvisoryReport } from './execution-state-machine'
import { fixtureFilePath, loadAllFixtures, assertNoPrivateReasoningFixtures } from './fixtures'
import { LabInputError, LabUnsafeWriteError, assertSafeShadowOutDir, timestampRunId } from './io'
import { runLab } from './ship'

interface Failure {
  fixture: string
  reason: string
}

function assert(condition: boolean, fixture: string, reason: string, failures: Failure[]): void {
  if (!condition) failures.push({ fixture, reason })
}

function assertInputAndPathErrors(failures: Failure[]): void {
  try {
    assertSafeShadowOutDir('../outside-lab')
    failures.push({ fixture: 'unsafe-path', reason: 'unsafe output path did not throw' })
  } catch (error) {
    if (!(error instanceof LabUnsafeWriteError) || error.code !== 5) {
      failures.push({ fixture: 'unsafe-path', reason: 'unsafe output path did not return code 5 class' })
    }
  }

  try {
    runLab({ task: 'hello', mode: 'advisory' as 'shadow', out: `.ship/lab/runs/${timestampRunId('invalid-mode')}` })
    failures.push({ fixture: 'invalid-mode', reason: 'invalid mode did not throw' })
  } catch (error) {
    if (!(error instanceof LabInputError) || error.code !== 3) {
      failures.push({ fixture: 'invalid-mode', reason: 'invalid mode did not return code 3 class' })
    }
  }
}

function assertArtifactCompiler(smokeId: string, failures: Failure[]): void {
  try {
    const yamlArtifacts = compileArtifactSpec({
      spec: 'docs/process/captain-os-lab/specs/sample-executable-task.yaml',
      out: `.ship/lab/runs/${smokeId}/artifact-compiler-yaml`,
    })
    const markdownArtifacts = compileArtifactSpec({
      spec: 'docs/process/captain-os-lab/specs/sample-executable-task.md',
      out: `.ship/lab/runs/${smokeId}/artifact-compiler-markdown`,
    })
    const reportOnlyArtifacts = compileArtifactSpec({
      spec: 'docs/process/captain-os-lab/README.md',
      out: `.ship/lab/runs/${smokeId}/artifact-compiler-report-only`,
    })

    assert(yamlArtifacts.report.status === 'pass', 'artifact-compiler', 'sample YAML spec did not pass', failures)
    assert(yamlArtifacts.report.exitCode === 0, 'artifact-compiler', `expected YAML exit 0, got ${yamlArtifacts.report.exitCode}`, failures)
    assert(yamlArtifacts.checklist.totalRows >= 4, 'artifact-compiler', 'expected at least 4 YAML checklist rows', failures)
    assert(
      yamlArtifacts.evidence.missingEvidenceRows.length === 0,
      'artifact-compiler',
      `unexpected YAML missing evidence rows: ${yamlArtifacts.evidence.missingEvidenceRows.join(', ')}`,
      failures,
    )
    assert(markdownArtifacts.report.status === 'pass', 'artifact-compiler', 'sample Markdown spec did not pass', failures)
    assert(
      reportOnlyArtifacts.report.status === 'blocked',
      'artifact-compiler',
      'report-only Markdown should block as non-executable',
      failures,
    )

    const p9dFixtures = [
      ['valid-pass-control.yaml', null],
      ['evidence-ref-untyped.yaml', 'evidence_EVD-P9D-UNTYPED_ref_0_must_be_typed'],
      ['evidence-ref-wrong-claim.yaml', 'evidence_ref_claim_mismatch'],
      ['evidence-ref-missing-file.yaml', 'evidence_ref_artifact_missing'],
      ['freshness-self-attested.yaml', 'freshness_self_attested'],
      ['closed-row-unknown-freshness.yaml', 'closed_row_unknown_freshness'],
      ['negative-proof-not-provided.yaml', 'negative_proof_missing'],
      ['wrong-acceptance-object.yaml', 'acceptance_object_mismatch'],
      ['requested-objects-undercovered.yaml', 'requested_object_uncovered'],
      ['t4-captain-only-no-reason.yaml', 'required_sailor_missing'],
      ['sailor-empty-ownership.yaml', 'sailor_ownership_empty'],
      ['accepted-risk-without-controls.yaml', 'accepted_risk_controls_missing'],
      ['weak-next-packet.yaml', 'next_packet_row_mapping_missing'],
      ['mode-depth-contradiction.yaml', 'mode_depth_incoherent'],
      ['vague-scope.yaml', 'typed_scope_required'],
      ['markdown-body-overclaims.md', 'markdown_body_overclaims'],
      ['semantic-security-negative-proof.yaml', 'public_host_negative_proof_required'],
      ['semantic-data-canonical-null.yaml', 'canonical_null_public_visibility_query_required'],
      ['semantic-parser-source-metadata.yaml', 'parser_source_metadata_freshness_runlog_required'],
      ['semantic-next-packet-required.yaml', 'semantic_next_packet_required'],
    ] as const

    for (const [fixtureFile, expectedBlock] of p9dFixtures) {
      const fixtureId = fixtureFile.replace(/\.(ya?ml|md)$/, '')
      const artifacts = compileArtifactSpec({
        spec: fixtureFilePath('p9d-hardening', fixtureFile),
        out: `.ship/lab/runs/${smokeId}/p9d-${fixtureId}`,
      })
      if (expectedBlock === null) {
        assert(artifacts.report.status === 'pass', fixtureId, `expected P9D control pass, got ${artifacts.report.status}`, failures)
      } else {
        assert(artifacts.report.status === 'blocked', fixtureId, 'expected P9D fixture to block', failures)
        assert(
          artifacts.report.compileBlocks.includes(expectedBlock),
          fixtureId,
          `missing expected P9D block ${expectedBlock}; got ${artifacts.report.compileBlocks.join(', ')}`,
          failures,
        )
      }
    }
  } catch (error) {
    failures.push({
      fixture: 'artifact-compiler',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function assertP9DAdvisoryIntegration(smokeId: string, failures: Failure[]): void {
  try {
    const compiledSpec = compileArtifactSpec({
      spec: 'docs/process/captain-os-lab/fixtures/p9d-hardening/evidence-ref-wrong-claim.yaml',
      out: `.ship/lab/runs/${smokeId}/p9d-advisory-compile`,
    })
    const artifacts = runLab({
      task: 'Advisory state machine must surface executable spec P9D blocks before StarPom/final claim.',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p9d-advisory-run`,
    })
    const report = buildAdvisoryReport(artifacts, compiledSpec.executability)
    const executabilityState = report.stateMachine.states.find((state) => state.id === 'executability')
    const starpomState = report.stateMachine.states.find((state) => state.id === 'starpom')

    assert(
      executabilityState?.status === 'blocked',
      'p9d-advisory-integration',
      `expected executability state to block, got ${executabilityState?.status ?? 'missing'}`,
      failures,
    )
    assert(
      report.stateMachine.decision === 'blocked_external',
      'p9d-advisory-integration',
      `expected blocked_external decision, got ${report.stateMachine.decision}`,
      failures,
    )
    assert(
      report.stateMachine.openWork.p9dBlocks.includes('evidence_ref_claim_mismatch'),
      'p9d-advisory-integration',
      `missing P9D open-work block, got ${report.stateMachine.openWork.p9dBlocks.join(', ')}`,
      failures,
    )
    assert(
      starpomState?.blockers.includes('evidence_ref_claim_mismatch') === true,
      'p9d-advisory-integration',
      `StarPom state did not inherit P9D block, got ${starpomState?.blockers.join(', ') ?? 'missing'}`,
      failures,
    )
    assert(
      report.metrics.p9dBlockCount > 0,
      'p9d-advisory-integration',
      `expected P9D metric count, got ${report.metrics.p9dBlockCount}`,
      failures,
    )
  } catch (error) {
    failures.push({
      fixture: 'p9d-advisory-integration',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function assertOperatingSafetyIntegration(smokeId: string, failures: Failure[]): void {
  try {
    const directArtifacts = runLab({
      fixture: 'direct-question-before-fix',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p0-operating-safety-direct-question`,
    })
    const directReport = buildAdvisoryReport(directArtifacts)
    const stateIds = directReport.stateMachine.states.map((state) => state.id)
    const operatingSafetyState = directReport.stateMachine.states.find((state) => state.id === 'operating_safety')
    const starpomState = directReport.stateMachine.states.find((state) => state.id === 'starpom')

    assert(
      stateIds.indexOf('operating_safety') > stateIds.indexOf('intake') &&
        stateIds.indexOf('operating_safety') < stateIds.indexOf('classification'),
      'p0-operating-safety-integration',
      `operating_safety state is not between intake and classification: ${stateIds.join(' -> ')}`,
      failures,
    )
    assert(
      directArtifacts.operatingSafety.blocks.includes('stop_and_answer_required'),
      'p0-operating-safety-integration',
      `direct question did not emit stop_and_answer_required: ${directArtifacts.operatingSafety.blocks.join(', ')}`,
      failures,
    )
    assert(
      operatingSafetyState?.status === 'blocked',
      'p0-operating-safety-integration',
      `expected operating_safety state to block, got ${operatingSafetyState?.status ?? 'missing'}`,
      failures,
    )
    assert(
      directReport.stateMachine.decision === 'blocked_external',
      'p0-operating-safety-integration',
      `expected blocked_external decision, got ${directReport.stateMachine.decision}`,
      failures,
    )
    assert(
      directReport.stateMachine.openWork.operatingSafetyBlocks.includes('stop_and_answer_required'),
      'p0-operating-safety-integration',
      `missing operating-safety open-work block: ${directReport.stateMachine.openWork.operatingSafetyBlocks.join(', ')}`,
      failures,
    )
    assert(
      starpomState?.blockers.includes('stop_and_answer_required') === true,
      'p0-operating-safety-integration',
      `StarPom did not inherit operating-safety block: ${starpomState?.blockers.join(', ') ?? 'missing'}`,
      failures,
    )
    assert(
      directReport.metrics.operatingSafetyBlockCount > 0,
      'p0-operating-safety-integration',
      `expected operatingSafetyBlockCount > 0, got ${directReport.metrics.operatingSafetyBlockCount}`,
      failures,
    )

    const visibleArtifacts = runLab({
      fixture: 'screenshot-visible-row-missed',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p0-operating-safety-visible-row`,
    })
    const visibleReport = buildAdvisoryReport(visibleArtifacts)
    assert(
      visibleArtifacts.operatingSafety.blocks.includes('visible_acceptance_missing'),
      'p0-operating-safety-visible-row',
      `visible row fixture did not emit visible_acceptance_missing: ${visibleArtifacts.operatingSafety.blocks.join(', ')}`,
      failures,
    )
    assert(
      visibleReport.stateMachine.decision === 'blocked_external',
      'p0-operating-safety-visible-row',
      `visible row should block final claim despite green tests, got ${visibleReport.stateMachine.decision}`,
      failures,
    )

    const mismatchArtifacts = runLab({
      fixture: 'graphic-preview-workbench-mismatch',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p0-operating-safety-mismatch`,
    })
    const mismatchReport = buildAdvisoryReport(mismatchArtifacts)
    assert(
      mismatchArtifacts.operatingSafety.blocks.includes('user_request_result_mismatch'),
      'p0-operating-safety-mismatch',
      `mismatch fixture did not emit user_request_result_mismatch: ${mismatchArtifacts.operatingSafety.blocks.join(', ')}`,
      failures,
    )
    assert(
      mismatchReport.stateMachine.states.find((state) => state.id === 'starpom')?.blockers.includes('user_request_result_mismatch') === true,
      'p0-operating-safety-mismatch',
      'StarPom did not block the user-request/result mismatch',
      failures,
    )

    const spanArtifacts = runLab({
      fixture: 'span-of-control-overload',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p0-operating-safety-span`,
    })
    assert(
      spanArtifacts.operatingSafety.blocks.includes('span_of_control_violation') &&
        spanArtifacts.operatingSafety.blocks.includes('officer_hierarchy_missing'),
      'p0-operating-safety-span',
      `span overload did not require officer hierarchy: ${spanArtifacts.operatingSafety.blocks.join(', ')}`,
      failures,
    )

    const contextArtifacts = runLab({
      fixture: 'context-broadcast-overload',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p0-operating-safety-context`,
    })
    assert(
      contextArtifacts.operatingSafety.blocks.includes('context_budget_violation'),
      'p0-operating-safety-context',
      `context broadcast did not emit budget violation: ${contextArtifacts.operatingSafety.blocks.join(', ')}`,
      failures,
    )

    const cleanArtifacts = runLab({
      fixture: 'clean-low-risk-control',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p0-operating-safety-clean`,
    })
    const cleanReport = buildAdvisoryReport(cleanArtifacts)
    const cleanOperatingSafetyState = cleanReport.stateMachine.states.find((state) => state.id === 'operating_safety')
    assert(
      cleanArtifacts.operatingSafety.blocks.length === 0,
      'p0-operating-safety-clean',
      `clean control emitted operating-safety blocks: ${cleanArtifacts.operatingSafety.blocks.join(', ')}`,
      failures,
    )
    assert(
      cleanOperatingSafetyState?.status === 'pass',
      'p0-operating-safety-clean',
      `clean control operating_safety state should pass, got ${cleanOperatingSafetyState?.status ?? 'missing'}`,
      failures,
    )
    assert(
      cleanReport.stateMachine.decision === 'ready_for_owner_review_planning_only',
      'p0-operating-safety-clean',
      `clean control should stay lightweight, got ${cleanReport.stateMachine.decision}`,
      failures,
    )
  } catch (error) {
    failures.push({
      fixture: 'p0-operating-safety-integration',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function assertOperatorDecisionInterrupt(smokeId: string, failures: Failure[]): void {
  try {
    const artifacts = runLab({
      fixture: 'operator-decision-required-adjacent-planning-continues',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/operator-decision-required-adjacent-planning-continues`,
    })
    const report = buildAdvisoryReport(artifacts)
    const expectedBlocks = [
      'operator_decision_required_interrupt',
      'critical_path_vs_adjacent_work',
      'blocked_but_continuing_budget',
      'seo_http_200_false_green_parity_missing',
    ]

    for (const block of expectedBlocks) {
      assert(
        artifacts.operatingSafety.blocks.includes(block),
        'operator-decision-required-adjacent-planning-continues',
        `missing operating-safety block ${block}: ${artifacts.operatingSafety.blocks.join(', ')}`,
        failures,
      )
    }
    assert(
      artifacts.operatingSafety.criticalPathMovement === 'adjacent_planning_only',
      'operator-decision-critical-path-movement',
      `expected adjacent_planning_only, got ${artifacts.operatingSafety.criticalPathMovement}`,
      failures,
    )
    assert(
      artifacts.operatingSafety.adjacentPlanningSlicesAfterBlocker > 2 &&
        artifacts.operatingSafety.hoursAfterBlocker > 2,
      'operator-decision-budget',
      `expected exhausted blocked-continuing budget, got slices=${artifacts.operatingSafety.adjacentPlanningSlicesAfterBlocker}, hours=${artifacts.operatingSafety.hoursAfterBlocker}`,
      failures,
    )
    assert(
      artifacts.operatingSafety.ownerChoices.length === 2,
      'operator-decision-owner-choices',
      `expected exactly 2 owner choices, got ${artifacts.operatingSafety.ownerChoices.length}`,
      failures,
    )
    assert(
      report.stateMachine.decision === 'operator_decision_required',
      'operator-decision-state-machine',
      `expected operator_decision_required decision, got ${report.stateMachine.decision}`,
      failures,
    )
    assert(
      report.metrics.preventedFailureSignals.includes('seo_http_200_false_green_parity_missing'),
      'operator-decision-seo-parity-signal',
      `missing SEO parity signal: ${report.metrics.preventedFailureSignals.join(', ')}`,
      failures,
    )
  } catch (error) {
    failures.push({
      fixture: 'operator-decision-required-adjacent-planning-continues',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function assertFalseParallelism(smokeId: string, failures: Failure[]): void {
  try {
    const artifacts = runLab({
      fixture: 'false-parallelism-no-persistent-lanes',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/false-parallelism-no-persistent-lanes`,
    })
    const report = buildAdvisoryReport(artifacts)
    const expectedBlocks = ['false_parallelism_no_persistent_lanes', 'lane_memory_missing']

    for (const block of expectedBlocks) {
      assert(
        artifacts.operatingSafety.blocks.includes(block),
        'false-parallelism-no-persistent-lanes',
        `missing operating-safety block ${block}: ${artifacts.operatingSafety.blocks.join(', ')}`,
        failures,
      )
      assert(
        report.stateMachine.openWork.operatingSafetyBlocks.includes(block),
        'false-parallelism-state-machine',
        `state machine missing operating-safety block ${block}: ${report.stateMachine.openWork.operatingSafetyBlocks.join(', ')}`,
        failures,
      )
    }
    assert(
      report.stateMachine.decision === 'blocked_external',
      'false-parallelism-state-machine-decision',
      `expected blocked_external decision, got ${report.stateMachine.decision}`,
      failures,
    )
  } catch (error) {
    failures.push({
      fixture: 'false-parallelism-no-persistent-lanes',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function assertP10GRuntimeHardening(smokeId: string, failures: Failure[]): void {
  try {
    const artifacts = runLab({
      task: [
        'Captain OS cross-domain runtime final claim: RAG, splash radius, Claude Code plan/code/final review, and evidence aggregation are ready.',
        'This is a final claim attempt for a state machine and cross-LLM SLA change touching runtime, RAG, radius, and PR review.',
      ].join('\n'),
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p10g-runtime-hardening-final-claim`,
    })
    const report = buildAdvisoryReport(artifacts)
    const stateIds = report.stateMachine.states.map((state) => state.id)
    const contextState = report.stateMachine.states.find((state) => state.id === 'context_envelope')
    const splashState = report.stateMachine.states.find((state) => state.id === 'splash_radius')
    const crossLlmState = report.stateMachine.states.find((state) => state.id === 'cross_llm_sla')
    const aggregationState = report.stateMachine.states.find((state) => state.id === 'evidence_aggregation')

    assert(
      stateIds.indexOf('classification') < stateIds.indexOf('context_envelope') &&
        stateIds.indexOf('context_envelope') < stateIds.indexOf('splash_radius') &&
        stateIds.indexOf('splash_radius') < stateIds.indexOf('packet') &&
        stateIds.indexOf('cross_llm_sla') < stateIds.indexOf('starpom') &&
        stateIds.indexOf('starpom') < stateIds.indexOf('evidence_aggregation') &&
        stateIds.indexOf('evidence_aggregation') < stateIds.indexOf('continuation'),
      'p10g-runtime-state-order',
      `unexpected P10G state order: ${stateIds.join(' -> ')}`,
      failures,
    )
    assert(
      artifacts.contextRuntime.ragRequired && artifacts.contextRuntime.ragPackInjected,
      'p10g-rag-context',
      'RAG/context pack was not auto-injected for a non-trivial task',
      failures,
    )
    assert(
      artifacts.contextRuntime.sessionPackRequired && artifacts.contextRuntime.sessionPackInjected,
      'p10g-session-pack',
      'Session pack was not auto-injected for D3+ runtime work',
      failures,
    )
    assert(
      artifacts.splashRadius.required && artifacts.splashRadius.splashRadiusHookInjected,
      'p10g-splash-radius',
      'Splash/blast-radius hook was not injected before packet/crew',
      failures,
    )
    assert(
      artifacts.crossLlmSla.requiredPhases.includes('plan_review') &&
        artifacts.crossLlmSla.requiredPhases.includes('code_review') &&
        artifacts.crossLlmSla.requiredPhases.includes('final_claim_review'),
      'p10g-cross-llm-sla',
      `Claude Code SLA did not require all final-claim phases: ${artifacts.crossLlmSla.requiredPhases.join(', ')}`,
      failures,
    )
    assert(
      artifacts.crossLlmSla.blocks.includes('cross_llm_required_verdict_missing'),
      'p10g-cross-llm-final-claim-block',
      `missing cross-LLM final-claim block: ${artifacts.crossLlmSla.blocks.join(', ')}`,
      failures,
    )
    assert(
      report.stateMachine.decision === 'blocked_external',
      'p10g-runtime-decision',
      `P10G missing Claude verdict should block final claim, got ${report.stateMachine.decision}`,
      failures,
    )
    assert(
      contextState?.status === 'pass' &&
        splashState?.status === 'pass' &&
        crossLlmState?.status === 'blocked' &&
        aggregationState?.status === 'pass',
      'p10g-runtime-state-status',
      `unexpected P10G states: context=${contextState?.status}, splash=${splashState?.status}, cross=${crossLlmState?.status}, aggregation=${aggregationState?.status}`,
      failures,
    )
  } catch (error) {
    failures.push({
      fixture: 'p10g-runtime-hardening',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function assertP11FAutoBootstrap(smokeId: string, failures: Failure[]): void {
  try {
    const plainPrompt = [
      'Посмотри, пожалуйста, в этом проекте, как устроена Captain OS для продолжения работы между сессиями.',
      'Мне нужно простое read-only заключение: если я завтра открою новую сессию или другой LLM, сможет ли он восстановить контекст задачи из локальных файлов и GitHub, без чтения всей старой переписки?',
      'Ничего не редактируй. Просто изучи проект, найди нужные файлы сам, запусти те проверки/evidence-команды, которые считаешь обязательными по правилам проекта, и в конце дай что понял, файлы/команды, evidence, риски и следующий шаг.',
    ].join('\n\n')
    const artifacts = runLab({
      task: plainPrompt,
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p11f-plain-prompt-auto-bootstrap`,
    })
    const report = buildAdvisoryReport(artifacts)
    const stateIds = report.stateMachine.states.map((state) => state.id)

    assert(
      artifacts.classification.intentMode === 'system_refactor',
      'p11f-auto-bootstrap-classification',
      `plain Captain OS continuity prompt must not be direct_answer; got ${artifacts.classification.intentMode}`,
      failures,
    )
    assert(
      artifacts.classification.complexityTier === 'T3' || artifacts.classification.complexityTier === 'T4',
      'p11f-auto-bootstrap-tier',
      `plain Captain OS continuity prompt must be T3+; got ${artifacts.classification.complexityTier}`,
      failures,
    )
    assert(
      artifacts.contextRuntime.captainOsAdapterRequired,
      'p11f-auto-bootstrap-adapter-required',
      'Captain OS adapter was not required for a Captain OS continuity prompt',
      failures,
    )
    assert(
      artifacts.contextRuntime.captainOsAdapterStatus === 'present',
      'p11f-auto-bootstrap-adapter-present',
      `expected adapter present in this worktree, got ${artifacts.contextRuntime.captainOsAdapterStatus}`,
      failures,
    )
    assert(
      artifacts.contextRuntime.ragPackRefs.includes('.captain-os/project.yaml') &&
        artifacts.contextRuntime.ragPackRefs.includes('.captain-os/task-spine.yaml') &&
        artifacts.contextRuntime.ragPackRefs.includes('docs/process/captain-os-lab/47-single-lane-deep-work-and-task-spine.md') &&
        artifacts.contextRuntime.ragPackRefs.includes('docs/process/captain-os-lab/48-captain-os-github-backlog-map.md'),
      'p11f-auto-bootstrap-rag-refs',
      `RAG refs did not include P11 adapter/spine docs: ${artifacts.contextRuntime.ragPackRefs.join(', ')}`,
      failures,
    )
    assert(
      artifacts.contextRuntime.ragRequired && artifacts.contextRuntime.ragPackInjected,
      'p11f-auto-bootstrap-rag',
      'RAG/context pack was not injected for a plain Captain OS continuity prompt',
      failures,
    )
    assert(
      artifacts.splashRadius.required &&
        artifacts.splashRadius.splashRadiusHookInjected &&
        artifacts.splashRadius.affectedSurfaces.includes('captain_os_runtime'),
      'p11f-auto-bootstrap-splash',
      `splash radius did not cover captain_os_runtime: ${JSON.stringify(artifacts.splashRadius)}`,
      failures,
    )
    assert(
      stateIds.includes('context_envelope') && stateIds.includes('splash_radius') && stateIds.includes('evidence_aggregation'),
      'p11f-auto-bootstrap-state-machine',
      `state machine missing P10G bootstrap states: ${stateIds.join(' -> ')}`,
      failures,
    )

    const missingArtifacts = runLab({
      fixture: 'plain-captain-os-continuity-missing-adapter',
      mode: 'shadow',
      out: `.ship/lab/runs/${smokeId}/p11f-missing-adapter`,
    })
    assert(
      missingArtifacts.contextRuntime.captainOsAdapterStatus === 'missing_adapter',
      'p11f-missing-adapter-status',
      `expected missing_adapter, got ${missingArtifacts.contextRuntime.captainOsAdapterStatus}`,
      failures,
    )
    assert(
      missingArtifacts.contextRuntime.blocks.includes('captain_os_adapter_missing') &&
        missingArtifacts.evidenceMatrix.rows.some((row) => row.id === 'captain_os_adapter_missing'),
      'p11f-missing-adapter-block',
      `missing_adapter did not become evidence block: ${missingArtifacts.contextRuntime.blocks.join(', ')}`,
      failures,
    )
  } catch (error) {
    failures.push({
      fixture: 'p11f-auto-bootstrap',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function main(): void {
  const failures: Failure[] = []
  const fixtures = loadAllFixtures()
  assertNoPrivateReasoningFixtures(fixtures)
  assert(fixtures.length >= 15, 'fixture-basket', `expected at least 15 fixtures, got ${fixtures.length}`, failures)
  assertInputAndPathErrors(failures)

  const smokeId = timestampRunId('smoke')
  assertArtifactCompiler(smokeId, failures)
  assertP9DAdvisoryIntegration(smokeId, failures)
  assertOperatingSafetyIntegration(smokeId, failures)
  assertOperatorDecisionInterrupt(smokeId, failures)
  assertFalseParallelism(smokeId, failures)
  assertP10GRuntimeHardening(smokeId, failures)
  assertP11FAutoBootstrap(smokeId, failures)
  for (const fixture of fixtures) {
    const out = `.ship/lab/runs/${smokeId}/${fixture.id}`
    const artifacts = runLab({ fixture: fixture.id, mode: 'shadow', out })
    const expectedBlocks = fixture.expected.requiredBlocks
    const actualBlocks = artifacts.evidenceMatrix.rows.map((row) => row.id)
    const missingBlocks = expectedBlocks.filter((blockId) => !actualBlocks.includes(blockId))

    assert(missingBlocks.length === 0, fixture.id, `missing expected blocks: ${missingBlocks.join(', ')}`, failures)

    if (expectedBlocks.length === 0) {
      assert(artifacts.run.exitCode === 0, fixture.id, `clean fixture should exit 0, got ${artifacts.run.exitCode}`, failures)
      assert(
        artifacts.starpomVerdict.blockedClaims.length === 0,
        fixture.id,
        `clean fixture should not block, got ${artifacts.starpomVerdict.blockedClaims.join(', ')}`,
        failures,
      )
    } else {
      assert(artifacts.run.exitCode === 2, fixture.id, `blocked fixture should exit 2, got ${artifacts.run.exitCode}`, failures)
    }

    assert(
      artifacts.classification.intentMode === fixture.expected.intentMode,
      fixture.id,
      `intent mismatch: expected ${fixture.expected.intentMode}, got ${artifacts.classification.intentMode}`,
      failures,
    )
  }

  if (failures.length > 0) {
    console.error('Captain Lab smoke failed:')
    for (const failure of failures) console.error(`- ${failure.fixture}: ${failure.reason}`)
    process.exitCode = 1
    return
  }

  console.log(`Captain Lab smoke passed: ${fixtures.length} fixtures`)
  console.log(`Run artifacts: .ship/lab/runs/${smokeId}`)
}

function isDirectEntrypoint(fileName: string): boolean {
  const entrypoint = (process.argv[1] ?? '').replace(/\\/g, '/')
  return entrypoint.endsWith(`/packages/core/src/${fileName}`) || entrypoint.endsWith(`/scripts/captain-lab/${fileName}`)
}

if (isDirectEntrypoint('smoke.ts')) main()
