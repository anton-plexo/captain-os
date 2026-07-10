import { dirname, relative, resolve } from 'node:path'
import {
  LabInputError,
  LabUnsafeWriteError,
  assertSafeShadowOutDir,
  ensureDir,
  fileExists,
  readJson,
  repoRoot,
  writeJson,
  writeText,
} from './io'

type P9BPerspective =
  | 'anton_intent_fidelity'
  | 'continuation_no_false_done'
  | 'runtime_state_machine'
  | 'domain_expert'
  | 'operator_burden'

type P9BDomain = 'ui' | 'cms' | 'security' | 'shipping' | 'data' | 'strategy' | 'mixed'
type P9BInputMode = 'baseline_advisory' | 'advisory_with_spec' | 'paired_comparison'
type HumanOutcomeLabel = 'true_pass' | 'correct_block' | 'false_positive' | 'false_negative' | 'burden_overload' | 'inconclusive'
type Confidence = 'low' | 'medium' | 'high'
type BurdenLevel = 'low' | 'medium' | 'high'
type Severity = 'P0' | 'P1' | 'P2' | 'P3'

interface CliOptions {
  run?: string
  source?: string
  json?: boolean
}

interface ScoreSet {
  intentFidelity: number
  continuationProtection: number
  runtimeCorrectness: number
  domainQuality: number
  operatorPracticality: number
}

interface BurdenShape {
  operatorMinutesAdded: number
  artifactCount: number
  burdenLevel: BurdenLevel
}

interface JudgeSourceRow {
  taskId: string
  humanOutcomeLabel: HumanOutcomeLabel
  confidence?: Confidence
  severity: Severity
  reason: string
  scores?: Partial<ScoreSet>
  burden?: BurdenShape
  newFixtureNeeded?: boolean
  semanticMismatch?: boolean
}

interface JudgeSourceDefault {
  humanOutcomeLabel: HumanOutcomeLabel
  confidence: Confidence
  severity: Severity
  reason: string
  scores: ScoreSet
  burden: BurdenShape
}

interface JudgeSourcePerspective {
  judgePerspective: P9BPerspective
  summary: string
  default: JudgeSourceDefault
  overrides: JudgeSourceRow[]
}

interface JudgeSource {
  schemaVersion: 1
  status: string
  sourceRunId: string
  hardenedRunId: string
  source: string
  notes: string[]
  perspectives: JudgeSourcePerspective[]
}

interface P9BVariant {
  variant: 'baseline_advisory' | 'advisory_with_spec'
  decision: string
  p9dBlocks: string[]
}

interface P9BTaskSummary {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  knownFailureClass: string
  expectedInspectionObject: string
  expectedAcceptanceObject: string
  expectedBlocks: string[]
  variants: P9BVariant[]
  machineOutcome: string
}

interface P9BRunReport {
  schemaVersion: 1
  runId: string
  corpusId: string
  outDir: string
  totals: {
    tasks: number
    pairedComparisons: number
  }
  taskSummaries: P9BTaskSummary[]
}

interface JudgeReport {
  schemaVersion: 1
  taskId: string
  judgePerspective: P9BPerspective
  inputMode: P9BInputMode
  domain: P9BDomain
  advisoryDecision: 'ready_for_owner_review_planning_only' | 'ready_for_execution' | 'continue_now' | 'accepted_partial_next_packet' | 'blocked_external'
  p9dBlocks: string[]
  humanOutcomeLabel: HumanOutcomeLabel
  confidence: Confidence
  scores: ScoreSet
  booleans: {
    falsePositive: boolean
    falseNegative: boolean
    ignoredAdvisoryMiss: boolean
    newFixtureNeeded: boolean
    promoteToP10Candidate: boolean
  }
  burden: BurdenShape
  findings: Array<{
    id: string
    severity: Severity
    claim: string
    evidenceRefs: string[]
    recommendedAction: string
  }>
  openQuestions: string[]
  judgeVerdict: 'pass' | 'block' | 'inconclusive'
  extensions: {
    semanticMismatch: boolean
    sourceStatus: string
  }
}

interface ReconciliationTaskRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  advisoryDecision: string
  p9dBlocks: string[]
  judgeVerdicts: Record<P9BPerspective, HumanOutcomeLabel>
  consensusOutcome: string
  falsePositive: boolean
  falseNegative: boolean
  rawFalsePositiveReports: number
  rawFalseNegativeReports: number
  semanticMismatchReports: number
  residualFalsePositiveAfterP9E: boolean
  residualFalseNegativeAfterP9E: boolean
  ignoredAdvisoryMiss: boolean
  operatorMinutesAdded: number
  newFixtureNeeded: boolean
  p10CandidateRules: string[]
  acceptedRiskRequired: boolean
  nextAction: string
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

interface ReconciliationReport {
  schemaVersion: 1
  status: 'p9b_reconciled_p10_candidates_selected'
  sourceStatus: string
  runId: string
  corpusId: string
  reportsExpected: number
  reportsReceived: number
  metrics: {
    tasks: number
    rawFalsePositiveReports: number
    rawFalseNegativeReports: number
    rawInconclusiveReports: number
    semanticMismatchReports: number
    rawFalsePositiveTaskCount: number
    rawFalseNegativeTaskCount: number
    residualFalsePositiveAfterP9E: number
    residualFalseNegativeAfterP9E: number
    ignoredAdvisoryMissTaskCount: number
    specLiftTaskCount: number
    pairedComparisonTaskCount: number
    medianOperatorMinutesAdded: number
    operatorBurdenLevel: BurdenLevel
  }
  taskRows: ReconciliationTaskRow[]
  p10Candidates: P10Candidate[]
  p10Deferred: P10Candidate[]
  nextAction: string
}

const defaultSource = 'docs/process/captain-os-lab/fixtures/p9b-live/batch0-judge-source.json'
const perspectives: P9BPerspective[] = [
  'anton_intent_fidelity',
  'continuation_no_false_done',
  'runtime_state_machine',
  'domain_expert',
  'operator_burden',
]

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
    if (key === 'run') options.run = value
    else if (key === 'source') options.source = value
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function requireRunDir(run?: string): string {
  if (!run) throw new LabInputError('missing --run .ship/lab/runs/<run-id>')
  const runDir = assertSafeShadowOutDir(run)
  if (!fileExists(resolve(runDir, 'p9b-live-metrics-report.json'))) {
    throw new LabInputError(`P9B run report not found under ${run}`)
  }
  return runDir
}

function readSource(sourcePath: string): JudgeSource {
  const resolved = resolve(repoRoot(), sourcePath)
  if (!fileExists(resolved)) throw new LabInputError(`judge source not found: ${sourcePath}`)
  const source = readJson<JudgeSource>(resolved)
  if (source.schemaVersion !== 1 || !Array.isArray(source.perspectives)) {
    throw new LabInputError('judge source must be schemaVersion 1 with perspectives')
  }
  const seen = new Set(source.perspectives.map((item) => item.judgePerspective))
  for (const perspective of perspectives) {
    if (!seen.has(perspective)) throw new LabInputError(`judge source missing perspective: ${perspective}`)
  }
  return source
}

function mergeScores(base: ScoreSet, patch?: Partial<ScoreSet>): ScoreSet {
  return {
    intentFidelity: patch?.intentFidelity ?? base.intentFidelity,
    continuationProtection: patch?.continuationProtection ?? base.continuationProtection,
    runtimeCorrectness: patch?.runtimeCorrectness ?? base.runtimeCorrectness,
    domainQuality: patch?.domainQuality ?? base.domainQuality,
    operatorPracticality: patch?.operatorPracticality ?? base.operatorPracticality,
  }
}

function advisoryDecision(task: P9BTaskSummary): JudgeReport['advisoryDecision'] {
  const decisions = task.variants.map((variant) => variant.decision)
  if (decisions.includes('blocked_external')) return 'blocked_external'
  if (decisions.includes('accepted_partial_next_packet')) return 'accepted_partial_next_packet'
  if (decisions.includes('continue_now')) return 'continue_now'
  return 'ready_for_owner_review_planning_only'
}

function p9dBlocks(task: P9BTaskSummary): string[] {
  return [...new Set(task.variants.flatMap((variant) => variant.p9dBlocks))]
}

function rowForTask(perspective: JudgeSourcePerspective, taskId: string): JudgeSourceDefault & {
  semanticMismatch: boolean
  newFixtureNeeded: boolean
  reason: string
} {
  const override = perspective.overrides.find((row) => row.taskId === taskId)
  return {
    ...perspective.default,
    ...override,
    confidence: override?.confidence ?? perspective.default.confidence,
    scores: mergeScores(perspective.default.scores, override?.scores),
    burden: override?.burden ?? perspective.default.burden,
    semanticMismatch: override?.semanticMismatch ?? false,
    newFixtureNeeded: override?.newFixtureNeeded ?? ['false_positive', 'false_negative', 'inconclusive'].includes(override?.humanOutcomeLabel ?? ''),
    reason: override?.reason ?? perspective.default.reason,
  }
}

function judgeVerdict(outcome: HumanOutcomeLabel): JudgeReport['judgeVerdict'] {
  if (outcome === 'false_positive' || outcome === 'false_negative' || outcome === 'burden_overload') return 'block'
  if (outcome === 'inconclusive') return 'inconclusive'
  return 'pass'
}

function writeJudgeReports(runDir: string, report: P9BRunReport, source: JudgeSource): JudgeReport[] {
  const reports: JudgeReport[] = []
  for (const task of report.taskSummaries) {
    const taskP9dBlocks = p9dBlocks(task)
    for (const perspective of source.perspectives) {
      const normalized = rowForTask(perspective, task.taskId)
      const falsePositive = normalized.humanOutcomeLabel === 'false_positive'
      const falseNegative = normalized.humanOutcomeLabel === 'false_negative'
      const materialized: JudgeReport = {
        schemaVersion: 1,
        taskId: task.taskId,
        judgePerspective: perspective.judgePerspective,
        inputMode: task.inputMode,
        domain: task.domain,
        advisoryDecision: advisoryDecision(task),
        p9dBlocks: taskP9dBlocks,
        humanOutcomeLabel: normalized.humanOutcomeLabel,
        confidence: normalized.confidence,
        scores: normalized.scores,
        booleans: {
          falsePositive,
          falseNegative,
          ignoredAdvisoryMiss: falseNegative,
          newFixtureNeeded: normalized.newFixtureNeeded,
          promoteToP10Candidate: false,
        },
        burden: normalized.burden,
        findings: [
          {
            id: `P9B-${task.taskId}-${perspective.judgePerspective}`,
            severity: normalized.severity,
            claim: normalized.reason,
            evidenceRefs: [
              'p9b-live-metrics-report.json',
              `task-runs/${task.taskId}/judge-packets/${perspective.judgePerspective}.json`,
            ],
            recommendedAction: normalized.newFixtureNeeded
              ? 'Keep or add executable validator/fixture before P10 promotion.'
              : 'Use in reconciliation metrics; do not claim product acceptance from this row alone.',
          },
        ],
        openQuestions: normalized.humanOutcomeLabel === 'inconclusive' ? ['Needs Captain reconciliation against P9E rerun artifacts.'] : [],
        judgeVerdict: judgeVerdict(normalized.humanOutcomeLabel),
        extensions: {
          semanticMismatch: normalized.semanticMismatch,
          sourceStatus: source.status,
        },
      }
      const outPath = resolve(runDir, 'task-runs', task.taskId, 'judge-reports', `${perspective.judgePerspective}.json`)
      writeJson(outPath, materialized)
      reports.push(materialized)
    }
  }
  return reports
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

function specLift(task: P9BTaskSummary): boolean {
  if (task.inputMode !== 'paired_comparison') return false
  const baseline = task.variants.find((variant) => variant.variant === 'baseline_advisory')
  const withSpec = task.variants.find((variant) => variant.variant === 'advisory_with_spec')
  if (!baseline || !withSpec) return false
  if (withSpec.decision !== baseline.decision) return true
  return withSpec.p9dBlocks.some((block) => !baseline.p9dBlocks.includes(block))
}

function ruleCandidates(report: P9BRunReport, taskRows: ReconciliationTaskRow[]): { selected: P10Candidate[]; deferred: P10Candidate[] } {
  const ruleTasks = new Map<string, Set<string>>()
  for (const task of report.taskSummaries) {
    for (const block of p9dBlocks(task)) {
      if (!ruleTasks.has(block)) ruleTasks.set(block, new Set())
      ruleTasks.get(block)?.add(task.taskId)
    }
  }

  const falsePositiveTasks = new Set(taskRows.filter((row) => row.residualFalsePositiveAfterP9E).map((row) => row.taskId))
  const falseNegativeTasks = new Set(taskRows.filter((row) => row.residualFalseNegativeAfterP9E).map((row) => row.taskId))
  const operatorMinutes = taskRows.map((row) => row.operatorMinutesAdded)
  const candidateRows: P10Candidate[] = []
  const deferredRows: P10Candidate[] = []

  for (const [ruleId, tasks] of [...ruleTasks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const evidenceTasks = [...tasks].sort()
    const row: P10Candidate = {
      ruleId,
      status: evidenceTasks.length >= 3 && falsePositiveTasks.size === 0 && falseNegativeTasks.size === 0
        ? 'candidate_selected_not_blocking'
        : 'deferred_more_evidence_needed',
      correctCatches: evidenceTasks.length,
      falsePositiveTasks: evidenceTasks.filter((taskId) => falsePositiveTasks.has(taskId)).length,
      falseNegativeTasks: evidenceTasks.filter((taskId) => falseNegativeTasks.has(taskId)).length,
      medianOperatorMinutes: median(operatorMinutes),
      evidenceTasks,
      reason: evidenceTasks.length >= 3
        ? 'Meets catch-count threshold in this batch, but still needs P10 narrow blocking rollout before enforcement.'
        : 'Useful advisory block, but fewer than three live catches in this batch.',
    }
    if (row.status === 'candidate_selected_not_blocking') candidateRows.push(row)
    else deferredRows.push(row)
  }

  return { selected: candidateRows, deferred: deferredRows }
}

function reconcile(runDir: string, sourcePath: string): ReconciliationReport {
  const runReport = readJson<P9BRunReport>(resolve(runDir, 'p9b-live-metrics-report.json'))
  const source = readSource(sourcePath)
  const judgeReports = writeJudgeReports(runDir, runReport, source)
  const reportsByTask = new Map<string, JudgeReport[]>()
  for (const report of judgeReports) {
    const rows = reportsByTask.get(report.taskId) ?? []
    rows.push(report)
    reportsByTask.set(report.taskId, rows)
  }

  const taskRows: ReconciliationTaskRow[] = runReport.taskSummaries.map((task) => {
    const rows = reportsByTask.get(task.taskId) ?? []
    const rawFalsePositiveReports = rows.filter((row) => row.booleans.falsePositive).length
    const rawFalseNegativeReports = rows.filter((row) => row.booleans.falseNegative).length
    const semanticMismatchReports = rows.filter((row) => row.extensions.semanticMismatch).length
    const expectedBlockTask = task.expectedBlocks.length > 0 || task.machineOutcome === 'machine_correct_block_candidate'
    const falsePositive = rawFalsePositiveReports > 0 && !expectedBlockTask
    const falseNegative = rawFalseNegativeReports > 0 && task.machineOutcome !== 'machine_correct_block_candidate'
    const operatorReport = rows.find((row) => row.judgePerspective === 'operator_burden')
    const rules = p9dBlocks(task)
    return {
      taskId: task.taskId,
      domain: task.domain,
      inputMode: task.inputMode,
      advisoryDecision: advisoryDecision(task),
      p9dBlocks: rules,
      judgeVerdicts: Object.fromEntries(rows.map((row) => [row.judgePerspective, row.humanOutcomeLabel])) as Record<P9BPerspective, HumanOutcomeLabel>,
      consensusOutcome: falsePositive || falseNegative
        ? 'blocked_needs_repair'
        : semanticMismatchReports > 0
          ? 'semantic_mismatch_resolved_by_p9e'
          : task.machineOutcome,
      falsePositive,
      falseNegative,
      rawFalsePositiveReports,
      rawFalseNegativeReports,
      semanticMismatchReports,
      residualFalsePositiveAfterP9E: falsePositive,
      residualFalseNegativeAfterP9E: falseNegative,
      ignoredAdvisoryMiss: falseNegative,
      operatorMinutesAdded: operatorReport?.burden.operatorMinutesAdded ?? 0,
      newFixtureNeeded: rows.some((row) => row.booleans.newFixtureNeeded),
      p10CandidateRules: rules,
      acceptedRiskRequired: false,
      nextAction: falsePositive || falseNegative
        ? 'Repair before P10.'
        : semanticMismatchReports > 0
          ? 'Resolved by P9E semantic validator; keep as advisory/P10 evidence.'
          : 'Use in P10 candidate evaluation.',
    }
  })

  const { selected, deferred } = ruleCandidates(runReport, taskRows)
  const rawFalsePositiveTaskCount = taskRows.filter((row) => row.rawFalsePositiveReports > 0).length
  const rawFalseNegativeTaskCount = taskRows.filter((row) => row.rawFalseNegativeReports > 0).length
  const operatorMinutes = taskRows.map((row) => row.operatorMinutesAdded)
  const medianOperatorMinutesAdded = median(operatorMinutes)
  const finalReport: ReconciliationReport = {
    schemaVersion: 1,
    status: 'p9b_reconciled_p10_candidates_selected',
    sourceStatus: source.status,
    runId: runReport.runId,
    corpusId: runReport.corpusId,
    reportsExpected: runReport.taskSummaries.length * perspectives.length,
    reportsReceived: judgeReports.length,
    metrics: {
      tasks: runReport.taskSummaries.length,
      rawFalsePositiveReports: judgeReports.filter((row) => row.booleans.falsePositive).length,
      rawFalseNegativeReports: judgeReports.filter((row) => row.booleans.falseNegative).length,
      rawInconclusiveReports: judgeReports.filter((row) => row.humanOutcomeLabel === 'inconclusive').length,
      semanticMismatchReports: judgeReports.filter((row) => row.extensions.semanticMismatch).length,
      rawFalsePositiveTaskCount,
      rawFalseNegativeTaskCount,
      residualFalsePositiveAfterP9E: taskRows.filter((row) => row.residualFalsePositiveAfterP9E).length,
      residualFalseNegativeAfterP9E: taskRows.filter((row) => row.residualFalseNegativeAfterP9E).length,
      ignoredAdvisoryMissTaskCount: taskRows.filter((row) => row.ignoredAdvisoryMiss).length,
      specLiftTaskCount: runReport.taskSummaries.filter(specLift).length,
      pairedComparisonTaskCount: runReport.totals.pairedComparisons,
      medianOperatorMinutesAdded,
      operatorBurdenLevel: burdenLevel(medianOperatorMinutesAdded),
    },
    taskRows,
    p10Candidates: selected,
    p10Deferred: deferred,
    nextAction: 'Run selected P10 candidates in narrow advisory-to-blocking rollout; do not enable blocking globally yet.',
  }

  writeJson(resolve(runDir, 'p9b-judge-reconciliation-report.json'), finalReport)
  writeJson(resolve(runDir, 'p10-candidates.json'), {
    schemaVersion: 1,
    status: 'p10_candidates_selected_not_blocking',
    selected,
    deferred,
  })
  writeJson(resolve(runDir, 'reconciliation.json'), finalReport)
  writeText(resolve(runDir, 'p9b-judge-reconciliation-report.md'), renderMarkdown(finalReport))
  return finalReport
}

function renderMarkdown(report: ReconciliationReport): string {
  const taskRows = report.taskRows
    .map((row) => `| ${row.taskId} | ${row.consensusOutcome} | ${row.rawFalsePositiveReports} | ${row.rawFalseNegativeReports} | ${row.residualFalsePositiveAfterP9E} | ${row.residualFalseNegativeAfterP9E} | ${row.operatorMinutesAdded} |`)
    .join('\n')
  const candidates = report.p10Candidates.length === 0
    ? '- none'
    : report.p10Candidates.map((row) => `- ${row.ruleId}: ${row.correctCatches} catches, status ${row.status}`).join('\n')
  const deferred = report.p10Deferred.length === 0
    ? '- none'
    : report.p10Deferred.map((row) => `- ${row.ruleId}: ${row.correctCatches} catches, ${row.reason}`).join('\n')

  return `# P9B Judge Reconciliation Report

Status: ${report.status}
Run: ${report.runId}
Corpus: ${report.corpusId}

## Metrics

- reportsExpected: ${report.reportsExpected}
- reportsReceived: ${report.reportsReceived}
- rawFalsePositiveReports: ${report.metrics.rawFalsePositiveReports}
- rawFalseNegativeReports: ${report.metrics.rawFalseNegativeReports}
- rawInconclusiveReports: ${report.metrics.rawInconclusiveReports}
- semanticMismatchReports: ${report.metrics.semanticMismatchReports}
- residualFalsePositiveAfterP9E: ${report.metrics.residualFalsePositiveAfterP9E}
- residualFalseNegativeAfterP9E: ${report.metrics.residualFalseNegativeAfterP9E}
- specLiftTaskCount: ${report.metrics.specLiftTaskCount} / ${report.metrics.pairedComparisonTaskCount}
- medianOperatorMinutesAdded: ${report.metrics.medianOperatorMinutesAdded}
- operatorBurdenLevel: ${report.metrics.operatorBurdenLevel}

## P10 Candidates

${candidates}

## Deferred Rules

${deferred}

## Task Rows

| Task | Consensus | Raw FP Reports | Raw FN Reports | Residual FP | Residual FN | Operator Minutes |
|---|---|---:|---:|---|---|---:|
${taskRows}

## Next Action

${report.nextAction}
`
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const runDir = requireRunDir(options.run)
    const report = reconcile(runDir, options.source ?? defaultSource)
    const summary = {
      status: report.status,
      runId: report.runId,
      reportsReceived: report.reportsReceived,
      residualFalsePositiveAfterP9E: report.metrics.residualFalsePositiveAfterP9E,
      residualFalseNegativeAfterP9E: report.metrics.residualFalseNegativeAfterP9E,
      specLiftTaskCount: report.metrics.specLiftTaskCount,
      p10Candidates: report.p10Candidates.map((candidate) => candidate.ruleId),
      report: relative(repoRoot(), resolve(runDir, 'p9b-judge-reconciliation-report.json')),
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`P9B reconciliation: ${summary.status}`)
      console.log(`reportsReceived: ${summary.reportsReceived}`)
      console.log(`p10Candidates: ${summary.p10Candidates.join(', ') || 'none'}`)
      console.log(`report: ${summary.report}`)
    }
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

if (isDirectEntrypoint('p9b-reconcile.ts')) main()
