#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function findRootCwd(startDir) {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, '.git')) || fs.existsSync(path.join(current, '.captain-os'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return startDir;
}

const rootCwd = findRootCwd(process.cwd());
if (rootCwd !== process.cwd()) {
  process.chdir(rootCwd);
}

import { createSnapshot, rollbackSnapshot, listSnapshots } from './snapshot-engine.js';
import { printReadinessConsole } from './readiness-eval.js';
import { runSetupWizard } from './setup-wizard.js';
import { runValidator } from './lock-validator.js';
import { executeSimplificationPipeline } from './simplifier.js';
import { runConfigureWizard } from './configure-wizard.js';
import { runFormulateWizard } from './formulate.js';
import { classifyIntent } from './intent-router.js';
import { runSwarmRuntimeScoreCommand } from './swarm-runtime-score.js';
import { runDeliveryCalibrationCommand } from './delivery-calibration.js';
import { runAgentLaneLifecycleCommand } from './agent-lane-lifecycle.js';

const command = process.argv[2] || 'help';

if (command === 'doctor') {
  printReadinessConsole();
} else if (command === 'formulate') {
  const isDryRun = process.argv.includes('--dry-run');
  const rawArgs = process.argv.slice(3).filter(arg => arg !== '--dry-run' && !arg.startsWith('-'));
  const directIntent = rawArgs.join(' ').trim();

  if (directIntent && !isDryRun) {
    const route = classifyIntent(directIntent);
    if (route === 'FAST_PATH') {
      console.log('\n\x1b[32m🚀 [FAST_PATH]\x1b[0m Классификатор определил задачу как тривиальную (Low Blast Radius).');
      console.log(`Задача: "${directIntent}"`);
      // Direct-executor handoff is not implemented yet. Until it is, fall through
      // to the wizard instead of exiting 0 with no output (which read as a silent success).
      console.log('Прямой вызов исполнителя пока не реализован — генерирую DDP-манифест через Goal Formulator.');
      runFormulateWizard(!isDryRun, directIntent, true).catch(e => {
        console.error('❌ Ошибка работы Goal Formulator:', e.message);
        process.exit(1);
      });
    } else {
      console.log('\n\x1b[33m🧠 [DEEP_PATH]\x1b[0m Обнаружена архитектурная задача (High/Medium Blast Radius).');
      console.log('Вызов Goal Formulator для генерации DDP-манифеста...');
      runFormulateWizard(!isDryRun, directIntent, true).catch(e => {
        console.error('❌ Ошибка работы Goal Formulator:', e.message);
        process.exit(1);
      });
    }
  } else {
    runFormulateWizard(!isDryRun, directIntent, false).catch(e => {
      console.error('❌ Ошибка работы Goal Formulator:', e.message);
      process.exit(1);
    });
  }
} else if (command === 'configure') {
  const isDryRun = process.argv.includes('--dry-run');
  runConfigureWizard(!isDryRun);
} else if (command === 'init') {
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('⚡ Запуск мастера настройки в режиме dry-run (неинтерактивный)...');
    runSetupWizard(false);
  } else {
    runSetupWizard(true);
  }
} else if (command === 'validate-lock' || command === 'check-lock') {
  runValidator();
} else if (command === 'swarm-score' || command === 'swarm:score') {
  process.exitCode = runSwarmRuntimeScoreCommand(process.argv.slice(3));
} else if (command === 'delivery-calibration' || command === 'delivery:calibration') {
  process.exitCode = runDeliveryCalibrationCommand(process.argv.slice(3));
} else if (command === 'agent-lane-lifecycle' || command === 'lane-lifecycle') {
  process.exitCode = runAgentLaneLifecycleCommand(process.argv.slice(3));
} else if (command === 'simplify') {
  const isDryRun = process.argv.includes('--dry-run');
  executeSimplificationPipeline(process.cwd(), isDryRun).catch(e => {
    console.error('❌ Конвейер SimplifyCode завершился с ошибкой:', e.message);
    process.exit(1);
  });
} else if (command === 'snapshot' || command === 'snapshots') {
  const subCommand = process.argv[3];
  if (subCommand === 'save' || subCommand === '--save') {
    const description = process.argv[4] || '';
    createSnapshot(process.cwd(), description);
  } else if (subCommand === 'list' || subCommand === '--list' || !subCommand) {
    listSnapshots(process.cwd());
  } else {
    console.log('Usage: npx captain-os snapshot [list | save "Description"]');
  }
} else if (command === 'rollback') {
  const targetId = process.argv[3] || '--last';
  rollbackSnapshot(process.cwd(), targetId);
} else {
  console.log('=== Captain OS CLI ===');
  console.log('Available commands:');
  console.log('  init                 - Initialize project workspace (add --dry-run for non-interactive)');
  console.log('  configure            - Run interactive prompt-wizard to customize project rules');
  console.log('  formulate            - Generate perfect DDP goals from simple user inputs');
  console.log('  doctor               - Check environment health and readiness');
  console.log('  swarm-score          - Run P11H swarm 9/10 runtime score gate');
  console.log('  delivery-calibration - Run live task-spine delivery calibration gate (--fixtures for core simulations)');
  console.log('  agent-lane-lifecycle - Generate a P11L thread-limit closeout/recycle corrective packet');
  console.log('  validate-lock        - Validate .captain-os.lock.json structure and policies');
  console.log('  simplify             - Run code simplification pipeline (add --dry-run for preview)');
  console.log('  snapshot list        - List all saved snapshots');
  console.log('  snapshot save "desc" - Create a new configuration snapshot');
  console.log('  rollback [id]        - Restore a specific snapshot (default: last)');
}
