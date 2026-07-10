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

type P9BDomain = 'ui' | 'cms' | 'security' | 'shipping' | 'data' | 'strategy' | 'mixed'
type P9BInputMode = 'baseline_advisory' | 'advisory_with_spec' | 'paired_comparison'

interface CliOptions {
  widerRun?: string
  out?: string
  json?: boolean
}

interface P10BWiderDecisionRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  sliceRole: 'positive_candidate' | 'clean_pass_control' | 'deferred_rule_control' | 'unrelated_serious_control'
  selectedRulesMatched: string[]
  deferredRulesMatched: string[]
  failClosedDecision: 'blocked_fail_closed' | 'pass_through'
  expectedDecision: 'should_block' | 'should_pass'
  falsePositive: boolean
  falseNegative: boolean
  operatorMinutesAdded: number
  acceptedRiskBypassAttempted: boolean
  acceptedRiskBypassAccepted: boolean
  nextAction: string
}

interface P10BWiderBlockingReport {
  schemaVersion: 1
  status: 'p10b_wider_blocking_profile_ready_global_disabled' | 'p10b_wider_blocking_profile_failed'
  sourceRunId: string
  sourceRunDir: string
  outDir: string
  blockingMode: 'fail_closed_wider_profile'
  globalBlockingEnabled: false
  selectedRules: string[]
  deferredRules: string[]
  metrics: {
    acceptedRiskBypassCoverage: 'not_exercised' | 'control_only' | 'blocking_path_exercised'
  }
  decisionRows: P10BWiderDecisionRow[]
}

type BypassAttemptKind = 'weak_missing_controls' | 'complete_bounded_controls'
type BypassDecision = 'rejected_missing_controls' | 'accepted_bounded_risk'
type FinalDecision = 'blocked_fail_closed' | 'accepted_risk_bypass'

interface AcceptedRiskBypassPacket {
  packetId: string
  taskId: string
  ruleIds: string[]
  attemptKind: BypassAttemptKind
  owner: string | null
  consequence: string | null
  expiry: string | null
  tracking: string | null
  compensatingControl: string | null
  claimLimits: string[]
  revisitTrigger: string | null
  operatorAcknowledged: boolean
  starpomApproved: boolean
  requestedClosure: 'accepted_full' | 'accepted_risk_only'
}

interface BypassDecisionRow {
  taskId: string
  domain: P9BDomain
  inputMode: P9BInputMode
  selectedRulesMatched: string[]
  attemptKind: BypassAttemptKind
  packetId: string
  missingControls: string[]
  bypassDecision: BypassDecision
  finalDecision: FinalDecision
  failClosedPreserved: boolean
  acceptedRiskRecorded: boolean
  acceptedFullAllowed: boolean
  operatorMinutesAdded: number
  nextAction: string
}

interface P10CRuleCoverageRow {
  ruleId: string
  selectedBlockingRows: number
  weakBypassRejected: number
  completeBypassAccepted: number
  acceptedFullClaimsAllowed: number
  status: 'selected_path_bypass_pass' | 'selected_path_bypass_fail'
}

interface P10CSelectedPathBypassReport {
  schemaVersion: 1
  status: 'p10c_selected_path_bypass_gate_ready_global_disabled' | 'p10c_selected_path_bypass_gate_failed'
  widerRunDir: string
  outDir: string
  blockingMode: 'selected_path_accepted_risk_bypass_exercise'
  globalBlockingEnabled: false
  selectedRules: string[]
  metrics: {
    selectedBlockingRows: number
    selectedRulesCovered: number
    bypassAttempts: number
    weakBypassRejected: number
    completeBypassAccepted: number
    acceptedFullClaimsAllowed: number
    failClosedPreservedRows: number
    acceptedRiskRecordedRows: number
    selectedPathBypassCoverage: 'none' | 'partial' | 'complete'
    globalEnablementPrerequisiteMet: boolean
    starpomDecision: 'accept_selected_path_bypass_keep_global_disabled' | 'reject_selected_path_bypass'
  }
  ruleRows: P10CRuleCoverageRow[]
  bypassPackets: AcceptedRiskBypassPacket[]
  decisionRows: BypassDecisionRow[]
  nextAction: string
}

const defaultWiderRun = '.ship/lab/runs/manual-p10b-wider-blocking-rollout'
const requiredControls = [
  'owner',
  'consequence',
  'expiry',
  'tracking',
  'compensatingControl',
  'claimLimits',
  'revisitTrigger',
  'operatorAcknowledged',
  'starpomApproved',
  'acceptedRiskOnlyClosure',
] as const

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
    if (key === 'wider-run') options.widerRun = value
    else if (key === 'out') options.out = value
    else throw new LabInputError(`unknown flag: ${arg}`)
  }
  return options
}

function requireWiderRun(run: string): string {
  const runDir = assertSafeShadowOutDir(run)
  const reportPath = resolve(runDir, 'p10b-wider-blocking-report.json')
  if (!fileExists(reportPath)) throw new LabInputError(`P10B wider report not found: ${reportPath}`)
  return runDir
}

function selectedBlockingRows(report: P10BWiderBlockingReport): P10BWiderDecisionRow[] {
  if (report.status !== 'p10b_wider_blocking_profile_ready_global_disabled') {
    throw new LabInputError('P10C requires a passing P10B wider rollout report')
  }
  const rows = report.decisionRows.filter((row) => (
    row.sliceRole === 'positive_candidate' &&
    row.failClosedDecision === 'blocked_fail_closed' &&
    row.selectedRulesMatched.length > 0 &&
    !row.falsePositive &&
    !row.falseNegative
  ))
  if (rows.length === 0) throw new LabInputError('P10C found no selected blocking-path rows to exercise')
  return rows.sort((a, b) => a.taskId.localeCompare(b.taskId))
}

function buildPacket(row: P10BWiderDecisionRow, attemptKind: BypassAttemptKind): AcceptedRiskBypassPacket {
  if (attemptKind === 'weak_missing_controls') {
    return {
      packetId: `P10C-WEAK-${row.taskId}`,
      taskId: row.taskId,
      ruleIds: row.selectedRulesMatched,
      attemptKind,
      owner: 'Captain',
      consequence: null,
      expiry: null,
      tracking: null,
      compensatingControl: null,
      claimLimits: [],
      revisitTrigger: null,
      operatorAcknowledged: false,
      starpomApproved: false,
      requestedClosure: 'accepted_full',
    }
  }

  return {
    packetId: `P10C-COMPLETE-${row.taskId}`,
    taskId: row.taskId,
    ruleIds: row.selectedRulesMatched,
    attemptKind,
    owner: 'Captain / StarPom',
    consequence: `Proceeding with ${row.taskId} before satisfying ${row.selectedRulesMatched.join(', ')} can only close as accepted risk, not accepted_full.`,
    expiry: 'Before P10D global enablement decision or 2026-05-19, whichever comes first.',
    tracking: 'REPAIR-20260513-CAPTAIN-LIVING-SYSTEM',
    compensatingControl: 'Keep the selected P10 rule fail-closed outside this explicit accepted-risk packet and carry the owed evidence into the next packet.',
    claimLimits: [
      'Do not claim accepted_full.',
      'Do not disable the selected rule.',
      'Do not apply this bypass to unrelated tasks.',
    ],
    revisitTrigger: 'Any final claim, StarPom closeout, or P10D global enablement decision touching this task class.',
    operatorAcknowledged: true,
    starpomApproved: true,
    requestedClosure: 'accepted_risk_only',
  }
}

function missingControls(packet: AcceptedRiskBypassPacket): string[] {
  const missing: string[] = []
  if (!packet.owner) missing.push('owner')
  if (!packet.consequence) missing.push('consequence')
  if (!packet.expiry) missing.push('expiry')
  if (!packet.tracking) missing.push('tracking')
  if (!packet.compensatingControl) missing.push('compensatingControl')
  if (packet.claimLimits.length === 0) missing.push('claimLimits')
  if (!packet.revisitTrigger) missing.push('revisitTrigger')
  if (!packet.operatorAcknowledged) missing.push('operatorAcknowledged')
  if (!packet.starpomApproved) missing.push('starpomApproved')
  if (packet.requestedClosure !== 'accepted_risk_only') missing.push('acceptedRiskOnlyClosure')
  return requiredControls.filter((control) => missing.includes(control))
}

function evaluatePacket(row: P10BWiderDecisionRow, packet: AcceptedRiskBypassPacket): BypassDecisionRow {
  const missing = missingControls(packet)
  const accepted = missing.length === 0
  return {
    taskId: row.taskId,
    domain: row.domain,
    inputMode: row.inputMode,
    selectedRulesMatched: row.selectedRulesMatched,
    attemptKind: packet.attemptKind,
    packetId: packet.packetId,
    missingControls: missing,
    bypassDecision: accepted ? 'accepted_bounded_risk' : 'rejected_missing_controls',
    finalDecision: accepted ? 'accepted_risk_bypass' : 'blocked_fail_closed',
    failClosedPreserved: !accepted,
    acceptedRiskRecorded: accepted,
    acceptedFullAllowed: false,
    operatorMinutesAdded: accepted ? row.operatorMinutesAdded + 2 : row.operatorMinutesAdded + 1,
    nextAction: accepted
      ? 'Record a bounded accepted-risk bypass, preserve selected rule enforcement, and require evidence repayment before accepted_full.'
      : 'Reject bypass and keep the selected rule fail-closed until a complete accepted-risk packet exists.',
  }
}

function buildReport(options: CliOptions): P10CSelectedPathBypassReport {
  const widerRunDir = requireWiderRun(options.widerRun ?? defaultWiderRun)
  const outDir = assertSafeShadowOutDir(options.out ?? `.ship/lab/runs/${timestampRunId('p10c-selected-path-bypass')}`)
  ensureDir(outDir)

  const widerReport = readJson<P10BWiderBlockingReport>(resolve(widerRunDir, 'p10b-wider-blocking-report.json'))
  const selectedRows = selectedBlockingRows(widerReport)
  const packets = selectedRows.flatMap((row) => [
    buildPacket(row, 'weak_missing_controls'),
    buildPacket(row, 'complete_bounded_controls'),
  ])
  const decisionRows = packets.map((packet) => {
    const row = selectedRows.find((item) => item.taskId === packet.taskId)
    if (!row) throw new LabInputError(`missing selected row for bypass packet: ${packet.packetId}`)
    return evaluatePacket(row, packet)
  })

  const weakBypassRejected = decisionRows.filter((row) => row.attemptKind === 'weak_missing_controls' && row.bypassDecision === 'rejected_missing_controls').length
  const completeBypassAccepted = decisionRows.filter((row) => row.attemptKind === 'complete_bounded_controls' && row.bypassDecision === 'accepted_bounded_risk').length
  const acceptedFullClaimsAllowed = decisionRows.filter((row) => row.acceptedFullAllowed).length
  const coveredRules = new Set(decisionRows.flatMap((row) => row.selectedRulesMatched))
  const ruleRows = widerReport.selectedRules.map((ruleId) => {
    const rowsForRule = decisionRows.filter((row) => row.selectedRulesMatched.includes(ruleId))
    const weakRows = rowsForRule.filter((row) => row.attemptKind === 'weak_missing_controls')
    const completeRows = rowsForRule.filter((row) => row.attemptKind === 'complete_bounded_controls')
    const weakRejected = weakRows.filter((row) => row.bypassDecision === 'rejected_missing_controls').length
    const completeAccepted = completeRows.filter((row) => row.bypassDecision === 'accepted_bounded_risk').length
    const acceptedFullAllowedForRule = rowsForRule.filter((row) => row.acceptedFullAllowed).length
    const pass = weakRows.length > 0 &&
      completeRows.length > 0 &&
      weakRejected === weakRows.length &&
      completeAccepted === completeRows.length &&
      acceptedFullAllowedForRule === 0
    return {
      ruleId,
      selectedBlockingRows: completeRows.length,
      weakBypassRejected: weakRejected,
      completeBypassAccepted: completeAccepted,
      acceptedFullClaimsAllowed: acceptedFullAllowedForRule,
      status: pass ? 'selected_path_bypass_pass' : 'selected_path_bypass_fail',
    }
  })

  const selectedPathBypassCoverage = completeBypassAccepted === selectedRows.length && coveredRules.size === widerReport.selectedRules.length
    ? 'complete'
    : completeBypassAccepted > 0
      ? 'partial'
      : 'none'
  const gatePass = selectedPathBypassCoverage === 'complete' &&
    weakBypassRejected === selectedRows.length &&
    completeBypassAccepted === selectedRows.length &&
    acceptedFullClaimsAllowed === 0 &&
    ruleRows.every((row) => row.status === 'selected_path_bypass_pass')

  const report: P10CSelectedPathBypassReport = {
    schemaVersion: 1,
    status: gatePass ? 'p10c_selected_path_bypass_gate_ready_global_disabled' : 'p10c_selected_path_bypass_gate_failed',
    widerRunDir: relative(repoRoot(), widerRunDir),
    outDir: relative(repoRoot(), outDir),
    blockingMode: 'selected_path_accepted_risk_bypass_exercise',
    globalBlockingEnabled: false,
    selectedRules: widerReport.selectedRules,
    metrics: {
      selectedBlockingRows: selectedRows.length,
      selectedRulesCovered: coveredRules.size,
      bypassAttempts: decisionRows.length,
      weakBypassRejected,
      completeBypassAccepted,
      acceptedFullClaimsAllowed,
      failClosedPreservedRows: decisionRows.filter((row) => row.failClosedPreserved).length,
      acceptedRiskRecordedRows: decisionRows.filter((row) => row.acceptedRiskRecorded).length,
      selectedPathBypassCoverage,
      globalEnablementPrerequisiteMet: gatePass,
      starpomDecision: gatePass ? 'accept_selected_path_bypass_keep_global_disabled' : 'reject_selected_path_bypass',
    },
    ruleRows,
    bypassPackets: packets,
    decisionRows,
    nextAction: gatePass
      ? 'Proceed to a separate P10D global enablement decision/canary; do not enable global blocking automatically from P10C.'
      : 'Repair accepted-risk bypass handling before any global enablement decision.',
  }

  writeJson(resolve(outDir, 'p10c-selected-path-bypass-report.json'), report)
  writeJson(resolve(outDir, 'accepted-risk-bypass-packets.json'), {
    schemaVersion: 1,
    packets: report.bypassPackets,
  })
  writeJson(resolve(outDir, 'bypass-decisions.json'), {
    schemaVersion: 1,
    blockingMode: report.blockingMode,
    selectedRules: report.selectedRules,
    rows: report.decisionRows,
  })
  writeJson(resolve(outDir, 'global-enablement-decision.json'), {
    schemaVersion: 1,
    status: gatePass ? 'global_enablement_decision_ready_not_enabled' : 'global_enablement_blocked_by_bypass_gate',
    prerequisiteMet: gatePass,
    enabled: false,
    reason: gatePass
      ? 'Selected-path accepted-risk bypass handling is proven, but global blocking still requires an explicit P10D operator decision and canary evidence.'
      : 'Selected-path accepted-risk bypass handling failed; global blocking must remain disabled.',
    selectedRules: report.selectedRules,
    nextAction: report.nextAction,
  })
  writeText(resolve(outDir, 'p10c-selected-path-bypass-report.md'), renderMarkdown(report))
  return report
}

function renderMarkdown(report: P10CSelectedPathBypassReport): string {
  const rules = report.ruleRows
    .map((row) => `| ${row.ruleId} | ${row.status} | ${row.selectedBlockingRows} | ${row.weakBypassRejected} | ${row.completeBypassAccepted} | ${row.acceptedFullClaimsAllowed} |`)
    .join('\n')
  const decisions = report.decisionRows
    .map((row) => `| ${row.taskId} | ${row.attemptKind} | ${row.selectedRulesMatched.join(', ')} | ${row.bypassDecision} | ${row.finalDecision} | ${row.missingControls.join(', ') || '-'} | ${row.acceptedFullAllowed} |`)
    .join('\n')

  return `# P10C Selected-Path Accepted-Risk Bypass Report

Status: ${report.status}
Wider run: ${report.widerRunDir}
Blocking mode: ${report.blockingMode}
Global blocking enabled: ${report.globalBlockingEnabled}

## Metrics

- selectedBlockingRows: ${report.metrics.selectedBlockingRows}
- selectedRulesCovered: ${report.metrics.selectedRulesCovered}
- bypassAttempts: ${report.metrics.bypassAttempts}
- weakBypassRejected: ${report.metrics.weakBypassRejected}
- completeBypassAccepted: ${report.metrics.completeBypassAccepted}
- acceptedFullClaimsAllowed: ${report.metrics.acceptedFullClaimsAllowed}
- failClosedPreservedRows: ${report.metrics.failClosedPreservedRows}
- acceptedRiskRecordedRows: ${report.metrics.acceptedRiskRecordedRows}
- selectedPathBypassCoverage: ${report.metrics.selectedPathBypassCoverage}
- globalEnablementPrerequisiteMet: ${report.metrics.globalEnablementPrerequisiteMet}
- starpomDecision: ${report.metrics.starpomDecision}

## Rule Rows

| Rule | Status | Selected Blocking Rows | Weak Rejected | Complete Accepted | Accepted Full Allowed |
|---|---|---:|---:|---:|---:|
${rules}

## Decision Rows

| Task | Attempt | Selected Rules | Bypass Decision | Final Decision | Missing Controls | Accepted Full Allowed |
|---|---|---|---|---|---|---|
${decisions}

## Next Action

${report.nextAction}
`
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = buildReport(options)
    const summary = {
      status: report.status,
      outDir: report.outDir,
      selectedRules: report.selectedRules,
      selectedBlockingRows: report.metrics.selectedBlockingRows,
      bypassAttempts: report.metrics.bypassAttempts,
      weakBypassRejected: report.metrics.weakBypassRejected,
      completeBypassAccepted: report.metrics.completeBypassAccepted,
      acceptedFullClaimsAllowed: report.metrics.acceptedFullClaimsAllowed,
      selectedPathBypassCoverage: report.metrics.selectedPathBypassCoverage,
      globalEnablementPrerequisiteMet: report.metrics.globalEnablementPrerequisiteMet,
      globalBlockingEnabled: report.globalBlockingEnabled,
      report: `${report.outDir}/p10c-selected-path-bypass-report.json`,
    }
    if (options.json) console.log(JSON.stringify(summary, null, 2))
    else {
      console.log(`P10C selected-path bypass: ${summary.status}`)
      console.log(`selectedRules: ${summary.selectedRules.join(', ')}`)
      console.log(`selectedBlockingRows: ${summary.selectedBlockingRows}`)
      console.log(`coverage: ${summary.selectedPathBypassCoverage}`)
      console.log(`report: ${summary.report}`)
    }
    process.exitCode = report.status === 'p10c_selected_path_bypass_gate_ready_global_disabled' ? 0 : 2
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

if (isDirectEntrypoint('p10c-selected-path-bypass.ts')) main()
