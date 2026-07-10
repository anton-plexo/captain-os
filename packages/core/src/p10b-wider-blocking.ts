import { relative, resolve } from 'node:path'
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

type P9BDomain = 'ui' | 'cms' | 'security' | 'shipping' | 'data' | 'strategy' | 'mixed'
type P9BInputMode = 'baseline_advisory' | 'advisory_with_spec' | 'paired_comparison'
type BurdenLevel = 'low' | 'medium' | 'high'

interface CliOptions {
  sourceRun?: string
  narrowRun?: string
  out?: string
  maxFalsePositiveRate?: number
  maxMedianBurdenMinutes?: number
  minControlTasks?: number
  json?: boolean
}

interface P10Candidate {
  ruleId: string
  status: 'candidate_selected_not_blocking' | 'deferred_more_evidence_needed'
  correctCatches: number
  falsePositiveTasks: number
  falseNegativeTasks: number
  medianOperatorMinutes: number
  evidenceTasks: string[]
  reason: string
}

interface ReconciliationTaskRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  advisoryDecision: string
  p9dBlocks: string[]
  consensusOutcome: string
  residualFalsePositiveAfterP9E: boolean
  residualFalseNegativeAfterP9E: boolean
  operatorMinutesAdded: number
  p10CandidateRules: string[]
}

interface ReconciliationReport {
  schemaVersion: 1
  status: 'p9b_reconciled_p10_candidates_selected'
  runId: string
  corpusId: string
  taskRows: ReconciliationTaskRow[]
  p10Candidates: P10Candidate[]
  p10Deferred: P10Candidate[]
}

interface P10NarrowReport {
  schemaVersion: 1
  status: 'p10_narrow_blocking_rollout_ready' | 'p10_narrow_blocking_rollout_failed'
  selectedRules: string[]
  globalBlockingEnabled: false
}

interface P10BWiderDecisionRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  sliceRole: 'positive_candidate' | 'clean_pass_control' | 'deferred_rule_control' | 'unrelated_serious_control'
  selectedRulesMatched: string[]
  deferredRulesMatched: string[]
  failClosedDecision: 'blocked_fail_closed' | 'pass_through'
  expectedDecision: 'should_block' | 'should_pass'
  falsePositive: boolean
  falseNegative: boolean
  operatorMinutesAdded: number
  acceptedRiskBypassAttempted: boolean
  acceptedRiskBypassAccepted: boolean
  nextAction: string
}

interface P10BRuleRow {
  ruleId: string
  status: 'wider_rollout_pass' | 'wider_rollout_fail'
  evaluatedTasks: number
  positiveTasks: number
  controlTasks: number
  blockedTasks: number
  falsePositiveTasks: number
  falseNegativeTasks: number
  falsePositiveRate: number
  medianOperatorMinutes: number
  evidenceTasks: string[]
}

interface P10BWiderBlockingReport {
  schemaVersion: 1
  status: 'p10b_wider_blocking_profile_ready_global_disabled' | 'p10b_wider_blocking_profile_failed'
  sourceRunId: string
  sourceRunDir: string
  narrowRunDir: string
  outDir: string
  blockingMode: 'fail_closed_wider_profile'
  globalBlockingEnabled: false
  selectedRules: string[]
  deferredRules: string[]
  thresholds: {
    maxFalsePositiveRate: number
    maxMedianBurdenMinutes: number
    minControlTasks: number
  }
  metrics: {
    sliceTasks: number
    positiveCandidateTasks: number
    controlTasks: number
    cleanPassControls: number
    deferredRuleControls: number
    unrelatedSeriousControls: number
    blockedTasks: number
    passThroughControls: number
    falsePositiveTasks: number
    falseNegativeTasks: number
    falsePositiveRate: number
    controlPassThroughRate: number
    medianBlockedOperatorMinutes: number
    medianAllOperatorMinutes: number
    operatorBurdenLevel: BurdenLevel
    acceptedRiskBypassAttempts: number
    acceptedRiskBlockingPathAttempts: number
    acceptedRiskBypassAccepted: number
    acceptedRiskBypassCoverage: 'not_exercised' | 'control_only' | 'blocking_path_exercised'
    starpomDecision: 'accept_wider_profile_keep_global_disabled' | 'reject_wider_profile'
    globalEnablementAllowed: false
  }
  ruleRows: P10BRuleRow[]
  decisionRows: P10BWiderDecisionRow[]
  nextAction: string
}

const defaultSourceRun = '.ship/lab/runs/manual-p9b-live-metrics-batch0-p9e3'
const defaultNarrowRun = '.ship/lab/runs/manual-p10-narrow-blocking-rollout'

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (!arg.startsWith('--')) throw new LabInputError(`unexpected positional argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new LabInputError(`missing value for ${arg}`)
    index += 1
    if (key === 'source-run') options.sourceRun = value
    else if (key === 'narrow-run') options.narrowRun = value
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

function requireRunDir(run: string, requiredFile: string): string {
  const runDir = assertSafeShadowOutDir(run)
  const reportPath = resolve(runDir, requiredFile)
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

function intersects(left: string[], right: string[]): boolean {
  return left.some((value) => right.includes(value))
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function selectedRulesFrom(reconciliation: ReconciliationReport, narrowReport: P10NarrowReport): string[] {
  if (narrowReport.status !== 'p10_narrow_blocking_rollout_ready') {
    throw new LabInputError('P10B requires a passing P10 narrow rollout')
  }
  const selected = reconciliation.p10Candidates
    .filter((candidate) => candidate.status === 'candidate_selected_not_blocking')
    .map((candidate) => candidate.ruleId)
    .sort()
  const narrow = [...narrowReport.selectedRules].sort()
  if (selected.join('|') !== narrow.join('|')) {
    throw new LabInputError(`P10 narrow selected rules do not match P9B reconciliation: ${narrow.join(', ')}`)
  }
  return selected
}

function decisionRows(
  reconciliation: ReconciliationReport,
  selectedRules: string[],
  deferredRules: string[],
): P10BWiderDecisionRow[] {
  const expectedBlockingTaskIds = new Set(reconciliation.p10Candidates.flatMap((candidate) => candidate.evidenceTasks))
  return [...reconciliation.taskRows].sort((a, b) => a.taskId.localeCompare(b.taskId)).map((row) => {
    const selectedRulesMatched = row.p10CandidateRules.filter((rule) => selectedRules.includes(rule))
    const deferredRulesMatched = row.p10CandidateRules.filter((rule) => deferredRules.includes(rule))
    const selectedRuleFired = selectedRulesMatched.length > 0
    const expectedShouldBlock = expectedBlockingTaskIds.has(row.taskId)
    const failClosedDecision = selectedRuleFired ? 'blocked_fail_closed' : 'pass_through'
    const sliceRole = expectedShouldBlock
      ? 'positive_candidate'
      : row.consensusOutcome === 'machine_true_pass_candidate'
        ? 'clean_pass_control'
        : deferredRulesMatched.length > 0
          ? 'deferred_rule_control'
          : 'unrelated_serious_control'
    const acceptedRiskBypassAttempted = /accepted[-_ ]risk/.test(row.taskId)
    return {
      taskId: row.taskId,
      domain: row.domain,
      inputMode: row.inputMode,
      sliceRole,
      selectedRulesMatched,
      deferredRulesMatched,
      failClosedDecision,
      expectedDecision: expectedShouldBlock ? 'should_block' : 'should_pass',
      falsePositive: failClosedDecision === 'blocked_fail_closed' && !expectedShouldBlock,
      falseNegative: failClosedDecision === 'pass_through' && expectedShouldBlock,
      operatorMinutesAdded: row.operatorMinutesAdded,
      acceptedRiskBypassAttempted,
      acceptedRiskBypassAccepted: false,
      nextAction: selectedRuleFired
        ? 'Keep selected P10 rule fail-closed for serious tasks unless a complete accepted-risk bypass is recorded.'
        : 'Pass through this wider control row; do not let selected P10 rules block unrelated failure classes.',
    }
  })
}

function ruleRows(
  candidates: P10Candidate[],
  rows: P10BWiderDecisionRow[],
  maxFalsePositiveRate: number,
  maxMedianBurdenMinutes: number,
): P10BRuleRow[] {
  return candidates.map((candidate) => {
    const positiveTaskIds = new Set(candidate.evidenceTasks)
    const matchingRows = rows.filter((row) => row.selectedRulesMatched.includes(candidate.ruleId))
    const falsePositiveTasks = matchingRows.filter((row) => row.falsePositive).length
    const falseNegativeTasks = rows.filter((row) => positiveTaskIds.has(row.taskId) && row.falseNegative).length
    const blockedTasks = matchingRows.filter((row) => row.failClosedDecision === 'blocked_fail_closed').length
    const medianOperatorMinutes = median(matchingRows.map((row) => row.operatorMinutesAdded))
    const falsePositiveRate = rate(falsePositiveTasks, Math.max(blockedTasks, 1))
    const pass = falsePositiveTasks === 0 &&
      falseNegativeTasks === 0 &&
      falsePositiveRate <= maxFalsePositiveRate &&
      medianOperatorMinutes <= maxMedianBurdenMinutes
    return {
      ruleId: candidate.ruleId,
      status: pass ? 'wider_rollout_pass' : 'wider_rollout_fail',
      evaluatedTasks: rows.length,
      positiveTasks: candidate.evidenceTasks.length,
      controlTasks: rows.length - candidate.evidenceTasks.length,
      blockedTasks,
      falsePositiveTasks,
      falseNegativeTasks,
      falsePositiveRate,
      medianOperatorMinutes,
      evidenceTasks: candidate.evidenceTasks,
    }
  })
}

function buildReport(options: CliOptions): P10BWiderBlockingReport {
  const sourceRunDir = requireRunDir(options.sourceRun ?? defaultSourceRun, 'p9b-judge-reconciliation-report.json')
  const narrowRunDir = requireRunDir(options.narrowRun ?? defaultNarrowRun, 'p10-narrow-blocking-report.json')
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${timestampRunId('p10b-wider-blocking')}`)
  ensureDir(outDir)

  const maxFalsePositiveRate = numberOption(options.maxFalsePositiveRate, 0.1, 'max-false-positive-rate')
  const maxMedianBurdenMinutes = numberOption(options.maxMedianBurdenMinutes, 8, 'max-median-burden-minutes')
  const minControlTasks = numberOption(options.minControlTasks, 10, 'min-control-tasks')

  const reconciliation = readJson<ReconciliationReport>(resolve(sourceRunDir, 'p9b-judge-reconciliation-report.json'))
  const narrowReport = readJson<P10NarrowReport>(resolve(narrowRunDir, 'p10-narrow-blocking-report.json'))
  const selectedRules = selectedRulesFrom(reconciliation, narrowReport)
  const deferredRules = reconciliation.p10Deferred.map((candidate) => candidate.ruleId).sort()
  const selectedCandidates = reconciliation.p10Candidates
    .filter((candidate) => selectedRules.includes(candidate.ruleId))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId))
  const rows = decisionRows(reconciliation, selectedRules, deferredRules)
  const rules = ruleRows(selectedCandidates, rows, maxFalsePositiveRate, maxMedianBurdenMinutes)
  const blockedRows = rows.filter((row) => row.failClosedDecision === 'blocked_fail_closed')
  const controlRows = rows.filter((row) => row.sliceRole !== 'positive_candidate')
  const falsePositiveTasks = rows.filter((row) => row.falsePositive).length
  const falseNegativeTasks = rows.filter((row) => row.falseNegative).length
  const medianBlockedOperatorMinutes = median(blockedRows.map((row) => row.operatorMinutesAdded))
  const acceptedRiskBypassAttempts = rows.filter((row) => row.acceptedRiskBypassAttempted).length
  const acceptedRiskBlockingPathAttempts = rows.filter((row) => row.acceptedRiskBypassAttempted && row.selectedRulesMatched.length > 0).length
  const acceptedRiskBypassAccepted = rows.filter((row) => row.acceptedRiskBypassAccepted).length
  const profilePass = rules.every((row) => row.status === 'wider_rollout_pass') &&
    controlRows.length >= minControlTasks &&
    falsePositiveTasks === 0 &&
    falseNegativeTasks === 0 &&
    medianBlockedOperatorMinutes <= maxMedianBurdenMinutes

  const report: P10BWiderBlockingReport = {
    schemaVersion: 1,
    status: profilePass ? 'p10b_wider_blocking_profile_ready_global_disabled' : 'p10b_wider_blocking_profile_failed',
    sourceRunId: reconciliation.runId,
    sourceRunDir: relative(repoRoot(), sourceRunDir),
    narrowRunDir: relative(repoRoot(), narrowRunDir),
    outDir: relative(repoRoot(), outDir),
    blockingMode: 'fail_closed_wider_profile',
    globalBlockingEnabled: false,
    selectedRules,
    deferredRules,
    thresholds: {
      maxFalsePositiveRate,
      maxMedianBurdenMinutes,
      minControlTasks,
    },
    metrics: {
      sliceTasks: rows.length,
      positiveCandidateTasks: rows.filter((row) => row.sliceRole === 'positive_candidate').length,
      controlTasks: controlRows.length,
      cleanPassControls: rows.filter((row) => row.sliceRole === 'clean_pass_control').length,
      deferredRuleControls: rows.filter((row) => row.sliceRole === 'deferred_rule_control').length,
      unrelatedSeriousControls: rows.filter((row) => row.sliceRole === 'unrelated_serious_control').length,
      blockedTasks: blockedRows.length,
      passThroughControls: controlRows.filter((row) => row.failClosedDecision === 'pass_through').length,
      falsePositiveTasks,
      falseNegativeTasks,
      falsePositiveRate: rate(falsePositiveTasks, Math.max(blockedRows.length, 1)),
      controlPassThroughRate: rate(controlRows.filter((row) => row.failClosedDecision === 'pass_through').length, controlRows.length),
      medianBlockedOperatorMinutes,
      medianAllOperatorMinutes: median(rows.map((row) => row.operatorMinutesAdded)),
      operatorBurdenLevel: burdenLevel(medianBlockedOperatorMinutes),
      acceptedRiskBypassAttempts,
      acceptedRiskBlockingPathAttempts,
      acceptedRiskBypassAccepted,
      acceptedRiskBypassCoverage: acceptedRiskBlockingPathAttempts > 0
        ? 'blocking_path_exercised'
        : acceptedRiskBypassAttempts > 0
          ? 'control_only'
          : 'not_exercised',
      starpomDecision: profilePass ? 'accept_wider_profile_keep_global_disabled' : 'reject_wider_profile',
      globalEnablementAllowed: false,
    },
    ruleRows: rules,
    decisionRows: rows,
    nextAction: profilePass
      ? 'Keep selected rules fail-closed for serious tasks in a bounded profile; add an accepted-risk bypass exercise before any global enablement.'
      : 'Repair wider profile false positives, false negatives, or burden before continuing rollout.',
  }

  writeJson(resolve(outDir, 'p10b-wider-blocking-report.json'), report)
  writeJson(resolve(outDir, 'blocking-decisions.json'), {
    schemaVersion: 1,
    blockingMode: report.blockingMode,
    selectedRules: report.selectedRules,
    rows: report.decisionRows,
  })
  writeJson(resolve(outDir, 'global-enablement-decision.json'), {
    schemaVersion: 1,
    status: 'global_blocking_disabled',
    allowed: false,
    reason: report.metrics.acceptedRiskBypassCoverage !== 'blocking_path_exercised'
      ? 'Selected profile passed the wider slice, but accepted-risk bypass was not exercised on a selected blocking path.'
      : 'Selected profile is still bounded to serious-task rollout.',
    selectedRules: report.selectedRules,
    nextAction: report.nextAction,
  })
  writeText(resolve(outDir, 'p10b-wider-blocking-report.md'), renderMarkdown(report))
  return report
}

function renderMarkdown(report: P10BWiderBlockingReport): string {
  const rules = report.ruleRows
    .map((row) => `| ${row.ruleId} | ${row.status} | ${row.evaluatedTasks} | ${row.blockedTasks} | ${row.falsePositiveTasks} | ${row.falseNegativeTasks} | ${row.falsePositiveRate.toFixed(2)} | ${row.medianOperatorMinutes} |`)
    .join('\n')
  const decisions = report.decisionRows
    .map((row) => `| ${row.taskId} | ${row.sliceRole} | ${row.selectedRulesMatched.join(', ') || '-'} | ${row.deferredRulesMatched.join(', ') || '-'} | ${row.failClosedDecision} | ${row.falsePositive} | ${row.falseNegative} | ${row.acceptedRiskBypassAttempted} | ${row.operatorMinutesAdded} |`)
    .join('\n')

  return `# P10B Wider Blocking Rollout Report

Status: ${report.status}
Source run: ${report.sourceRunDir}
Narrow run: ${report.narrowRunDir}
Blocking mode: ${report.blockingMode}
Global blocking enabled: ${report.globalBlockingEnabled}

## Metrics

- sliceTasks: ${report.metrics.sliceTasks}
- positiveCandidateTasks: ${report.metrics.positiveCandidateTasks}
- controlTasks: ${report.metrics.controlTasks}
- cleanPassControls: ${report.metrics.cleanPassControls}
- deferredRuleControls: ${report.metrics.deferredRuleControls}
- unrelatedSeriousControls: ${report.metrics.unrelatedSeriousControls}
- blockedTasks: ${report.metrics.blockedTasks}
- passThroughControls: ${report.metrics.passThroughControls}
- falsePositiveTasks: ${report.metrics.falsePositiveTasks}
- falseNegativeTasks: ${report.metrics.falseNegativeTasks}
- falsePositiveRate: ${report.metrics.falsePositiveRate.toFixed(2)}
- controlPassThroughRate: ${report.metrics.controlPassThroughRate.toFixed(2)}
- medianBlockedOperatorMinutes: ${report.metrics.medianBlockedOperatorMinutes}
- medianAllOperatorMinutes: ${report.metrics.medianAllOperatorMinutes}
- operatorBurdenLevel: ${report.metrics.operatorBurdenLevel}
- acceptedRiskBypassAttempts: ${report.metrics.acceptedRiskBypassAttempts}
- acceptedRiskBlockingPathAttempts: ${report.metrics.acceptedRiskBlockingPathAttempts}
- acceptedRiskBypassCoverage: ${report.metrics.acceptedRiskBypassCoverage}
- starpomDecision: ${report.metrics.starpomDecision}
- globalEnablementAllowed: ${report.metrics.globalEnablementAllowed}

## Rule Rows

| Rule | Status | Evaluated | Blocked | FP Tasks | FN Tasks | FP Rate | Median Minutes |
|---|---|---:|---:|---:|---:|---:|---:|
${rules}

## Decision Rows

| Task | Slice Role | Selected Rules | Deferred Rules | Decision | FP | FN | Bypass Attempt | Operator Minutes |
|---|---|---|---|---|---|---|---|---:|
${decisions}

## Next Action

${report.nextAction}
`
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = buildReport(options)
    const summary = {
      status: report.status,
      outDir: report.outDir,
      selectedRules: report.selectedRules,
      sliceTasks: report.metrics.sliceTasks,
      controlTasks: report.metrics.controlTasks,
      blockedTasks: report.metrics.blockedTasks,
      falsePositiveTasks: report.metrics.falsePositiveTasks,
      falseNegativeTasks: report.metrics.falseNegativeTasks,
      falsePositiveRate: report.metrics.falsePositiveRate,
      medianBlockedOperatorMinutes: report.metrics.medianBlockedOperatorMinutes,
      acceptedRiskBypassCoverage: report.metrics.acceptedRiskBypassCoverage,
      globalBlockingEnabled: report.globalBlockingEnabled,
      report: `${report.outDir}/p10b-wider-blocking-report.json`,
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`P10B wider blocking: ${summary.status}`)
      console.log(`selectedRules: ${summary.selectedRules.join(', ')}`)
      console.log(`sliceTasks: ${summary.sliceTasks}`)
      console.log(`falsePositiveRate: ${summary.falsePositiveRate}`)
      console.log(`report: ${summary.report}`)
    }
    process.exitCode = report.status === 'p10b_wider_blocking_profile_ready_global_disabled' ? 0 : 2
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

if (isDirectEntrypoint('p10b-wider-blocking.ts')) main()
