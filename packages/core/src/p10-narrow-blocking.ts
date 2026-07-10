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
  out?: string
  maxFalsePositiveRate?: number
  maxMedianBurdenMinutes?: number
  minCorrectCatches?: number
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
  reportsExpected: number
  reportsReceived: number
  metrics: {
    tasks: number
    residualFalsePositiveAfterP9E: number
    residualFalseNegativeAfterP9E: number
    medianOperatorMinutesAdded: number
    operatorBurdenLevel: BurdenLevel
  }
  taskRows: ReconciliationTaskRow[]
  p10Candidates: P10Candidate[]
  p10Deferred: P10Candidate[]
}

interface BlockingDecisionRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  sliceRole: 'positive_candidate' | 'clean_pass_control' | 'deferred_rule_control'
  selectedRulesMatched: string[]
  deferredRulesMatched: string[]
  failClosedDecision: 'blocked_fail_closed' | 'pass_through'
  expectedDecision: 'should_block' | 'should_pass'
  falsePositive: boolean
  falseNegative: boolean
  operatorMinutesAdded: number
  acceptedRiskBypass: false
  nextAction: string
}

interface RuleRolloutRow {
  ruleId: string
  status: 'blocking_rollout_pass' | 'blocking_rollout_fail'
  evaluatedTasks: number
  blockedTasks: number
  correctCatches: number
  falsePositiveTasks: number
  falseNegativeTasks: number
  falsePositiveRate: number
  medianOperatorMinutes: number
  operatorBurdenAcceptable: boolean
  evidenceTasks: string[]
}

interface P10NarrowBlockingReport {
  schemaVersion: 1
  status: 'p10_narrow_blocking_rollout_ready' | 'p10_narrow_blocking_rollout_failed'
  sourceRunId: string
  sourceRunDir: string
  outDir: string
  blockingMode: 'fail_closed_narrow'
  globalBlockingEnabled: false
  selectedRules: string[]
  deferredRules: string[]
  thresholds: {
    maxFalsePositiveRate: number
    maxMedianBurdenMinutes: number
    minCorrectCatches: number
  }
  metrics: {
    sliceTasks: number
    positiveCandidateTasks: number
    controlTasks: number
    blockedTasks: number
    falsePositiveTasks: number
    falseNegativeTasks: number
    falsePositiveRate: number
    medianBlockedOperatorMinutes: number
    operatorBurdenLevel: BurdenLevel
    acceptedRiskBypassCount: 0
    starpomDecision: 'accept_narrow_blocking' | 'reject_narrow_blocking'
  }
  ruleRows: RuleRolloutRow[]
  decisionRows: BlockingDecisionRow[]
  nextAction: string
}

const defaultSourceRun = '.ship/lab/runs/manual-p9b-live-metrics-batch0-p9e3'

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
    else if (key === 'out') options.out = value
    else if (key === 'max-false-positive-rate') options.maxFalsePositiveRate = Number(value)
    else if (key === 'max-median-burden-minutes') options.maxMedianBurdenMinutes = Number(value)
    else if (key === 'min-correct-catches') options.minCorrectCatches = Number(value)
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function numberOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) throw new LabInputError(`${name} must be a non-negative number`)
  return value
}

function requireSourceRun(run: string): string {
  const sourceRunDir = assertSafeShadowOutDir(run)
  const reportPath = resolve(sourceRunDir, 'p9b-judge-reconciliation-report.json')
  const candidatePath = resolve(sourceRunDir, 'p10-candidates.json')
  if (!fileExists(reportPath)) throw new LabInputError(`P9B reconciliation report not found: ${reportPath}`)
  if (!fileExists(candidatePath)) throw new LabInputError(`P10 candidates report not found: ${candidatePath}`)
  return sourceRunDir
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

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function intersects(left: string[], right: string[]): boolean {
  return left.some((value) => right.includes(value))
}

function falsePositiveRate(falsePositiveTasks: number, blockedTasks: number): number {
  return blockedTasks === 0 ? 0 : falsePositiveTasks / blockedTasks
}

function sliceRows(report: ReconciliationReport, selectedRules: string[]): ReconciliationTaskRow[] {
  const selectedTaskIds = new Set(report.p10Candidates.flatMap((candidate) => candidate.evidenceTasks))
  const positiveRows = report.taskRows.filter((row) => selectedTaskIds.has(row.taskId) || intersects(row.p10CandidateRules, selectedRules))
  const controlRows = report.taskRows.filter((row) => {
    if (intersects(row.p10CandidateRules, selectedRules)) return false
    if (row.consensusOutcome === 'machine_true_pass_candidate') return true
    return row.p10CandidateRules.length > 0
  })
  const byId = new Map<string, ReconciliationTaskRow>()
  for (const row of [...positiveRows, ...controlRows]) byId.set(row.taskId, row)
  return [...byId.values()].sort((a, b) => a.taskId.localeCompare(b.taskId))
}

function decisionRows(
  rows: ReconciliationTaskRow[],
  selectedRules: string[],
  deferredRules: string[],
  expectedBlockingTaskIds: Set<string>,
): BlockingDecisionRow[] {
  return rows.map((row) => {
    const selectedRulesMatched = row.p10CandidateRules.filter((rule) => selectedRules.includes(rule))
    const deferredRulesMatched = row.p10CandidateRules.filter((rule) => deferredRules.includes(rule))
    const selectedRuleFired = selectedRulesMatched.length > 0
    const expectedShouldBlock = expectedBlockingTaskIds.has(row.taskId)
    const failClosedDecision = selectedRuleFired ? 'blocked_fail_closed' : 'pass_through'
    const sliceRole = expectedShouldBlock
      ? 'positive_candidate'
      : row.consensusOutcome === 'machine_true_pass_candidate'
        ? 'clean_pass_control'
        : 'deferred_rule_control'
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
      acceptedRiskBypass: false,
      nextAction: selectedRuleFired
        ? 'Block final claim until the selected P10 rule is satisfied or an accepted-risk bypass is recorded.'
        : 'Do not block on this narrow P10 profile; keep deferred rules advisory until more evidence exists.',
    }
  })
}

function ruleRows(
  selectedCandidates: P10Candidate[],
  rows: BlockingDecisionRow[],
  maxFalsePositiveRate: number,
  maxMedianBurdenMinutes: number,
  minCorrectCatches: number,
): RuleRolloutRow[] {
  return selectedCandidates.map((candidate) => {
    const matchingRows = rows.filter((row) => row.selectedRulesMatched.includes(candidate.ruleId))
    const falsePositiveTasks = matchingRows.filter((row) => row.falsePositive).length
    const falseNegativeTasks = matchingRows.filter((row) => row.falseNegative).length
    const blockedTasks = matchingRows.filter((row) => row.failClosedDecision === 'blocked_fail_closed').length
    const medianOperatorMinutes = median(matchingRows.map((row) => row.operatorMinutesAdded))
    const rate = falsePositiveRate(falsePositiveTasks, blockedTasks)
    const operatorBurdenAcceptable = medianOperatorMinutes <= maxMedianBurdenMinutes
    const pass = candidate.correctCatches >= minCorrectCatches &&
      falseNegativeTasks === 0 &&
      rate <= maxFalsePositiveRate &&
      operatorBurdenAcceptable
    return {
      ruleId: candidate.ruleId,
      status: pass ? 'blocking_rollout_pass' : 'blocking_rollout_fail',
      evaluatedTasks: matchingRows.length,
      blockedTasks,
      correctCatches: candidate.correctCatches,
      falsePositiveTasks,
      falseNegativeTasks,
      falsePositiveRate: rate,
      medianOperatorMinutes,
      operatorBurdenAcceptable,
      evidenceTasks: candidate.evidenceTasks,
    }
  })
}

function buildReport(options: CliOptions): P10NarrowBlockingReport {
  const sourceRun = options.sourceRun ?? defaultSourceRun
  const sourceRunDir = requireSourceRun(sourceRun)
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${timestampRunId('p10-narrow-blocking')}`)
  ensureDir(outDir)

  const maxFalsePositiveRateOption = numberOption(options.maxFalsePositiveRate, 0.1, 'max-false-positive-rate')
  const maxMedianBurdenMinutes = numberOption(options.maxMedianBurdenMinutes, 8, 'max-median-burden-minutes')
  const minCorrectCatches = numberOption(options.minCorrectCatches, 3, 'min-correct-catches')

  const reconciliation = readJson<ReconciliationReport>(resolve(sourceRunDir, 'p9b-judge-reconciliation-report.json'))
  const selectedCandidates = reconciliation.p10Candidates.filter((candidate) => candidate.status === 'candidate_selected_not_blocking')
  if (selectedCandidates.length === 0) throw new LabInputError('no selected P10 candidates found')
  const selectedRules = selectedCandidates.map((candidate) => candidate.ruleId)
  const deferredRules = reconciliation.p10Deferred.map((candidate) => candidate.ruleId)
  const expectedBlockingTaskIds = new Set(selectedCandidates.flatMap((candidate) => candidate.evidenceTasks))
  const rows = decisionRows(sliceRows(reconciliation, selectedRules), selectedRules, deferredRules, expectedBlockingTaskIds)
  const rules = ruleRows(selectedCandidates, rows, maxFalsePositiveRateOption, maxMedianBurdenMinutes, minCorrectCatches)
  const blockedRows = rows.filter((row) => row.failClosedDecision === 'blocked_fail_closed')
  const falsePositiveTasks = rows.filter((row) => row.falsePositive).length
  const falseNegativeTasks = rows.filter((row) => row.falseNegative).length
  const medianBlockedOperatorMinutes = median(blockedRows.map((row) => row.operatorMinutesAdded))
  const rolloutPass = rules.every((row) => row.status === 'blocking_rollout_pass') &&
    falseNegativeTasks === 0 &&
    falsePositiveRate(falsePositiveTasks, blockedRows.length) <= maxFalsePositiveRateOption &&
    medianBlockedOperatorMinutes <= maxMedianBurdenMinutes

  const report: P10NarrowBlockingReport = {
    schemaVersion: 1,
    status: rolloutPass ? 'p10_narrow_blocking_rollout_ready' : 'p10_narrow_blocking_rollout_failed',
    sourceRunId: reconciliation.runId,
    sourceRunDir: relative(repoRoot(), sourceRunDir),
    outDir: relative(repoRoot(), outDir),
    blockingMode: 'fail_closed_narrow',
    globalBlockingEnabled: false,
    selectedRules,
    deferredRules,
    thresholds: {
      maxFalsePositiveRate: maxFalsePositiveRateOption,
      maxMedianBurdenMinutes,
      minCorrectCatches,
    },
    metrics: {
      sliceTasks: rows.length,
      positiveCandidateTasks: rows.filter((row) => row.sliceRole === 'positive_candidate').length,
      controlTasks: rows.filter((row) => row.sliceRole !== 'positive_candidate').length,
      blockedTasks: blockedRows.length,
      falsePositiveTasks,
      falseNegativeTasks,
      falsePositiveRate: falsePositiveRate(falsePositiveTasks, blockedRows.length),
      medianBlockedOperatorMinutes,
      operatorBurdenLevel: burdenLevel(medianBlockedOperatorMinutes),
      acceptedRiskBypassCount: 0,
      starpomDecision: rolloutPass ? 'accept_narrow_blocking' : 'reject_narrow_blocking',
    },
    ruleRows: rules,
    decisionRows: rows,
    nextAction: rolloutPass
      ? 'Wire this profile as a narrow blocking gate for serious tasks only; keep deferred rules advisory and keep global blocking disabled.'
      : 'Keep selected rules advisory and repair false positives, false negatives, or operator burden before blocking rollout.',
  }

  writeJson(resolve(outDir, 'p10-narrow-blocking-report.json'), report)
  writeJson(resolve(outDir, 'blocking-decisions.json'), {
    schemaVersion: 1,
    blockingMode: report.blockingMode,
    selectedRules: report.selectedRules,
    rows: report.decisionRows,
  })
  writeJson(resolve(outDir, 'p10-selected-rules.json'), {
    schemaVersion: 1,
    status: report.status,
    globalBlockingEnabled: false,
    selectedRules: report.ruleRows,
    deferredRules: report.deferredRules,
  })
  writeText(resolve(outDir, 'p10-narrow-blocking-report.md'), renderMarkdown(report))
  return report
}

function renderMarkdown(report: P10NarrowBlockingReport): string {
  const rules = report.ruleRows
    .map((row) => `| ${row.ruleId} | ${row.status} | ${row.correctCatches} | ${row.falsePositiveTasks} | ${row.falseNegativeTasks} | ${row.falsePositiveRate.toFixed(2)} | ${row.medianOperatorMinutes} |`)
    .join('\n')
  const decisions = report.decisionRows
    .map((row) => `| ${row.taskId} | ${row.sliceRole} | ${row.selectedRulesMatched.join(', ') || '-'} | ${row.deferredRulesMatched.join(', ') || '-'} | ${row.failClosedDecision} | ${row.falsePositive} | ${row.falseNegative} | ${row.operatorMinutesAdded} |`)
    .join('\n')

  return `# P10 Narrow Blocking Rollout Report

Status: ${report.status}
Source run: ${report.sourceRunDir}
Blocking mode: ${report.blockingMode}
Global blocking enabled: ${report.globalBlockingEnabled}

## Metrics

- sliceTasks: ${report.metrics.sliceTasks}
- positiveCandidateTasks: ${report.metrics.positiveCandidateTasks}
- controlTasks: ${report.metrics.controlTasks}
- blockedTasks: ${report.metrics.blockedTasks}
- falsePositiveTasks: ${report.metrics.falsePositiveTasks}
- falseNegativeTasks: ${report.metrics.falseNegativeTasks}
- falsePositiveRate: ${report.metrics.falsePositiveRate.toFixed(2)}
- medianBlockedOperatorMinutes: ${report.metrics.medianBlockedOperatorMinutes}
- operatorBurdenLevel: ${report.metrics.operatorBurdenLevel}
- acceptedRiskBypassCount: ${report.metrics.acceptedRiskBypassCount}
- starpomDecision: ${report.metrics.starpomDecision}

## Rule Rows

| Rule | Status | Correct Catches | FP Tasks | FN Tasks | FP Rate | Median Minutes |
|---|---|---:|---:|---:|---:|---:|
${rules}

## Decision Rows

| Task | Slice Role | Selected Rules | Deferred Rules | Fail-Closed Decision | FP | FN | Operator Minutes |
|---|---|---|---|---|---|---|---:|
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
      blockedTasks: report.metrics.blockedTasks,
      falsePositiveTasks: report.metrics.falsePositiveTasks,
      falseNegativeTasks: report.metrics.falseNegativeTasks,
      falsePositiveRate: report.metrics.falsePositiveRate,
      medianBlockedOperatorMinutes: report.metrics.medianBlockedOperatorMinutes,
      globalBlockingEnabled: report.globalBlockingEnabled,
      report: `${report.outDir}/p10-narrow-blocking-report.json`,
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`P10 narrow blocking: ${summary.status}`)
      console.log(`selectedRules: ${summary.selectedRules.join(', ')}`)
      console.log(`blockedTasks: ${summary.blockedTasks}`)
      console.log(`falsePositiveRate: ${summary.falsePositiveRate}`)
      console.log(`report: ${summary.report}`)
    }
    process.exitCode = report.status === 'p10_narrow_blocking_rollout_ready' ? 0 : 2
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

if (isDirectEntrypoint('p10-narrow-blocking.ts')) main()
