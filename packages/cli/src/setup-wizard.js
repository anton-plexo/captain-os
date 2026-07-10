import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as readline from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function askQuestion(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

function detectPackageManager() {
  const root = process.cwd();
  if (existsSync(resolve(root, 'bun.lockb')) || existsSync(resolve(root, 'bun.lock'))) {
    return 'bun';
  }
  if (existsSync(resolve(root, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(resolve(root, 'yarn.lock'))) {
    return 'yarn';
  }
  try {
    execSync('which bun', { stdio: 'ignore' });
    return 'bun';
  } catch {
    return 'npm';
  }
}

function checkRuntimeEnvironment() {
  let hasBun = false;
  let hasNode = false;
  
  try {
    execSync('bun --version', { stdio: 'ignore' });
    hasBun = true;
  } catch {}
  
  try {
    execSync('node --version', { stdio: 'ignore' });
    hasNode = true;
  } catch {}
  
  return {
    bun: hasBun,
    node: hasNode,
    preferred: hasBun ? 'bun' : 'node',
  };
}

function printUserAgreement(projectName, ownerName, runtimes, ragPaths, ledgerPath, useGitForIssues) {
  console.log('\n\x1b[35m======================================================================\x1b[0m');
  console.log('\x1b[35m📋  🤖  ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ И ПРАВИЛА РАБОТЫ CAPTAIN OS  🤖  📋\x1b[0m');
  console.log('\x1b[35m======================================================================\x1b[0m\n');
  
  console.log(`Приветствуем, \x1b[32m${ownerName}\x1b[0m!`);
  console.log(`Ваш проект \x1b[36m${projectName}\x1b[0m подготовлен к интеграции управляющего ядра мета-ОС.\n`);

  console.log('\x1b[1m⚙️  1. ИНТЕГРАЦИЯ И ДИНАМИЧЕСКИЙ ВЫБОР КАПИТАНА (RUNTIMES):\x1b[0m');
  console.log(`   - \x1b[33mГлавный разработчик (Оператор)\x1b[0m: ${ownerName}`);
  console.log(`   - \x1b[33mДинамический выбор Капитана (Dynamic Captain Mode)\x1b[0m: Управляющей моделью`);
  console.log(`     автоматически становится тот ИИ-ассистент, из сессии которого начата работа.`);
  console.log(`     Доступные рантаймы в контуре: \x1b[36m${runtimes.join(', ')}\x1b[0m`);
  console.log(`   - \x1b[33mПараллельное ревью\x1b[0m: При сложных или междоменных задачах`);
  console.log(`     автоматически подключается внешняя ЛЛМ (Claude/Codex) для перекрестной проверки.\n`);

  console.log('\x1b[1m📂  2. УПРАВЛЕНИЕ КОНТЕКСТОМ И СОСТОЯНИЕМ (STATE & STORAGE):\x1b[0m');
  console.log(`   - \x1b[33mБаза знаний RAG (Локальный поиск)\x1b[0m: Строится по папкам: \x1b[36m${ragPaths.join(', ')}\x1b[0m`);
  console.log(`   - \x1b[33mРеестр качества (Дефекты)\x1b[0m: Список зарегистрированных багов хранится в \x1b[32m${ledgerPath}\x1b[0m`);
  console.log(`   - \x1b[33mСпикер состояния задач (Task Spine)\x1b[0m: Состояние задач пишется в \x1b[32m.captain-os/task-spine.yaml\x1b[0m`);
  console.log(`   - \x1b[33mСинхронизация задач (Issues)\x1b[0m: ${useGitForIssues ? '\x1b[32mЗапись напрямую в локальную историю Git (без внешнего мусора)\x1b[0m' : '\x1b[31mРучной режим / Внешний трекер\x1b[0m'}\n`);

  console.log('\x1b[1m🛡️  3. РЕГЛАМЕНТ ИЗМЕНЕНИЙ И ГЕЙТЫ КАЧЕСТВА (CODE POLICY & KISS):\x1b[0m');
  console.log('   - 🧠 \x1b[33mИзначальная лаконичность (KISS)\x1b[0m: Агенты обязаны вносить минимально возможные');
  console.log('     изменения в кодовую базу. Минимум строк, минимум функций, максимальная опора на RAG.');
  console.log('   - 🔒 \x1b[33mЗащита стабильного легаси-кода\x1b[0m: Автоматический рефакторинг старых файлов запрещен.');
  console.log('     Любое изменение старого кода требует Conscious Agreement (ручного согласия [Y/N] разработчика).');
  console.log('   - ✨ \x1b[33mАвто-оптимизация новых файлов\x1b[0m: Новые файлы, созданные ИИ в процессе выполнения');
  console.log('     задачи, автоматически упрощаются и приводятся к лаконичному виду.');
  console.log('   - 🧪 \x1b[33mБезопасность рантайма (Mechanical Rollback)\x1b[0m: Перед упрощением создается снапшот.');
  console.log('     Если после оптимизаций падают авто-тесты — система мгновенно возвращает исходный рабочий код.\n');

  console.log('\x1b[35m----------------------------------------------------------------------\x1b[0m\n');
}

export async function runSetupWizard(interactive = true, defaults = {}) {
  console.log('\n======================================================================');
  console.log('🚀  🤖  Captain OS - Интерактивный Мастер Настройки  🤖  🚀');
  console.log('======================================================================\n');
  console.log('Привет! Этот мастер поможет быстро развернуть Captain OS на вашем проекте.');
  console.log('Система полностью универсальна, независима от моделей (LLM-agnostic) и');
  console.log('автоматически делает Капитаном ту модель, через которую вы начали сессию!\n');

  const env = checkRuntimeEnvironment();
  console.log('🔍 Анализ рантайм-окружения на хост-машине:');
  console.log(`   - Node.js: ${env.node ? '✅ Доступен' : '❌ Не найден (рекомендуется установить)'}`);
  console.log(`   - Bun:     ${env.bun ? '✅ Доступен (рекомендуется для сверхбыстрой работы)' : '⚠️ Не найден (используем Node.js)'}`);
  console.log(`   - Выбран рантайм по умолчанию: \x1b[36m${env.preferred.toUpperCase()}\x1b[0m\n`);

  const rl = interactive
    ? readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
    : null;

  try {
    // 1. Имя проекта
    let projectName = defaults.projectName || 'universal-project';
    if (rl) {
      const ans = await askQuestion(rl, `📦 Имя вашего проекта [${projectName}]: `);
      if (ans.trim()) projectName = ans.trim();
    }

    // 2. Имя владельца
    let ownerName = defaults.ownerName || 'Anton';
    if (rl) {
      const ans = await askQuestion(rl, `👨‍💻 Имя главного разработчика/владельца [${ownerName}]: `);
      if (ans.trim()) ownerName = ans.trim();
    }

    // 3. Поддерживаемые LLM модели
    let runtimesStr = defaults.runtimes?.join(', ') || 'gemini-3.1-pro, claude-4.7, codex-5.3, gpt-5.5';
    if (rl) {
      console.log('\n🧠 Какие языковые модели (LLMs) вы планируете запускать на этой машине?');
      console.log('   У нас действует Dynamic Captain Mode: кто первый запущен — тот и Капитан!');
      console.log('   Варианты: gemini-3.1-pro, claude-4.7, codex-5.3, gpt-5.5');
      const ans = await askQuestion(rl, `   Укажите поддерживаемые модели через запятую [${runtimesStr}]: `);
      if (ans.trim()) runtimesStr = ans.trim();
    }
    const runtimes = runtimesStr.split(',').map((r) => r.trim()).filter(Boolean);

    // 4. Директории для RAG
    let ragPathsStr = defaults.ragPaths?.join(', ') || 'src, docs';
    if (rl) {
      console.log('\n📚 Откуда строить локальную базу знаний RAG по документации и исходникам?');
      const ans = await askQuestion(rl, `   Укажите директории через запятую [${ragPathsStr}]: `);
      if (ans.trim()) ragPathsStr = ans.trim();
    }
    const ragPaths = ragPathsStr.split(',').map((p) => p.trim()).filter(Boolean);

    // 5. Путь к реестру ремонта
    let ledgerPath = defaults.ledgerPath || '.ship/repair-ledger.json';
    if (rl) {
      const ans = await askQuestion(rl, `🛠️ Путь к реестру дефектов/ремонта (.ship/repair-ledger.json) [${ledgerPath}]: `);
      if (ans.trim()) ledgerPath = ans.trim();
    }

    // 6. Согласие на использование Git для issues
    let useGitForIssues = true;
    if (rl) {
      console.log('\n📝 Использование Git-трекера для задач (Issues)');
      console.log('   Мы можем записывать и синхронизировать все issues/задачи прямо в Git-историю,');
      console.log('   чтобы гарантировать чистоту проекта и не замусоривать его внешними трекерами.');
      const ans = await askQuestion(rl, `   Использовать Git-трекер для issues? (y/n) [y]: `);
      if (ans.trim().toLowerCase() === 'n' || ans.trim().toLowerCase() === 'no') {
        useGitForIssues = false;
      }
    }

    // Вывод Пользовательского соглашения и Правил работы
    if (rl) {
      printUserAgreement(projectName, ownerName, runtimes, ragPaths, ledgerPath, useGitForIssues);
      const agree = await askQuestion(rl, '📝 Вы согласны со способом работы Captain OS и готовы ее запустить? (y/n) [y]: ');
      if (agree.trim().toLowerCase() === 'n' || agree.trim().toLowerCase() === 'no') {
        console.log('\n❌ Инициализация отменена. Управляющее ядро Captain OS не запущено. 👋\n');
        rl.close();
        return;
      }
    }

    console.log('\n💾 Генерация конфигурационных файлов...');

    const configDir = resolve(process.cwd(), '.captain-os');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Генерация project.yaml
    const projectYamlContent = `schemaVersion: captain-project.v1
captainOsVersion: 0.1.0-local-p11a
mode: shadow
ownerName: ${ownerName}
projectName: ${projectName}
tracking: REPAIR-20260520-CAPTAIN-DYNAMIC-SETUP

runtimes:
  strategy: dynamic_session_first  # Капитаном становится модель, которая первая запустила текущую сессию
  primaryOptions:
${runtimes.map((r) => `    - ${r}`).join('\n')}
  reviewers:
    - claude-4.7
  optionalJudges:
    - gemini-3.1-pro

readinessCriteria:
  projectManifest: 20
  adaptersConfigured: 20
  ragIndexed: 20
  ledgerAndFermatActive: 20
  evidenceGatesLive: 20

sourceOfTruth:
  strategic: docs
  actionable: github
  evidence: local_ship
  useGitForIssues: ${useGitForIssues}

paths:
  repairLedger: ${ledgerPath}
  labRuns: .ship/lab/runs
  brain: .brain
  processDocs: docs/process
  captainOsDocs: docs/process/captain-os-lab
  productDocs: docs
  runtimeScripts: scripts/captain-lab
  ragSources:
${ragPaths.map((p) => `    - ${p}`).join('\n')}

swarmRuntime:
  defaultExecutionModel: parallel_lane_swarm
  captainRole: orchestrator
  laneMemory: required_for_tier2_plus
  scoreGate:
    minScore: 9
    captainImplementationShareMax: 0.5
    reviewWindowMinutes: 30
    command: captain-os swarm-score
  activeLaneTarget:
    min: 2
    max: 4
  maxCaptainChildren: 5
  standingReviewLane: claude-code
  starpomLane: required_before_final_claim

operatorDecisionInterrupt:
  protocol: docs/protocols/operator-decision-interrupt.md
  appliesTo:
    - production
    - opening
    - indexing
    - deploy
    - gsc
    - sitemap
    - crawler_visibility
  ownerChoicesRequired:
    min: 2
    max: 3
  defaultOnBlocker: blocked_waiting_owner
  adjacentPlanningDefaultAllowed: false
  adjacentPlanningBypass:
    requiresOwnerApproval: true
    requiresTimebox: true
    requiresVisibleWarning: true
  blockedButContinuingBudget:
    maxPlanningOnlyPackets: 2
    maxHoursWithoutOwnerDecision: 2
  seoProductionSuccessEvidence:
    - raw_html
    - rendered_html
    - canonical
    - robots
    - h1
    - sitemap
  http200SuccessAllowed: false

managedBlocks:
  - AGENTS.md#captain-os-managed
  - CLAUDE.md#captain-os-managed
  - GEMINI.md#captain-os-managed

protectedPaths:
  - src/**
  - production/**
  - .env*
  - ${ledgerPath}
  - .brain/**

localRules:
  language: ru
  maxCaptainChildren: 5
  simpleTaskMode: lightweight
  dangerZones:
    - direct_user_question
    - anger_incident
    - screenshot_visual_acceptance
    - final_claim
    - security_public_boundary
    - accepted_full_claim

evidencePolicy:
  writeArtifactsToProject: true
  writeArtifactsToOsRepo: false
  requireScrubBeforePromotionToCore: true
  globalBlockingEnabled: false
  productAcceptedFullAllowed: false
`;

    // Записываем файл project.yaml
    writeFileSync(resolve(configDir, 'project.yaml'), projectYamlContent, 'utf8');
    console.log(`✅ Создан манифест проекта: .captain-os/project.yaml`);

    const today = new Date().toISOString().slice(0, 10);
    const taskSpineContent = `schemaVersion: captain-task-spine.v1
spineId: ${projectName.toUpperCase().replace(/[^A-Z0-9]+/g, '-') || 'HOST'}-SPINE
status: active
mode: shadow
updatedAt: "${today}"
owner: captain-codex

goal: >
  Keep one durable task spine while allowing multiple bounded active lanes
  with persistent lane memory.

currentLanes:
  mode: single_spine_multi_lane
  captainRole: orchestrator
  maxDirectCaptainLanes: 5
  officerSplitRequired: false
  swarmScoreGate:
    minScore: 9
    captainImplementationShareMax: 0.5
    reviewWindowMinutes: 30
    command: captain-os swarm-score
    currentScore: null
    currentVerdict: not_swarm
  swarmCapacity:
    maxOpenAgentThreads: 3
    onThreadLimit: close_finished_lanes_then_retry
    closeRequires:
      - lane delta captured
      - lane memory updated
      - evidence refs attached or blocker recorded
    lastThreadLimitAt: null
    closeAgentsAttempted: false
    retrySpawnScheduled: false
  active:
    - captain-orchestration

deliveryCalibration:
  projectStage: planning
  outcomeUnit: bounded next delivery packet
  deliveryShareTarget: 0.25
  qualityShareTarget: 0.35
  safetyShareTarget: 0.2
  processBudgetMax: 0.45
  maxPlanningOnlyCycles: 2
  minClosedOutcomesPerCycle: 0
  namedDeliverableRequired: false
  gateCommand: captain-os delivery-calibration
  currentVerdict: not_checked
  blocks: []
  nextAction: Name the next 1-3 deliverables/pages/cohorts before switching to delivery or launch_opening.
  currentCycle:
    id: bootstrap_planning_cycle
    processShare: 0.35
    deliveryShare: 0.25
    qualityShare: 0.35
    safetyShare: 0.2
    namedDeliverables:
      - bootstrap task spine
    closedOutcomes: []
    outcomeRows:
      - target=bootstrap task spine;type=artifact;status=not_ready_with_exact_blocker;issueRefs=bootstrap;reportRefs=.captain-os/task-spine.yaml;owner=captain-codex;nextAction=choose first delivery packet
    planningOnlyCycles: 0
    falseGreenRisk: false
    safetyEvidenceRefs: []
    qualityEvidenceRefs:
      - task spine bootstrap
    ownerDecisionRequired: false
    adjacentWorkActive: false
    nextActionBound: true
    reportingAttachedToOutcomes: true

laneStates:
  - laneId: captain-orchestration
    title: Captain orchestration and synthesis
    ownerRegistryId: captain-codex
    runtimeId: codex
    laneMode: persistent_owner
    status: active
    assignmentId: ASSIGN-BOOTSTRAP-CAPTAIN
    heartbeatAt: "${today}"
    staleAfterMinutes: 1440
    allowedScope:
      - .captain-os/**
      - .ship/lab/runs/**
    forbiddenScope:
      - .env*
      - secrets/**
    locks: []
    dependencies: []
    conflictsWith: []
    contextRefs:
      - .captain-os/project.yaml
      - .captain-os/runtime-adapters.yaml
    contextBudgetRefs:
      - captain-summary
      - scoped-source-docs
    laneMemoryRef: .captain-os/task-spine.yaml#laneMemory.captain-orchestration
    acceptanceRows:
      - Task has a declared execution model before Tier 2+ implementation.
    evidenceOwed:
      - Updated task spine and linked evidence refs.
    evidenceRefs: []
    lastDelta: ""
    decisions: []
    openQuestions: []
    blockers: []
    nextAction: Classify the next task and choose single_lane or parallel_lane_swarm.
    closeoutCriteria:
      - All lane deltas merged or explicitly rejected.
      - Evidence refs attached for completed rows.
    transferCriteria:
      - New captain can continue from currentLanes, laneStates, and laneMemory.

laneMemory:
  captain-orchestration:
    persistentSummary: Bootstrap lane for Captain orchestration and synthesis.
    decisions: []
    openQuestions: []
    blockers: []
    evidenceRefs: []
    lastTouchedAt: "${today}"
    continuationPrompt: Read this spine, then continue from laneStates[].nextAction.
`;
    writeFileSync(resolve(configDir, 'task-spine.yaml'), taskSpineContent, 'utf8');
    console.log(`✅ Создан task spine с lane memory: .captain-os/task-spine.yaml`);

    const ownerRegistryContent = `schemaVersion: captain-owner-registry.v1
owners:
  - ownerRegistryId: captain-codex
    runtimeId: codex
    role: primary_captain
    lockIdentity: codex
    canMutate: true
    canFinalClaim: true
  - ownerRegistryId: captain-claude
    runtimeId: claude-code
    role: peer_captain_or_read_only_reviewer
    lockIdentity: claude-code
    canMutate: packet_only
    canFinalClaim: true
  - ownerRegistryId: captain-gemini
    runtimeId: gemini-coding
    role: peer_captain_or_read_only_judge
    lockIdentity: gemini-coding
    canMutate: packet_only
    canFinalClaim: true
  - ownerRegistryId: starpom
    runtimeId: process
    role: quality_auditor
    lockIdentity: starpom
    canMutate: false
    canFinalClaim: false
`;
    writeFileSync(resolve(configDir, 'owner-registry.yaml'), ownerRegistryContent, 'utf8');
    console.log(`✅ Создан реестр владельцев: .captain-os/owner-registry.yaml`);

    const lockfileContent = `{
  "schemaVersion": "captain-os-lock.v1",
  "captainOsVersion": "0.1.0-local-p11a",
  "projectName": ${JSON.stringify(projectName)},
  "createdAt": ${JSON.stringify(today)},
  "globalBlockingEnabled": false,
  "productAcceptedFullAllowed": false
}
`;
    writeFileSync(resolve(configDir, '../.captain-os.lock.json'), lockfileContent, 'utf8');
    console.log(`✅ Создан lockfile: .captain-os.lock.json`);

    // Генерация runtime-adapters.yaml с поддержкой всех указанных моделей
    let adaptersContent = `schemaVersion: captain-runtime-adapters.v1
project: ${projectName}
defaultMode: shadow

adapters:
`;

    if (runtimes.includes('gemini-3.1-pro') || runtimes.includes('gemini-coding') || runtimes.includes('gemini')) {
      adaptersContent += `  - runtimeId: gemini-3.1-pro
    ownerRegistryId: captain-gemini
    instructionEntrypoint: GEMINI.md
    captainEligibility: dynamic
    defaultRole: captain_first
    swarmRole: optional_judge_or_packeted_lane
    capabilities:
      readFiles: true
      writeFiles: true
      shell: true
      git: true
      browserScreenshots: true
      webSearch: true
      mcpConnectors: true
      structuredJson: true
      longContext: true
      backgroundParallelism: true
    constraints:
      mutationPolicy: allowed
      approvalPolicy: operator_required
      secretPolicy: no_public_exposure
      contextBudget: scoped_only
    captainOsHooks:
      modeClassifier: manual
      p10DangerStops: manual
      contextRadius: supported
      finalClaimGate: supported
      evidenceAggregation: manual
      agentLaneLifecycle: manual

`;
    }

    if (runtimes.includes('claude-4.7') || runtimes.includes('claude-code') || runtimes.includes('claude')) {
      adaptersContent += `  - runtimeId: claude-4.7
    ownerRegistryId: captain-claude
    instructionEntrypoint: CLAUDE.md
    captainEligibility: dynamic
    defaultRole: captain_first
    swarmRole: standing_review_lane
    capabilities:
      readFiles: true
      writeFiles: true
      shell: true
      git: true
      browserScreenshots: true
      webSearch: true
      mcpConnectors: true
      structuredJson: true
      longContext: true
      backgroundParallelism: true
    constraints:
      mutationPolicy: allowed
      approvalPolicy: operator_required
      secretPolicy: no_public_exposure
      contextBudget: scoped_only
    captainOsHooks:
      modeClassifier: manual
      p10DangerStops: supported
      contextRadius: supported
      finalClaimGate: supported
      evidenceAggregation: manual
      agentLaneLifecycle: handoff_required

`;
    }

    if (runtimes.includes('codex-5.3') || runtimes.includes('codex')) {
      adaptersContent += `  - runtimeId: codex-5.3
    ownerRegistryId: captain-codex
    instructionEntrypoint: AGENTS.md
    captainEligibility: dynamic
    defaultRole: captain_first
    swarmRole: orchestrator_and_integrator
    capabilities:
      readFiles: true
      writeFiles: true
      shell: true
      git: true
      browserScreenshots: true
      webSearch: true
      mcpConnectors: true
      structuredJson: true
      longContext: true
      backgroundParallelism: true
    constraints:
      mutationPolicy: allowed
      approvalPolicy: none
      secretPolicy: no_public_exposure
      contextBudget: scoped_only
    captainOsHooks:
      modeClassifier: supported
      p10DangerStops: supported
      contextRadius: supported
      finalClaimGate: supported
      evidenceAggregation: supported
      agentLaneLifecycle: supported

`;
    }

    if (runtimes.includes('gpt-5.5') || runtimes.includes('gpt') || runtimes.includes('openai')) {
      adaptersContent += `  - runtimeId: gpt-5.5
    ownerRegistryId: captain-gpt
    instructionEntrypoint: AGENTS.md
    captainEligibility: dynamic
    defaultRole: captain_first
    swarmRole: orchestrator_and_integrator
    capabilities:
      readFiles: true
      writeFiles: true
      shell: true
      git: true
      browserScreenshots: true
      webSearch: true
      mcpConnectors: true
      structuredJson: true
      longContext: true
      backgroundParallelism: true
    constraints:
      mutationPolicy: allowed
      approvalPolicy: none
      secretPolicy: no_public_exposure
      contextBudget: scoped_only
    captainOsHooks:
      modeClassifier: supported
      p10DangerStops: supported
      contextRadius: supported
      finalClaimGate: supported
      evidenceAggregation: supported
      agentLaneLifecycle: supported

`;
    }

    writeFileSync(resolve(configDir, 'runtime-adapters.yaml'), adaptersContent, 'utf8');
    console.log(`✅ Создана конфигурация адаптеров: .captain-os/runtime-adapters.yaml`);

    const pm = detectPackageManager();
    const indexCmd = pm === 'bun' ? 'bun run brain:index' : `${pm} run brain:index`;
    const readinessCmd = 'npx captain-os doctor';

    console.log('\n🎉 Онбординг-настройка Captain OS успешно завершена!');
    console.log(`Чтобы проверить статус готовности вашей ОС, вы можете запустить:\n  \x1b[36m${readinessCmd}\x1b[0m\n`);

    if (rl) {
      const runIndex = await askQuestion(rl, '⚡ Хотите прямо сейчас запустить индексацию RAG базы знаний? (y/n) [y]: ');
      if (!runIndex.trim() || runIndex.trim().toLowerCase() === 'y' || runIndex.trim().toLowerCase() === 'yes') {
        console.log(`\nИндексируем базу знаний (${indexCmd})...`);
        try {
          execSync(indexCmd, { stdio: 'inherit' });
          console.log('\n✅ База знаний успешно проиндексирована!');
        } catch (e) {
          console.warn(`\n⚠️ Не удалось запустить индексацию RAG автоматически. Вы можете запустить её вручную позже: ${indexCmd}`);
        }
      }
    }
  } catch (err) {
    console.error('❌ Ошибка во время работы setup wizard:', err);
  } finally {
    if (rl) rl.close();
  }
}

// Запуск при прямом вызове
const isMainFile = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isMainFile) {
  runSetupWizard(true);
}
