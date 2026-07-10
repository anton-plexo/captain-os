import readline from 'node:readline';

/**
 * Классифицирует намерение пользователя (L1/L2 Semantic Router).
 * Если намерение простое - возвращает 'FAST_PATH', иначе 'DEEP_PATH'.
 * 
 * @param {string} intent 
 * @returns {string} 'FAST_PATH' | 'DEEP_PATH'
 */
export function classifyIntent(intent) {
  if (!intent || intent.trim().length === 0) {
    return 'FAST_PATH'; // Пустой запрос не требует архитектурного планирования
  }

  const complexKeywords = [
    'спроектируй', 'архитектур', 'перепиши', 'рефакторинг', 
    'миграци', 'интеграци', 'модуль', 'фреймворк', 'баз', 'schema'
  ];

  const lowerIntent = intent.toLowerCase();

  // Если запрос слишком длинный, скорее всего это сложное ТЗ
  if (intent.length > 80) {
    return 'DEEP_PATH';
  }

  // Если запрос содержит архитектурные маркеры
  for (const keyword of complexKeywords) {
    if (lowerIntent.includes(keyword)) {
      return 'DEEP_PATH';
    }
  }

  // В остальных случаях считаем задачу тривиальной
  return 'FAST_PATH';
}

/**
 * Запрашивает явное подтверждение у пользователя (Explicit Gate).
 * @param {string} message 
 * @returns {Promise<boolean>}
 */
export function askExplicitGate(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(`\n${message} [Y/N]: `, (answer) => {
      rl.close();
      const isYes = answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
      resolve(isYes);
    });
  });
}
