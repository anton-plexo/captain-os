# 🚀 Captain OS: Руководство по быстрому развертыванию

Это краткое руководство поможет вам запустить Captain OS на вашем проекте менее чем за 2 минуты.

---

## 📦 Способ 1: Быстрая инициализация через `npx` (Рекомендуется)

Если вы хотите развернуть Captain OS на любом существующем проекте без глобальной установки пакета, просто выполните в корне проекта:

```bash
npx -y captain-os init
```

### Что произойдет?
1. Мастер автоматически определит ваш пакетный менеджер (`npm`, `bun`, `pnpm`, `yarn`).
2. Предложит ввести имя проекта и владельца.
3. Поможет выбрать языковые модели для **Dynamic Captain Mode**.
4. Сгенерирует файлы конфигурации `.captain-os/project.yaml`, `.captain-os/runtime-adapters.yaml`, `.captain-os/owner-registry.yaml`, `.captain-os/task-spine.yaml` и `.captain-os.lock.json`.
5. Предложит проиндексировать локальный RAG.

---

## 🛠️ Способ 2: Глобальная установка в систему

Для постоянного использования CLI-команд Captain OS в терминале установите пакет глобально:

```bash
npm install -g captain-os
```

После этого вам будут доступны следующие команды:

### 1. Первичная настройка
```bash
captain-os init
```
*Запускает интерактивный мастер настройки проекта.*

### 2. Проверка здоровья окружения (Doctor)
```bash
captain-os doctor
```
*Сканирует систему на наличие необходимых конфигов, базы знаний RAG, локфайлов и выводит красивый цветной прогресс-бар готовности.*

### 3. Проверка дисциплины swarm
```bash
captain-os swarm-score
```
*Проверяет P11H/P11L 9/10 swarm runtime: Captain не должен быть главным исполнителем, нужны свежие lane artifacts, Claude/StarPom freshness, agent thread lifecycle при лимите тредов, outcome binding для issue/reporting и отсутствие SEO/opening false-green.*

### 4. Проверка delivery calibration
```bash
captain-os delivery-calibration
```
*Если в проекте есть `.captain-os/task-spine.yaml`, проверяет live `deliveryCalibration.currentCycle`: delivery/launch не могут считаться прогрессом без named outcomes, evidence и process budget.*

### 5. Управление снимками конфигурации (Snapshots)
### 5. P11L packet при лимите агентских тредов
```bash
captain-os agent-lane-lifecycle --outcomes /data/map,/data/smart-money --pr "#681"
```
*Генерирует bounded corrective packet: сохранить lane memory, закрыть recyclable threads, retry spawn и привязать issue/reporting к outcome rows.*

### 6. Управление снимками конфигурации (Snapshots)
Captain OS позволяет делать резервные копии локального состояния ИИ-агента для быстрого отката в случае ошибок:
```bash
# Сохранить текущее состояние
captain-os snapshot save "Перед началом рефакторинга авторизации"

# Посмотреть список всех сохраненных снимков
captain-os snapshot list

# Откатить конфигурацию к последнему снимку
captain-os rollback --last

# Откатить конфигурацию к конкретному снимку по ID
captain-os rollback SNAP-20260520-XXXX
```

---

## 💡 Полезные советы для разработчиков

* **Advisory Режим (по умолчанию)**: Captain OS разворачивается в мягком режиме `shadow`. Она не блокирует ваши коммиты и файлы принудительно, а дает теплые, дружелюбные подсказки в консоли. Вы можете переключить режим на жесткий `blocking` в файле `.captain-os/project.yaml` только тогда, когда будете на 100% уверены в готовности всей команды.
* **Индексация базы знаний RAG**: Для того чтобы ИИ-агенты могли качественно ориентироваться в ваших исходных кодах, не забывайте периодически переиндексировать базу:
  ```bash
  # Если используется bun
  bun run brain:index
  
  # Если используется npm
  npm run brain:index
  ```
* **Совместимость с Git**: Все создаваемые файлы в папке `.captain-os/` (за исключением персональных секретов и локальных дампов логов в `.ship/`) рекомендуется закоммитить в ваш репозиторий. Это позволит вашей команде разработчиков мгновенно получить настроенную среду агентов сразу после клонирования проекта!
* **Swarm flow без потери памяти**: Для сложных задач Captain OS использует один `.captain-os/task-spine.yaml`, но внутри него ведет несколько `laneStates`. Это позволяет запускать независимые агентские дорожки параллельно и не терять их контекст между one-shot запусками. Если работа называется swarm, проверяйте ее через `captain-os swarm-score`.
* **Agent thread limit без потери контекста**: если рантайм уперся в лимит агентских тредов, сначала перенесите closeout delta, lane memory и issue/outcome/evidence refs в `.captain-os/task-spine.yaml`, затем закрывайте finished lanes и пробуйте следующий bounded spawn.
* **Delivery без process-loop**: В delivery/launch стадиях обновляйте `deliveryCalibration.currentCycle` перед claim и проверяйте `captain-os delivery-calibration`; `fail_recalibrate` означает, что следующий packet должен вернуться к named outcomes.
