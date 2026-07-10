import { relative, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { compileArtifactSpec } from './artifact-compiler'
import { buildAdvisoryReport } from './execution-state-machine'
import { loadFixtureById } from './fixtures'
import {
  LabInputError,
  LabUnsafeWriteError,
  assertSafeShadowOutDir,
  ensureDir,
  fileExists,
  gitRef,
  readJson,
  repoRoot,
  timestampRunId,
  writeJson,
  writeText,
} from './io'
import { runLab } from './ship'
import {
  type CaptainMode,
  type ComplexityTier,
  type FixtureInput,
  type IntentMode,
  type LabMode,
  type PlanDepth,
  type Sailor,
  depthValue,
  isComplexityTier,
  isIntentMode,
  isSailor,
  maxDepth,
  tierValue,
} from './schema'

type P9BDomain = 'ui' | 'cms' | 'security' | 'shipping' | 'data' | 'strategy' | 'mixed'
type P9BInputMode = 'baseline_advisory' | 'advisory_with_spec' | 'paired_comparison'
type P9BSpecMode = 'none' | 'generated_from_fixture' | 'generated_from_task' | 'path'
type P9BPerspective =
  | 'anton_intent_fidelity'
  | 'continuation_no_false_done'
  | 'runtime_state_machine'
  | 'domain_expert'
  | 'operator_burden'

interface CliOptions {
  corpus?: string
  out?: string
  json?: boolean
}

interface P9BCorpusTask {
  taskId: string
  fixtureId?: string
  domain: P9BDomain
  inputMode: P9BInputMode
  task?: string
  sourceCase?: string
  expectedIntentMode: IntentMode
  expectedComplexityTier: ComplexityTier
  expectedInspectionObject: string
  expectedAcceptanceObject: string
  knownFailureClass: string
  specMode: P9BSpecMode
  specPath?: string
}

interface P9BCorpus {
  schemaVersion: 1
  id: string
  status: 'frozen'
  frozenAt: string
  protocol: string
  description: string
  tasks: P9BCorpusTask[]
}

interface P9BRunVariantSummary {
  variant: 'baseline_advisory' | 'advisory_with_spec'
  outDir: string
  decision: string
  requiredNextAction: string
  p9dBlocks: string[]
  p9dBlockCount: number
  preventedFailureSignals: string[]
  generatedSpecPath: string | null
  executableSpecOutDir: string | null
}

interface P9BTaskSummary {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  knownFailureClass: string
  expectedInspectionObject: string
  expectedAcceptanceObject: string
  expectedBlocks: string[]
  variants: P9BRunVariantSummary[]
  machineOutcome: 'machine_true_pass_candidate' | 'machine_correct_block_candidate' | 'potential_false_positive_needs_judge' | 'potential_false_negative_needs_judge'
  judgeReportsExpected: number
  judgeReportsReceived: 0
}

interface P9BRunReport {
  schemaVersion: 1
  status: 'p9b_batch_ready_for_independent_judges'
  runId: string
  createdAt: string
  corpusId: string
  corpusPath: string
  protocol: string
  gitRef: string
  outDir: string
  totals: {
    tasks: number
    baselineRuns: number
    advisoryWithSpecRuns: number
    pairedComparisons: number
    judgePackets: number
    judgeReportsReceived: 0
    potentialFalsePositiveNeedsJudge: number
    potentialFalseNegativeNeedsJudge: number
    machineCorrectBlockCandidates: number
    machineTruePassCandidates: number
  }
  domainCounts: Record<P9BDomain, number>
  inputModeCounts: Record<P9BInputMode, number>
  taskSummaries: P9BTaskSummary[]
  nextAction: string
}

const defaultCorpus = 'docs/process/captain-os-lab/fixtures/p9b-live/p9b-corpus.json'

const perspectives: P9BPerspective[] = [
  'anton_intent_fidelity',
  'continuation_no_false_done',
  'runtime_state_machine',
  'domain_expert',
  'operator_burden',
]

const domainMinimums: Record<P9BDomain, number> = {
  ui: 4,
  cms: 3,
  security: 2,
  shipping: 2,
  data: 2,
  strategy: 3,
  mixed: 4,
}

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
    else if (key === 'out') options.out = value
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new LabInputError(`P9B corpus field ${field} must be a non-empty string`)
  return value
}

function requireDomain(value: unknown, field: string): P9BDomain {
  const allowed: P9BDomain[] = ['ui', 'cms', 'security', 'shipping', 'data', 'strategy', 'mixed']
  const raw = requireString(value, field)
  if (!allowed.includes(raw as P9BDomain)) throw new LabInputError(`invalid ${field}: ${raw}`)
  return raw as P9BDomain
}

function requireInputMode(value: unknown, field: string): P9BInputMode {
  const allowed: P9BInputMode[] = ['baseline_advisory', 'advisory_with_spec', 'paired_comparison']
  const raw = requireString(value, field)
  if (!allowed.includes(raw as P9BInputMode)) throw new LabInputError(`invalid ${field}: ${raw}`)
  return raw as P9BInputMode
}

function requireSpecMode(value: unknown, field: string): P9BSpecMode {
  const allowed: P9BSpecMode[] = ['none', 'generated_from_fixture', 'generated_from_task', 'path']
  const raw = requireString(value, field)
  if (!allowed.includes(raw as P9BSpecMode)) throw new LabInputError(`invalid ${field}: ${raw}`)
  return raw as P9BSpecMode
}

function validateCorpus(value: unknown): P9BCorpus {
  if (!value || typeof value !== 'object') throw new LabInputError('P9B corpus must be an object')
  const raw = value as Record<string, unknown>
  const tasksRaw = raw.tasks
  if (!Array.isArray(tasksRaw)) throw new LabInputError('P9B corpus tasks must be an array')
  if (tasksRaw.length < 20 || tasksRaw.length > 30) throw new LabInputError(`P9B corpus must contain 20-30 tasks, got ${tasksRaw.length}`)

  const tasks = tasksRaw.map((item, index) => {
    if (!item || typeof item !== 'object') throw new LabInputError(`P9B corpus task ${index} must be an object`)
    const taskRaw = item as Record<string, unknown>
    const expectedIntentMode = requireString(taskRaw.expectedIntentMode, `tasks[${index}].expectedIntentMode`)
    const expectedComplexityTier = requireString(taskRaw.expectedComplexityTier, `tasks[${index}].expectedComplexityTier`)
    if (!isIntentMode(expectedIntentMode)) throw new LabInputError(`invalid tasks[${index}].expectedIntentMode: ${expectedIntentMode}`)
    if (!isComplexityTier(expectedComplexityTier)) throw new LabInputError(`invalid tasks[${index}].expectedComplexityTier: ${expectedComplexityTier}`)

    const fixtureId = typeof taskRaw.fixtureId === 'string' && taskRaw.fixtureId.trim() ? taskRaw.fixtureId.trim() : undefined
    const task = typeof taskRaw.task === 'string' && taskRaw.task.trim() ? taskRaw.task.trim() : undefined
    if (!fixtureId && !task) throw new LabInputError(`tasks[${index}] must provide fixtureId or task`)

    const inputMode = requireInputMode(taskRaw.inputMode, `tasks[${index}].inputMode`)
    const specMode = requireSpecMode(taskRaw.specMode, `tasks[${index}].specMode`)
    if (inputMode !== 'baseline_advisory' && specMode === 'none') {
      throw new LabInputError(`tasks[${index}] uses ${inputMode} but specMode is none`)
    }
    if (specMode === 'path') requireString(taskRaw.specPath, `tasks[${index}].specPath`)

    return {
      taskId: requireString(taskRaw.taskId, `tasks[${index}].taskId`),
      fixtureId,
      domain: requireDomain(taskRaw.domain, `tasks[${index}].domain`),
      inputMode,
      task,
      sourceCase: typeof taskRaw.sourceCase === 'string' ? taskRaw.sourceCase : undefined,
      expectedIntentMode,
      expectedComplexityTier,
      expectedInspectionObject: requireString(taskRaw.expectedInspectionObject, `tasks[${index}].expectedInspectionObject`),
      expectedAcceptanceObject: requireString(taskRaw.expectedAcceptanceObject, `tasks[${index}].expectedAcceptanceObject`),
      knownFailureClass: requireString(taskRaw.knownFailureClass, `tasks[${index}].knownFailureClass`),
      specMode,
      specPath: typeof taskRaw.specPath === 'string' ? taskRaw.specPath : undefined,
    }
  })

  const seen = new Set<string>()
  for (const task of tasks) {
    if (seen.has(task.taskId)) throw new LabInputError(`duplicate P9B task id: ${task.taskId}`)
    seen.add(task.taskId)
  }

  const domainCounts = countBy(tasks, (task) => task.domain)
  for (const [domain, minimum] of Object.entries(domainMinimums) as Array<[P9BDomain, number]>) {
    if ((domainCounts[domain] ?? 0) < minimum) throw new LabInputError(`P9B corpus needs at least ${minimum} ${domain} tasks`)
  }

  const inputModeCounts = countBy(tasks, (task) => task.inputMode)
  if ((inputModeCounts.baseline_advisory ?? 0) < 5) throw new LabInputError('P9B corpus needs at least 5 baseline_advisory tasks')
  if ((inputModeCounts.advisory_with_spec ?? 0) < 10) throw new LabInputError('P9B corpus needs at least 10 advisory_with_spec tasks')
  if ((inputModeCounts.paired_comparison ?? 0) < 5) throw new LabInputError('P9B corpus needs at least 5 paired_comparison tasks')

  return {
    schemaVersion: 1,
    id: requireString(raw.id, 'id'),
    status: raw.status === 'frozen' ? 'frozen' : (() => { throw new LabInputError('P9B corpus status must be frozen') })(),
    frozenAt: requireString(raw.frozenAt, 'frozenAt'),
    protocol: requireString(raw.protocol, 'protocol'),
    description: requireString(raw.description, 'description'),
    tasks,
  }
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>
  for (const item of items) {
    const value = key(item)
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function sourceDocForTask(task: P9BCorpusTask, fixture: FixtureInput | null): string {
  const raw = (fixture?.sourceCase ?? task.sourceCase ?? 'docs/process/captain-os-lab/32-p9b-live-metrics-five-perspective-protocol.md').split('#')[0]
  const candidate = raw || 'docs/process/captain-os-lab/32-p9b-live-metrics-five-perspective-protocol.md'
  return fileExists(resolve(repoRoot(), candidate))
    ? candidate
    : 'docs/process/captain-os-lab/32-p9b-live-metrics-five-perspective-protocol.md'
}

function planDepthForTier(tier: ComplexityTier): PlanDepth {
  if (tierValue(tier) >= tierValue('T4')) return 'D4'
  if (tierValue(tier) >= tierValue('T3')) return 'D3'
  if (tierValue(tier) >= tierValue('T2')) return 'D2'
  return 'D1'
}

function captainModeFor(intentMode: IntentMode, tier: ComplexityTier, depth: PlanDepth): CaptainMode {
  if (intentMode === 'strategy_design') return 'strategy_packet'
  if (intentMode === 'incident_repair') return 'incident_repair'
  if (tierValue(tier) >= tierValue('T3') || depthValue(depth) >= depthValue('D3')) return 'full_ship_cycle'
  if (tierValue(tier) >= tierValue('T2')) return 'bounded_pr'
  return 'mini_packet'
}

function domainSailors(domain: P9BDomain): Sailor[] {
  if (domain === 'ui') return ['Surface', 'Context', 'QA', 'StarPom']
  if (domain === 'cms') return ['CMS', 'Context', 'QA', 'StarPom']
  if (domain === 'security') return ['Security', 'Context', 'QA', 'StarPom', 'Shipping']
  if (domain === 'shipping') return ['Shipping', 'QA', 'StarPom']
  if (domain === 'data') return ['Runtime', 'Context', 'QA', 'StarPom']
  if (domain === 'strategy') return ['Knowledge', 'QA', 'StarPom']
  return ['Context', 'Runtime', 'Knowledge', 'QA', 'StarPom', 'Shipping']
}

function requiredSailorsFor(task: P9BCorpusTask, fixture: FixtureInput | null): Sailor[] {
  const sailors = new Set<Sailor>(['Captain', ...domainSailors(task.domain)])
  for (const sailor of fixture?.expected.requiredSailors ?? []) sailors.add(sailor)
  if (task.expectedIntentMode === 'system_refactor') {
    sailors.add('Runtime')
    sailors.add('Context')
  }
  if (task.expectedIntentMode === 'incident_repair') {
    sailors.add('Knowledge')
    sailors.add('QA')
    sailors.add('StarPom')
  }
  if (tierValue(task.expectedComplexityTier) >= tierValue('T3')) {
    sailors.add('QA')
    sailors.add('StarPom')
  }
  return [...sailors].filter(isSailor)
}

function semanticTaskText(task: P9BCorpusTask): string {
  return [
    task.task ?? '',
    task.sourceCase ?? '',
    task.expectedInspectionObject,
    task.expectedAcceptanceObject,
    task.knownFailureClass,
    task.domain,
  ].join('\n').toLowerCase()
}

function requiresNegativeProof(task: P9BCorpusTask): boolean {
  const text = semanticTaskText(task)
  if (/negative proof|negative-proof|not exposed|must not expose|exclusion proof|not frontend-visible/.test(text)) return true
  if (/canonical_name\s*=\s*null|canonical_name null|canonical null|null exclusion/.test(text)) return true
  if (/public\/studio|public host|route exposure|access[- ]?control|\/admin|\/cms|\/ui-old/.test(text)) return true
  return false
}

function requiredEvidenceForTask(task: P9BCorpusTask): string[] {
  const text = semanticTaskText(task)
  const evidence = new Set<string>(['advisory-report.json', 'execution-state-machine.json', 'five independent judge reports'])
  if (/public\/studio|public host|route exposure|access[- ]?control|\/admin|\/cms|\/ui-old/.test(text)) {
    evidence.add('public/studio route negative-proof matrix')
  }
  if (/canonical_name\s*=\s*null|canonical_name null|canonical null|null exclusion|not frontend-visible/.test(text)) {
    evidence.add('SQL/query proof for canonical_name NULL exclusion')
    evidence.add('public visibility negative proof')
  }
  if (/source metadata|parser source|worker source|run log|run logging|freshness proof|data freshness/.test(text)) {
    evidence.add('source metadata proof')
    evidence.add('freshness proof')
    evidence.add('parser/worker run-log proof')
  }
  if (/next[- ]?packet|bound next|open work|remaining work|continue-now|continue now|accepted_partial/.test(text)) {
    evidence.add('row-level next-packet mapping')
  }
  return [...evidence]
}

function semanticExpectedBlocksForTask(task: P9BCorpusTask): string[] {
  const text = semanticTaskText(task)
  const blocks = new Set<string>()
  if (/public_internal_route|security_negative|public\/studio|public host|route exposure|access[- ]?control|\/admin|\/cms|\/ui-old/.test(text)) {
    blocks.add('public_host_negative_proof_missing')
  }
  if (/canonical_name\s*=\s*null|canonical_name null|canonical null|null exclusion|not frontend-visible|data_visibility_negative_proof_missing/.test(text)) {
    blocks.add('canonical_null_public_visibility_negative_proof_missing')
  }
  if (/source metadata|parser source|worker source|run log|run logging|freshness proof|data freshness|data_freshness_self_attestation/.test(text)) {
    blocks.add('parser_source_metadata_freshness_runlog_evidence_missing')
  }
  if (/partial slice|open work inventory|bound next|next[- ]packet[- ]bound|continue-now|continue now|broad_done|premature_stop|false_done/.test(text)) {
    blocks.add('semantic_next_packet_required')
  }
  return [...blocks]
}

function requestedObjectsForTask(task: P9BCorpusTask): string[] {
  return [...new Set([task.expectedInspectionObject, task.expectedAcceptanceObject])]
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase()
}

function generatedSpec(task: P9BCorpusTask, fixture: FixtureInput | null): Record<string, unknown> {
  const specId = `P9B-SPEC-${safeId(task.taskId)}`
  const checklistId = `CHK-${safeId(task.taskId)}-001`
  const evidenceId = `EVD-${safeId(task.taskId)}-001`
  const acceptanceObject = task.expectedAcceptanceObject
  const depth = maxDepth(planDepthForTier(task.expectedComplexityTier), fixture?.expected.minPlanDepth ?? 'D0')
  const sailors = requiredSailorsFor(task, fixture)
  const sourceDoc = sourceDocForTask(task, fixture)
  const requestedObjects = requestedObjectsForTask(task)
  const requiredEvidence = requiredEvidenceForTask(task)
  const negativeProofRequired = requiresNegativeProof(task)

  return {
    version: 1,
    id: specId,
    title: `Generated P9B executable spec for ${task.taskId}`,
    intentMode: task.expectedIntentMode,
    complexityTier: task.expectedComplexityTier,
    planDepth: depth,
    captainMode: captainModeFor(task.expectedIntentMode, task.expectedComplexityTier, depth),
    owner: 'Captain',
    sourceDocs: [
      'docs/process/captain-os-lab/32-p9b-live-metrics-five-perspective-protocol.md',
      sourceDoc,
    ],
    acceptanceObjects: [acceptanceObject],
    requestedObjects,
    coverageMap: requestedObjects.map((object) => ({
      object,
      status: 'covered',
      checklistRefs: [checklistId],
      owner: object === task.expectedInspectionObject ? 'Captain' : 'QA',
      reason: `P9B generated spec covers ${object}.`,
    })),
    acceptedRisks: [],
    sailors: sailors.map((sailor) => ({
      sailor,
      owns: [`${task.taskId} ${sailor} evaluation lane`],
      mayDecide: [`${sailor} scoring notes for ${task.taskId}`],
      mustNotChange: ['frozen corpus', 'product runtime state', 'judge reports from other perspectives'],
      mustEscalateIf: ['artifact evidence is missing', 'inspection object differs from acceptance object'],
      evidenceOwed: [`${sailor} perspective scorecard or advisory artifact reference`],
    })),
    checklist: [
      {
        id: checklistId,
        sourceRequirement: `P9B task must evaluate ${task.expectedAcceptanceObject} against ${task.expectedInspectionObject}.`,
        owner: sailors.includes('QA') ? 'QA' : 'Captain',
        scope: [task.taskId, task.domain, task.knownFailureClass],
        forbiddenScope: ['product mutation', 'corpus mutation after freeze', 'judge cross-contamination'],
        acceptanceObject,
        userInspectionObject: task.expectedInspectionObject,
        agentAcceptanceObject: task.expectedAcceptanceObject,
        acceptanceObjectMatch: true,
        requiredEvidence,
        negativeProofRequired,
        status: 'pass',
        blocking: true,
        evidenceRefs: [evidenceId],
        rerunStatus: 'complete',
      },
    ],
    evidence: [
      {
        id: evidenceId,
        claimId: checklistId,
        refs: [
          {
            type: 'artifact',
            value: `${task.taskId}/advisory artifacts`,
            generated: true,
            producedAt: new Date().toISOString(),
            gitRef: 'generated-current-run',
            changedScope: [`.ship/lab/runs/<p9b-run-id>/task-runs/${task.taskId}`],
          },
        ],
        freshness: 'current',
        verifier: sailors.includes('QA') ? 'QA' : 'Captain',
      },
    ],
    nextPacket: {
      required: false,
      owner: 'Shipping',
      nextAction: '',
      reason: '',
      artifactRef: null,
      rows: [],
    },
  }
}

function runAdvisoryVariant(
  task: P9BCorpusTask,
  fixture: FixtureInput | null,
  taskRoot: string,
  variant: 'baseline_advisory' | 'advisory_with_spec',
): P9BRunVariantSummary {
  const variantOut = resolve(taskRoot, variant)
  const artifacts = task.fixtureId
    ? runLab({ fixture: task.fixtureId, mode: 'shadow' as LabMode, out: variantOut })
    : runLab({ task: task.task, mode: 'shadow' as LabMode, out: variantOut })

  let generatedSpecPath: string | null = null
  let executableSpecOutDir: string | null = null
  let executability = undefined
  if (variant === 'advisory_with_spec') {
    if (task.specMode === 'path' && task.specPath) {
      generatedSpecPath = task.specPath
    } else {
      generatedSpecPath = relative(repoRoot(), resolve(variantOut, 'generated-executable-spec.yaml'))
      writeText(resolve(variantOut, 'generated-executable-spec.yaml'), stringifyYaml(generatedSpec(task, fixture)))
    }
    const compiled = compileArtifactSpec({
      spec: generatedSpecPath,
      out: resolve(variantOut, 'executable-spec'),
    })
    executability = compiled.executability
    executableSpecOutDir = compiled.report.outDir
    writeJson(resolve(variantOut, 'executability-validation.json'), compiled.executability)
  }

  const report = buildAdvisoryReport(artifacts, executability)
  writeJson(resolve(variantOut, 'execution-state-machine.json'), report.stateMachine)
  writeJson(resolve(variantOut, 'advisory-metrics.json'), report.metrics)
  writeJson(resolve(variantOut, 'advisory-report.json'), report)

  return {
    variant,
    outDir: variantOut,
    decision: report.stateMachine.decision,
    requiredNextAction: report.stateMachine.requiredNextAction,
    p9dBlocks: report.stateMachine.openWork.p9dBlocks,
    p9dBlockCount: report.metrics.p9dBlockCount,
    preventedFailureSignals: report.metrics.preventedFailureSignals,
    generatedSpecPath,
    executableSpecOutDir,
  }
}

function machineOutcome(expectedBlocks: string[], variants: P9BRunVariantSummary[]): P9BTaskSummary['machineOutcome'] {
  const blocked = variants.some((variant) => (
    variant.decision !== 'ready_for_owner_review_planning_only' &&
    variant.decision !== 'ready_for_execution'
  ))
  if (expectedBlocks.length === 0) {
    return blocked ? 'potential_false_positive_needs_judge' : 'machine_true_pass_candidate'
  }
  return blocked ? 'machine_correct_block_candidate' : 'potential_false_negative_needs_judge'
}

function writeJudgePackets(task: P9BCorpusTask, taskRoot: string, variants: P9BRunVariantSummary[]): number {
  const packetRoot = resolve(taskRoot, 'judge-packets')
  ensureDir(packetRoot)
  for (const perspective of perspectives) {
    writeJson(resolve(packetRoot, `${perspective}.json`), {
      schemaVersion: 1,
      status: 'ready_for_independent_judge',
      taskId: task.taskId,
      judgePerspective: perspective,
      inputMode: task.inputMode,
      domain: task.domain,
      expectedInspectionObject: task.expectedInspectionObject,
      expectedAcceptanceObject: task.expectedAcceptanceObject,
      knownFailureClass: task.knownFailureClass,
      variantArtifactRefs: variants.map((variant) => ({
        variant: variant.variant,
        advisoryReport: `${variant.variant}/advisory-report.json`,
        stateMachine: `${variant.variant}/execution-state-machine.json`,
        metrics: `${variant.variant}/advisory-metrics.json`,
        executability: variant.variant === 'advisory_with_spec' ? `${variant.variant}/executability-validation.json` : null,
      })),
      requiredOutputShape: 'Use the JSON scorecard contract from docs/process/captain-os-lab/32-p9b-live-metrics-five-perspective-protocol.md.',
      mustNotRead: perspectives.filter((item) => item !== perspective).map((item) => `judge-reports/${item}.json`),
      outputPath: `judge-reports/${perspective}.json`,
    })
  }
  return perspectives.length
}

function renderMarkdown(report: P9BRunReport): string {
  const rows = report.taskSummaries
    .map((task) => `| ${task.taskId} | ${task.domain} | ${task.inputMode} | ${task.variants.map((variant) => `${variant.variant}:${variant.decision}`).join('<br>')} | ${task.machineOutcome} |`)
    .join('\n')

  return `# P9B Live Metrics Batch Report

Status: ${report.status}
Run: ${report.runId}
Corpus: ${report.corpusId}

## Totals

- tasks: ${report.totals.tasks}
- baselineRuns: ${report.totals.baselineRuns}
- advisoryWithSpecRuns: ${report.totals.advisoryWithSpecRuns}
- pairedComparisons: ${report.totals.pairedComparisons}
- judgePackets: ${report.totals.judgePackets}
- judgeReportsReceived: ${report.totals.judgeReportsReceived}
- machineCorrectBlockCandidates: ${report.totals.machineCorrectBlockCandidates}
- machineTruePassCandidates: ${report.totals.machineTruePassCandidates}
- potentialFalsePositiveNeedsJudge: ${report.totals.potentialFalsePositiveNeedsJudge}
- potentialFalseNegativeNeedsJudge: ${report.totals.potentialFalseNegativeNeedsJudge}

## Task Rows

| Task | Domain | Input Mode | Decisions | Machine Outcome |
|---|---|---|---|---|
${rows}

## Next Action

${report.nextAction}
`
}

function runP9BBatch(corpusPath: string, out?: string): P9BRunReport {
  const corpus = validateCorpus(readJson(resolve(repoRoot(), corpusPath)))
  const runId = out ? out.split('/').filter(Boolean).at(-1) ?? timestampRunId('p9b-live-metrics') : timestampRunId('p9b-live-metrics')
  const outDir = assertSafeShadowOutDir(out ?? `.ship/lab/runs/${runId}`)
  ensureDir(outDir)
  writeJson(resolve(outDir, 'corpus.json'), corpus)

  const taskSummaries: P9BTaskSummary[] = []
  let baselineRuns = 0
  let advisoryWithSpecRuns = 0
  let judgePackets = 0

  for (const task of corpus.tasks) {
    const fixture = task.fixtureId ? loadFixtureById(task.fixtureId) : null
    const taskRoot = resolve(outDir, 'task-runs', task.taskId)
    ensureDir(taskRoot)

    const variants: P9BRunVariantSummary[] = []
    if (task.inputMode === 'baseline_advisory' || task.inputMode === 'paired_comparison') {
      variants.push(runAdvisoryVariant(task, fixture, taskRoot, 'baseline_advisory'))
      baselineRuns += 1
    }
    if (task.inputMode === 'advisory_with_spec' || task.inputMode === 'paired_comparison') {
      variants.push(runAdvisoryVariant(task, fixture, taskRoot, 'advisory_with_spec'))
      advisoryWithSpecRuns += 1
    }

    judgePackets += writeJudgePackets(task, taskRoot, variants)
    const expectedBlocks = [...new Set([...(fixture?.expected.requiredBlocks ?? []), ...semanticExpectedBlocksForTask(task)])]
    taskSummaries.push({
      taskId: task.taskId,
      domain: task.domain,
      inputMode: task.inputMode,
      knownFailureClass: task.knownFailureClass,
      expectedInspectionObject: task.expectedInspectionObject,
      expectedAcceptanceObject: task.expectedAcceptanceObject,
      expectedBlocks,
      variants,
      machineOutcome: machineOutcome(expectedBlocks, variants),
      judgeReportsExpected: perspectives.length,
      judgeReportsReceived: 0,
    })
  }

  const machineOutcomeCounts = countBy(taskSummaries, (task) => task.machineOutcome)
  const report: P9BRunReport = {
    schemaVersion: 1,
    status: 'p9b_batch_ready_for_independent_judges',
    runId,
    createdAt: new Date().toISOString(),
    corpusId: corpus.id,
    corpusPath,
    protocol: corpus.protocol,
    gitRef: gitRef(),
    outDir,
    totals: {
      tasks: corpus.tasks.length,
      baselineRuns,
      advisoryWithSpecRuns,
      pairedComparisons: corpus.tasks.filter((task) => task.inputMode === 'paired_comparison').length,
      judgePackets,
      judgeReportsReceived: 0,
      potentialFalsePositiveNeedsJudge: machineOutcomeCounts.potential_false_positive_needs_judge ?? 0,
      potentialFalseNegativeNeedsJudge: machineOutcomeCounts.potential_false_negative_needs_judge ?? 0,
      machineCorrectBlockCandidates: machineOutcomeCounts.machine_correct_block_candidate ?? 0,
      machineTruePassCandidates: machineOutcomeCounts.machine_true_pass_candidate ?? 0,
    },
    domainCounts: {
      ui: 0,
      cms: 0,
      security: 0,
      shipping: 0,
      data: 0,
      strategy: 0,
      mixed: 0,
      ...countBy(corpus.tasks, (task) => task.domain),
    },
    inputModeCounts: {
      baseline_advisory: 0,
      advisory_with_spec: 0,
      paired_comparison: 0,
      ...countBy(corpus.tasks, (task) => task.inputMode),
    },
    taskSummaries,
    nextAction: 'Dispatch five independent perspective judges using task-runs/*/judge-packets, then write judge-reports and rerun reconciliation.',
  }

  writeJson(resolve(outDir, 'p9b-live-metrics-report.json'), report)
  writeText(resolve(outDir, 'p9b-live-metrics-report.md'), renderMarkdown(report))
  writeJson(resolve(outDir, 'reconciliation.json'), {
    schemaVersion: 1,
    status: 'pending_independent_judge_reports',
    corpusId: corpus.id,
    tasks: taskSummaries.map((task) => ({
      taskId: task.taskId,
      inputMode: task.inputMode,
      domain: task.domain,
      advisoryDecisions: task.variants.map((variant) => ({ variant: variant.variant, decision: variant.decision })),
      p9dBlocks: [...new Set(task.variants.flatMap((variant) => variant.p9dBlocks))],
      judgeReportsExpected: perspectives,
      judgeReportsReceived: [],
      consensusOutcome: 'pending_judges',
      nextAction: 'Fill five judge-reports before computing final P9B metrics.',
    })),
  })

  return report
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = runP9BBatch(options.corpus ?? defaultCorpus, options.out)
    const summary = {
      runId: report.runId,
      outDir: report.outDir,
      status: report.status,
      tasks: report.totals.tasks,
      baselineRuns: report.totals.baselineRuns,
      advisoryWithSpecRuns: report.totals.advisoryWithSpecRuns,
      pairedComparisons: report.totals.pairedComparisons,
      judgePackets: report.totals.judgePackets,
      nextAction: report.nextAction,
    }

    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`Captain Lab P9B live metrics batch: ${summary.status}`)
      console.log(`outDir: ${summary.outDir}`)
      console.log(`tasks: ${summary.tasks}`)
      console.log(`judgePackets: ${summary.judgePackets}`)
      console.log(`next: ${summary.nextAction}`)
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

if (isDirectEntrypoint('p9b-live-metrics.ts')) main()
