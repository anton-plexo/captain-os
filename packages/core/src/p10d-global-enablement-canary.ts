import { relative, resolve } from 'node:path'
import { buildAdvisoryReport } from './execution-state-machine'
import {
  LabInputError,
  LabUnsafeWriteError,
  assertSafeShadowOutDir,
  ensureDir,
  fileExists,
  readJson,
  repoRoot,
  timestampRunId,
  writeJson,
  writeText,
} from './io'
import { runLab } from './ship'

type P9BDomain = 'ui' | 'cms' | 'security' | 'shipping' | 'data' | 'strategy' | 'mixed'
type P9BInputMode = 'baseline_advisory' | 'advisory_with_spec' | 'paired_comparison'
type BurdenLevel = 'low' | 'medium' | 'high'

interface CliOptions {
  p10cRun?: string
  out?: string
  maxFalsePositiveRate?: number
  maxMedianBurdenMinutes?: number
  minControlTasks?: number
  requireOperatingSafety?: boolean
  json?: boolean
}

interface P10BDecisionRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  sliceRole: 'positive_candidate' | 'clean_pass_control' | 'deferred_rule_control' | 'unrelated_serious_control'
  selectedRulesMatched: string[]
  failClosedDecision: 'blocked_fail_closed' | 'pass_through'
  falsePositive: boolean
  falseNegative: boolean
  operatorMinutesAdded: number
}

interface P10BWiderBlockingReport {
  schemaVersion: 1
  status: 'p10b_wider_blocking_profile_ready_global_disabled' | 'p10b_wider_blocking_profile_failed'
  outDir: string
  blockingMode: 'fail_closed_wider_profile'
  globalBlockingEnabled: false
  selectedRules: string[]
  metrics: {
    sliceTasks: number
    controlTasks: number
    blockedTasks: number
    passThroughControls: number
    falsePositiveTasks: number
    falseNegativeTasks: number
    falsePositiveRate: number
    medianBlockedOperatorMinutes: number
    operatorBurdenLevel: BurdenLevel
  }
  decisionRows: P10BDecisionRow[]
}

interface P10CSelectedPathBypassReport {
  schemaVersion: 1
  status: 'p10c_selected_path_bypass_gate_ready_global_disabled' | 'p10c_selected_path_bypass_gate_failed'
  widerRunDir: string
  outDir: string
  blockingMode: 'selected_path_accepted_risk_bypass_exercise'
  globalBlockingEnabled: false
  selectedRules: string[]
  metrics: {
    selectedBlockingRows: number
    selectedRulesCovered: number
    bypassAttempts: number
    weakBypassRejected: number
    completeBypassAccepted: number
    acceptedFullClaimsAllowed: number
    selectedPathBypassCoverage: 'none' | 'partial' | 'complete'
    globalEnablementPrerequisiteMet: boolean
  }
}

interface OperatingSafetyProbeRow {
  fixtureId: string
  expectedBlocks: string[]
  actualBlocks: string[]
  advisoryDecision: string
  status: 'pass' | 'fail'
  outDir: string
}

interface CanaryDecisionRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  sliceRole: P10BDecisionRow['sliceRole']
  selectedRulesMatched: string[]
  canaryDecision: 'blocked_by_selected_profile' | 'passed_through'
  expectedDecision: 'should_block' | 'should_pass'
  falsePositive: boolean
  falseNegative: boolean
  operatorMinutesAdded: number
  nextAction: string
}

interface P10DGlobalEnablementCanaryReport {
  schemaVersion: 1
  status: 'p10d_selected_profile_canary_ready_global_disabled' | 'p10d_selected_profile_canary_failed'
  p10cRunDir: string
  p10bRunDir: string
  outDir: string
  blockingMode: 'selected_profile_global_canary'
  selectedRules: string[]
  canaryBlockingEnabled: boolean
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
  thresholds: {
    maxFalsePositiveRate: number
    maxMedianBurdenMinutes: number
    minControlTasks: number
  }
  prerequisites: {
    p10bWiderProfileReady: boolean
    p10cBypassReady: boolean
    p0OperatingSafetyReady: boolean
    rollbackPlanPresent: boolean
    operatorOverrideRequiresAcceptedRisk: boolean
  }
  metrics: {
    canaryTasks: number
    blockedTasks: number
    controlTasks: number
    passThroughControls: number
    falsePositiveTasks: number
    falseNegativeTasks: number
    falsePositiveRate: number
    medianBlockedOperatorMinutes: number
    operatorBurdenLevel: BurdenLevel
    operatingSafetyProbes: number
    operatingSafetyProbeFailures: number
    starpomDecision: 'enable_selected_profile_canary_only' | 'reject_global_canary'
  }
  operatingSafetyProbes: OperatingSafetyProbeRow[]
  decisionRows: CanaryDecisionRow[]
  rollbackPlan: {
    trigger: string[]
    action: string
    owner: string
  }
  nextAction: string
}

const defaultP10CRun = '.ship/lab/runs/manual-p10c-selected-path-bypass-gate'
const operatingSafetyProbePlan = [
  { fixtureId: 'direct-question-before-fix', expectedBlocks: ['stop_and_answer_required'] },
  { fixtureId: 'screenshot-visible-row-missed', expectedBlocks: ['visible_acceptance_missing'] },
  { fixtureId: 'graphic-preview-workbench-mismatch', expectedBlocks: ['visible_acceptance_missing', 'user_request_result_mismatch'] },
  { fixtureId: 'span-of-control-overload', expectedBlocks: ['span_of_control_violation', 'officer_hierarchy_missing'] },
  { fixtureId: 'context-broadcast-overload', expectedBlocks: ['context_budget_violation'] },
  { fixtureId: 'anger-incident-mode', expectedBlocks: ['stop_and_answer_required', 'anger_incident_answer_required'] },
  { fixtureId: 'clean-low-risk-control', expectedBlocks: [] },
] as const

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { requireOperatingSafety: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--no-require-operating-safety') {
      options.requireOperatingSafety = false
      continue
    }
    if (!arg.startsWith('--')) throw new LabInputError(`unexpected positional argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new LabInputError(`missing value for ${arg}`)
    index += 1
    if (key === 'p10c-run') options.p10cRun = value
    else if (key === 'out') options.out = value
    else if (key === 'max-false-positive-rate') options.maxFalsePositiveRate = Number(value)
    else if (key === 'max-median-burden-minutes') options.maxMedianBurdenMinutes = Number(value)
    else if (key === 'min-control-tasks') options.minControlTasks = Number(value)
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function numberOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) throw new LabInputError(`${name} must be a non-negative number`)
  return value
}

function requireRunFile(run: string, fileName: string): string {
  const runDir = assertSafeShadowOutDir(run)
  const reportPath = resolve(runDir, fileName)
  if (!fileExists(reportPath)) throw new LabInputError(`required report not found: ${reportPath}`)
  return runDir
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function burdenLevel(minutes: number): BurdenLevel {
  if (minutes <= 3) return 'low'
  if (minutes <= 8) return 'medium'
  return 'high'
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function buildOperatingSafetyProbes(outDir: string, requireOperatingSafety: boolean): OperatingSafetyProbeRow[] {
  if (!requireOperatingSafety) return []
  return operatingSafetyProbePlan.map((probe) => {
    const probeOut = resolve(outDir, 'operating-safety-probes', probe.fixtureId)
    const artifacts = runLab({
      fixture: probe.fixtureId,
      mode: 'shadow',
      out: probeOut,
    })
    const advisory = buildAdvisoryReport(artifacts)
    const actualBlocks = artifacts.operatingSafety.blocks
    const expectedCovered = probe.expectedBlocks.every((block) => actualBlocks.includes(block))
    const noUnexpectedCleanBlock = probe.expectedBlocks.length > 0 || actualBlocks.length === 0
    const decisionMatches = probe.expectedBlocks.length === 0
      ? advisory.stateMachine.decision === 'ready_for_owner_review_planning_only' ||
        advisory.stateMachine.decision === 'ready_for_execution'
      : advisory.stateMachine.decision === 'blocked_external' ||
        advisory.stateMachine.decision === 'operator_decision_required'
    const status = expectedCovered && noUnexpectedCleanBlock && decisionMatches ? 'pass' : 'fail'
    return {
      fixtureId: probe.fixtureId,
      expectedBlocks: [...probe.expectedBlocks],
      actualBlocks,
      advisoryDecision: advisory.stateMachine.decision,
      status,
      outDir: relative(repoRoot(), probeOut),
    }
  })
}

function canaryRows(widerReport: P10BWiderBlockingReport): CanaryDecisionRow[] {
  return [...widerReport.decisionRows].sort((a, b) => a.taskId.localeCompare(b.taskId)).map((row) => {
    const selectedFired = row.selectedRulesMatched.length > 0
    const canaryDecision = selectedFired ? 'blocked_by_selected_profile' : 'passed_through'
    const expectedDecision = row.sliceRole === 'positive_candidate' ? 'should_block' : 'should_pass'
    return {
      taskId: row.taskId,
      domain: row.domain,
      inputMode: row.inputMode,
      sliceRole: row.sliceRole,
      selectedRulesMatched: row.selectedRulesMatched,
      canaryDecision,
      expectedDecision,
      falsePositive: canaryDecision === 'blocked_by_selected_profile' && expectedDecision === 'should_pass',
      falseNegative: canaryDecision === 'passed_through' && expectedDecision === 'should_block',
      operatorMinutesAdded: row.operatorMinutesAdded,
      nextAction: selectedFired
        ? 'Block final claim under the selected canary profile until evidence closes or complete accepted-risk bypass is recorded.'
        : 'Pass through under the selected canary profile; keep deferred/global rules advisory.',
    }
  })
}

export function buildP10DReport(options: CliOptions): P10DGlobalEnablementCanaryReport {
  const p10cRunDir = requireRunFile(options.p10cRun ?? defaultP10CRun, 'p10c-selected-path-bypass-report.json')
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${timestampRunId('p10d-global-enablement-canary')}`)
  ensureDir(outDir)

  const maxFalsePositiveRate = numberOption(options.maxFalsePositiveRate, 0.1, 'max-false-positive-rate')
  const maxMedianBurdenMinutes = numberOption(options.maxMedianBurdenMinutes, 8, 'max-median-burden-minutes')
  const minControlTasks = numberOption(options.minControlTasks, 10, 'min-control-tasks')

  const p10cReport = readJson<P10CSelectedPathBypassReport>(resolve(p10cRunDir, 'p10c-selected-path-bypass-report.json'))
  if (p10cReport.status !== 'p10c_selected_path_bypass_gate_ready_global_disabled') {
    throw new LabInputError('P10D requires a passing P10C selected-path bypass report')
  }
  const p10bRunDir = requireRunFile(p10cReport.widerRunDir, 'p10b-wider-blocking-report.json')
  const widerReport = readJson<P10BWiderBlockingReport>(resolve(p10bRunDir, 'p10b-wider-blocking-report.json'))
  if (widerReport.status !== 'p10b_wider_blocking_profile_ready_global_disabled') {
    throw new LabInputError('P10D requires a passing P10B wider blocking report')
  }

  const probes = buildOperatingSafetyProbes(outDir, options.requireOperatingSafety ?? true)
  const rows = canaryRows(widerReport)
  const blockedRows = rows.filter((row) => row.canaryDecision === 'blocked_by_selected_profile')
  const controlRows = rows.filter((row) => row.expectedDecision === 'should_pass')
  const falsePositiveTasks = rows.filter((row) => row.falsePositive).length
  const falseNegativeTasks = rows.filter((row) => row.falseNegative).length
  const falsePositiveRate = rate(falsePositiveTasks, Math.max(blockedRows.length, 1))
  const medianBlockedOperatorMinutes = median(blockedRows.map((row) => row.operatorMinutesAdded))
  const p0Ready = (options.requireOperatingSafety ?? true)
    ? probes.length === operatingSafetyProbePlan.length && probes.every((probe) => probe.status === 'pass')
    : true
  const p10cReady = p10cReport.metrics.globalEnablementPrerequisiteMet &&
    p10cReport.metrics.selectedPathBypassCoverage === 'complete' &&
    p10cReport.metrics.acceptedFullClaimsAllowed === 0
  const p10bReady = widerReport.metrics.falsePositiveTasks === 0 &&
    widerReport.metrics.falseNegativeTasks === 0 &&
    widerReport.metrics.controlTasks >= minControlTasks &&
    widerReport.metrics.medianBlockedOperatorMinutes <= maxMedianBurdenMinutes
  const canaryPass = p10bReady &&
    p10cReady &&
    p0Ready &&
    controlRows.length >= minControlTasks &&
    falsePositiveTasks === 0 &&
    falseNegativeTasks === 0 &&
    falsePositiveRate <= maxFalsePositiveRate &&
    medianBlockedOperatorMinutes <= maxMedianBurdenMinutes

  const report: P10DGlobalEnablementCanaryReport = {
    schemaVersion: 1,
    status: canaryPass ? 'p10d_selected_profile_canary_ready_global_disabled' : 'p10d_selected_profile_canary_failed',
    p10cRunDir: relative(repoRoot(), p10cRunDir),
    p10bRunDir: relative(repoRoot(), p10bRunDir),
    outDir: relative(repoRoot(), outDir),
    blockingMode: 'selected_profile_global_canary',
    selectedRules: p10cReport.selectedRules,
    canaryBlockingEnabled: canaryPass,
    globalBlockingEnabled: false,
    productAcceptedFullAllowed: false,
    thresholds: {
      maxFalsePositiveRate,
      maxMedianBurdenMinutes,
      minControlTasks,
    },
    prerequisites: {
      p10bWiderProfileReady: p10bReady,
      p10cBypassReady: p10cReady,
      p0OperatingSafetyReady: p0Ready,
      rollbackPlanPresent: true,
      operatorOverrideRequiresAcceptedRisk: true,
    },
    metrics: {
      canaryTasks: rows.length,
      blockedTasks: blockedRows.length,
      controlTasks: controlRows.length,
      passThroughControls: controlRows.filter((row) => row.canaryDecision === 'passed_through').length,
      falsePositiveTasks,
      falseNegativeTasks,
      falsePositiveRate,
      medianBlockedOperatorMinutes,
      operatorBurdenLevel: burdenLevel(medianBlockedOperatorMinutes),
      operatingSafetyProbes: probes.length,
      operatingSafetyProbeFailures: probes.filter((probe) => probe.status === 'fail').length,
      starpomDecision: canaryPass ? 'enable_selected_profile_canary_only' : 'reject_global_canary',
    },
    operatingSafetyProbes: probes,
    decisionRows: rows,
    rollbackPlan: {
      trigger: [
        'any false positive in selected profile canary',
        'any false negative for selected positive candidate',
        'median blocked burden above threshold',
        'any failed P0 operating-safety probe',
        'any accepted_full claim through accepted-risk bypass',
      ],
      action: 'Disable selected-profile canary and return the failed row to advisory/P10E hardening.',
      owner: 'Captain / StarPom / Shipping',
    },
    nextAction: canaryPass
      ? 'Selected profile may move to a live opt-in runtime adapter/canary. Do not claim accepted_full until live adapter evidence exists.'
      : 'Repair failed P10D canary rows before any runtime adapter or global enablement claim.',
  }

  writeJson(resolve(outDir, 'p10d-global-enablement-canary-report.json'), report)
  writeJson(resolve(outDir, 'canary-decisions.json'), {
    schemaVersion: 1,
    blockingMode: report.blockingMode,
    selectedRules: report.selectedRules,
    rows: report.decisionRows,
  })
  writeJson(resolve(outDir, 'operating-safety-prerequisite.json'), {
    schemaVersion: 1,
    required: options.requireOperatingSafety ?? true,
    status: report.prerequisites.p0OperatingSafetyReady ? 'pass' : 'fail',
    rows: report.operatingSafetyProbes,
  })
  writeJson(resolve(outDir, 'global-enablement-decision.json'), {
    schemaVersion: 1,
    status: report.status,
    canaryBlockingEnabled: report.canaryBlockingEnabled,
    globalBlockingEnabled: report.globalBlockingEnabled,
    productAcceptedFullAllowed: report.productAcceptedFullAllowed,
    selectedRules: report.selectedRules,
    decision: report.metrics.starpomDecision,
    reason: report.nextAction,
  })
  writeText(resolve(outDir, 'p10d-global-enablement-canary-report.md'), renderMarkdown(report))
  return report
}

function renderMarkdown(report: P10DGlobalEnablementCanaryReport): string {
  const probes = report.operatingSafetyProbes
    .map((row) => `| ${row.fixtureId} | ${row.status} | ${row.expectedBlocks.join(', ') || '-'} | ${row.actualBlocks.join(', ') || '-'} | ${row.advisoryDecision} |`)
    .join('\n')
  const decisions = report.decisionRows
    .map((row) => `| ${row.taskId} | ${row.sliceRole} | ${row.selectedRulesMatched.join(', ') || '-'} | ${row.canaryDecision} | ${row.expectedDecision} | ${row.falsePositive} | ${row.falseNegative} | ${row.operatorMinutesAdded} |`)
    .join('\n')

  return `# P10D Global Enablement Decision Canary

Status: ${report.status}
P10C run: ${report.p10cRunDir}
P10B run: ${report.p10bRunDir}
Blocking mode: ${report.blockingMode}
Canary blocking enabled: ${report.canaryBlockingEnabled}
Global blocking enabled: ${report.globalBlockingEnabled}
Product accepted_full allowed: ${report.productAcceptedFullAllowed}

## Metrics

- canaryTasks: ${report.metrics.canaryTasks}
- blockedTasks: ${report.metrics.blockedTasks}
- controlTasks: ${report.metrics.controlTasks}
- passThroughControls: ${report.metrics.passThroughControls}
- falsePositiveTasks: ${report.metrics.falsePositiveTasks}
- falseNegativeTasks: ${report.metrics.falseNegativeTasks}
- falsePositiveRate: ${report.metrics.falsePositiveRate.toFixed(2)}
- medianBlockedOperatorMinutes: ${report.metrics.medianBlockedOperatorMinutes}
- operatorBurdenLevel: ${report.metrics.operatorBurdenLevel}
- operatingSafetyProbes: ${report.metrics.operatingSafetyProbes}
- operatingSafetyProbeFailures: ${report.metrics.operatingSafetyProbeFailures}
- starpomDecision: ${report.metrics.starpomDecision}

## Prerequisites

- p10bWiderProfileReady: ${report.prerequisites.p10bWiderProfileReady}
- p10cBypassReady: ${report.prerequisites.p10cBypassReady}
- p0OperatingSafetyReady: ${report.prerequisites.p0OperatingSafetyReady}
- rollbackPlanPresent: ${report.prerequisites.rollbackPlanPresent}
- operatorOverrideRequiresAcceptedRisk: ${report.prerequisites.operatorOverrideRequiresAcceptedRisk}

## Operating Safety Probes

| Fixture | Status | Expected Blocks | Actual Blocks | Advisory Decision |
|---|---|---|---|---|
${probes}

## Canary Decisions

| Task | Slice Role | Selected Rules | Canary Decision | Expected | FP | FN | Operator Minutes |
|---|---|---|---|---|---|---|---:|
${decisions}

## Rollback

Owner: ${report.rollbackPlan.owner}

Action: ${report.rollbackPlan.action}

Triggers:

${report.rollbackPlan.trigger.map((item) => `- ${item}`).join('\n')}

## Next Action

${report.nextAction}
`
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = buildP10DReport(options)
    const summary = {
      status: report.status,
      outDir: report.outDir,
      selectedRules: report.selectedRules,
      canaryBlockingEnabled: report.canaryBlockingEnabled,
      globalBlockingEnabled: report.globalBlockingEnabled,
      productAcceptedFullAllowed: report.productAcceptedFullAllowed,
      canaryTasks: report.metrics.canaryTasks,
      blockedTasks: report.metrics.blockedTasks,
      controlTasks: report.metrics.controlTasks,
      falsePositiveTasks: report.metrics.falsePositiveTasks,
      falseNegativeTasks: report.metrics.falseNegativeTasks,
      operatingSafetyProbeFailures: report.metrics.operatingSafetyProbeFailures,
      report: `${report.outDir}/p10d-global-enablement-canary-report.json`,
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`P10D global enablement canary: ${summary.status}`)
      console.log(`selectedRules: ${summary.selectedRules.join(', ')}`)
      console.log(`canaryBlockingEnabled: ${summary.canaryBlockingEnabled}`)
      console.log(`globalBlockingEnabled: ${summary.globalBlockingEnabled}`)
      console.log(`report: ${summary.report}`)
    }
    process.exitCode = report.status === 'p10d_selected_profile_canary_ready_global_disabled' ? 0 : 2
  } catch (error) {
    if (error instanceof LabUnsafeWriteError || error instanceof LabInputError) {
      console.error(error.message)
      process.exitCode = error.code
      return
    }
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 4
  }
}

function isDirectEntrypoint(fileName: string): boolean {
  const entrypoint = (process.argv[1] ?? '').replace(/\\/g, '/')
  return entrypoint.endsWith(`/packages/core/src/${fileName}`) || entrypoint.endsWith(`/scripts/captain-lab/${fileName}`)
}

if (isDirectEntrypoint('p10d-global-enablement-canary.ts')) main()
