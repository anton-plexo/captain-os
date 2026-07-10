import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CANONICAL_SOURCE_DOCS } from './policy-registry'
import {
  type FixtureInput,
  type LabInput,
  isComplexityTier,
  isIntentMode,
  isPlanDepth,
  isSailor,
} from './schema'
import { LabInputError, readJson, readText, repoRoot } from './io'

const FIXTURE_ROOTS = ['fixtures', 'docs/process/captain-os-lab/fixtures']
const FIXTURE_DIRS = ['high-anger', 'methodology', 'operating-safety', 'auto-bootstrap', 'p9d-hardening']

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LabInputError(`fixture field ${field} must be a non-empty string`)
  }
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new LabInputError(`fixture field ${field} must be a string array`)
  }
  return value
}

export function validateFixtureInput(value: unknown): FixtureInput {
  if (!value || typeof value !== 'object') {
    throw new LabInputError('fixture must be a JSON object')
  }

  const raw = value as Record<string, unknown>
  const expected = raw.expected as Record<string, unknown> | undefined
  if (!expected || typeof expected !== 'object') {
    throw new LabInputError('fixture.expected must exist')
  }

  const intentMode = requireString(expected.intentMode, 'expected.intentMode')
  const minComplexityTier = requireString(expected.minComplexityTier, 'expected.minComplexityTier')
  const minPlanDepth = requireString(expected.minPlanDepth, 'expected.minPlanDepth')

  if (!isIntentMode(intentMode)) throw new LabInputError(`invalid expected.intentMode: ${intentMode}`)
  if (!isComplexityTier(minComplexityTier)) {
    throw new LabInputError(`invalid expected.minComplexityTier: ${minComplexityTier}`)
  }
  if (!isPlanDepth(minPlanDepth)) throw new LabInputError(`invalid expected.minPlanDepth: ${minPlanDepth}`)

  const requiredSailors = expected.requiredSailors === undefined
    ? undefined
    : requireStringArray(expected.requiredSailors, 'expected.requiredSailors')

  if (requiredSailors?.some((sailor) => !isSailor(sailor))) {
    throw new LabInputError(`invalid expected.requiredSailors: ${requiredSailors.join(', ')}`)
  }

  return {
    id: requireString(raw.id, 'id'),
    title: requireString(raw.title, 'title'),
    task: requireString(raw.task, 'task'),
    sourceCase: requireString(raw.sourceCase, 'sourceCase'),
    tags: requireStringArray(raw.tags, 'tags'),
    expected: {
      intentMode,
      minComplexityTier,
      minPlanDepth,
      requiredBlocks: requireStringArray(expected.requiredBlocks, 'expected.requiredBlocks'),
      nonBlockingWarnings: expected.nonBlockingWarnings === undefined
        ? []
        : requireStringArray(expected.nonBlockingWarnings, 'expected.nonBlockingWarnings'),
      requiredSailors: requiredSailors as FixtureInput['expected']['requiredSailors'],
    },
    context: raw.context && typeof raw.context === 'object'
      ? Object.fromEntries(
        Object.entries(raw.context as Record<string, unknown>).map(([key, item]) => [key, String(item)]),
      )
      : {},
  }
}

export function fixturePath(id: string): string {
  for (const root of FIXTURE_ROOTS) {
    for (const dir of FIXTURE_DIRS) {
      const path = resolve(repoRoot(), root, dir, `${id}.json`)
      try {
        readText(path)
        return path
      } catch {
        // Try the next fixture family/root.
      }
    }
  }
  return resolve(repoRoot(), FIXTURE_ROOTS[0], FIXTURE_DIRS[0], `${id}.json`)
}

function fixtureRootForFamily(family: string): string {
  for (const root of FIXTURE_ROOTS) {
    const dir = resolve(repoRoot(), root, family)
    try {
      readdirSync(dir)
      return root
    } catch {
      // Try the next fixture root.
    }
  }
  return FIXTURE_ROOTS[0]
}

export function fixtureFilePath(family: string, fileName: string): string {
  if (!FIXTURE_DIRS.includes(family)) {
    throw new LabInputError(`unknown fixture family: ${family}`)
  }
  return resolve(repoRoot(), fixtureRootForFamily(family), family, fileName)
}

export function loadFixtureById(id: string): FixtureInput {
  return validateFixtureInput(readJson(fixturePath(id)))
}

export function loadAllFixtures(): FixtureInput[] {
  return FIXTURE_DIRS.flatMap((family) => {
    const dir = resolve(repoRoot(), fixtureRootForFamily(family), family)
    return readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => validateFixtureInput(readJson(join(dir, file))))
  })
}

export function loadFixtureFamily(family: string): FixtureInput[] {
  if (!FIXTURE_DIRS.includes(family)) {
    throw new LabInputError(`unknown fixture family: ${family}`)
  }
  const dir = resolve(repoRoot(), fixtureRootForFamily(family), family)
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => validateFixtureInput(readJson(join(dir, file))))
}

export function fixtureToLabInput(fixture: FixtureInput): LabInput {
  return {
    id: fixture.id,
    title: fixture.title,
    task: fixture.task,
    fixtureId: fixture.id,
    sourceCase: fixture.sourceCase,
    sourceDocs: [...CANONICAL_SOURCE_DOCS, fixture.sourceCase],
    tags: fixture.tags,
    expected: fixture.expected,
    context: fixture.context ?? {},
  }
}

export function loadPromptFile(path: string): LabInput {
  const text = readText(path)
  try {
    const parsed = validateFixtureInput(JSON.parse(text))
    return {
      ...fixtureToLabInput(parsed),
      promptFile: path,
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        id: 'prompt-file',
        title: 'Prompt file shadow run',
        task: text,
        promptFile: path,
        sourceDocs: [...CANONICAL_SOURCE_DOCS, path],
        tags: [],
        context: {},
      }
    }
    throw error
  }
}

export function assertNoPrivateReasoningFixtures(fixtures: FixtureInput[]): void {
  const forbidden = /(chain[- ]of[- ]thought|private reasoning|model reasoning|hidden reasoning|размышления модели)/i
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture)
    if (forbidden.test(serialized)) {
      throw new LabInputError(`fixture includes forbidden private reasoning marker: ${fixture.id}`)
    }
  }
}
