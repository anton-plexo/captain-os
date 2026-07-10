import {
  LabInputError,
  LabUnsafeWriteError,
  resolveRunFile,
  timestampRunId,
  writeJson,
} from './io'
import { runLab } from './ship'
import { buildAdvisoryReport } from './execution-state-machine'
import type { LabMode } from './schema'

interface CliOptions {
  fixture?: string
  task?: string
  promptFile?: string
  issue?: string
  spec?: string
  out?: string
  json?: boolean
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
    if (key === 'fixture') options.fixture = value
    else if (key === 'task') options.task = value
    else if (key === 'prompt-file') options.promptFile = value
    else if (key === 'issue') options.issue = value
    else if (key === 'spec') options.spec = value
    else if (key === 'out') options.out = value
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2))
    const primaryInputProvided = Boolean(options.fixture || options.task || options.promptFile || options.issue)
    const advisoryTask = options.task ?? (!primaryInputProvided && options.spec ? `Executable spec advisory: ${options.spec}` : undefined)
    const seed = options.fixture ?? options.issue ?? advisoryTask ?? options.promptFile ?? options.spec ?? 'universal-advisory'
    const out = options.out ?? `.ship/lab/runs/${timestampRunId(`advisory-${seed}`)}`
    const artifacts = runLab({
      fixture: options.fixture,
      task: advisoryTask,
      promptFile: options.promptFile,
      issue: options.issue,
      mode: 'shadow' as LabMode,
      out,
    })
    const compiledSpec = options.spec
      ? (await import('./artifact-compiler')).compileArtifactSpec({
        spec: options.spec,
        out: `${artifacts.run.outDir}/executable-spec`,
      })
      : null
    if (compiledSpec) {
      writeJson(resolveRunFile(artifacts.run.outDir, 'executability-validation.json'), compiledSpec.executability)
    }
    const report = buildAdvisoryReport(artifacts, compiledSpec?.executability)

    writeJson(resolveRunFile(artifacts.run.outDir, 'execution-state-machine.json'), report.stateMachine)
    writeJson(resolveRunFile(artifacts.run.outDir, 'advisory-metrics.json'), report.metrics)
    writeJson(resolveRunFile(artifacts.run.outDir, 'advisory-report.json'), report)

    const summary = {
      runId: artifacts.run.runId,
      outDir: artifacts.run.outDir,
      status: report.status,
      blocking: report.blocking,
      decision: report.stateMachine.decision,
      requiredNextAction: report.stateMachine.requiredNextAction,
      falsePositiveRisk: report.metrics.falsePositiveRisk,
      falseNegativeRisk: report.metrics.falseNegativeRisk,
      operatorBurdenRisk: report.metrics.operatorBurdenRisk,
      preventedFailureSignals: report.metrics.preventedFailureSignals,
      executableSpecOutDir: compiledSpec?.report.outDir ?? null,
      operatingSafetyBlocks: report.stateMachine.openWork.operatingSafetyBlocks,
      operatingSafetyBlockCount: report.metrics.operatingSafetyBlockCount,
      p9dBlocks: report.stateMachine.openWork.p9dBlocks,
      p9dBlockCount: report.metrics.p9dBlockCount,
    }

    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`Captain Lab universal advisory: ${summary.status}`)
      console.log(`outDir: ${summary.outDir}`)
      console.log(`decision: ${summary.decision}`)
      console.log(`next: ${summary.requiredNextAction}`)
    }

    // Advisory mode reports guidance but does not block the caller yet.
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

if (isDirectEntrypoint('advisory.ts')) {
  void main()
}
