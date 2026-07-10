import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import {
  LabInputError,
  LabUnsafeWriteError,
  assertSafeShadowOutDir,
  ensureDir,
  labRunsRoot,
  readJson,
  repoRoot,
  timestampRunId,
  writeJson,
  writeText,
} from './io'

type CollectorStatus =
  | 'p10g_live_evidence_ready_for_more_canary'
  | 'p10g_live_evidence_partial_insufficient'
  | 'p10g_live_evidence_lag_risk'
  | 'p10g_live_evidence_attention_required'

interface CliOptions {
  runRoot?: string
  out?: string
  json?: boolean
  includeSmoke?: boolean
  since?: string
  limit?: number
  minP10gCompleteRuns?: number
  maxMedianLagMinutes?: number
}

interface P10EReport {
  status?: string
  metrics?: {
    evaluatedTasks?: number
    answerFirst?: number
    blockFinalClaim?: number
    allowContinue?: number
    falsePositiveTaskRuns?: number
    falseNegativeTaskRuns?: number
    replayCorpusTasks?: number
  }
  decisions?: Array<{
    taskId?: string
    decision?: string
    operatingSafetyBlocks?: string[]
    selectedRulesTriggered?: string[]
  }>
}

interface AdvisoryReport {
  status?: string
  metrics?: {
    falsePositiveRisk?: string
    falseNegativeRisk?: string
    operatorBurdenRisk?: string
    preventedFailureSignals?: string[]
    openBlockingCount?: number
    contextRuntimeBlockCount?: number
    splashRadiusBlockCount?: number
    crossLlmBlockCount?: number
    evidenceAggregationBlockCount?: number
  }
  stateMachine?: {
    decision?: string
    allowedFinalClaim?: boolean
    requiredNextAction?: string
  }
}

interface ClassificationArtifact {
  intentMode?: string
  complexityTier?: string
  planDepth?: string
  captainMode?: string
  finalClaimGateRequired?: boolean
  hardWorkRequired?: boolean
  octopusRequired?: boolean
}

interface ContextRuntimeArtifact {
  ragRequired?: boolean
  ragPackInjected?: boolean
  sessionPackRequired?: boolean
  sessionPackInjected?: boolean
  blocks?: string[]
}

interface SplashRadiusArtifact {
  required?: boolean
  splashRadiusHookInjected?: boolean
  crossDomain?: boolean
  blocks?: string[]
}

interface CrossLlmSlaArtifact {
  requiredPhases?: string[]
  optionalPhases?: string[]
  maxTimeoutMinutes?: number
  verdictRefs?: string[]
  missingVerdicts?: string[]
  blocks?: string[]
}

interface EvidenceAggregationArtifact {
  dashboardReady?: boolean
  runArtifactRefs?: string[]
  p10fEvidenceLevels?: string[]
  blocks?: string[]
}

interface OperatingSafetyArtifact {
  answerRequiredBeforeAction?: boolean
  blocks?: string[]
}

interface RunEvidenceRow {
  runId: string
  relativeDir: string
  mtime: string
  artifacts: {
    p10eAdapter: boolean
    advisory: boolean
    classification: boolean
    contextRuntime: boolean
    splashRadius: boolean
    crossLlmSla: boolean
    evidenceAggregation: boolean
  }
  legacyP10fOnly: boolean
  p10gComplete: boolean
  classification: ClassificationArtifact | null
  advisoryDecision: string | null
  p10eEvaluatedTasks: number
  p10eDecisionCounts: {
    answerFirst: number
    blockFinalClaim: number
    allowContinue: number
  }
  falsePositiveTaskRuns: number
  falseNegativeTaskRuns: number
  p10gBlocks: string[]
  estimatedLagMinutes: {
    context: number
    splash: number
    claudeSla: number
    evidenceAggregation: number
    total: number
    note: string
  }
  bureaucracySignals: string[]
  requiredNextAction: string | null
}

interface CollectorReport {
  schemaVersion: 1
  status: CollectorStatus
  outDir: string
  runRoot: string
  generatedAt: string
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
  thresholds: {
    minP10gCompleteRuns: number
    maxMedianLagMinutes: number
  }
  metrics: {
    scannedRunDirs: number
    evaluatedRunDirs: number
    p10eAdapterRuns: number
    advisoryRuns: number
    p10gCompleteRuns: number
    legacyP10fOnlyRuns: number
    p10eEvaluatedTasks: number
    answerFirst: number
    blockFinalClaim: number
    allowContinue: number
    falsePositiveTaskRuns: number
    falseNegativeTaskRuns: number
    crossLlmRequiredRuns: number
    crossLlmMissingVerdictRuns: number
    simpleTaskParalysisSignals: number
    medianEstimatedLagMinutes: number
    maxEstimatedLagMinutes: number
  }
  interpretation: {
    lagRisk: 'low' | 'medium' | 'high'
    bureaucracyRisk: 'low' | 'medium' | 'high'
    evidenceConfidence: 'low' | 'medium' | 'high'
    verdict: string
  }
  rows: RunEvidenceRow[]
  nextAction: string
}

const targetFiles = [
  'p10e-live-runtime-adapter-report.json',
  'advisory-report.json',
  'operating-safety.json',
  'classification.json',
  'context-runtime.json',
  'splash-radius.json',
  'cross-llm-sla.json',
  'evidence-aggregation.json',
]

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--include-smoke') {
      options.includeSmoke = true
      continue
    }
    if (!arg.startsWith('--')) throw new LabInputError(`unexpected positional argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new LabInputError(`missing value for ${arg}`)
    index += 1
    if (key === 'run-root') options.runRoot = value
    else if (key === 'out') options.out = value
    else if (key === 'since') options.since = value
    else if (key === 'limit') options.limit = positiveInteger(value, arg)
    else if (key === 'min-p10g-complete-runs') options.minP10gCompleteRuns = positiveInteger(value, arg)
    else if (key === 'max-median-lag-minutes') options.maxMedianLagMinutes = positiveInteger(value, arg)
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new LabInputError(`${flag} must be a positive integer`)
  return parsed
}

function safeReadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return readJson<T>(path)
  } catch {
    return null
  }
}

function hasTargetFile(dir: string): boolean {
  return targetFiles.some((file) => existsSync(resolve(dir, file)))
}

function collectRunDirs(dir: string, maxDepth = 3, depth = 0): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const rows: string[] = []
  if (hasTargetFile(dir)) rows.push(dir)
  if (depth >= maxDepth) return rows
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    rows.push(...collectRunDirs(resolve(dir, entry.name), maxDepth, depth + 1))
  }
  return rows
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

function classifySimple(classification: ClassificationArtifact | null, row: RunEvidenceRow): boolean {
  if (!classification) return row.relativeDir.includes('clean-control') || row.relativeDir.includes('simple')
  return (
    classification.intentMode === 'direct_answer' ||
    classification.complexityTier === 'T0' ||
    classification.complexityTier === 'T1'
  )
}

function estimateLag(
  context: ContextRuntimeArtifact | null,
  splash: SplashRadiusArtifact | null,
  cross: CrossLlmSlaArtifact | null,
  evidence: EvidenceAggregationArtifact | null,
): RunEvidenceRow['estimatedLagMinutes'] {
  const contextMinutes = context && (context.ragRequired || context.sessionPackRequired) ? 1 : 0
  const splashMinutes = splash?.required ? 1 : 0
  const missingVerdicts = arrayValue<string>(cross?.missingVerdicts)
  const requiredPhases = arrayValue<string>(cross?.requiredPhases)
  const claudeMinutes = requiredPhases.length > 0 && missingVerdicts.length > 0 ? numberValue(cross?.maxTimeoutMinutes) || 8 : 0
  const evidenceMinutes = evidence?.dashboardReady ? 0.5 : 0
  const total = contextMinutes + splashMinutes + claudeMinutes + evidenceMinutes
  const note =
    claudeMinutes > 0
      ? 'Potential wait if Captain insists on final claim without Claude verdict; should run in parallel under SLA.'
      : 'Low expected overhead; context/radius are generated artifacts, not manual ceremony.'
  return {
    context: contextMinutes,
    splash: splashMinutes,
    claudeSla: claudeMinutes,
    evidenceAggregation: evidenceMinutes,
    total,
    note,
  }
}

function buildRunRow(dir: string, runRoot: string): RunEvidenceRow {
  const p10e = safeReadJson<P10EReport>(resolve(dir, 'p10e-live-runtime-adapter-report.json'))
  const advisory = safeReadJson<AdvisoryReport>(resolve(dir, 'advisory-report.json'))
  const operatingSafety = safeReadJson<OperatingSafetyArtifact>(resolve(dir, 'operating-safety.json'))
  const classification = safeReadJson<ClassificationArtifact>(resolve(dir, 'classification.json'))
  const context = safeReadJson<ContextRuntimeArtifact>(resolve(dir, 'context-runtime.json'))
  const splash = safeReadJson<SplashRadiusArtifact>(resolve(dir, 'splash-radius.json'))
  const cross = safeReadJson<CrossLlmSlaArtifact>(resolve(dir, 'cross-llm-sla.json'))
  const evidence = safeReadJson<EvidenceAggregationArtifact>(resolve(dir, 'evidence-aggregation.json'))
  const artifacts = {
    p10eAdapter: Boolean(p10e),
    advisory: Boolean(advisory),
    classification: Boolean(classification),
    contextRuntime: Boolean(context),
    splashRadius: Boolean(splash),
    crossLlmSla: Boolean(cross),
    evidenceAggregation: Boolean(evidence),
  }
  const p10gComplete = artifacts.contextRuntime && artifacts.splashRadius && artifacts.crossLlmSla && artifacts.evidenceAggregation
  const p10eMetrics = p10e?.metrics ?? {}
  const p10gBlocks = unique([
    ...arrayValue<string>(context?.blocks),
    ...arrayValue<string>(splash?.blocks),
    ...arrayValue<string>(cross?.blocks),
    ...arrayValue<string>(evidence?.blocks),
  ])
  const stat = statSync(dir)
  const row: RunEvidenceRow = {
    runId: basename(dir),
    relativeDir: relative(repoRoot(), dir),
    mtime: stat.mtime.toISOString(),
    artifacts,
    legacyP10fOnly: Boolean(p10e) && !p10gComplete,
    p10gComplete,
    classification,
    advisoryDecision: advisory?.stateMachine?.decision ?? null,
    p10eEvaluatedTasks: numberValue(p10eMetrics.evaluatedTasks),
    p10eDecisionCounts: {
      answerFirst: numberValue(p10eMetrics.answerFirst),
      blockFinalClaim: numberValue(p10eMetrics.blockFinalClaim),
      allowContinue: numberValue(p10eMetrics.allowContinue),
    },
    falsePositiveTaskRuns: numberValue(p10eMetrics.falsePositiveTaskRuns),
    falseNegativeTaskRuns: numberValue(p10eMetrics.falseNegativeTaskRuns),
    p10gBlocks,
    estimatedLagMinutes: estimateLag(context, splash, cross, evidence),
    bureaucracySignals: [],
    requiredNextAction: advisory?.stateMachine?.requiredNextAction ?? null,
  }
  const directAnswerBlocks = [
    ...arrayValue<string>(p10e?.decisions?.flatMap((decision) => decision.operatingSafetyBlocks ?? [])),
    ...arrayValue<string>(operatingSafety?.blocks),
  ]
  const simpleBlocked =
    row.p10gComplete &&
    classifySimple(classification, row) &&
    row.advisoryDecision === 'blocked_external' &&
    !directAnswerBlocks.includes('stop_and_answer_required')
  if (simpleBlocked) row.bureaucracySignals.push('simple_task_blocked_without_stop_and_answer')
  if (row.falsePositiveTaskRuns > 0) row.bureaucracySignals.push('adapter_false_positive')
  if (row.falseNegativeTaskRuns > 0) row.bureaucracySignals.push('adapter_false_negative')
  if (row.legacyP10fOnly) row.bureaucracySignals.push('legacy_p10f_run_missing_p10g_artifacts')
  return row
}

function riskFromMetrics(
  metrics: CollectorReport['metrics'],
  thresholds: CollectorReport['thresholds'],
): CollectorReport['interpretation'] {
  const lagRisk =
    metrics.medianEstimatedLagMinutes > thresholds.maxMedianLagMinutes
      ? 'high'
      : metrics.crossLlmMissingVerdictRuns > 0
        ? 'medium'
        : 'low'
  const bureaucracyRisk =
    metrics.falsePositiveTaskRuns > 0 || metrics.simpleTaskParalysisSignals > 0
      ? 'high'
      : metrics.legacyP10fOnlyRuns > metrics.p10gCompleteRuns
        ? 'medium'
        : 'low'
  const evidenceConfidence =
    metrics.p10gCompleteRuns >= thresholds.minP10gCompleteRuns && metrics.p10eEvaluatedTasks >= 20
      ? 'high'
      : metrics.p10gCompleteRuns >= 3
        ? 'medium'
        : 'low'
  const verdict =
    metrics.falsePositiveTaskRuns > 0 || metrics.falseNegativeTaskRuns > 0 || metrics.simpleTaskParalysisSignals > 0
      ? 'Attention required before broader rollout: the sample has FP/FN or simple-task paralysis signals.'
      : metrics.p10gCompleteRuns < thresholds.minP10gCompleteRuns
        ? 'P10F evidence exists, but P10G new-task evidence is still too small for broader enablement.'
        : lagRisk === 'high'
          ? 'P10G is catching risks, but Claude/RAG overhead is too high for expansion.'
          : 'P10F/P10G can continue as opt-in canary; global blocking remains disabled.'
  return { lagRisk, bureaucracyRisk, evidenceConfidence, verdict }
}

function buildReport(options: CliOptions): CollectorReport {
  const root = resolve(repoRoot(), options.runRoot ?? labRunsRoot())
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${timestampRunId('p10g-live-evidence')}`)
  const sinceMs = options.since ? Date.parse(options.since) : null
  if (sinceMs !== null && Number.isNaN(sinceMs)) throw new LabInputError(`invalid --since date: ${options.since}`)
  const allDirs = collectRunDirs(root)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .filter((dir) => sinceMs === null || statSync(dir).mtimeMs >= sinceMs)
    .filter((dir) => options.includeSmoke || !relative(root, dir).includes('-smoke/'))
  const selectedDirs = allDirs.slice(0, options.limit ?? allDirs.length)
  const rows = selectedDirs.map((dir) => buildRunRow(dir, root))
  const metrics: CollectorReport['metrics'] = {
    scannedRunDirs: allDirs.length,
    evaluatedRunDirs: rows.length,
    p10eAdapterRuns: rows.filter((row) => row.artifacts.p10eAdapter).length,
    advisoryRuns: rows.filter((row) => row.artifacts.advisory).length,
    p10gCompleteRuns: rows.filter((row) => row.p10gComplete).length,
    legacyP10fOnlyRuns: rows.filter((row) => row.legacyP10fOnly).length,
    p10eEvaluatedTasks: rows.reduce((sum, row) => sum + row.p10eEvaluatedTasks, 0),
    answerFirst: rows.reduce((sum, row) => sum + row.p10eDecisionCounts.answerFirst, 0),
    blockFinalClaim: rows.reduce((sum, row) => sum + row.p10eDecisionCounts.blockFinalClaim, 0),
    allowContinue: rows.reduce((sum, row) => sum + row.p10eDecisionCounts.allowContinue, 0),
    falsePositiveTaskRuns: rows.reduce((sum, row) => sum + row.falsePositiveTaskRuns, 0),
    falseNegativeTaskRuns: rows.reduce((sum, row) => sum + row.falseNegativeTaskRuns, 0),
    crossLlmRequiredRuns: rows.filter((row) => row.artifacts.crossLlmSla && row.estimatedLagMinutes.claudeSla > 0).length,
    crossLlmMissingVerdictRuns: rows.filter((row) => row.p10gBlocks.includes('cross_llm_required_verdict_missing')).length,
    simpleTaskParalysisSignals: rows.reduce((sum, row) => sum + (row.bureaucracySignals.includes('simple_task_blocked_without_stop_and_answer') ? 1 : 0), 0),
    medianEstimatedLagMinutes: median(rows.map((row) => row.estimatedLagMinutes.total)),
    maxEstimatedLagMinutes: Math.max(0, ...rows.map((row) => row.estimatedLagMinutes.total)),
  }
  const thresholds = {
    minP10gCompleteRuns: options.minP10gCompleteRuns ?? 10,
    maxMedianLagMinutes: options.maxMedianLagMinutes ?? 8,
  }
  const interpretation = riskFromMetrics(metrics, thresholds)
  const status: CollectorStatus =
    interpretation.bureaucracyRisk === 'high'
      ? 'p10g_live_evidence_attention_required'
      : interpretation.lagRisk === 'high'
        ? 'p10g_live_evidence_lag_risk'
        : metrics.p10gCompleteRuns < thresholds.minP10gCompleteRuns
          ? 'p10g_live_evidence_partial_insufficient'
          : 'p10g_live_evidence_ready_for_more_canary'
  return {
    schemaVersion: 1,
    status,
    outDir,
    runRoot: relative(repoRoot(), root) || '.',
    generatedAt: new Date().toISOString(),
    globalBlockingEnabled: false,
    productAcceptedFullAllowed: false,
    thresholds,
    metrics,
    interpretation,
    rows,
    nextAction:
      status === 'p10g_live_evidence_ready_for_more_canary'
        ? 'Continue opt-in P10G canary on new tasks; do not enable global blocking without explicit decision.'
        : 'Collect more P10G-complete new-task runs and keep global blocking disabled.',
  }
}

function renderMarkdown(report: CollectorReport): string {
  const topRows = report.rows
    .slice(0, 20)
    .map((row) =>
      `| ${row.relativeDir} | ${row.p10gComplete ? 'yes' : 'no'} | ${row.advisoryDecision ?? '-'} | ${row.estimatedLagMinutes.total} | ${row.p10gBlocks.join(', ') || '-'} | ${row.bureaucracySignals.join(', ') || '-'} |`,
    )
    .join('\n')
  return `# P10G Live Evidence Collection

Status: ${report.status}
Generated: ${report.generatedAt}
Run Root: \`${report.runRoot}\`
Global Blocking: ${report.globalBlockingEnabled}
Product Accepted Full Allowed: ${report.productAcceptedFullAllowed}

## Metrics

| Metric | Value |
|---|---:|
| scannedRunDirs | ${report.metrics.scannedRunDirs} |
| evaluatedRunDirs | ${report.metrics.evaluatedRunDirs} |
| p10eAdapterRuns | ${report.metrics.p10eAdapterRuns} |
| advisoryRuns | ${report.metrics.advisoryRuns} |
| p10gCompleteRuns | ${report.metrics.p10gCompleteRuns} |
| legacyP10fOnlyRuns | ${report.metrics.legacyP10fOnlyRuns} |
| p10eEvaluatedTasks | ${report.metrics.p10eEvaluatedTasks} |
| answerFirst | ${report.metrics.answerFirst} |
| blockFinalClaim | ${report.metrics.blockFinalClaim} |
| allowContinue | ${report.metrics.allowContinue} |
| falsePositiveTaskRuns | ${report.metrics.falsePositiveTaskRuns} |
| falseNegativeTaskRuns | ${report.metrics.falseNegativeTaskRuns} |
| crossLlmRequiredRuns | ${report.metrics.crossLlmRequiredRuns} |
| crossLlmMissingVerdictRuns | ${report.metrics.crossLlmMissingVerdictRuns} |
| simpleTaskParalysisSignals | ${report.metrics.simpleTaskParalysisSignals} |
| medianEstimatedLagMinutes | ${report.metrics.medianEstimatedLagMinutes} |
| maxEstimatedLagMinutes | ${report.metrics.maxEstimatedLagMinutes} |

## Interpretation

- lagRisk: ${report.interpretation.lagRisk}
- bureaucracyRisk: ${report.interpretation.bureaucracyRisk}
- evidenceConfidence: ${report.interpretation.evidenceConfidence}
- verdict: ${report.interpretation.verdict}

## Latest Rows

| Run | P10G Complete | Decision | Estimated Lag Min | P10G Blocks | Bureaucracy Signals |
|---|---|---|---:|---|---|
${topRows || '| - | - | - | 0 | - | - |'}

## Next Action

${report.nextAction}
`
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = buildReport(options)
    ensureDir(report.outDir)
    writeJson(resolve(report.outDir, 'p10g-live-evidence-report.json'), report)
    writeText(resolve(report.outDir, 'p10g-live-evidence-report.md'), renderMarkdown(report))
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: report.status,
            outDir: report.outDir,
            metrics: report.metrics,
            interpretation: report.interpretation,
            nextAction: report.nextAction,
          },
          null,
          2,
        ),
      )
    } else {
      console.log(`P10G live evidence collector: ${report.status}`)
      console.log(`outDir: ${report.outDir}`)
      console.log(`verdict: ${report.interpretation.verdict}`)
    }
    process.exitCode = 0
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

if (isDirectEntrypoint('p10g-live-evidence-collector.ts')) main()
