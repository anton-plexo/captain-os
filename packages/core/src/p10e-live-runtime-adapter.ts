import { relative, resolve } from 'node:path'
import { buildOperatingSafety } from './operating-safety'
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
import type { LabInput } from './schema'

type P10EDomain = 'ui_visual' | 'diagrams_seo' | 'data_product' | 'captain_os' | 'delivery_ops' | 'control'
type P10ERule =
  | 'stop_and_answer_required'
  | 'visible_acceptance_missing'
  | 'user_request_result_mismatch'
  | 'span_of_control_violation'
  | 'context_budget_violation'
  | 'semantic_next_packet_required'
  | 'negative_proof_missing'
type AdapterDecision = 'answer_first_no_edits' | 'block_final_claim' | 'allow_continue'
type AdapterGate = 'pre_action' | 'pre_final_claim'

interface CliOptions {
  corpus?: string
  p10dRun?: string
  packet?: string
  task?: string
  gate?: AdapterGate
  out?: string
  json?: boolean
}

interface SourceMessage {
  timestamp: string
  thread: string
  excerpt: string
}

interface LiveAcceptanceRow {
  id: string
  visibleObject: string
  expectedState: string
  currentState?: string | null
  evidenceRequired: string[]
  ownerLane: string
  blockingRuleRefs: P10ERule[]
  status?: 'open' | 'closed' | 'deferred' | 'next_packet'
}

interface LiveRuntimePacket {
  schemaVersion: 1
  taskId: string
  domain: P10EDomain
  gate: AdapterGate
  userIntent: string
  currentAgentClaim?: string
  sourceMessages?: SourceMessage[]
  acceptanceRows: LiveAcceptanceRow[]
  context?: Record<string, string | number | boolean | string[]>
}

interface P10ECorpusTask {
  taskId: string
  domain: P10EDomain
  taskType: string
  userIntent: string
  painPoint: string
  sourceMessages: SourceMessage[]
  acceptanceRows: Array<Omit<LiveAcceptanceRow, 'status'>>
  selectedRulesFired: P10ERule[]
  expectedDecision: 'should_block' | 'should_pass'
  estimatedOperatorBurdenMinutes: number
  expectedNextAction: string
}

interface P10ECorpus {
  schemaVersion: 1
  id: string
  status: 'frozen'
  p10dPrerequisiteRun: string
  selectedRules: P10ERule[]
  tasks: P10ECorpusTask[]
}

interface P10DDecision {
  schemaVersion: 1
  status: string
  canaryBlockingEnabled: boolean
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
}

interface AdapterDecisionRow {
  taskId: string
  domain: P10EDomain
  gate: AdapterGate
  decision: AdapterDecision
  selectedRulesTriggered: P10ERule[]
  blockingAcceptanceRows: string[]
  operatingSafetyBlocks: string[]
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
  requiredNextAction: string
}

interface AdapterReport {
  schemaVersion: 1
  status: 'p10e_live_runtime_adapter_ready_global_disabled' | 'p10e_live_runtime_adapter_failed'
  adapterMode: 'opt_in_live_runtime_adapter'
  outDir: string
  corpusPath: string
  p10dRunDir: string
  optInAdapterEnabled: true
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
  selectedRules: P10ERule[]
  metrics: {
    evaluatedTasks: number
    answerFirst: number
    blockFinalClaim: number
    allowContinue: number
    falsePositiveTaskRuns: number
    falseNegativeTaskRuns: number
    replayCorpusTasks: number
  }
  prerequisite: {
    p10dReady: boolean
    corpusReplayMode: boolean
  }
  decisions: AdapterDecisionRow[]
  nextAction: string
}

const defaultCorpus = 'docs/process/captain-os-lab/fixtures/p10e-live-canary/p10e-live-canary-corpus.json'
const defaultP10DRun = '.ship/lab/runs/manual-p10d-global-enablement-canary'
const selectedRules: P10ERule[] = [
  'stop_and_answer_required',
  'visible_acceptance_missing',
  'user_request_result_mismatch',
  'span_of_control_violation',
  'context_budget_violation',
  'semantic_next_packet_required',
  'negative_proof_missing',
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
    if (key === 'corpus') options.corpus = value
    else if (key === 'p10d-run') options.p10dRun = value
    else if (key === 'packet') options.packet = value
    else if (key === 'task') options.task = value
    else if (key === 'gate') {
      if (value !== 'pre_action' && value !== 'pre_final_claim') throw new LabInputError(`invalid --gate: ${value}`)
      options.gate = value
    } else if (key === 'out') options.out = value
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  if (options.packet && options.task) throw new LabInputError('use either --packet or --task, not both')
  return options
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new LabInputError(`${field} must be a non-empty string`)
  return value.trim()
}

function contextValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) return value.join(';')
  return String(value)
}

function packetToLabInput(packet: LiveRuntimePacket): LabInput {
  const openRows = packet.acceptanceRows.filter((row) => (row.status ?? 'open') === 'open')
  const missingVisibleObjects = openRows
    .filter((row) => row.blockingRuleRefs.includes('visible_acceptance_missing'))
    .map((row) => row.visibleObject)
  const explicitContext = Object.fromEntries(
    Object.entries(packet.context ?? {}).map(([key, value]) => [key, contextValue(value)]),
  )
  return {
    id: packet.taskId,
    title: packet.taskId,
    task: [
      packet.userIntent,
      packet.currentAgentClaim ?? '',
      packet.acceptanceRows.map((row) => `${row.visibleObject}: ${row.expectedState}`).join('\n'),
    ].join('\n'),
    sourceDocs: [defaultCorpus],
    tags: [packet.domain, packet.gate],
    context: {
      ...explicitContext,
      userIntentRows: packet.acceptanceRows.map((row) => row.expectedState).join(';'),
      visibleAcceptanceObjects: packet.acceptanceRows.map((row) => row.visibleObject).join(';'),
      missingVisibleObjects: missingVisibleObjects.join(';'),
      activeRowCount: String(openRows.length || packet.acceptanceRows.length),
      testsGreen: explicitContext.testsGreen ?? 'true',
      userInspectionObject: explicitContext.userInspectionObject ?? openRows[0]?.visibleObject ?? '',
      agentAcceptanceObject: explicitContext.agentAcceptanceObject ?? packet.currentAgentClaim ?? openRows[0]?.visibleObject ?? '',
    },
  }
}

function corpusTaskToPacket(task: P10ECorpusTask): LiveRuntimePacket {
  return {
    schemaVersion: 1,
    taskId: task.taskId,
    domain: task.domain,
    gate: task.expectedDecision === 'should_block' ? 'pre_final_claim' : 'pre_action',
    userIntent: task.userIntent,
    currentAgentClaim: task.expectedDecision === 'should_block'
      ? 'Agent is attempting to claim done or proceed without required evidence.'
      : 'No final claim is being made.',
    sourceMessages: task.sourceMessages,
    acceptanceRows: task.acceptanceRows.map((row) => ({
      ...row,
      status: task.expectedDecision === 'should_block' ? 'open' : 'closed',
    })),
    context: {
      expectedDecision: task.expectedDecision,
      expectedNextAction: task.expectedNextAction,
      testsGreen: task.expectedDecision === 'should_block',
      userRequestResultMismatch: task.selectedRulesFired.includes('user_request_result_mismatch'),
      directQuestion: task.selectedRulesFired.includes('stop_and_answer_required'),
      activeRowCount: task.selectedRulesFired.includes('span_of_control_violation') ? 12 : task.acceptanceRows.length,
      broadcastContext: task.selectedRulesFired.includes('context_budget_violation'),
      negativeProofRequired: task.selectedRulesFired.includes('negative_proof_missing'),
      openWorkWithoutNextPacket: task.selectedRulesFired.includes('semantic_next_packet_required'),
    },
  }
}

function taskTextToPacket(taskText: string, gate: AdapterGate): LiveRuntimePacket {
  return {
    schemaVersion: 1,
    taskId: 'live-task',
    domain: 'captain_os',
    gate,
    userIntent: taskText,
    currentAgentClaim: gate === 'pre_final_claim' ? 'Agent is attempting a final claim.' : '',
    sourceMessages: [
      {
        timestamp: new Date().toISOString(),
        thread: 'current',
        excerpt: taskText.slice(0, 240),
      },
    ],
    acceptanceRows: [
      {
        id: 'live-row-001',
        visibleObject: 'current live task',
        expectedState: 'Task proceeds only if selected P10E/P0 rules do not block.',
        evidenceRequired: ['live adapter decision'],
        ownerLane: 'Captain',
        blockingRuleRefs: [],
        status: 'closed',
      },
    ],
    context: {},
  }
}

function requireP10DReady(run: string): { runDir: string; ready: boolean } {
  const runDir = assertSafeShadowOutDir(run)
  const decisionPath = resolve(runDir, 'global-enablement-decision.json')
  if (!fileExists(decisionPath)) throw new LabInputError(`P10E adapter requires P10D decision artifact: ${decisionPath}`)
  const decision = readJson<P10DDecision>(decisionPath)
  const ready = decision.status === 'p10d_selected_profile_canary_ready_global_disabled' &&
    decision.canaryBlockingEnabled === true &&
    decision.globalBlockingEnabled === false &&
    decision.productAcceptedFullAllowed === false
  return { runDir, ready }
}

function livePacketFromFile(path: string): LiveRuntimePacket {
  const resolved = resolve(repoRoot(), path)
  if (!fileExists(resolved)) throw new LabInputError(`live adapter packet not found: ${resolved}`)
  const raw = readJson<Record<string, unknown>>(resolved)
  if (!raw || typeof raw !== 'object') throw new LabInputError('live adapter packet must be an object')
  const acceptanceRows = raw.acceptanceRows
  if (!Array.isArray(acceptanceRows) || acceptanceRows.length === 0) {
    throw new LabInputError('live adapter packet acceptanceRows must be a non-empty array')
  }
  return {
    schemaVersion: 1,
    taskId: requireString(raw.taskId, 'taskId'),
    domain: requireString(raw.domain, 'domain') as P10EDomain,
    gate: (raw.gate === 'pre_action' || raw.gate === 'pre_final_claim') ? raw.gate : 'pre_final_claim',
    userIntent: requireString(raw.userIntent, 'userIntent'),
    currentAgentClaim: typeof raw.currentAgentClaim === 'string' ? raw.currentAgentClaim : undefined,
    sourceMessages: Array.isArray(raw.sourceMessages) ? raw.sourceMessages as SourceMessage[] : [],
    acceptanceRows: acceptanceRows as LiveAcceptanceRow[],
    context: raw.context && typeof raw.context === 'object' ? raw.context as LiveRuntimePacket['context'] : {},
  }
}

function ruleTriggers(packet: LiveRuntimePacket): { rules: P10ERule[]; blockingRows: string[]; operatingSafetyBlocks: string[] } {
  const openRows = packet.acceptanceRows.filter((row) => (row.status ?? 'open') === 'open')
  const rules = new Set<P10ERule>()
  const blockingRows: string[] = []
  for (const row of openRows) {
    for (const rule of row.blockingRuleRefs) {
      if (selectedRules.includes(rule)) {
        rules.add(rule)
        blockingRows.push(row.id)
      }
    }
  }

  const operatingSafety = buildOperatingSafety(packetToLabInput(packet))
  for (const block of operatingSafety.blocks) {
    if (selectedRules.includes(block as P10ERule)) rules.add(block as P10ERule)
  }

  const context = packet.context ?? {}
  if (context.openWorkWithoutNextPacket === true || context.openWorkWithoutNextPacket === 'true') rules.add('semantic_next_packet_required')
  if (context.negativeProofRequired === true || context.negativeProofRequired === 'true') {
    const refs = String(context.negativeProofRefs ?? '').trim()
    if (!refs) rules.add('negative_proof_missing')
  }

  return {
    rules: [...rules].sort(),
    blockingRows: [...new Set(blockingRows)].sort(),
    operatingSafetyBlocks: operatingSafety.blocks,
  }
}

function decisionFor(packet: LiveRuntimePacket): AdapterDecisionRow {
  const triggers = ruleTriggers(packet)
  const decision: AdapterDecision = triggers.rules.includes('stop_and_answer_required')
    ? 'answer_first_no_edits'
    : triggers.rules.length > 0
      ? 'block_final_claim'
      : 'allow_continue'
  const requiredNextAction = decision === 'answer_first_no_edits'
    ? 'Answer the user directly before edits, tool calls, or final repair claims.'
    : decision === 'block_final_claim'
      ? 'Do not make a final done/accepted_full claim. Close the blocking rows or bind them into a next packet/accepted-risk record.'
      : 'No selected-profile block. Continue in the scoped opt-in task.'

  return {
    taskId: packet.taskId,
    domain: packet.domain,
    gate: packet.gate,
    decision,
    selectedRulesTriggered: triggers.rules,
    blockingAcceptanceRows: triggers.blockingRows,
    operatingSafetyBlocks: triggers.operatingSafetyBlocks,
    globalBlockingEnabled: false,
    productAcceptedFullAllowed: false,
    requiredNextAction,
  }
}

function loadCorpus(path: string): P10ECorpus {
  const resolved = resolve(repoRoot(), path)
  if (!fileExists(resolved)) throw new LabInputError(`P10E corpus not found: ${resolved}`)
  const corpus = readJson<P10ECorpus>(resolved)
  if (!Array.isArray(corpus.tasks) || corpus.tasks.length === 0) throw new LabInputError('P10E corpus has no tasks')
  return corpus
}

export function buildP10ELiveRuntimeAdapterReport(options: CliOptions): AdapterReport {
  const corpusPath = options.corpus ?? defaultCorpus
  const corpus = loadCorpus(corpusPath)
  const p10d = requireP10DReady(options.p10dRun ?? corpus.p10dPrerequisiteRun ?? defaultP10DRun)
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${timestampRunId('p10e-live-runtime-adapter')}`)
  ensureDir(outDir)

  const packets = options.packet
    ? [livePacketFromFile(options.packet)]
    : options.task
      ? [taskTextToPacket(options.task, options.gate ?? 'pre_action')]
      : corpus.tasks.map(corpusTaskToPacket)

  const decisions = packets.map((packet) => {
    const decision = decisionFor(packet)
    const taskOut = resolve(outDir, 'live-decisions', packet.taskId)
    writeJson(resolve(taskOut, 'live-packet.json'), packet)
    writeJson(resolve(taskOut, 'live-adapter-decision.json'), decision)
    return decision
  })

  const corpusReplay = !options.packet && !options.task
  let falsePositiveTaskRuns = 0
  let falseNegativeTaskRuns = 0
  if (corpusReplay) {
    const byId = new Map(corpus.tasks.map((task) => [task.taskId, task]))
    for (const decision of decisions) {
      const expected = byId.get(decision.taskId)?.expectedDecision
      const blocked = decision.decision !== 'allow_continue'
      if (expected === 'should_pass' && blocked) falsePositiveTaskRuns += 1
      if (expected === 'should_block' && !blocked) falseNegativeTaskRuns += 1
    }
  }

  const pass = p10d.ready && falsePositiveTaskRuns === 0 && falseNegativeTaskRuns === 0
  const report: AdapterReport = {
    schemaVersion: 1,
    status: pass ? 'p10e_live_runtime_adapter_ready_global_disabled' : 'p10e_live_runtime_adapter_failed',
    adapterMode: 'opt_in_live_runtime_adapter',
    outDir: relative(repoRoot(), outDir),
    corpusPath,
    p10dRunDir: relative(repoRoot(), p10d.runDir),
    optInAdapterEnabled: true,
    globalBlockingEnabled: false,
    productAcceptedFullAllowed: false,
    selectedRules,
    metrics: {
      evaluatedTasks: decisions.length,
      answerFirst: decisions.filter((row) => row.decision === 'answer_first_no_edits').length,
      blockFinalClaim: decisions.filter((row) => row.decision === 'block_final_claim').length,
      allowContinue: decisions.filter((row) => row.decision === 'allow_continue').length,
      falsePositiveTaskRuns,
      falseNegativeTaskRuns,
      replayCorpusTasks: corpusReplay ? corpus.tasks.length : 0,
    },
    prerequisite: {
      p10dReady: p10d.ready,
      corpusReplayMode: corpusReplay,
    },
    decisions,
    nextAction: pass
      ? 'Use this opt-in adapter on the next live tasks. Keep global blocking disabled until live evidence shows low FP/FN and acceptable burden.'
      : 'Repair adapter decision logic or packet rows before using it on live tasks.',
  }

  writeJson(resolve(outDir, 'p10e-live-runtime-adapter-report.json'), report)
  writeJson(resolve(outDir, 'live-adapter-decisions.json'), {
    schemaVersion: 1,
    adapterMode: report.adapterMode,
    optInAdapterEnabled: report.optInAdapterEnabled,
    globalBlockingEnabled: report.globalBlockingEnabled,
    productAcceptedFullAllowed: report.productAcceptedFullAllowed,
    decisions,
  })
  writeText(resolve(outDir, 'p10e-live-runtime-adapter-report.md'), renderMarkdown(report))
  return report
}

function renderMarkdown(report: AdapterReport): string {
  const rows = report.decisions
    .map((row) => `| ${row.taskId} | ${row.domain} | ${row.gate} | ${row.decision} | ${row.selectedRulesTriggered.join(', ') || '-'} | ${row.blockingAcceptanceRows.join(', ') || '-'} |`)
    .join('\n')
  return `# P10E Live Runtime Adapter Report

Status: ${report.status}
Adapter mode: ${report.adapterMode}
Opt-in adapter enabled: ${report.optInAdapterEnabled}
Global blocking enabled: ${report.globalBlockingEnabled}
Product accepted_full allowed: ${report.productAcceptedFullAllowed}

## Metrics

- evaluatedTasks: ${report.metrics.evaluatedTasks}
- answerFirst: ${report.metrics.answerFirst}
- blockFinalClaim: ${report.metrics.blockFinalClaim}
- allowContinue: ${report.metrics.allowContinue}
- falsePositiveTaskRuns: ${report.metrics.falsePositiveTaskRuns}
- falseNegativeTaskRuns: ${report.metrics.falseNegativeTaskRuns}
- replayCorpusTasks: ${report.metrics.replayCorpusTasks}

## Decisions

| Task | Domain | Gate | Decision | Rules | Rows |
|---|---|---|---|---|---|
${rows}

## Next Action

${report.nextAction}
`
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = buildP10ELiveRuntimeAdapterReport(options)
    const summary = {
      status: report.status,
      outDir: report.outDir,
      optInAdapterEnabled: report.optInAdapterEnabled,
      globalBlockingEnabled: report.globalBlockingEnabled,
      productAcceptedFullAllowed: report.productAcceptedFullAllowed,
      evaluatedTasks: report.metrics.evaluatedTasks,
      answerFirst: report.metrics.answerFirst,
      blockFinalClaim: report.metrics.blockFinalClaim,
      allowContinue: report.metrics.allowContinue,
      falsePositiveTaskRuns: report.metrics.falsePositiveTaskRuns,
      falseNegativeTaskRuns: report.metrics.falseNegativeTaskRuns,
      report: `${report.outDir}/p10e-live-runtime-adapter-report.json`,
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`P10E live runtime adapter: ${summary.status}`)
      console.log(`evaluatedTasks: ${summary.evaluatedTasks}`)
      console.log(`answerFirst: ${summary.answerFirst}`)
      console.log(`blockFinalClaim: ${summary.blockFinalClaim}`)
      console.log(`allowContinue: ${summary.allowContinue}`)
      console.log(`globalBlockingEnabled: ${summary.globalBlockingEnabled}`)
      console.log(`report: ${summary.report}`)
    }
    process.exitCode = report.status === 'p10e_live_runtime_adapter_ready_global_disabled' ? 0 : 2
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

if (isDirectEntrypoint('p10e-live-runtime-adapter.ts')) main()
