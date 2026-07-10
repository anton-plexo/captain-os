import type { LabRunArtifacts } from './schema'

function list(items: string[]): string {
  return items.length === 0 ? '- none' : items.map((item) => `- ${item}`).join('\n')
}

export function renderCaptainSynthesis(artifacts: Omit<LabRunArtifacts, 'synthesis'>): string {
  const {
    classification,
    crewPlan,
    evidenceMatrix,
    starpomVerdict,
    input,
    run,
    diamond,
    operatingSafety,
    contextRuntime,
    splashRadius,
    crossLlmSla,
    evidenceAggregation,
  } = artifacts

  const finalClaim = starpomVerdict.finalClaimAllowed
    ? 'allowed for this shadow classification only; product closure is still not granted'
    : 'blocked'
  const continuationBlocks = diamond.blockIds.filter((blockId) => (
    blockId.includes('open_work') ||
    blockId.includes('broad_done') ||
    blockId.includes('next_packet') ||
    blockId.includes('premature_stop')
  ))

  return `# Captain OS Lab Shadow Synthesis

Run: ${run.runId}
Task: ${input.title}
Mode: ${run.mode}

## Classification

- intentMode: ${classification.intentMode}
- complexityTier: ${classification.complexityTier}
- planDepth: ${classification.planDepth}
- captainMode: ${classification.captainMode}
- hardWorkRequired: ${classification.hardWorkRequired}
- octopusRequired: ${classification.octopusRequired}
- finalClaimGateRequired: ${classification.finalClaimGateRequired}
- diamondRequired: ${diamond.diamondRequired.required}

Why:
${list(classification.matchedSignals)}

## 🧠 Cognitive Skills Advisory (Рекомендации по Выбору Фреймворков)

${(() => {
  const activeAdvisories = [];
  if (classification.hardWorkRequired) {
    activeAdvisories.push(`* **🧠 Hardwork Framework [RECOMMENDED]:** Задаче присвоен высокий уровень технической сложности (T3/T4 или рефакторинг ядра).
  * *Рекомендация:* Решайте задачу по шагам через команду \`/goal\` с фиксацией гипотез и снапшотов (\`npx captain-os snapshot save\`).`);
  }
  if (classification.octopusRequired) {
    activeAdvisories.push(`* **🐙 Octopus Framework [RECOMMENDED]:** Обнаружен высокий Blast Radius (изменения затрагивают несколько слоев кодовой базы).
  * *Рекомендация:* Постройте карту зависимостей в 4 плоскостях (каскады импортов, типы, схемы Zod/БД и UI). См. регламент в [\`docs/protocols/octopus-framework.md\`](file:///docs/protocols/octopus-framework.md).`);
  }
  const isFireChatRecommended = classification.complexityTier === 'T3' || classification.complexityTier === 'T4' || classification.finalClaimGateRequired;
  if (isFireChatRecommended) {
    activeAdvisories.push(`* **🔥 Multi-LLM Fire Chat Consensus [RECOMMENDED]:** Критический этап планирования или финализации перед слиянием (Pre-Merge/Deploy).
  * *Рекомендация:* Запустите параллельное перекрестное ревью одной роли на 3 разных LLM-движках для исключения галлюцинаций (подробнее в [\`docs/protocols/fire-chat-protocol.md\`](file:///docs/protocols/fire-chat-protocol.md)).`);
  }
  if (activeAdvisories.length === 0) {
    return `* **🟢 Low Risk Task:** Особые когнитивные фреймворки не требуются. Достаточно быстрого автоматического тестирования и локальной верификации микро-судьей (Gemini 3.5 Flash).`;
  }
  return activeAdvisories.join('\n\n');
})()}

## Crew

Selected sailors:
${list(crewPlan.requiredSailors)}

Officer lanes:
${list(crewPlan.officerLanes.map((lane) => `${lane.id}: ${lane.owner} (${lane.scope.join(', ')})`))}

Omitted/optional sailors:
${list(crewPlan.optionalSailors)}

Captain-only reason:
- ${crewPlan.captainOnlyReason ?? 'none'}

## Operating Safety

- directQuestionDetected: ${operatingSafety.directQuestionDetected}
- answerRequiredBeforeAction: ${operatingSafety.answerRequiredBeforeAction}
- angerIncidentMode: ${operatingSafety.angerIncidentMode}
- productionOpeningGoalDetected: ${operatingSafety.productionOpeningGoalDetected}
- operatorDecisionRequired: ${operatingSafety.operatorDecisionRequired}
- criticalPathMovement: ${operatingSafety.criticalPathMovement}
- adjacentPlanningSlicesAfterBlocker: ${operatingSafety.adjacentPlanningSlicesAfterBlocker}
- hoursAfterBlocker: ${operatingSafety.hoursAfterBlocker}
- seoHttp200OnlySignal: ${operatingSafety.seoHttp200OnlySignal}
- seoParityMissing: ${operatingSafety.seoParityMissing}
- activeRowCount: ${operatingSafety.activeRowCount}
- spanOfControlViolation: ${operatingSafety.spanOfControlViolation}
- officerHierarchyRequired: ${operatingSafety.officerHierarchyRequired}
- contextBudgetViolations: ${operatingSafety.contextBudgetViolations.length}

Operating safety blocks:
${list(operatingSafety.blocks)}

## P10G Runtime Hardening

- ragRequired: ${contextRuntime.ragRequired}
- ragPackInjected: ${contextRuntime.ragPackInjected}
- sessionPackRequired: ${contextRuntime.sessionPackRequired}
- sessionPackInjected: ${contextRuntime.sessionPackInjected}
- splashRadiusRequired: ${splashRadius.required}
- splashRadiusHookInjected: ${splashRadius.splashRadiusHookInjected}
- crossDomain: ${splashRadius.crossDomain}
- crossLlmRequiredPhases: ${crossLlmSla.requiredPhases.join(', ') || 'none'}
- evidenceAggregationReport: ${evidenceAggregation.reportName}

P10G blocks:
${list([...contextRuntime.blocks, ...splashRadius.blocks, ...crossLlmSla.blocks, ...evidenceAggregation.blocks])}

## Evidence Gaps

${list(evidenceMatrix.rows.filter((row) => row.verdict === 'blocked').map((row) => `${row.id}: ${row.claim}`))}

## Diamond Protocol

- status: ${diamond.diamondRequired.status}
- reason: ${diamond.diamondRequired.reason}
- closureMatrix: ${diamond.closureMatrix.closureStatus}
- runtime blocks: ${diamond.blockIds.length}
- routeChecklist: ${diamond.routeChecklistCoverage.parsed ? `${diamond.routeChecklistCoverage.openRows} open / ${diamond.routeChecklistCoverage.totalRows} total` : 'not attached'}

Diamond blocks:
${list(diamond.blockIds)}

## Continuation Protocol

Open-work / false-done blocks:
${list(continuationBlocks)}

Open checklist rows:
${list(diamond.routeChecklistCoverage.openBlockingRows.slice(0, 12).map((row) => `${row.section} line ${row.line}: ${row.text}`))}

## StarPom

- verdict: ${starpomVerdict.verdict}
- finalClaimAllowed: ${starpomVerdict.finalClaimAllowed}
- productClosureAllowed: ${starpomVerdict.productClosureAllowed}
- productClosureStatus: ${starpomVerdict.productClosureStatus}

Blocked claims:
${list(starpomVerdict.blockedClaims)}

## Next Packet

Final claim is ${finalClaim}.
Next required gate: ${starpomVerdict.requiredRepairs[0] ?? 'continue with the next shadow/advisory fixture run'}.
`
}
