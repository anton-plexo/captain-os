import { isAbsolute, relative, resolve, extname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  LabInputError,
  LabUnsafeWriteError,
  assertSafeShadowOutDir,
  digestText,
  ensureDir,
  fileExists,
  gitRef,
  readText,
  repoRoot,
  resolveRunFile,
  timestampRunId,
  writeJson,
  writeText,
} from './io'
import {
  captainModes,
  evidenceVerdicts,
  executableEvidenceRefTypes,
  depthValue,
  isComplexityTier,
  isIntentMode,
  isPlanDepth,
  isSailor,
  tierValue,
} from './schema'
import type {
  ArtifactCompileReportArtifact,
  ArtifactCompileStatus,
  CaptainMode,
  CompiledChecklistArtifact,
  CompiledEvidenceArtifact,
  CompiledNextPacketArtifact,
  EvidenceVerdict,
  ExecutabilityValidationArtifact,
  ExecutableEvidenceRefType,
  ExecutableSpecAcceptedRisk,
  ExecutableSpecCoverageMapRow,
  ExecutableSpecEvidenceSource,
  ExecutableSpecEvidenceRef,
  ExecutableSpecNextPacket,
  ExecutableSpecNextPacketRow,
  ExecutableSpecSourceArtifact,
  ExecutableSpecSourceFormat,
  PriorityChecklistItem,
  Sailor,
  SailorOwnership,
} from './schema'

const checklistStatuses = ['pending', 'pass', 'fail', 'blocked', 'accepted_risk'] as const
const rerunStatuses = ['not_required', 'required', 'complete'] as const
const freshnessValues = ['current', 'stale', 'unknown'] as const

interface CliOptions {
  spec?: string
  out?: string
  json?: boolean
}

interface ParsedSource {
  raw: Record<string, unknown>
  format: ExecutableSpecSourceFormat
  parseBlocks: string[]
  parseWarnings: string[]
}

export interface ArtifactCompilerArtifacts {
  source: ExecutableSpecSourceArtifact
  checklist: CompiledChecklistArtifact
  evidence: CompiledEvidenceArtifact
  nextPacket: CompiledNextPacketArtifact
  executability: ExecutabilityValidationArtifact
  report: ArtifactCompileReportArtifact
  markdownReport: string
}

export interface CompileArtifactSpecOptions {
  spec: string
  out?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCaptainMode(value: unknown): value is CaptainMode {
  return typeof value === 'string' && (captainModes as readonly string[]).includes(value)
}

function isExecutableEvidenceRefType(value: unknown): value is ExecutableEvidenceRefType {
  return typeof value === 'string' && (executableEvidenceRefTypes as readonly string[]).includes(value)
}

function isChecklistStatus(value: unknown): value is PriorityChecklistItem['status'] {
  return typeof value === 'string' && (checklistStatuses as readonly string[]).includes(value)
}

function isRerunStatus(value: unknown): value is PriorityChecklistItem['rerunStatus'] {
  return typeof value === 'string' && (rerunStatuses as readonly string[]).includes(value)
}

function isFreshness(value: unknown): value is ExecutableSpecEvidenceSource['freshness'] {
  return typeof value === 'string' && (freshnessValues as readonly string[]).includes(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return isString(value) ? value.trim() : null
}

function parseCliArgs(argv: string[]): CliOptions {
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
    if (key === 'spec') options.spec = value
    else if (key === 'out') options.out = value
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function resolveSpecPath(specPath: string, rootDir = repoRoot()): string {
  const resolved = resolve(rootDir, specPath)
  const rel = relative(rootDir, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new LabInputError(`spec input must be inside repo: ${specPath}`)
  }
  if (!fileExists(resolved)) throw new LabInputError(`spec input not found: ${specPath}`)
  return resolved
}

function parseMarkdownChecklist(markdownBody: string, defaults: Record<string, unknown>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  let heading = 'Document'
  const defaultOwner = readString(defaults, 'owner') ?? 'Captain'
  const acceptanceObjects = asStringArray(defaults.acceptanceObjects)
  const defaultAcceptanceObject = readString(defaults, 'defaultAcceptanceObject') ?? acceptanceObjects[0] ?? ''

  markdownBody.split(/\r?\n/).forEach((line, index) => {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/)
    if (headingMatch?.[1]) heading = headingMatch[1].trim()

    const checkboxMatch = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/)
    if (!checkboxMatch) return

    const checked = checkboxMatch[1].toLowerCase() === 'x'
    const text = checkboxMatch[2].trim()
    const id = text.match(/`?((?:CHK|SPEC|PROD|BR|TR)[A-Z0-9-]+)`?/)?.[1] ?? ''
    rows.push({
      id,
      sourceRequirement: id ? text.replace(id, '').replace(/`/g, '').trim() : text,
      owner: defaultOwner,
      scope: [heading],
      forbiddenScope: [],
      acceptanceObject: defaultAcceptanceObject,
      requiredEvidence: [],
      negativeProofRequired: false,
      status: checked ? 'pass' : 'pending',
      blocking: true,
      evidenceRefs: [],
      rerunStatus: checked ? 'complete' : 'required',
      sourceLine: index + 1,
    })
  })

  return rows
}

function parseSource(text: string, specPath: string): ParsedSource {
  const ext = extname(specPath).toLowerCase()
  if (ext === '.yaml' || ext === '.yml') {
    const parsed = parseYaml(text)
    if (!isRecord(parsed)) {
      return {
        raw: {},
        format: 'yaml',
        parseBlocks: ['yaml_root_must_be_object'],
        parseWarnings: [],
      }
    }
    return { raw: parsed, format: 'yaml', parseBlocks: [], parseWarnings: [] }
  }

  if (ext === '.md' || ext === '.markdown') {
    const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!frontmatterMatch?.[1]) {
      return {
        raw: {},
        format: 'markdown',
        parseBlocks: ['markdown_without_machine_contract_frontmatter'],
        parseWarnings: [],
      }
    }

    const parsed = parseYaml(frontmatterMatch[1])
    const raw = isRecord(parsed) ? parsed : {}
    const body = text.slice(frontmatterMatch[0].length)
    if (!Array.isArray(raw.checklist)) raw.checklist = parseMarkdownChecklist(body, raw)
    return {
      raw,
      format: 'markdown',
      parseBlocks: isRecord(parsed) ? [] : ['markdown_frontmatter_must_be_object'],
      parseWarnings: ['markdown_body_is_report_layer_checkboxes_are_compiled_only_with_frontmatter'],
    }
  }

  throw new LabInputError(`unsupported spec extension: ${ext || '<none>'}`)
}

function normalizeSailorOwnership(value: unknown, blocks: string[]): SailorOwnership[] {
  const rows = Array.isArray(value) ? value : []
  if (rows.length === 0) blocks.push('sailors_required')

  return rows.map((row, index) => {
    const record = isRecord(row) ? row : {}
    const rawSailor = record.sailor
    if (!isSailor(rawSailor)) blocks.push(`sailors_${index}_invalid_sailor`)
    return {
      sailor: isSailor(rawSailor) ? rawSailor : 'Captain',
      owns: asStringArray(record.owns),
      mayDecide: asStringArray(record.mayDecide),
      mustNotChange: asStringArray(record.mustNotChange),
      mustEscalateIf: asStringArray(record.mustEscalateIf),
      evidenceOwed: asStringArray(record.evidenceOwed),
    }
  })
}

function normalizeChecklist(
  value: unknown,
  acceptanceObjects: string[],
  blocks: string[],
): PriorityChecklistItem[] {
  const rows = Array.isArray(value) ? value : []
  if (rows.length === 0) blocks.push('checklist_required')
  const knownIds = new Set<string>()

  return rows.map((row, index) => {
    const record = isRecord(row) ? row : {}
    if (!isRecord(row)) blocks.push(`checklist_${index}_must_be_object`)

    const rawId = readString(record, 'id')
    const id = rawId ?? `CHK-MISSING-${String(index + 1).padStart(3, '0')}`
    if (!rawId) blocks.push(`checklist_${index}_id_required`)
    if (knownIds.has(id)) blocks.push(`checklist_${id}_duplicate_id`)
    knownIds.add(id)

    const rawOwner = record.owner
    if (!isSailor(rawOwner)) blocks.push(`checklist_${id}_owner_invalid`)

    const sourceRequirement = readString(record, 'sourceRequirement') ?? readString(record, 'text') ?? ''
    if (!sourceRequirement) blocks.push(`checklist_${id}_source_requirement_required`)

    const acceptanceObject = readString(record, 'acceptanceObject') ?? ''
    if (!acceptanceObject) blocks.push(`checklist_${id}_acceptance_object_required`)
    if (acceptanceObject && acceptanceObjects.length > 0 && !acceptanceObjects.includes(acceptanceObject)) {
      blocks.push(`checklist_${id}_acceptance_object_not_declared`)
    }

    const requiredEvidence = asStringArray(record.requiredEvidence)
    if (requiredEvidence.length === 0) blocks.push(`checklist_${id}_required_evidence_required`)

    const rawStatus = record.status
    if (!isChecklistStatus(rawStatus)) blocks.push(`checklist_${id}_status_invalid`)
    const status = isChecklistStatus(rawStatus) ? rawStatus : 'pending'

    const rawBlocking = record.blocking
    if (!isBoolean(rawBlocking)) blocks.push(`checklist_${id}_blocking_boolean_required`)
    const blocking = isBoolean(rawBlocking) ? rawBlocking : true

    const rawRerunStatus = record.rerunStatus
    if (!isRerunStatus(rawRerunStatus)) blocks.push(`checklist_${id}_rerun_status_invalid`)
    const rerunStatus = isRerunStatus(rawRerunStatus)
      ? rawRerunStatus
      : status === 'pass'
        ? 'complete'
        : 'required'

    const evidenceRefs = asStringArray(record.evidenceRefs)
    if ((status === 'pass' || status === 'accepted_risk') && evidenceRefs.length === 0) {
      blocks.push(`checklist_${id}_closed_without_evidence_refs`)
    }
    if (blocking && ['pending', 'fail', 'blocked'].includes(status) && rerunStatus !== 'required') {
      blocks.push(`checklist_${id}_open_blocking_without_required_rerun`)
    }

    return {
      id,
      sourceRequirement,
      owner: isSailor(rawOwner) ? rawOwner : 'Captain',
      scope: asStringArray(record.scope),
      forbiddenScope: asStringArray(record.forbiddenScope),
      acceptanceObject,
      userInspectionObject: readString(record, 'userInspectionObject'),
      agentAcceptanceObject: readString(record, 'agentAcceptanceObject'),
      acceptanceObjectMatch: isBoolean(record.acceptanceObjectMatch) ? record.acceptanceObjectMatch : null,
      requiredEvidence,
      negativeProofRequired: isBoolean(record.negativeProofRequired) ? record.negativeProofRequired : false,
      status,
      blocking,
      evidenceRefs,
      rerunStatus,
    }
  })
}

function normalizeEvidenceRefs(value: unknown, evidenceId: string, blocks: string[]): ExecutableSpecEvidenceRef[] {
  const rows = Array.isArray(value) ? value : []
  if (rows.length === 0) blocks.push(`evidence_${evidenceId}_refs_required`)

  return rows.map((row, index) => {
    if (typeof row === 'string') {
      blocks.push(`evidence_${evidenceId}_ref_${index}_must_be_typed`)
      return {
        type: 'note',
        value: row,
        producedAt: null,
        gitRef: null,
        exitCode: null,
        changedScope: [],
        generated: false,
      }
    }

    const record = isRecord(row) ? row : {}
    if (!isRecord(row)) blocks.push(`evidence_${evidenceId}_ref_${index}_must_be_object`)

    const rawType = record.type
    if (!isExecutableEvidenceRefType(rawType)) blocks.push(`evidence_${evidenceId}_ref_${index}_type_invalid`)
    const type = isExecutableEvidenceRefType(rawType) ? rawType : 'note'

    const valueText = readString(record, 'value') ?? readString(record, 'path') ?? readString(record, 'command') ?? readString(record, 'url') ?? ''
    if (!valueText) blocks.push(`evidence_${evidenceId}_ref_${index}_value_required`)

    const producedAt = readString(record, 'producedAt')
    const gitRefValue = readString(record, 'gitRef')
    const exitCode = isNumber(record.exitCode) ? record.exitCode : null
    const generated = isBoolean(record.generated) ? record.generated : false

    if (type === 'command') {
      if (exitCode === null) blocks.push(`evidence_${evidenceId}_command_exit_code_required`)
      if (!producedAt) blocks.push(`evidence_${evidenceId}_command_produced_at_required`)
      if (!gitRefValue) blocks.push(`evidence_${evidenceId}_command_git_ref_required`)
    }

    return {
      type,
      value: valueText,
      producedAt,
      gitRef: gitRefValue,
      exitCode,
      changedScope: asStringArray(record.changedScope),
      generated,
    }
  })
}

function normalizeCoverageMap(value: unknown, blocks: string[]): ExecutableSpecCoverageMapRow[] {
  const rows = Array.isArray(value) ? value : []
  return rows.map((row, index) => {
    const record = isRecord(row) ? row : {}
    if (!isRecord(row)) blocks.push(`coverage_${index}_must_be_object`)
    const object = readString(record, 'object') ?? ''
    if (!object) blocks.push(`coverage_${index}_object_required`)
    const rawStatus = record.status
    const status = rawStatus === 'covered' || rawStatus === 'deferred' || rawStatus === 'accepted_risk'
      ? rawStatus
      : 'covered'
    if (rawStatus !== status) blocks.push(`coverage_${object || index}_status_invalid`)
    const rawOwner = record.owner
    if (!isSailor(rawOwner)) blocks.push(`coverage_${object || index}_owner_invalid`)
    return {
      object,
      status,
      checklistRefs: asStringArray(record.checklistRefs),
      owner: isSailor(rawOwner) ? rawOwner : 'Captain',
      reason: readString(record, 'reason') ?? '',
    }
  })
}

function normalizeAcceptedRisks(value: unknown, blocks: string[]): ExecutableSpecAcceptedRisk[] {
  const rows = Array.isArray(value) ? value : []
  return rows.map((row, index) => {
    const record = isRecord(row) ? row : {}
    if (!isRecord(row)) blocks.push(`accepted_risk_${index}_must_be_object`)
    const id = readString(record, 'id') ?? `ACCEPTED-RISK-MISSING-${index + 1}`
    if (id.startsWith('ACCEPTED-RISK-MISSING')) blocks.push(`accepted_risk_${index}_id_required`)
    const claimId = readString(record, 'claimId') ?? ''
    if (!claimId) blocks.push(`accepted_risk_${id}_claim_id_required`)
    const rawOwner = record.owner
    if (!isSailor(rawOwner)) blocks.push(`accepted_risk_${id}_owner_invalid`)
    return {
      id,
      claimId,
      owner: isSailor(rawOwner) ? rawOwner : 'Captain',
      consequence: readString(record, 'consequence') ?? '',
      expiry: readString(record, 'expiry') ?? '',
      tracking: readString(record, 'tracking') ?? '',
      compensatingControl: readString(record, 'compensatingControl') ?? '',
      claimLimits: asStringArray(record.claimLimits),
      revisitTrigger: readString(record, 'revisitTrigger') ?? '',
    }
  })
}

function normalizeNextPacketRows(value: unknown, blocks: string[]): ExecutableSpecNextPacketRow[] {
  const rows = Array.isArray(value) ? value : []
  return rows.map((row, index) => {
    const record = isRecord(row) ? row : {}
    if (!isRecord(row)) blocks.push(`next_packet_row_${index}_must_be_object`)
    const rowId = readString(record, 'rowId') ?? ''
    if (!rowId) blocks.push(`next_packet_row_${index}_row_id_required`)
    const rawOwner = record.owner
    if (!isSailor(rawOwner)) blocks.push(`next_packet_row_${rowId || index}_owner_invalid`)
    return {
      rowId,
      owner: isSailor(rawOwner) ? rawOwner : 'Shipping',
      nextAction: readString(record, 'nextAction') ?? '',
      evidenceOwed: asStringArray(record.evidenceOwed),
      stopCondition: readString(record, 'stopCondition') ?? '',
      tracking: readString(record, 'tracking') ?? '',
    }
  })
}

function normalizeEvidence(
  value: unknown,
  checklistIds: Set<string>,
  checklistEvidenceRefs: Set<string>,
  blocks: string[],
): ExecutableSpecEvidenceSource[] {
  const rows = Array.isArray(value) ? value : []
  const knownEvidenceIds = new Set<string>()

  const normalized = rows.map((row, index) => {
    const record = isRecord(row) ? row : {}
    if (!isRecord(row)) blocks.push(`evidence_${index}_must_be_object`)

    const rawId = readString(record, 'id')
    const id = rawId ?? `EVD-MISSING-${String(index + 1).padStart(3, '0')}`
    if (!rawId) blocks.push(`evidence_${index}_id_required`)
    if (knownEvidenceIds.has(id)) blocks.push(`evidence_${id}_duplicate_id`)
    knownEvidenceIds.add(id)

    const claimId = readString(record, 'claimId') ?? ''
    if (!claimId) blocks.push(`evidence_${id}_claim_id_required`)
    if (claimId && !checklistIds.has(claimId)) blocks.push(`evidence_${id}_claim_id_not_in_checklist`)

    const refs = normalizeEvidenceRefs(record.refs, id, blocks)

    const rawVerifier = record.verifier
    if (!isSailor(rawVerifier)) blocks.push(`evidence_${id}_verifier_invalid`)

    const rawFreshness = record.freshness
    if (!isFreshness(rawFreshness)) blocks.push(`evidence_${id}_freshness_invalid`)

    return {
      id,
      claimId,
      refs,
      freshness: isFreshness(rawFreshness) ? rawFreshness : 'unknown',
      verifier: isSailor(rawVerifier) ? rawVerifier : 'QA',
    }
  })

  for (const evidenceRef of checklistEvidenceRefs) {
    if (!knownEvidenceIds.has(evidenceRef)) blocks.push(`checklist_evidence_ref_missing_${evidenceRef}`)
  }

  return normalized
}

function normalizeNextPacket(value: unknown, openBlockingRows: PriorityChecklistItem[], blocks: string[]): ExecutableSpecNextPacket {
  const record = isRecord(value) ? value : {}
  if (!isRecord(value)) blocks.push('next_packet_required_object')

  const rawRequired = record.required
  if (!isBoolean(rawRequired)) blocks.push('next_packet_required_boolean_required')
  const required = isBoolean(rawRequired) ? rawRequired : openBlockingRows.length > 0

  const rawOwner = record.owner
  if (!isSailor(rawOwner)) blocks.push('next_packet_owner_invalid')

  const nextAction = readString(record, 'nextAction') ?? ''
  const reason = readString(record, 'reason') ?? ''
  const artifactRef = readString(record, 'artifactRef')
  const rows = normalizeNextPacketRows(record.rows, blocks)

  if (required && !nextAction) blocks.push('next_packet_required_without_next_action')
  if (required && !reason) blocks.push('next_packet_required_without_reason')
  if (openBlockingRows.length > 0 && !required) blocks.push('open_blocking_rows_without_next_packet')

  return {
    required,
    owner: isSailor(rawOwner) ? rawOwner : 'Shipping',
    nextAction,
    reason,
    artifactRef,
    rows,
  }
}

function validateSourceDocs(sourceDocs: string[], blocks: string[]): void {
  for (const sourceDoc of sourceDocs) {
    if (/^https?:\/\//.test(sourceDoc)) continue
    const path = resolve(repoRoot(), sourceDoc)
    if (!fileExists(path)) blocks.push(`source_doc_not_found_${sourceDoc}`)
  }
}

function normalizeSpec(
  parsed: ParsedSource,
  absoluteSpecPath: string,
  sourceText: string,
): {
  source: ExecutableSpecSourceArtifact
  blocks: string[]
  warnings: string[]
} {
  const blocks = [...parsed.parseBlocks]
  const warnings = [...parsed.parseWarnings]
  const raw = parsed.raw
  const sourcePath = relative(repoRoot(), absoluteSpecPath)
  const sourceDigest = digestText(sourceText)

  const rawVersion = raw.version
  if (rawVersion !== 1) blocks.push('version_must_be_1')

  const id = readString(raw, 'id') ?? 'missing-spec-id'
  if (id === 'missing-spec-id') blocks.push('id_required')

  const title = readString(raw, 'title') ?? 'Missing executable spec title'
  if (title === 'Missing executable spec title') blocks.push('title_required')

  const rawIntent = raw.intentMode
  if (!isIntentMode(String(rawIntent))) blocks.push('intent_mode_invalid')

  const rawTier = raw.complexityTier
  if (!isComplexityTier(String(rawTier))) blocks.push('complexity_tier_invalid')

  const rawDepth = raw.planDepth
  if (!isPlanDepth(String(rawDepth))) blocks.push('plan_depth_invalid')

  const rawCaptainMode = raw.captainMode
  if (!isCaptainMode(rawCaptainMode)) blocks.push('captain_mode_invalid')

  const rawOwner = raw.owner
  if (!isSailor(rawOwner)) blocks.push('owner_invalid')

  const sourceDocs = asStringArray(raw.sourceDocs)
  if (sourceDocs.length === 0) blocks.push('source_docs_required')
  validateSourceDocs(sourceDocs, blocks)

  const acceptanceObjects = asStringArray(raw.acceptanceObjects)
  if (acceptanceObjects.length === 0) blocks.push('acceptance_objects_required')
  const requestedObjects = asStringArray(raw.requestedObjects)
  const coverageMap = normalizeCoverageMap(raw.coverageMap, blocks)
  const acceptedRisks = normalizeAcceptedRisks(raw.acceptedRisks, blocks)

  const sailors = normalizeSailorOwnership(raw.sailors, blocks)
  const checklist = normalizeChecklist(raw.checklist, acceptanceObjects, blocks)
  const openBlockingRows = checklist.filter((row) => row.blocking && ['pending', 'fail', 'blocked'].includes(row.status))
  const checklistIds = new Set(checklist.map((row) => row.id))
  const checklistEvidenceRefs = new Set(checklist.flatMap((row) => row.evidenceRefs))
  const evidence = normalizeEvidence(raw.evidence, checklistIds, checklistEvidenceRefs, blocks)
  const nextPacket = normalizeNextPacket(raw.nextPacket, openBlockingRows, blocks)

  for (const row of evidence) {
    if (row.freshness === 'stale') blocks.push(`evidence_${row.id}_stale`)
  }

  if (/\b(TBD|TODO|to decide later)\b/i.test(sourceText)) blocks.push('source_contains_unresolved_placeholder')
  if (/\baccepted_full\b/i.test(sourceText) && openBlockingRows.length > 0) {
    blocks.push('accepted_full_claim_with_open_blocking_rows')
  }

  return {
    source: {
      version: 1,
      id,
      title,
      sourceFormat: parsed.format,
      sourcePath,
      sourceDigest,
      intentMode: isIntentMode(String(rawIntent)) ? String(rawIntent) : 'direct_answer',
      complexityTier: isComplexityTier(String(rawTier)) ? String(rawTier) : 'T0',
      planDepth: isPlanDepth(String(rawDepth)) ? String(rawDepth) : 'D0',
      captainMode: isCaptainMode(rawCaptainMode) ? rawCaptainMode : 'direct_answer',
      owner: isSailor(rawOwner) ? rawOwner : 'Captain',
      sourceDocs,
      acceptanceObjects,
      requestedObjects,
      coverageMap,
      acceptedRisks,
      sailors,
      checklist,
      evidence,
      nextPacket,
    },
    blocks,
    warnings,
  }
}

function validatorResult(id: string, blocks: string[]): ExecutabilityValidationArtifact['validators'][number] {
  return { id, status: blocks.length === 0 ? 'pass' : 'blocked', blocks }
}

function isClosed(row: PriorityChecklistItem): boolean {
  return row.status === 'pass' || row.status === 'accepted_risk'
}

function validateEvidenceRefs(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const evidenceById = new Map(source.evidence.map((row) => [row.id, row]))

  for (const row of source.checklist) {
    for (const refId of row.evidenceRefs) {
      const evidence = evidenceById.get(refId)
      if (!evidence) continue
      if (evidence.claimId !== row.id) blocks.push('evidence_ref_claim_mismatch')
    }
  }

  for (const evidence of source.evidence) {
    if (evidence.refs.length === 0) blocks.push(`evidence_${evidence.id}_typed_refs_required`)
    for (const ref of evidence.refs) {
      if (!ref.type || !ref.value) blocks.push(`evidence_${evidence.id}_typed_ref_invalid`)
      if (ref.type === 'file' && ref.value && !ref.generated) {
        const resolved = resolve(repoRoot(), ref.value)
        const rel = relative(repoRoot(), resolved)
        const insideRepo = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
        if (!insideRepo || !fileExists(resolved)) blocks.push('evidence_ref_artifact_missing')
      }
    }
  }

  return blocks
}

function validateFreshness(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const evidenceById = new Map(source.evidence.map((row) => [row.id, row]))
  for (const row of source.checklist.filter(isClosed)) {
    for (const evidenceRef of row.evidenceRefs) {
      const evidence = evidenceById.get(evidenceRef)
      if (!evidence) continue
      if (evidence.freshness === 'unknown') blocks.push('closed_row_unknown_freshness')
      if (evidence.freshness === 'current') {
        const hasFreshnessProof = evidence.refs.some((ref) => Boolean(ref.producedAt && ref.gitRef))
        if (!hasFreshnessProof) blocks.push('freshness_self_attested')
      }
    }
    if (row.rerunStatus === 'required') blocks.push(`closed_row_rerun_required_${row.id}`)
  }
  return blocks
}

function validateNegativeProof(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const evidenceById = new Map(source.evidence.map((row) => [row.id, row]))
  for (const row of source.checklist.filter((item) => item.negativeProofRequired && isClosed(item))) {
    const hasNegativeProof = row.evidenceRefs
      .map((refId) => evidenceById.get(refId))
      .filter((evidence): evidence is ExecutableSpecEvidenceSource => Boolean(evidence))
      .some((evidence) => evidence.refs.some((ref) => ref.type === 'negative_proof'))
    if (!hasNegativeProof) blocks.push('negative_proof_missing')
  }
  return blocks
}

function validateAcceptanceObjects(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  for (const row of source.checklist.filter(isClosed)) {
    if (!row.userInspectionObject || !row.agentAcceptanceObject) blocks.push('acceptance_object_missing')
    else if (!row.acceptanceObjectMatch) blocks.push('acceptance_object_mismatch')
  }
  return blocks
}

function validateRequestCoverage(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const requiresCoverage = depthValue(source.planDepth) >= depthValue('D3') || tierValue(source.complexityTier) >= tierValue('T3')
  if (!requiresCoverage) return blocks
  if (source.requestedObjects.length === 0) return ['requested_objects_missing']

  const coverageByObject = new Map(source.coverageMap.map((row) => [row.object, row]))
  for (const object of source.requestedObjects) {
    const coverage = coverageByObject.get(object)
    if (!coverage) {
      blocks.push('requested_object_uncovered')
      continue
    }
    if (coverage.status === 'covered' && coverage.checklistRefs.length === 0) blocks.push(`requested_object_no_checklist_${object}`)
    if (coverage.status === 'deferred' && !coverage.reason) blocks.push(`requested_object_deferred_without_reason_${object}`)
  }
  return blocks
}

function validateModeDepthSailors(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const sailorIds = new Set(source.sailors.map((row) => row.sailor))
  const requiredSailors: Sailor[] = []
  if (tierValue(source.complexityTier) >= tierValue('T3') || depthValue(source.planDepth) >= depthValue('D3')) {
    requiredSailors.push('Captain', 'QA', 'StarPom')
  }
  if (source.intentMode === 'system_refactor') requiredSailors.push('Runtime', 'Context')
  if (source.intentMode === 'incident_repair') requiredSailors.push('Knowledge', 'StarPom', 'QA')

  for (const sailor of new Set(requiredSailors)) {
    if (!sailorIds.has(sailor)) blocks.push('required_sailor_missing')
  }

  for (const sailor of source.sailors) {
    if (
      sailor.owns.length === 0 ||
      sailor.mayDecide.length === 0 ||
      sailor.mustNotChange.length === 0 ||
      sailor.mustEscalateIf.length === 0 ||
      sailor.evidenceOwed.length === 0
    ) {
      blocks.push('sailor_ownership_empty')
    }
  }

  for (const row of source.checklist) {
    if (!sailorIds.has(row.owner)) blocks.push(`checklist_owner_not_declared_${row.id}`)
  }

  for (const evidence of source.evidence) {
    if (!sailorIds.has(evidence.verifier)) blocks.push(`evidence_verifier_not_declared_${evidence.id}`)
  }

  if (source.intentMode === 'system_refactor' && tierValue(source.complexityTier) < tierValue('T3')) blocks.push('mode_depth_incoherent')
  if (source.intentMode === 'direct_answer' && depthValue(source.planDepth) >= depthValue('D3')) blocks.push('mode_depth_incoherent')
  if (source.complexityTier === 'T0' && depthValue(source.planDepth) >= depthValue('D3')) blocks.push('mode_depth_incoherent')

  return blocks
}

function validateAcceptedRisks(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const risksByClaim = new Map(source.acceptedRisks.map((risk) => [risk.claimId, risk]))
  for (const row of source.checklist.filter((item) => item.status === 'accepted_risk')) {
    const risk = risksByClaim.get(row.id)
    if (
      !risk ||
      !risk.consequence ||
      !risk.expiry ||
      !risk.tracking ||
      !risk.compensatingControl ||
      risk.claimLimits.length === 0 ||
      !risk.revisitTrigger
    ) {
      blocks.push('accepted_risk_controls_missing')
    }
  }
  return blocks
}

function validateNextPacket(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const openBlockingRows = source.checklist.filter((row) => row.blocking && ['pending', 'fail', 'blocked'].includes(row.status))
  if (openBlockingRows.length === 0) return blocks
  const mappingsByRow = new Map(source.nextPacket.rows.map((row) => [row.rowId, row]))
  for (const row of openBlockingRows) {
    const mapping = mappingsByRow.get(row.id)
    if (!mapping || !mapping.nextAction || mapping.evidenceOwed.length === 0 || !mapping.stopCondition || !mapping.tracking) {
      blocks.push('next_packet_row_mapping_missing')
    }
    if (mapping && /^(continue|later|follow[- ]?up|remaining work)$/i.test(mapping.nextAction.trim())) {
      blocks.push('next_packet_action_too_vague')
    }
  }
  return blocks
}

function semanticText(source: ExecutableSpecSourceArtifact, sourceText: string): string {
  return [
    source.title,
    source.intentMode,
    source.complexityTier,
    source.planDepth,
    ...source.sourceDocs,
    ...source.acceptanceObjects,
    ...source.requestedObjects,
    ...source.coverageMap.flatMap((row) => [row.object, row.reason, ...row.checklistRefs]),
    ...source.checklist.flatMap((row) => [
      row.id,
      row.sourceRequirement,
      row.acceptanceObject,
      row.userInspectionObject ?? '',
      row.agentAcceptanceObject ?? '',
      ...row.scope,
      ...row.requiredEvidence,
    ]),
    ...source.evidence.flatMap((row) => [
      row.id,
      row.claimId,
      ...row.refs.flatMap((ref) => [ref.type, ref.value]),
    ]),
    source.nextPacket.nextAction,
    source.nextPacket.reason,
    ...source.nextPacket.rows.flatMap((row) => [
      row.rowId,
      row.nextAction,
      row.stopCondition,
      row.tracking,
      ...row.evidenceOwed,
    ]),
    sourceText,
  ].join('\n').toLowerCase()
}

function validateSemanticEvidence(
  source: ExecutableSpecSourceArtifact,
  sourceText: string,
): string[] {
  const blocks: string[] = []
  const text = semanticText(source, sourceText)
  const requiredEvidenceText = source.checklist.flatMap((row) => row.requiredEvidence).join('\n').toLowerCase()
  const evidenceRefText = source.evidence
    .flatMap((row) => row.refs.flatMap((ref) => [ref.type, ref.value]))
    .join('\n')
    .toLowerCase()
  const hasNegativeProofRequired = source.checklist.some((row) => row.negativeProofRequired)
  const hasNegativeProofRef = source.evidence.some((row) => row.refs.some((ref) => ref.type === 'negative_proof'))

  const mentionsInternalRouteExposure =
    /\/admin|\/cms|\/ui-old|internal route|route exposure|public host|public\/studio|access[- ]?control/.test(text)
  const mentionsNegativeProof = /negative proof|not exposed|must not expose|exclusion proof|negative-proof/.test(text)
  if (mentionsInternalRouteExposure && mentionsNegativeProof) {
    if (!hasNegativeProofRequired) blocks.push('public_host_negative_proof_required')
    if (!hasNegativeProofRef) blocks.push('public_host_negative_proof_missing')
  }

  const mentionsCanonicalNull =
    /canonical_name\s*=\s*null|canonical_name null|canonical null|null exclusion|not frontend-visible/.test(text)
  if (mentionsCanonicalNull) {
    if (!/sql|query|negative proof|public visibility|public route|frontend-visible/.test(requiredEvidenceText)) {
      blocks.push('canonical_null_public_visibility_query_required')
    }
    if (!/sql|query/.test(evidenceRefText)) blocks.push('canonical_null_public_visibility_query_missing')
    if (!hasNegativeProofRequired || !hasNegativeProofRef) blocks.push('canonical_null_public_visibility_negative_proof_missing')
  }

  const mentionsParserFreshness =
    /source metadata|parser source|worker source|run log|run logging|freshness proof|data freshness/.test(text)
  if (mentionsParserFreshness) {
    if (!/source metadata/.test(requiredEvidenceText) || !/freshness/.test(requiredEvidenceText) || !/run[- ]?log|run logging|run log/.test(requiredEvidenceText)) {
      blocks.push('parser_source_metadata_freshness_runlog_required')
    }
    if (!/source metadata/.test(evidenceRefText) || !/freshness/.test(evidenceRefText) || !/run[- ]?log|run logging|run log/.test(evidenceRefText)) {
      blocks.push('parser_source_metadata_freshness_runlog_evidence_missing')
    }
  }

  const mentionsBoundContinuation =
    /partial slice|open work inventory|remaining work|bound next|next[- ]packet[- ]bound|continue-now|continue now|accepted_partial/.test(text)
  if (mentionsBoundContinuation && !source.nextPacket.required && source.nextPacket.rows.length === 0) {
    blocks.push('semantic_next_packet_required')
  }

  for (const row of source.checklist.filter(isClosed)) {
    if (
      row.userInspectionObject &&
      row.agentAcceptanceObject &&
      row.agentAcceptanceObject === row.userInspectionObject &&
      row.acceptanceObject !== row.userInspectionObject &&
      !/^AO-[A-Z0-9-]+$/.test(row.acceptanceObject) &&
      /(proof|negative|query|source|freshness|run[- ]?log|next[- ]?packet|baseline)/i.test(row.acceptanceObject)
    ) {
      blocks.push('agent_acceptance_object_collapsed_to_inspection_object')
    }
  }

  return blocks
}

function validateScope(source: ExecutableSpecSourceArtifact): string[] {
  const blocks: string[] = []
  const requiresTypedScope = depthValue(source.planDepth) >= depthValue('D2') || tierValue(source.complexityTier) >= tierValue('T2')
  if (!requiresTypedScope) return blocks
  for (const row of source.checklist) {
    if (row.scope.length === 0 || row.scope.some((scope) => ['app', 'the app', 'everything', 'all'].includes(scope.toLowerCase()))) {
      blocks.push('typed_scope_required')
    }
    if (row.forbiddenScope.length === 0) blocks.push(`forbidden_scope_required_${row.id}`)
  }
  return blocks
}

function markdownBody(sourceText: string): string {
  const match = sourceText.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? sourceText.slice(match[0].length) : sourceText
}

function validateMarkdownContradiction(
  source: ExecutableSpecSourceArtifact,
  sourceText: string,
): string[] {
  if (source.sourceFormat !== 'markdown') return []
  const body = markdownBody(sourceText)
  const claimsDone = /\b(done|ready|green|fixed|accepted|complete|готово|сделано|зел[её]н|принято)\b/i.test(body)
  const openRows = source.checklist.filter((row) => row.blocking && ['pending', 'fail', 'blocked'].includes(row.status))
  return claimsDone && openRows.length > 0 ? ['markdown_body_overclaims'] : []
}

function validateExecutability(
  source: ExecutableSpecSourceArtifact,
  sourceText: string,
): ExecutabilityValidationArtifact {
  const validators = [
    validatorResult('evidence_ref_validator', validateEvidenceRefs(source)),
    validatorResult('freshness_validator', validateFreshness(source)),
    validatorResult('negative_proof_validator', validateNegativeProof(source)),
    validatorResult('acceptance_object_validator', validateAcceptanceObjects(source)),
    validatorResult('request_coverage_validator', validateRequestCoverage(source)),
    validatorResult('mode_depth_sailor_validator', validateModeDepthSailors(source)),
    validatorResult('accepted_risk_validator', validateAcceptedRisks(source)),
    validatorResult('next_packet_mapping_validator', validateNextPacket(source)),
    validatorResult('semantic_evidence_validator', validateSemanticEvidence(source, sourceText)),
    validatorResult('scope_validator', validateScope(source)),
    validatorResult('markdown_contradiction_validator', validateMarkdownContradiction(source, sourceText)),
  ]
  const p9dBlocks = [...new Set(validators.flatMap((validator) => validator.blocks))]
  return {
    specId: source.id,
    status: p9dBlocks.length === 0 ? 'pass' : 'blocked',
    p9dBlocks,
    p9dWarnings: [],
    validators,
  }
}

function buildCompiledArtifacts(
  source: ExecutableSpecSourceArtifact,
  outDir: string,
  blocks: string[],
  warnings: string[],
  executability: ExecutabilityValidationArtifact,
): ArtifactCompilerArtifacts {
  const openBlockingRows = source.checklist.filter((row) => row.blocking && ['pending', 'fail', 'blocked'].includes(row.status))
  const missingEvidenceRows = source.checklist
    .filter((row) => (row.status === 'pass' || row.status === 'accepted_risk') && row.evidenceRefs.length === 0)
    .map((row) => row.id)
  const staleEvidenceRows = source.evidence.filter((row) => row.freshness === 'stale').map((row) => row.id)
  const allBlocks = [...blocks, ...executability.p9dBlocks]
  const status: ArtifactCompileStatus = allBlocks.length === 0 ? 'pass' : 'blocked'
  const verdict: EvidenceVerdict = status === 'pass' ? 'pass' : 'blocked'
  const runId = outDir.split('/').filter(Boolean).at(-1) ?? timestampRunId(source.id)

  const checklist: CompiledChecklistArtifact = {
    specId: source.id,
    totalRows: source.checklist.length,
    openRows: source.checklist.filter((row) => ['pending', 'fail', 'blocked'].includes(row.status)).length,
    openBlockingRows,
    rows: source.checklist,
    finalVerdict: verdict,
  }

  const evidence: CompiledEvidenceArtifact = {
    specId: source.id,
    rows: source.evidence,
    missingEvidenceRows,
    staleEvidenceRows,
    finalVerdict: (evidenceVerdicts as readonly string[]).includes(verdict) ? verdict : 'blocked',
  }

  const nextPacket: CompiledNextPacketArtifact = {
    specId: source.id,
    ...source.nextPacket,
    openBlockingRows: openBlockingRows.map((row) => row.id),
  }

  const artifactRefs = [
    'compiled-spec.json',
    'compiled-checklist.json',
    'compiled-evidence.json',
    'compiled-next-packet.json',
    'executability-validation.json',
    'artifact-compile-report.json',
    'artifact-compile-report.md',
  ]

  const report: ArtifactCompileReportArtifact = {
    runId,
    createdAt: new Date().toISOString(),
    trackingId: 'REPAIR-20260513-CAPTAIN-LIVING-SYSTEM',
    sourcePath: source.sourcePath,
    sourceDigest: source.sourceDigest,
    outDir,
    status,
    exitCode: status === 'pass' ? 0 : 2,
    compileBlocks: allBlocks,
    p9dBlocks: executability.p9dBlocks,
    warnings,
    artifactRefs,
    contractCompileAllowed: blocks.length === 0,
    executionReady: status === 'pass',
    productClosureAllowed: false,
  }

  return {
    source,
    checklist,
    evidence,
    nextPacket,
    executability,
    report,
    markdownReport: renderCompileReport(source, checklist, evidence, nextPacket, report),
  }
}

function markdownList(items: string[]): string {
  return items.length === 0 ? '- none' : items.map((item) => `- ${item}`).join('\n')
}

function renderCompileReport(
  source: ExecutableSpecSourceArtifact,
  checklist: CompiledChecklistArtifact,
  evidence: CompiledEvidenceArtifact,
  nextPacket: CompiledNextPacketArtifact,
  report: ArtifactCompileReportArtifact,
): string {
  return `# Artifact Compile Report

Spec: ${source.id}
Title: ${source.title}
Status: ${report.status}
Run: ${report.runId}

## Machine Contract

- sourceFormat: ${source.sourceFormat}
- intentMode: ${source.intentMode}
- complexityTier: ${source.complexityTier}
- planDepth: ${source.planDepth}
- captainMode: ${source.captainMode}
- contractCompileAllowed: ${report.contractCompileAllowed}
- executionReady: ${report.executionReady}
- productClosureAllowed: ${report.productClosureAllowed}

## Checklist

- totalRows: ${checklist.totalRows}
- openRows: ${checklist.openRows}
- openBlockingRows: ${checklist.openBlockingRows.length}

Open blocking:
${markdownList(checklist.openBlockingRows.map((row) => `${row.id}: ${row.sourceRequirement}`))}

## Evidence

- evidenceRows: ${evidence.rows.length}
- missingEvidenceRows: ${evidence.missingEvidenceRows.length}
- staleEvidenceRows: ${evidence.staleEvidenceRows.length}

## Next Packet

- required: ${nextPacket.required}
- owner: ${nextPacket.owner}
- nextAction: ${nextPacket.nextAction || 'none'}
- reason: ${nextPacket.reason || 'none'}

## Compile Blocks

${markdownList(report.compileBlocks)}

## P9D Blocks

${markdownList(report.p9dBlocks)}

## Warnings

${markdownList(report.warnings)}
`
}

export function compileArtifactSpec(options: CompileArtifactSpecOptions): ArtifactCompilerArtifacts {
  const absoluteSpecPath = resolveSpecPath(options.spec)
  const sourceText = readText(absoluteSpecPath)
  const parsed = parseSource(sourceText, absoluteSpecPath)
  const runId = timestampRunId(`artifact-compile-${options.spec}`)
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${runId}`)
  ensureDir(outDir)

  const normalized = normalizeSpec(parsed, absoluteSpecPath, sourceText)
  const executability = validateExecutability(normalized.source, sourceText)
  const artifacts = buildCompiledArtifacts(normalized.source, outDir, normalized.blocks, normalized.warnings, executability)

  writeJson(resolveRunFile(outDir, 'compiled-spec.json'), artifacts.source)
  writeJson(resolveRunFile(outDir, 'compiled-checklist.json'), artifacts.checklist)
  writeJson(resolveRunFile(outDir, 'compiled-evidence.json'), artifacts.evidence)
  writeJson(resolveRunFile(outDir, 'compiled-next-packet.json'), artifacts.nextPacket)
  writeJson(resolveRunFile(outDir, 'executability-validation.json'), artifacts.executability)
  writeJson(resolveRunFile(outDir, 'artifact-compile-report.json'), {
    ...artifacts.report,
    gitRef: gitRef(),
  })
  writeText(resolveRunFile(outDir, 'artifact-compile-report.md'), artifacts.markdownReport)

  return artifacts
}

function main(): void {
  try {
    const options = parseCliArgs(process.argv.slice(2))
    if (!options.spec) throw new LabInputError('--spec is required')
    const artifacts = compileArtifactSpec({ spec: options.spec, out: options.out })
    const summary = {
      runId: artifacts.report.runId,
      outDir: artifacts.report.outDir,
      status: artifacts.report.status,
      exitCode: artifacts.report.exitCode,
      compileBlocks: artifacts.report.compileBlocks,
      p9dBlocks: artifacts.report.p9dBlocks,
      openBlockingRows: artifacts.checklist.openBlockingRows.map((row) => row.id),
    }

    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`Captain Lab artifact compile: ${summary.status}`)
      console.log(`outDir: ${summary.outDir}`)
      if (summary.compileBlocks.length > 0) console.log(`blocks: ${summary.compileBlocks.join(', ')}`)
    }

    process.exitCode = artifacts.report.exitCode
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

if (isDirectEntrypoint('artifact-compiler.ts')) main()
