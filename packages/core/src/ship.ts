import { classifyTask } from './classifier'
import { planCrew } from './crew-planner'
import { buildDiamondArtifacts } from './diamond'
import { buildEvidenceMatrix } from './evidence-matrix'
import { fixtureToLabInput, loadFixtureById, loadPromptFile } from './fixtures'
import {
  LabInputError,
  LabUnsafeWriteError,
  assertSafeShadowOutDir,
  digestText,
  ensureDir,
  gitRef,
  resolveRunFile,
  timestampRunId,
  writeJson,
  writeText,
} from './io'
import { compilePacketPreview } from './packet-compiler'
import { buildOperatingSafety } from './operating-safety'
import { renderCaptainSynthesis } from './report'
import {
  buildContextRuntimeArtifact,
  buildCrossLlmSlaArtifact,
  buildEvidenceAggregationArtifact,
  buildSplashRadiusArtifact,
} from './runtime-hardening'
import { buildScorecard } from './scorecard'
import type { LabInput, LabMode, LabRunArtifacts } from './schema'
import { buildStarPomVerdict, starpomExitCode } from './starpom-verdict'

interface CliOptions {
  fixture?: string
  task?: string
  promptFile?: string
  issue?: string
  mode?: string
  out?: string
  json?: boolean
}

export interface RunLabOptions {
  fixture?: string
  task?: string
  promptFile?: string
  issue?: string
  mode: LabMode
  out?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (!arg.startsWith('--')) {
      throw new LabInputError(`unexpected positional argument: ${arg}`)
    }
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new LabInputError(`missing value for ${arg}`)
    }
    index += 1
    if (key === 'fixture') options.fixture = value
    else if (key === 'task') options.task = value
    else if (key === 'prompt-file') options.promptFile = value
    else if (key === 'issue') options.issue = value
    else if (key === 'mode') options.mode = value
    else if (key === 'out') options.out = value
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function buildInput(options: RunLabOptions): LabInput {
  const provided = [options.fixture, options.task, options.promptFile, options.issue].filter(Boolean)
  if (provided.length === 0) {
    throw new LabInputError('one of --fixture, --task, --prompt-file, or --issue is required')
  }

  if (options.fixture) {
    const input = fixtureToLabInput(loadFixtureById(options.fixture))
    return options.task ? { ...input, task: options.task } : input
  }

  if (options.promptFile) {
    return loadPromptFile(options.promptFile)
  }

  if (options.task) {
    return {
      id: 'ad-hoc-task',
      title: 'Ad hoc shadow task',
      task: options.task,
      issueId: options.issue,
      sourceDocs: ['docs/process/captain-os-lab/17-runtime-contract-and-gates.md'],
      tags: [],
      context: {},
    }
  }

  return {
    id: options.issue ?? 'issue-shadow',
    title: `Issue ${options.issue}`,
    task: `Shadow-classify issue ${options.issue}`,
    issueId: options.issue,
    sourceDocs: ['docs/process/captain-os-lab/17-runtime-contract-and-gates.md'],
    tags: ['issue'],
    context: {},
  }
}

export function runLab(options: RunLabOptions): LabRunArtifacts {
  if (options.mode !== 'shadow') {
    throw new LabInputError(`unsupported mode for v0: ${options.mode}`)
  }

  const input = buildInput(options)
  const runId = options.out
    ? options.out.split('/').filter(Boolean).at(-1) ?? timestampRunId(input.id)
    : timestampRunId(input.fixtureId ?? input.id ?? input.title)
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${runId}`)
  ensureDir(outDir)

  const operatingSafety = buildOperatingSafety(input)
  const classification = classifyTask(input)
  const contextRuntime = buildContextRuntimeArtifact(input, classification)
  const packetPreview = compilePacketPreview(input, classification)
  const splashRadius = buildSplashRadiusArtifact(input, classification, packetPreview)
  const crewPlan = planCrew(input, classification, operatingSafety)
  const crossLlmSla = buildCrossLlmSlaArtifact(input, classification, splashRadius)
  const diamond = buildDiamondArtifacts(input, classification, crewPlan)
  const evidenceAggregation = buildEvidenceAggregationArtifact(
    input,
    classification,
    contextRuntime,
    splashRadius,
    crossLlmSla,
  )
  const { evidenceMatrix, fixQueue } = buildEvidenceMatrix(
    input,
    classification,
    packetPreview,
    [
      ...operatingSafety.blocks,
      ...contextRuntime.blocks,
      ...splashRadius.blocks,
      ...crossLlmSla.blocks,
      ...evidenceAggregation.blocks,
      ...diamond.blockIds,
    ],
  )
  const starpomVerdict = buildStarPomVerdict(classification, evidenceMatrix, fixQueue)
  const scorecard = buildScorecard(input, classification, crewPlan, evidenceMatrix, starpomVerdict)
  const exitCode = starpomExitCode(starpomVerdict)

  const run = {
    runId,
    createdAt: new Date().toISOString(),
    mode: options.mode,
    issueId: input.issueId ?? options.issue ?? null,
    trackingId: 'REPAIR-20260513-CAPTAIN-LIVING-SYSTEM',
    readOnly: true as const,
    inputPromptDigest: digestText(input.task),
    sourceDocs: input.sourceDocs,
    gitRef: gitRef(),
    outDir,
    exitCode,
  }

  const partial = {
    run,
    input,
    operatingSafety,
    contextRuntime,
    splashRadius,
    crossLlmSla,
    evidenceAggregation,
    classification,
    packetPreview,
    crewPlan,
    diamond,
    evidenceMatrix,
    fixQueue,
    starpomVerdict,
    scorecard,
  }
  const synthesis = renderCaptainSynthesis(partial)
  const artifacts = { ...partial, synthesis }

  writeJson(resolveRunFile(outDir, 'run.json'), run)
  writeJson(resolveRunFile(outDir, 'operating-safety.json'), operatingSafety)
  writeJson(resolveRunFile(outDir, 'context-runtime.json'), contextRuntime)
  writeJson(resolveRunFile(outDir, 'splash-radius.json'), splashRadius)
  writeJson(resolveRunFile(outDir, 'cross-llm-sla.json'), crossLlmSla)
  writeJson(resolveRunFile(outDir, 'evidence-aggregation.json'), evidenceAggregation)
  writeJson(resolveRunFile(outDir, 'classification.json'), classification)
  writeJson(resolveRunFile(outDir, 'packet-preview.json'), packetPreview)
  writeJson(resolveRunFile(outDir, 'crew-plan.json'), crewPlan)
  writeJson(resolveRunFile(outDir, 'diamond-required.json'), diamond.diamondRequired)
  writeJson(resolveRunFile(outDir, 'research-context.json'), diamond.researchContext)
  writeJson(resolveRunFile(outDir, 'findings-ledger.json'), diamond.findingsLedger)
  writeJson(resolveRunFile(outDir, 'artifact-specs.json'), diamond.artifactSpecs)
  writeJson(resolveRunFile(outDir, 'priority-checklists.json'), diamond.priorityChecklists)
  writeJson(resolveRunFile(outDir, 'autonomy-envelope.json'), diamond.autonomyEnvelope)
  writeJson(resolveRunFile(outDir, 'execution-plan-validation.json'), diamond.executionPlanValidation)
  writeJson(resolveRunFile(outDir, 'accepted-risk-validation.json'), diamond.acceptedRiskValidation)
  writeJson(resolveRunFile(outDir, 'closure-matrix.json'), diamond.closureMatrix)
  writeJson(resolveRunFile(outDir, 'route-checklist-coverage.json'), diamond.routeChecklistCoverage)
  writeJson(resolveRunFile(outDir, 'evidence-matrix.json'), evidenceMatrix)
  writeJson(resolveRunFile(outDir, 'fix-queue.json'), fixQueue)
  writeJson(resolveRunFile(outDir, 'starpom-verdict.json'), starpomVerdict)
  writeJson(resolveRunFile(outDir, 'scorecard.json'), scorecard)
  writeText(resolveRunFile(outDir, 'captain-synthesis.md'), synthesis)

  return artifacts
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const mode = options.mode ?? 'shadow'
    const artifacts = runLab({
      fixture: options.fixture,
      task: options.task,
      promptFile: options.promptFile,
      issue: options.issue,
      mode: mode as LabMode,
      out: options.out,
    })
    const summary = {
      runId: artifacts.run.runId,
      outDir: artifacts.run.outDir,
      exitCode: artifacts.run.exitCode,
      intentMode: artifacts.classification.intentMode,
      complexityTier: artifacts.classification.complexityTier,
      planDepth: artifacts.classification.planDepth,
      verdict: artifacts.starpomVerdict.verdict,
      blockedClaims: artifacts.starpomVerdict.blockedClaims,
    }
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2))
    } else {
      console.log(`Captain Lab shadow run: ${summary.runId}`)
      console.log(`outDir: ${summary.outDir}`)
      console.log(`classification: ${summary.intentMode} ${summary.complexityTier}/${summary.planDepth}`)
      console.log(`StarPom: ${summary.verdict}`)
      if (summary.blockedClaims.length > 0) console.log(`blocked: ${summary.blockedClaims.join(', ')}`)
    }
    process.exitCode = artifacts.run.exitCode
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

if (isDirectEntrypoint('ship.ts')) main()
