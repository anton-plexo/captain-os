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

type P10EDomain = 'ui_visual' | 'diagrams_seo' | 'data_product' | 'captain_os' | 'delivery_ops' | 'control'
type P10ETaskType = 'visual_repair' | 'content_conveyor' | 'data_repair' | 'process_runtime' | 'delivery_hotfix' | 'direct_answer_control' | 'continuation_control'
type P10ERule =
  | 'stop_and_answer_required'
  | 'visible_acceptance_missing'
  | 'user_request_result_mismatch'
  | 'span_of_control_violation'
  | 'context_budget_violation'
  | 'semantic_next_packet_required'
  | 'negative_proof_missing'
type P10EExpectedDecision = 'should_block' | 'should_pass'
type P10EActualDecision = 'blocked_by_selected_profile' | 'passed_through'
type P10EBurdenLevel = 'low' | 'medium' | 'high'

interface CliOptions {
  corpus?: string
  p10dRun?: string
  out?: string
  maxFalsePositiveRate?: number
  maxFalseNegativeRate?: number
  maxMedianBurdenMinutes?: number
  minTaskRuns?: number
  maxTaskRuns?: number
  minPassControls?: number
  json?: boolean
}

interface P10ESourceMessage {
  timestamp: string
  thread: string
  excerpt: string
}

interface P10EAcceptanceRow {
  id: string
  visibleObject: string
  expectedState: string
  evidenceRequired: string[]
  ownerLane: string
  blockingRuleRefs: P10ERule[]
}

interface P10ECorpusTask {
  taskId: string
  domain: P10EDomain
  taskType: P10ETaskType
  userIntent: string
  painPoint: string
  sourceMessages: P10ESourceMessage[]
  acceptanceRows: P10EAcceptanceRow[]
  selectedRulesFired: P10ERule[]
  expectedDecision: P10EExpectedDecision
  estimatedOperatorBurdenMinutes: number
  expectedNextAction: string
}

interface P10ELiveCanaryCorpus {
  schemaVersion: 1
  id: string
  status: 'frozen'
  sourceWindow: {
    from: string
    to: string
    userMessagesRead: number
    uniqueUserMessagesUsed: number
    excluded: string[]
  }
  p10dPrerequisiteRun: string
  selectedRules: P10ERule[]
  scope: P10EDomain[]
  tasks: P10ECorpusTask[]
}

interface P10DDecision {
  schemaVersion: 1
  status: string
  canaryBlockingEnabled: boolean
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
  selectedRules: string[]
}

interface P10ETaskRunRow {
  taskId: string
  domain: P10EDomain
  taskType: P10ETaskType
  acceptanceRows: number
  selectedRulesFired: P10ERule[]
  actualDecision: P10EActualDecision
  expectedDecision: P10EExpectedDecision
  falsePositive: boolean
  falseNegative: boolean
  estimatedOperatorBurdenMinutes: number
  expectedNextAction: string
  outDir: string
}

interface P10ELiveCanaryCorpusReport {
  schemaVersion: 1
  status: 'p10e_live_canary_corpus_ready_adapter_disabled' | 'p10e_live_canary_corpus_failed'
  corpusId: string
  corpusPath: string
  outDir: string
  p10dRunDir: string
  adapterEnabled: false
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
  selectedRules: P10ERule[]
  thresholds: {
    minTaskRuns: number
    maxTaskRuns: number
    maxFalsePositiveRate: number
    maxFalseNegativeRate: number
    maxMedianBurdenMinutes: number
    minPassControls: number
  }
  metrics: {
    taskRuns: number
    shouldBlock: number
    shouldPass: number
    blockedBySelectedProfile: number
    passThrough: number
    falsePositiveTaskRuns: number
    falseNegativeTaskRuns: number
    falsePositiveRate: number
    falseNegativeRate: number
    medianBlockedOperatorBurdenMinutes: number
    medianAllOperatorBurdenMinutes: number
    operatorBurdenLevel: P10EBurdenLevel
  }
  domainCounts: Record<P10EDomain, number>
  ruleCounts: Record<P10ERule, number>
  prerequisite: {
    p10dReady: boolean
    operatingSafetyPrerequisiteInherited: boolean
    adapterStillDisabled: true
  }
  taskRuns: P10ETaskRunRow[]
  nextAction: string
}

const defaultCorpus = 'docs/process/captain-os-lab/fixtures/p10e-live-canary/p10e-live-canary-corpus.json'
const defaultP10DRun = '.ship/lab/runs/manual-p10d-global-enablement-canary'

const knownRules: P10ERule[] = [
  'stop_and_answer_required',
  'visible_acceptance_missing',
  'user_request_result_mismatch',
  'span_of_control_violation',
  'context_budget_violation',
  'semantic_next_packet_required',
  'negative_proof_missing',
]

const domains: P10EDomain[] = ['ui_visual', 'diagrams_seo', 'data_product', 'captain_os', 'delivery_ops', 'control']

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
    if (key === 'corpus') options.corpus = value
    else if (key === 'p10d-run') options.p10dRun = value
    else if (key === 'out') options.out = value
    else if (key === 'max-false-positive-rate') options.maxFalsePositiveRate = Number(value)
    else if (key === 'max-false-negative-rate') options.maxFalseNegativeRate = Number(value)
    else if (key === 'max-median-burden-minutes') options.maxMedianBurdenMinutes = Number(value)
    else if (key === 'min-task-runs') options.minTaskRuns = Number(value)
    else if (key === 'max-task-runs') options.maxTaskRuns = Number(value)
    else if (key === 'min-pass-controls') options.minPassControls = Number(value)
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function numberOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) throw new LabInputError(`${name} must be a non-negative number`)
  return value
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new LabInputError(`P10E corpus field ${field} must be a non-empty string`)
  return value.trim()
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new LabInputError(`P10E corpus field ${field} must be a non-empty string array`)
  }
  return value.map((item) => item.trim())
}

function requireRule(value: unknown, field: string): P10ERule {
  const raw = requireString(value, field)
  if (!knownRules.includes(raw as P10ERule)) throw new LabInputError(`invalid ${field}: ${raw}`)
  return raw as P10ERule
}

function requireRules(value: unknown, field: string): P10ERule[] {
  if (!Array.isArray(value)) throw new LabInputError(`P10E corpus field ${field} must be an array`)
  return value.map((item, index) => requireRule(item, `${field}[${index}]`))
}

function requireDomain(value: unknown, field: string): P10EDomain {
  const raw = requireString(value, field)
  if (!domains.includes(raw as P10EDomain)) throw new LabInputError(`invalid ${field}: ${raw}`)
  return raw as P10EDomain
}

function requireTaskType(value: unknown, field: string): P10ETaskType {
  const raw = requireString(value, field)
  const allowed: P10ETaskType[] = ['visual_repair', 'content_conveyor', 'data_repair', 'process_runtime', 'delivery_hotfix', 'direct_answer_control', 'continuation_control']
  if (!allowed.includes(raw as P10ETaskType)) throw new LabInputError(`invalid ${field}: ${raw}`)
  return raw as P10ETaskType
}

function requireExpectedDecision(value: unknown, field: string): P10EExpectedDecision {
  const raw = requireString(value, field)
  if (raw !== 'should_block' && raw !== 'should_pass') throw new LabInputError(`invalid ${field}: ${raw}`)
  return raw
}

function validateSourceMessages(value: unknown, field: string): P10ESourceMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new LabInputError(`${field} must contain at least one source message`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new LabInputError(`${field}[${index}] must be an object`)
    const raw = item as Record<string, unknown>
    return {
      timestamp: requireString(raw.timestamp, `${field}[${index}].timestamp`),
      thread: requireString(raw.thread, `${field}[${index}].thread`),
      excerpt: requireString(raw.excerpt, `${field}[${index}].excerpt`),
    }
  })
}

function validateAcceptanceRows(value: unknown, field: string): P10EAcceptanceRow[] {
  if (!Array.isArray(value) || value.length === 0) throw new LabInputError(`${field} must contain at least one acceptance row`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new LabInputError(`${field}[${index}] must be an object`)
    const raw = item as Record<string, unknown>
    return {
      id: requireString(raw.id, `${field}[${index}].id`),
      visibleObject: requireString(raw.visibleObject, `${field}[${index}].visibleObject`),
      expectedState: requireString(raw.expectedState, `${field}[${index}].expectedState`),
      evidenceRequired: requireStringArray(raw.evidenceRequired, `${field}[${index}].evidenceRequired`),
      ownerLane: requireString(raw.ownerLane, `${field}[${index}].ownerLane`),
      blockingRuleRefs: requireRules(raw.blockingRuleRefs, `${field}[${index}].blockingRuleRefs`),
    }
  })
}

function validateCorpus(value: unknown): P10ELiveCanaryCorpus {
  if (!value || typeof value !== 'object') throw new LabInputError('P10E corpus must be an object')
  const raw = value as Record<string, unknown>
  const sourceWindow = raw.sourceWindow as Record<string, unknown> | undefined
  if (!sourceWindow || typeof sourceWindow !== 'object') throw new LabInputError('P10E corpus sourceWindow must be an object')
  const tasksRaw = raw.tasks
  if (!Array.isArray(tasksRaw)) throw new LabInputError('P10E corpus tasks must be an array')
  if (tasksRaw.length < 20 || tasksRaw.length > 30) throw new LabInputError(`P10E corpus must contain 20-30 task runs, got ${tasksRaw.length}`)

  const selectedRules = requireRules(raw.selectedRules, 'selectedRules')
  const selectedRuleSet = new Set(selectedRules)
  const tasks = tasksRaw.map((item, index) => {
    if (!item || typeof item !== 'object') throw new LabInputError(`tasks[${index}] must be an object`)
    const taskRaw = item as Record<string, unknown>
    const selectedRulesFired = requireRules(taskRaw.selectedRulesFired, `tasks[${index}].selectedRulesFired`)
    for (const rule of selectedRulesFired) {
      if (!selectedRuleSet.has(rule)) throw new LabInputError(`tasks[${index}] fires rule outside selectedRules: ${rule}`)
    }
    const expectedDecision = requireExpectedDecision(taskRaw.expectedDecision, `tasks[${index}].expectedDecision`)
    if (expectedDecision === 'should_block' && selectedRulesFired.length === 0) {
      throw new LabInputError(`tasks[${index}] should_block requires at least one selected rule`)
    }
    if (expectedDecision === 'should_pass' && selectedRulesFired.length > 0) {
      throw new LabInputError(`tasks[${index}] should_pass must not fire selected rules`)
    }
    const burden = Number(taskRaw.estimatedOperatorBurdenMinutes)
    if (!Number.isFinite(burden) || burden < 0) throw new LabInputError(`invalid tasks[${index}].estimatedOperatorBurdenMinutes`)
    return {
      taskId: requireString(taskRaw.taskId, `tasks[${index}].taskId`),
      domain: requireDomain(taskRaw.domain, `tasks[${index}].domain`),
      taskType: requireTaskType(taskRaw.taskType, `tasks[${index}].taskType`),
      userIntent: requireString(taskRaw.userIntent, `tasks[${index}].userIntent`),
      painPoint: requireString(taskRaw.painPoint, `tasks[${index}].painPoint`),
      sourceMessages: validateSourceMessages(taskRaw.sourceMessages, `tasks[${index}].sourceMessages`),
      acceptanceRows: validateAcceptanceRows(taskRaw.acceptanceRows, `tasks[${index}].acceptanceRows`),
      selectedRulesFired,
      expectedDecision,
      estimatedOperatorBurdenMinutes: burden,
      expectedNextAction: requireString(taskRaw.expectedNextAction, `tasks[${index}].expectedNextAction`),
    }
  })

  const seen = new Set<string>()
  for (const task of tasks) {
    if (seen.has(task.taskId)) throw new LabInputError(`duplicate P10E task id: ${task.taskId}`)
    seen.add(task.taskId)
  }
  for (const domain of ['ui_visual', 'diagrams_seo', 'data_product', 'captain_os'] as P10EDomain[]) {
    if (!tasks.some((task) => task.domain === domain)) throw new LabInputError(`P10E corpus missing domain: ${domain}`)
  }

  return {
    schemaVersion: 1,
    id: requireString(raw.id, 'id'),
    status: raw.status === 'frozen' ? 'frozen' : (() => { throw new LabInputError('P10E corpus status must be frozen') })(),
    sourceWindow: {
      from: requireString(sourceWindow.from, 'sourceWindow.from'),
      to: requireString(sourceWindow.to, 'sourceWindow.to'),
      userMessagesRead: Number(sourceWindow.userMessagesRead),
      uniqueUserMessagesUsed: Number(sourceWindow.uniqueUserMessagesUsed),
      excluded: requireStringArray(sourceWindow.excluded, 'sourceWindow.excluded'),
    },
    p10dPrerequisiteRun: requireString(raw.p10dPrerequisiteRun, 'p10dPrerequisiteRun'),
    selectedRules,
    scope: requireStringArray(raw.scope, 'scope').map((domain, index) => requireDomain(domain, `scope[${index}]`)),
    tasks,
  }
}

function requireP10DReady(run: string): { runDir: string; ready: boolean } {
  const runDir = assertSafeShadowOutDir(run)
  const decisionPath = resolve(runDir, 'global-enablement-decision.json')
  if (!fileExists(decisionPath)) throw new LabInputError(`P10E requires P10D decision artifact: ${decisionPath}`)
  const decision = readJson<P10DDecision>(decisionPath)
  const ready = decision.status === 'p10d_selected_profile_canary_ready_global_disabled' &&
    decision.canaryBlockingEnabled === true &&
    decision.globalBlockingEnabled === false &&
    decision.productAcceptedFullAllowed === false
  return { runDir, ready }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function burdenLevel(minutes: number): P10EBurdenLevel {
  if (minutes <= 3) return 'low'
  if (minutes <= 8) return 'medium'
  return 'high'
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>
  for (const item of items) {
    const value = key(item)
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function zeroRuleCounts(): Record<P10ERule, number> {
  return Object.fromEntries(knownRules.map((rule) => [rule, 0])) as Record<P10ERule, number>
}

function taskRunFor(task: P10ECorpusTask, taskOutDir: string): P10ETaskRunRow {
  const actualDecision: P10EActualDecision = task.selectedRulesFired.length > 0 ? 'blocked_by_selected_profile' : 'passed_through'
  return {
    taskId: task.taskId,
    domain: task.domain,
    taskType: task.taskType,
    acceptanceRows: task.acceptanceRows.length,
    selectedRulesFired: task.selectedRulesFired,
    actualDecision,
    expectedDecision: task.expectedDecision,
    falsePositive: actualDecision === 'blocked_by_selected_profile' && task.expectedDecision === 'should_pass',
    falseNegative: actualDecision === 'passed_through' && task.expectedDecision === 'should_block',
    estimatedOperatorBurdenMinutes: task.estimatedOperatorBurdenMinutes,
    expectedNextAction: task.expectedNextAction,
    outDir: relative(repoRoot(), taskOutDir),
  }
}

export function buildP10ELiveCanaryCorpusReport(options: CliOptions): P10ELiveCanaryCorpusReport {
  const corpusPath = resolve(repoRoot(), options.corpus ?? defaultCorpus)
  if (!fileExists(corpusPath)) throw new LabInputError(`P10E corpus not found: ${corpusPath}`)
  const corpus = validateCorpus(readJson(corpusPath))
  const p10d = requireP10DReady(options.p10dRun ?? corpus.p10dPrerequisiteRun ?? defaultP10DRun)
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${timestampRunId('p10e-live-canary-corpus')}`)
  ensureDir(outDir)

  const thresholds = {
    minTaskRuns: numberOption(options.minTaskRuns, 20, 'min-task-runs'),
    maxTaskRuns: numberOption(options.maxTaskRuns, 30, 'max-task-runs'),
    maxFalsePositiveRate: numberOption(options.maxFalsePositiveRate, 0.05, 'max-false-positive-rate'),
    maxFalseNegativeRate: numberOption(options.maxFalseNegativeRate, 0.05, 'max-false-negative-rate'),
    maxMedianBurdenMinutes: numberOption(options.maxMedianBurdenMinutes, 8, 'max-median-burden-minutes'),
    minPassControls: numberOption(options.minPassControls, 4, 'min-pass-controls'),
  }

  const taskRuns = corpus.tasks.map((task) => {
    const taskOutDir = resolve(outDir, 'task-runs', task.taskId)
    ensureDir(taskOutDir)
    const row = taskRunFor(task, taskOutDir)
    writeJson(resolve(taskOutDir, 'task-input.json'), task)
    writeJson(resolve(taskOutDir, 'acceptance-rows.json'), task.acceptanceRows)
    writeJson(resolve(taskOutDir, 'canary-task-run.json'), row)
    return row
  })

  const blockedRows = taskRuns.filter((row) => row.actualDecision === 'blocked_by_selected_profile')
  const passRows = taskRuns.filter((row) => row.actualDecision === 'passed_through')
  const falsePositiveTaskRuns = taskRuns.filter((row) => row.falsePositive).length
  const falseNegativeTaskRuns = taskRuns.filter((row) => row.falseNegative).length
  const shouldBlock = taskRuns.filter((row) => row.expectedDecision === 'should_block').length
  const shouldPass = taskRuns.filter((row) => row.expectedDecision === 'should_pass').length
  const falsePositiveRate = rate(falsePositiveTaskRuns, Math.max(blockedRows.length, 1))
  const falseNegativeRate = rate(falseNegativeTaskRuns, Math.max(shouldBlock, 1))
  const medianBlockedBurden = median(blockedRows.map((row) => row.estimatedOperatorBurdenMinutes))
  const medianAllBurden = median(taskRuns.map((row) => row.estimatedOperatorBurdenMinutes))
  const ruleCounts = zeroRuleCounts()
  for (const task of corpus.tasks) {
    for (const rule of task.selectedRulesFired) ruleCounts[rule] += 1
  }
  const pass = p10d.ready &&
    taskRuns.length >= thresholds.minTaskRuns &&
    taskRuns.length <= thresholds.maxTaskRuns &&
    shouldPass >= thresholds.minPassControls &&
    falsePositiveRate <= thresholds.maxFalsePositiveRate &&
    falseNegativeRate <= thresholds.maxFalseNegativeRate &&
    medianBlockedBurden <= thresholds.maxMedianBurdenMinutes

  const report: P10ELiveCanaryCorpusReport = {
    schemaVersion: 1,
    status: pass ? 'p10e_live_canary_corpus_ready_adapter_disabled' : 'p10e_live_canary_corpus_failed',
    corpusId: corpus.id,
    corpusPath: relative(repoRoot(), corpusPath),
    outDir: relative(repoRoot(), outDir),
    p10dRunDir: relative(repoRoot(), p10d.runDir),
    adapterEnabled: false,
    globalBlockingEnabled: false,
    productAcceptedFullAllowed: false,
    selectedRules: corpus.selectedRules,
    thresholds,
    metrics: {
      taskRuns: taskRuns.length,
      shouldBlock,
      shouldPass,
      blockedBySelectedProfile: blockedRows.length,
      passThrough: passRows.length,
      falsePositiveTaskRuns,
      falseNegativeTaskRuns,
      falsePositiveRate,
      falseNegativeRate,
      medianBlockedOperatorBurdenMinutes: medianBlockedBurden,
      medianAllOperatorBurdenMinutes: medianAllBurden,
      operatorBurdenLevel: burdenLevel(medianBlockedBurden),
    },
    domainCounts: countBy(taskRuns, (row) => row.domain),
    ruleCounts,
    prerequisite: {
      p10dReady: p10d.ready,
      operatingSafetyPrerequisiteInherited: p10d.ready,
      adapterStillDisabled: true,
    },
    taskRuns,
    nextAction: pass
      ? 'Implement the opt-in live runtime adapter against this frozen corpus. Keep adapter/global blocking disabled until live task evidence is collected.'
      : 'Repair the P10E corpus or selected rule mapping before any live runtime adapter work.',
  }

  writeJson(resolve(outDir, 'p10e-live-canary-corpus-report.json'), report)
  writeJson(resolve(outDir, 'metrics.json'), report.metrics)
  writeJson(resolve(outDir, 'canary-scope.json'), {
    schemaVersion: 1,
    corpusId: corpus.id,
    sourceWindow: corpus.sourceWindow,
    scope: corpus.scope,
    selectedRules: corpus.selectedRules,
    adapterEnabled: report.adapterEnabled,
    globalBlockingEnabled: report.globalBlockingEnabled,
  })
  writeText(resolve(outDir, 'p10e-live-canary-corpus-report.md'), renderMarkdown(report))
  return report
}

function renderMarkdown(report: P10ELiveCanaryCorpusReport): string {
  const taskRows = report.taskRuns
    .map((row) => `| ${row.taskId} | ${row.domain} | ${row.actualDecision} | ${row.expectedDecision} | ${row.selectedRulesFired.join(', ') || '-'} | ${row.falsePositive} | ${row.falseNegative} | ${row.estimatedOperatorBurdenMinutes} |`)
    .join('\n')
  const ruleRows = knownRules.map((rule) => `| ${rule} | ${report.ruleCounts[rule]} |`).join('\n')

  return `# P10E Live Canary Corpus Report

Status: ${report.status}
Corpus: ${report.corpusId}
P10D prerequisite: ${report.p10dRunDir}
Adapter enabled: ${report.adapterEnabled}
Global blocking enabled: ${report.globalBlockingEnabled}
Product accepted_full allowed: ${report.productAcceptedFullAllowed}

## Metrics

- taskRuns: ${report.metrics.taskRuns}
- shouldBlock: ${report.metrics.shouldBlock}
- shouldPass: ${report.metrics.shouldPass}
- blockedBySelectedProfile: ${report.metrics.blockedBySelectedProfile}
- passThrough: ${report.metrics.passThrough}
- falsePositiveTaskRuns: ${report.metrics.falsePositiveTaskRuns}
- falseNegativeTaskRuns: ${report.metrics.falseNegativeTaskRuns}
- falsePositiveRate: ${report.metrics.falsePositiveRate.toFixed(2)}
- falseNegativeRate: ${report.metrics.falseNegativeRate.toFixed(2)}
- medianBlockedOperatorBurdenMinutes: ${report.metrics.medianBlockedOperatorBurdenMinutes}
- medianAllOperatorBurdenMinutes: ${report.metrics.medianAllOperatorBurdenMinutes}
- operatorBurdenLevel: ${report.metrics.operatorBurdenLevel}

## Rule Coverage

| Rule | Task Runs |
|---|---:|
${ruleRows}

## Task Runs

| Task | Domain | Actual | Expected | Rules | FP | FN | Burden |
|---|---|---|---|---|---|---|---:|
${taskRows}

## Next Action

${report.nextAction}
`
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = buildP10ELiveCanaryCorpusReport(options)
    const summary = {
      status: report.status,
      outDir: report.outDir,
      taskRuns: report.metrics.taskRuns,
      shouldBlock: report.metrics.shouldBlock,
      shouldPass: report.metrics.shouldPass,
      falsePositiveTaskRuns: report.metrics.falsePositiveTaskRuns,
      falseNegativeTaskRuns: report.metrics.falseNegativeTaskRuns,
      medianBlockedOperatorBurdenMinutes: report.metrics.medianBlockedOperatorBurdenMinutes,
      adapterEnabled: report.adapterEnabled,
      globalBlockingEnabled: report.globalBlockingEnabled,
      report: `${report.outDir}/p10e-live-canary-corpus-report.json`,
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`P10E live canary corpus: ${summary.status}`)
      console.log(`taskRuns: ${summary.taskRuns}`)
      console.log(`falsePositiveTaskRuns: ${summary.falsePositiveTaskRuns}`)
      console.log(`falseNegativeTaskRuns: ${summary.falseNegativeTaskRuns}`)
      console.log(`adapterEnabled: ${summary.adapterEnabled}`)
      console.log(`report: ${summary.report}`)
    }
    process.exitCode = report.status === 'p10e_live_canary_corpus_ready_adapter_disabled' ? 0 : 2
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

if (isDirectEntrypoint('p10e-live-canary-corpus.ts')) main()
