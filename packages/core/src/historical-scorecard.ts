import { atLeastDepth, atLeastTier } from './schema'
import type { FixtureInput } from './schema'
import { loadFixtureFamily } from './fixtures'
import {
  LabInputError,
  LabUnsafeWriteError,
  assertSafeShadowOutDir,
  ensureDir,
  resolveRunFile,
  timestampRunId,
  writeJson,
  writeText,
} from './io'
import { runLab } from './ship'

interface CliOptions {
  out?: string
  json?: boolean
}

interface HistoricalCaseScore {
  fixtureId: string
  title: string
  sourceCase: string
  intentMode: string
  complexityTier: string
  planDepth: string
  exitCode: number
  expectedBlocks: string[]
  blockedClaims: string[]
  expectedBlocksCovered: boolean
  classificationCovered: boolean
  routeChecklistParsed: boolean
  routeChecklistOpenRows: number
  continuationBlocked: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg !== '--out') throw new LabInputError(`unknown flag: ${arg}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new LabInputError(`missing value for ${arg}`)
    options.out = value
    index += 1
  }
  return options
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 100
  return Math.round((numerator / denominator) * 1000) / 10
}

function blockCounts(cases: HistoricalCaseScore[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of cases) {
    for (const block of item.blockedClaims) counts[block] = (counts[block] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function renderMarkdown(summary: HistoricalScorecard): string {
  const topBlocks = Object.entries(summary.topBlockers)
    .slice(0, 12)
    .map(([block, count]) => `- ${block}: ${count}`)
    .join('\n') || '- none'
  const cases = summary.cases
    .map((item) => `- ${item.fixtureId}: blocks=${item.blockedClaims.join(', ') || 'none'} checklistOpen=${item.routeChecklistOpenRows}`)
    .join('\n')
  const judges = summary.judgeSynthesis
    .map((item) => `- ${item.judge}: ${item.verdict} - ${item.note}`)
    .join('\n')

  return `# P8 Historical Serious-Task Scorecard

Status: ${summary.status}
Sample size: ${summary.sampleSize}

## Scores

- classifierCoverage: ${summary.scores.classifierCoverage}%
- expectedBlockCoverage: ${summary.scores.expectedBlockCoverage}%
- finalClaimProtection: ${summary.scores.finalClaimProtection}%
- continuationProtection: ${summary.scores.continuationProtection}%
- routeChecklistParseCoverage: ${summary.scores.routeChecklistParseCoverage}%

## Top Blockers

${topBlocks}

## Five-Lens Judge Synthesis

${judges}

## Cases

${cases}

## Next Gate

${summary.nextGate}
`
}

interface HistoricalScorecard {
  status: 'p8_shadow_scorecard_ready' | 'blocked'
  sampleSize: number
  sourceFamily: string
  scores: {
    classifierCoverage: number
    expectedBlockCoverage: number
    finalClaimProtection: number
    continuationProtection: number
    routeChecklistParseCoverage: number
  }
  topBlockers: Record<string, number>
  judgeSynthesis: Array<{
    judge: string
    verdict: 'pass' | 'warning' | 'blocked'
    note: string
  }>
  cases: HistoricalCaseScore[]
  nextGate: string
}

function seriousHistoricalFixtures(): FixtureInput[] {
  return loadFixtureFamily('high-anger').filter((fixture) => fixture.id !== 'clean-success-control')
}

export function runHistoricalScorecard(out?: string): HistoricalScorecard {
  const fixtures = seriousHistoricalFixtures()
  const outDir = assertSafeShadowOutDir(out ?? `.ship/lab/runs/${timestampRunId('p8-historical-scorecard')}`)
  ensureDir(outDir)

  const cases = fixtures.map((fixture): HistoricalCaseScore => {
    const artifacts = runLab({ fixture: fixture.id, mode: 'shadow', out: `${outDir}/cases/${fixture.id}` })
    const expectedBlocks = fixture.expected.requiredBlocks
    const blockedClaims = artifacts.starpomVerdict.blockedClaims
    const actualBlocks = artifacts.evidenceMatrix.rows.map((row) => row.id)
    const expectedBlocksCovered = expectedBlocks.every((block) => actualBlocks.includes(block))
    const classificationCovered =
      artifacts.classification.intentMode === fixture.expected.intentMode &&
      atLeastTier(artifacts.classification.complexityTier, fixture.expected.minComplexityTier) &&
      atLeastDepth(artifacts.classification.planDepth, fixture.expected.minPlanDepth)
    const continuationBlocked = blockedClaims.some((block) => (
      block.includes('open_work') ||
      block.includes('broad_done') ||
      block.includes('next_packet') ||
      block.includes('premature_stop')
    ))

    return {
      fixtureId: fixture.id,
      title: fixture.title,
      sourceCase: fixture.sourceCase,
      intentMode: artifacts.classification.intentMode,
      complexityTier: artifacts.classification.complexityTier,
      planDepth: artifacts.classification.planDepth,
      exitCode: artifacts.run.exitCode,
      expectedBlocks,
      blockedClaims,
      expectedBlocksCovered,
      classificationCovered,
      routeChecklistParsed: artifacts.diamond.routeChecklistCoverage.parsed,
      routeChecklistOpenRows: artifacts.diamond.routeChecklistCoverage.openRows,
      continuationBlocked,
    }
  })

  const continuationCases = cases.filter((item) => item.fixtureId.includes('false-done') || item.continuationBlocked)
  const checklistCases = cases.filter((item) => item.fixtureId.includes('checklist') || item.routeChecklistParsed)
  const allExpectedCovered = cases.every((item) => item.expectedBlocksCovered)
  const allClassified = cases.every((item) => item.classificationCovered)
  const allFailuresBlocked = cases.every((item) => item.expectedBlocks.length === 0 || item.exitCode === 2)
  const continuationProtected = continuationCases.length === 0 || continuationCases.every((item) => item.continuationBlocked)
  const checklistParsed = checklistCases.length === 0 || checklistCases.every((item) => item.routeChecklistParsed)
  const sampleSizeOk = cases.length >= 15 && cases.length <= 30

  const scorecard: HistoricalScorecard = {
    status: sampleSizeOk && allExpectedCovered && allClassified && allFailuresBlocked && continuationProtected && checklistParsed
      ? 'p8_shadow_scorecard_ready'
      : 'blocked',
    sampleSize: cases.length,
    sourceFamily: 'high-anger',
    scores: {
      classifierCoverage: percent(cases.filter((item) => item.classificationCovered).length, cases.length),
      expectedBlockCoverage: percent(cases.filter((item) => item.expectedBlocksCovered).length, cases.length),
      finalClaimProtection: percent(cases.filter((item) => item.expectedBlocks.length === 0 || item.exitCode === 2).length, cases.length),
      continuationProtection: percent(continuationCases.filter((item) => item.continuationBlocked).length, continuationCases.length),
      routeChecklistParseCoverage: percent(checklistCases.filter((item) => item.routeChecklistParsed).length, checklistCases.length),
    },
    topBlockers: blockCounts(cases),
    judgeSynthesis: [
      {
        judge: 'StarPom/process',
        verdict: allFailuresBlocked ? 'pass' : 'blocked',
        note: allFailuresBlocked ? 'Historical false-green cases block final claims.' : 'At least one historical case did not block.',
      },
      {
        judge: 'Principal/runtime',
        verdict: allExpectedCovered && allClassified ? 'pass' : 'blocked',
        note: allExpectedCovered && allClassified ? 'Expected policies and classifications are covered.' : 'Expected block or classifier coverage is incomplete.',
      },
      {
        judge: 'UX/surface',
        verdict: checklistParsed ? 'pass' : 'warning',
        note: checklistParsed ? 'Route checklist parsing catches the UI false-done case.' : 'No route checklist case was parsed.',
      },
      {
        judge: 'QA/evidence',
        verdict: allExpectedCovered ? 'pass' : 'blocked',
        note: allExpectedCovered ? 'Evidence matrix rows cover expected historical blockers.' : 'Some expected blockers are missing from evidence rows.',
      },
      {
        judge: 'Product/operations',
        verdict: continuationProtected ? 'pass' : 'blocked',
        note: continuationProtected ? 'Partial work becomes blocked or continuation-bound.' : 'A partial-stop case escaped continuation protection.',
      },
    ],
    cases,
    nextGate: 'P9B-LIVE-METRICS: run universal advisory across 20-30 real tasks and record false-positive/false-negative/operator-burden metrics.',
  }

  writeJson(resolveRunFile(outDir, 'historical-scorecard.json'), scorecard)
  writeText(resolveRunFile(outDir, 'historical-scorecard.md'), renderMarkdown(scorecard))
  return scorecard
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const scorecard = runHistoricalScorecard(options.out)
    const summary = {
      status: scorecard.status,
      sampleSize: scorecard.sampleSize,
      scores: scorecard.scores,
      nextGate: scorecard.nextGate,
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`Captain Lab P8 historical scorecard: ${scorecard.status}`)
      console.log(`sampleSize: ${scorecard.sampleSize}`)
      console.log(`expectedBlockCoverage: ${scorecard.scores.expectedBlockCoverage}%`)
      console.log(`nextGate: ${scorecard.nextGate}`)
    }
    process.exitCode = scorecard.status === 'p8_shadow_scorecard_ready' ? 0 : 2
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

if (isDirectEntrypoint('historical-scorecard.ts')) main()
