# 📦 🤖 Captain OS: Universal AI Coding Agent Core & Workspace Guard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.1.0--local--p11a-blue.svg)]()
[![LLM-Agnostic](https://img.shields.io/badge/LLM-Agnostic-success.svg)]()
[![Status](https://img.shields.io/badge/Status-p11a__core__ready-green.svg)]()

> **Captain OS** — это универсальная, переносимая и независимая от моделей (LLM-agnostic) мета-операционная система для автономных ИИ-агентов (Gemini, Claude, OpenAI/Codex). Она превращает обычный репозиторий кода в структурированную, защищенную от сбоев среду выполнения задач с замкнутым контуром контроля качества (Closed-Loop Quality Control).

---

## 🗺️ Оглавление (Table of Contents)
- [🏎️ Как это устроено: Понятная концепция за 1 минуту (Автомобильная аналогия)](#️-как-это-устроено-понятная-концепция-за-1-минуту-автомобильная-аналогия)
- [🗺️ Техническая Архитектура & Компоненты (Core Architecture)](#️-техническая-архитектура--компоненты-core-architecture)
- [🔄 Сквозной поток данных: Синергия факторов (Closed-Loop Data Pipeline)](#-сквозной-поток-данных-синергия-факторов-closed-loop-data-pipeline)
- [🐝 Swarm Development Runtime](#-swarm-development-runtime)
- [⚖️ Delivery Calibration Runtime](#️-delivery-calibration-runtime)
- [🛑 Operator Decision Interrupt](#-operator-decision-interrupt)
- [🌊 Жизненный цикл изменений & 13 Гейтов Качества (Quality Gates Workflow)](#-жизненный-цикл-изменений--13-гейтов-качества-quality-gates-workflow)
- [⚙️ Интерактивная кастомизация и Prompt-опросник (Customization Protocol)](#️-интерактивная-кастомизация-и-prompt-опросник-customization-protocol)
- [🧠 Dynamic Captain Mode (Динамический выбор Капитана)](#-dynamic-captain-mode-динамический-выбор-капитана)
- [🪚 Aerospace-Grade SimplifyCode Pipeline (Садоводство Кода)](#-aerospace-grade-simplifycode-pipeline-садоводство-кода)
- [🧙‍♂️ Быстрый старт & Интерактивный онбординг (init / setup)](#️-быстрый-старт--интерактивный-онбординг-init--setup)
- [🛠️ Архитектурные компоненты в репозитории](#️-архитектурные-компоненты-в-репозитории)
- [📦 GitHub-интеграция из коробки (Git & GitHub Integration)](#-github-интеграция-из-коробки-git--github-integration)
- [📄 Лицензия](#-лицензия)

---

## 🏎️ Как это устроено: Понятная концепция за 1 минуту (Автомобильная аналогия)

Чтобы с первого взгляда понять, как взаимодействуют модули **Captain OS** с вашим проектом, представьте себе автомобиль, где каждый технический узел выполняет свою строго определенную задачу:

```mermaid
graph TD
    Ignition["🔑 1. СИСТЕМА ЗАЖИГАНИЯ (Локальные коннекторы & CLI)"]
    
    subgraph EngineBlock["🧠 2. ДВИГАТЕЛЬ & КОМПЬЮТЕР (Ядро Captain OS)"]
        Engine["⚙️ Центральный Блок (Блокировки, Задачи)"]
        Telemetry["📊 Телеметрия (StarPom, датчики дрифта & качества)"]
        Engine --> Telemetry
    end
    
    Gearbox["⚙️ 3. КОРОБКА ПЕРЕДАЧ (Стейт-машина задач)"]
    Tank["⛽ 4. РЕЕСТР РЕМОНТА / БЕНЗОБАК (Контекст, RAG-база, Реестр качества)"]
    
    subgraph DriveTrain["🏎️ 5. ТРАНСМИССИЯ, ПОДВЕСКА & КОЛЕСА"]
        DriveMode{"🔌 Выбор привода"}
        2WD["Передний привод (2WD - Внутренние агенты главной ЛЛМ)"]
        AWD["Полный привод (AWD - Подключение доп. оси & внешних ЛЛМ)"]
        Wheels["🏎️ Колеса (Внесение изменений на хосте)"]
        
        DriveMode -->|"Легкий путь / Локально"| 2WD
        DriveMode -->|"Бездорожье / Сложный PR / Ревью"| AWD
        2WD --> Wheels
        AWD --> Wheels
    end

    Ignition -->|Запуск сессии| Engine
    
    %% Потоки из бензобака в двигатель (топливо, параметры и реестр)
    Tank -->|Рак-контекст, База знаний, Реестр качества, Сплэш-радиус| Engine
    
    %% Сигналы телеметрии обратно к приборам
    Telemetry -->|Данные о дрифте & качестве| Tank
    
    %% Передача усилия на коробку и далее колеса
    Engine -->|Координирует работу трансмиссии| Gearbox
    Gearbox -->|Управляет приводом| DriveMode
    Wheels -->|Вносит изменения в код| Road(["Рабочий проект / Дорога"])

    style Ignition fill:#fff3cd,stroke:#ffc107,color:#333
    style Engine fill:#e8f4fd,stroke:#4a90d9,color:#333
    style Telemetry fill:#e8f4fd,stroke:#4a90d9,color:#333
    style Gearbox fill:#e8f5e9,stroke:#28a745,color:#333
    style Tank fill:#f8f9fa,stroke:#6c757d,color:#333
    style DriveMode fill:#fce4ec,stroke:#c62828,color:#333
    style 2WD fill:#e8f5e9,stroke:#28a745,color:#333
    style AWD fill:#fff3cd,stroke:#ffc107,color:#333
    style Wheels fill:#e8f5e9,stroke:#28a745,color:#333
    style Road fill:#f5f5f5,stroke:#333,color:#333
    style EngineBlock fill:#e8f0fe,stroke:#004085,color:#333
    style DriveTrain fill:#fafafa,stroke:#6c757d,color:#333
```

### 1. 🔑 Система зажигания (Локальные коннекторы и CLI-стартер)
Это пусковой механизм. Когда вы открываете терминал или ИИ-ассистент начинает работу:
* Коннекторы считывают окружение и активируют **Dynamic Captain Mode**.
* Зажигание происходит независимо от того, какая модель за рулем — Gemini, Claude или Codex. Система сама определяет активного водителя и заводит двигатель.

### 2. 🧠 Двигатель & Бортовой Компьютер (Ядро Captain OS)
Двигатель — это центральный управляющий блок всей системы:
* Он считывает показания приборов (проверяет готовность системы через `Readiness Evaluator`).
* Предотвращает аварии и столкновения изменений (управляет блокировками файлов через `Lock Registry`).
* Координирует работу всех датчиков и дает команды другим узлам.
* **📊 Бортовая Телеметрия**: Фоновые агенты-наблюдатели (такие как StarPom и локальные сканеры дрифта). Они непрерывно считывают показатели системы, следят за здоровьем кодовой базы, чистотой архитектуры, замеряют уровень готовности системы и сигнализируют о любых отклонениях на приборную панель.

### 3. ⚙️ Коробка передач (Универсальная Стейт-машина)
Коробка передач отвечает за переключение скоростей и режимы движения (процесс выполнения задач):
* Знает универсальные переходы состояний задачи (`not_started -> in_progress -> review -> done -> merged`).
* Считывает текущее положение шестеренок из локального файла `.captain-os/task-spine.yaml` (spine-снимки) и переводит задачу на нужную "передачу" без риска сломать трансмиссию.

### 4. ⛽  Бензобак (Локальный контекст и RAG-база проекта)
Бензобак — это всё, что является локальной памятью, записями и топливом текущего проекта. Двигатель и коробка передач не сдвинутся с места без этого содержимого:
* **Топливо (RAG-база)**: Проиндексированный контекст исходного кода текущего проекта («Рак» / RAG).
* **Чертежи (.captain-os/project.yaml)**: Индивидуальные параметры (имя проекта, владельца, splash-радиус изменений).
* **Журнал поездки (.ship/repair-ledger.json)**: Список зарегистрированных багов для прохождения гейтов качества, куда телеметрия автоматически сбрасывает данные о неисправностях.

### 5. 🏎️  Трансмиссия, Подвеска & Колеса (Исполнительный рантайм изменений)
Этот узел отвечает за то, как крутящий момент от коробки передач переносится на дорожное покрытие (ваш локальный рабочий хост):
* **🏎️ Выбор привода (Распределение усилий ЛЛМ)**:
  * **Передний привод (2WD)**: Работает силами внутренних агентов главной ЛЛМ (активный Капитан, например Gemini). Идеально подходит для быстрой езды по ровной дороге — локальные правки, небольшие изолированные задачи, быстрое прототипирование.
  * **Полный привод (AWD/4WD) с жесткими блокировками**: Подключается автоматически при выезде на бездорожье — сложный междоменный рефакторинг, архитектурные изменения и прохождение гейтов. Включает дополнительные оси в виде внешних ЛЛМ (Claude-Code, Codex) для совместного планирования, перекрестного код-ревью и жесткого контроля качества изменений, исключая конфликты в кодовой базе.
* **Подвеска**: Отрабатывает неровности и выбоины на дороге (сложные баги, конфликты слияния веток, неожиданный дрифт структуры файлов).
* **Колеса**: Обеспечивают сцепление с дорогой и двигают весь проект вперед, превращая команды от двигателя в реальный рабочий прогресс и коммиты в Git.

---

## 🗺️ Техническая Архитектура & Компоненты (Core Architecture)

Captain OS функционирует как автономный слой абстракции над вашей кодовой базой и ЛЛМ-рантаймом, разделяя логику управления, контекст проекта и среду внесения изменений:

```mermaid
graph TD
    classDef engine fill:#e1f5fe,stroke:#03a9f4,stroke-width:2px,color:#333;
    classDef local fill:#efebe9,stroke:#5d4037,stroke-width:2px,color:#333;
    classDef lRuntime fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#333;
    classDef dev fill:#fffde7,stroke:#fbc02d,stroke-width:2px,color:#333;

    User([👨‍💻 Разработчик]) -->|"1. Запуск сессии / CLI"| CLI["⚡ CLI Engine<br>(init / doctor / simplify)"]:::dev
    
    subgraph CoreBlock["🧠 Глобальное Ядро Captain OS (Core Engine)"]
        CLI -->|Инициация| StateMachine["⚙️ Task Spine State Machine<br>(not_started -> merged)"]:::engine
        Locks["🔒 Lock Registry<br>(Менеджер блокировок ресурсов)"]:::engine
        ConflictDetector["⚠️ Conflict & Drift Detector"]:::engine
        Locks --> ConflictDetector
    end

    subgraph ProjectBlock["📂 Локальный Проект (Host Project Workspace)"]
        Manifest[".captain-os/project.yaml<br>(Манифест и правила проекта)"]:::local
        Spine[".captain-os/task-spine.yaml<br>(Спиннер выполнения задач)"]:::local
        Ledger[".ship/repair-ledger.json<br>(Реестр дефектов & телеметрия)"]:::local
        RAG["📚 Локальная RAG-база знаний<br>(Индекс кодовой базы)"]:::local
    end

    subgraph LLMRuntime["🤖 Среда Исполнения (LLM Adapters Runtime)"]
        Captain{"👑 Active Captain<br>(Dynamic Captain Mode)"}:::lRuntime
        Gemini["🟢 Captain Gemini (Local Active)"]:::lRuntime
        Claude["🟠 Captain Claude (Reviewer SLA)"]:::lRuntime
        Codex["🔵 Captain Codex (Task Spine Driver)"]:::lRuntime
        
        Captain --> Gemini
        Captain --> Claude
        Captain --> Codex
    end

    %% Связи
    Captain -->|"2. Загружает правила"| Manifest
    Captain -->|"3. Проверяет историю"| Spine
    Captain -->|"4. Блокирует файлы"| Locks
    Captain -->|"5. Пишет телеметрию"| Ledger
    Captain -->|"6. Извлекает контекст"| RAG
    
    StateMachine -->|"Координирует переходы"| Spine
    Locks -.->|"Защищает файлы во время работы"| WorkDir[("💻 Рабочая директория хоста")]:::local

    style User fill:#f5f5f5,stroke:#333,color:#333
    style WorkDir fill:#fafafa,stroke:#6c757d,color:#333
    style CoreBlock fill:#e8f0fe,stroke:#004085,color:#333
    style ProjectBlock fill:#fafafa,stroke:#6c757d,color:#333
    style LLMRuntime fill:#f0fff0,stroke:#28a745,color:#333
```

### 1. ⚡ CLI-Инфраструктура & Онбординг (CLI Engine & Setup Wizard)
Точка входа в Captain OS. Универсальные CLI-команды (`npx captain-os init`, `doctor`, `simplify`) позволяют быстро развернуть систему на любом новом проекте. CLI автоматически определяет окружение, пакетные менеджеры и настраивает конфигурации без прерывания рабочих процессов разработчика.

### 2. 🧠 Глобальное Ядро Мета-системы (Core Engine & Guard)
Центральный управляющий модуль, отвечающий за безопасность и бесконфликтность работы ИИ-агентов:
* **🔒 Lock Registry**: Блокирует файлы, находящиеся в активном Splash Radius выполняемой задачи. Предотвращает перезапись изменений другими сессиями или агентами.
* **⚠️ Conflict & Drift Detector**: Сканирует структуру файлов на наличие внешних ручных изменений, выявляя архитектурный дрейф до того, как код будет изменен ИИ.

### 3. 📂 Workspace-Среда Проекта (Host Workspace)
Локальный слой состояния, хранящийся непосредственно в Git вашего проекта. Гарантирует переносимость и восстанавливаемость сессий:
* **`task-spine.yaml`**: Снимок состояния текущих задач.
* **`repair-ledger.json`**: Машиночитаемый реестр дефектов, собирающий телеметрию (результаты тестов, сжатие кода, защиту от регрессии).
* **`project.yaml`**: Описывает манифест проекта, правила владения и допустимый Splash Radius.

### 4. 🤖 Ответ на ключевой вопрос: Где живет стейт-машина выполнения задач?

> **Важная архитектурная деталь:**
> Вся динамическая стейт-машина выполнения задач, спиннер выполнения (`task-spine.yaml`), лок-файлы (`captain-os.lock.json` / `active-locks.json`) и реестры качества (`repair-ledger.json`) **живут непосредственно внутри локального репозитория проекта (Host Project)**, а не в глобальном ядре Captain OS.
>
> **Почему это сделано именно так?**
> 1. **Data Integrity (Целостность данных)**: Состояние работы над конкретными задачами, заблокированные файлы и реестр багов — это неотъемлемая часть кодовой базы самого проекта. Они должны находиться в Git, версионироваться вместе с кодом и быть доступными любому другому разработчику при клонировании репозитория.
> 2. **Cross-Session Recovery (Восстановление сессий)**: Если сессия терминала упадет или вы переключитесь с Gemini на Claude, новый агент мгновенно прочитает `.captain-os/task-spine.yaml` и продолжит работу ровно с того места, где остановился предыдущий.
> 3. **Zero Telemetry & Privacy**: Все доказательства работы (evidence) и дампы остаются локальными в папке `.ship/lab/runs/`, исключая утечку коммерческих данных во внешние системы.

---

## 🔄 Сквозной поток данных: Синергия факторов (Closed-Loop Data Pipeline)

Связка компонентов Captain OS работает как единый шестереночный механизм, исключая человеческие ошибки и предотвращая регрессию:

```mermaid
graph TD
    Spine["📋 Task Spine / Issues<br>(Что делать?)"] -->|Определяет рамки задачи| RAG["📚 RAG-база & Context<br>(На что опираться?)"]
    RAG -->|Насыщает контекстом| Radius["🔍 Splash/Blast Radius<br>(Что безопасно менять?)"]
    Radius -->|Ограничивает область мутации| KISS["🧠 KISS Code & Git<br>(Минимальные изменения)"]
    KISS -->|Записывает телеметрию| Ledger["📊 Реестр ремонта / Ledger<br>(Где сохранить след?)"]
    Ledger -->|Обновляет статус| Spine

    style Spine fill:#f8f9fa,stroke:#6c757d,color:#333
    style RAG fill:#f8f9fa,stroke:#6c757d,color:#333
    style Radius fill:#fff3cd,stroke:#ffc107,color:#333
    style KISS fill:#e8f5e9,stroke:#28a745,color:#333
    style Ledger fill:#f8f9fa,stroke:#6c757d,color:#333
```

1. **Task Spine (Позвоночник задач)**: Служит единственным источником правды для определения приоритетов. Он не позволяет ИИ-агенту «придумывать» себе работу или сбиваться с курса. Каждая задача имеет свой уникальный `REPAIR-ID`.
2. **RAG-база знаний**: Насыщает Капитана точными знаниями о коде и спецификациях, исключая галлюцинации и избыточное дублирование.
3. **Splash & Blast Radius**: Четко очерчивает границы изменений. Splash Radius — это файлы, которые мы редактируем непосредственно (`[NEW]` / `[MODIFY]`). Blast Radius — файлы, которые могут пострадать косвенно. Это локализует диффы.
4. **Git-Issues**: Убирает необходимость во внешних тяжелых трекерах. Вся история, требования и изменения живут прямо в репозитории, в ветках вида `task/REPAIR-ID`.
5. **Реестр ремонта (`repair-ledger.json`)**: Фиксирует телеметрию изменений (Compression Ratio, спасенные строки, результаты тестов), формируя долгосрочную память системы.

## 🐝 Swarm Development Runtime

Captain OS does not define swarm work as "many agents in a list". It defines it as one task spine with multiple bounded active lanes.

For Tier 2+ work, the active Captain must choose:

- `single_lane` when the next action is genuinely blocking or cannot be split safely;
- `parallel_lane_swarm` when independent execution, research, review, or evidence lanes can advance at the same time.

In `parallel_lane_swarm`, Captain is the orchestrator by default. Sailors execute packeted lanes, Claude Code acts as a standing review lane when the host SLA triggers it, and StarPom audits process/evidence before final claims. Each active lane needs a packet, assignment id, disjoint scope, lane memory reference, heartbeat/staleness rule, evidence owed, closeout criteria, and stop conditions.

Swarm-labelled work must score at least 9/10. Captain implementation share must
stay at or below 50%, at least two fresh non-review critical-path lane artifacts
must exist, Claude Code and StarPom must be fresh when required, and text-only
planning cannot be reported as execution. Run the portable gate:

```bash
captain-os swarm-score
```

Portable protocol: `docs/protocols/swarm-development-runtime.md`.
Portable spine contract: `docs/task-spine-contract.md`.

### P11L Agent Lane Lifecycle

When the host runtime reports `agent thread limit reached`, Captain must
preserve lane memory before recycling capacity. Generate the bounded corrective
packet with:

```bash
captain-os agent-lane-lifecycle --outcomes /data/map,/data/smart-money --pr "#681"
```

The packet requires closeout deltas, lane memory updates, close/archive of
finished threads, retry spawn, and outcome-bound issue/report evidence.

Portable protocol: `docs/protocols/agent-lane-lifecycle.md`.

## ⚖️ Delivery Calibration Runtime

Captain OS changes its delivery/quality/safety/process ratio by project stage.
Discovery and planning may spend more budget on learning and acceptance, but
delivery and launch/opening cycles must close named outcomes.

Delivery progress is one of:

- `ready_with_evidence`;
- `not_ready_with_exact_blocker`;
- `blocked_owner_decision_required`.

Phase reports, acceptance matrices, and process artifacts count only when they
directly unblock a named deliverable, page, URL cohort, or blocker in the current
board. Run the portable gate:

```bash
captain-os delivery-calibration
```

When `.captain-os/task-spine.yaml` exists, the gate reads
`deliveryCalibration.currentCycle` from that spine. Use `--fixtures` only for
core regression simulations.

Portable protocol: `docs/protocols/delivery-calibration.md`.

## 🛑 Operator Decision Interrupt

When the original goal is production/opening/indexing/deploy visibility, a blocker that requires owner choice stops the critical path. Captain must name exactly 2-3 owner choices and must not continue adjacent planning by default.

Every next packet must say whether it moves the original goal or only adjacent planning/evidence, and how many adjacent slices already happened after the blocker.

For SEO/prod work, HTTP 200 is transport evidence only. It is never success without raw/rendered/canonical/robots/H1/sitemap parity.

Portable protocol: `docs/protocols/operator-decision-interrupt.md`.

---

## 🌊 Жизненный цикл изменений & 13 Гейтов Качества (Quality Gates Workflow)

В нашей системе гейты — это не абстрактные советы, а жесткие программные и логические преграды, которые не позволяют коду продвинуться дальше по пайплайну, если нарушены политики качества. Все гейты качества объединены в сквозной хронологический пайплайн выполнения задачи:

### 📋 Единая Сводная Таблица Гейтов Качества

Мы собрали все действующие гейты качества в единый хронологический пайплайн выполнения задачи — от запуска ИИ-ассистента до финального слияния (Merge) в продакшн:

| Хронологический этап | Название гейта | Тип | Что именно он контролирует? (Ценность для стабильности проекта) |
| :--- | :--- | :--- | :--- |
| **0. Инициация сессии** | **0. Startup Gate (`CAPTAIN_STARTUP_BOOTSTRAP`)** | Авто | Блокирует запуск ИИ-ассистента, если в сессии не загружены cockpit-файлы (`AGENTS.md`, `GEMINI.md`, `CLAUDE.md`) или не активирован Dynamic Captain Mode. Исключает работу "вслепую". |
| | **1. Session Gap Check (`npm run session:gap`)** | Авто | Сканирует расхождения между локальными файлами, индексами RAG-базы и удаленной веткой Git перед стартом работы. Исключает работу на устаревшей кодовой базе. |
| | **2. Logging Gate (`work:logging-gate`)** | Авто | **Жесткое вето на мутации кода без задачи**. Блокирует любые изменения кодовой базы хоста, если в системе нет активной зарегистрированной задачи с валидным `REPAIR-ID` (из GitHub-issues). |
| **1. Проектирование** | **3. Plan Approval Gate** | Ручной | Для Tier 2+ архитектурных и сложных задач ИИ обязан разработать технический план (`implementation_plan.md`) и получить осознанный ручной аппрув оператора перед написанием кода. |
| | **4. Splash Radius Gate** | Авто | Ограничивает область редактирования. Блокирует запись любых файлов, которые не были явно задекларированы в Splash Radius текущей задачи. Предотвращает "расползание" изменений. |
| | **5. Conscious Agreement Gate** | Ручной | **Абсолютная защита легаси**. Если Splash Radius затрагивает старые стабильные файлы, ИИ физически не имеет права вносить в них правки без ручного `[Y/N]` аппрува разработчика в консоли. |
| **2. Разработка & Рефакторинг** | **6. KISS Code Check** | Авто | Обязывает ассистента писать максимально плоский и лаконичный код с первого коммита (минимальные изменения строк, Guard Clauses, переиспользование RAG-компонентов). |
| | **7. Mechanical Rollback (Авиарезерв)** | Авто | Перед авто-упрощением новых файлов создается снапшот. Запускаются тесты. Если тесты ломаются — гейт мгновенно откатывает файлы к снапшоту, спасая рантайм. |
| **3. Локальная приемка** | **8. Fermat validate-lock** | Авто | `npx captain-os validate-lock` сканирует локфайл блокировок. Запрещает коммиты, если в файле случайно остались флаги локального локирования ресурсов. |
| | **9. Repair Gate (`npm run repair:gate`)** | Авто | Проверяет целостность, валидность JSON-структуры и statuses реестра дефектов (`.ship/repair-ledger.json`) перед финальным рапортом о готовности задачи. |
| | **10. Custom Design & Lint Audit** | Авто | Утилита проверки дизайн-кода. Сканирует новые файлы на соответствие токенам CSS, дизайн-инвариантам и стандартам линтинга вашего проекта, блокируя ad-hoc стили. |
| **4. Слияние (Merge) & CI** | **11. PR Size Ceiling Gate** | Авто | Ограничивает размер Pull Request (рекомендуется 10-25 файлов). Всё, что больше 50 файлов, блокируется и принудительно дробится на подзадачи (Large-Slice). |
| | **12. Environment Boundary Gate** | Авто | **Безопасность контуров**. Жестко контролирует, чтобы защищенные/административные роуты, ключи шифрования и отладочные файлы были физически отрезаны от публичной сборки. |
| | **13. CI Verification & Branch Closeout** | Авто | Автоматический прогон тестов (`doctor`) на GitHub Actions и авто-удаление временных веток после слияния, гарантируя отсутствие мусора в Git. |

---

## ⚙️ Декларативная кастомизация и Авто-определение (Zero-Friction Customization Protocol)

Универсальность **Captain OS** заключается в том, что все 13 гейтов качества не являются «намертво зашитыми» правилами. Вы можете гибко кастомизировать и адаптировать любой гейт под стек, архитектуру и соглашения конкретно вашего проекта.

Для мгновенного и бесшовного развертывания система использует **Lute Flow Auto-Detection**.

### 🌊 Протокол кастомизации (Как это работает?)

Инициализация и кастомизация мета-ОС сводится к автоматическому сканированию и простой декларативной конфигурации:

```mermaid
graph TD
    User([👨‍💻 Разработчик]) -->|"1. Запуск"| CLI["⚡ npx captain-os init"]
    
    subgraph Scan["🔍 Lute Flow Auto-Detection (Без вопросов)"]
        CLI --> Package["📦 Пакетный менеджер & Окружение<br>(npm/bun/pnpm/yarn)"]
        Package --> Metrics["📊 Метрики репозитория & Уровень<br>(LOC, связность, масштаб, энтропия)"]
        Metrics --> AutoConfig["⚙️ Авто-распределение гейтов<br>(P0 Hard Security + Adaptive Gates)"]
    end

    AutoConfig -->|"2. Мгновенная генерация"| Manifest[".captain-os/project.yaml <br>(Манифест проекта)"]
    AutoConfig -->|"3. Создание адаптеров"| Adapters[".captain-os/runtime-adapters.yaml <br>(Конфигурации LLM-пилотов)"]
    AutoConfig -->|"4. Инструкции ИИ"| CustomRules[".captain-os/custom-rules.md <br>(Локальные инварианты качества)"]
```

### 📋 Декларативное управление гейтами

Вся тонкая настройка системы осуществляется непосредственно через редактирование сгенерированного файла конфигурации [project.yaml](file:///.captain-os/project.yaml):

1. **Разделение гейтов (`activeHardGates` и `activeAdaptiveGates`)**: Вы можете легко перетаскивать любой гейт качества из мягкого режима (Adaptive) в жесткий блокирующий режим (Hard) или полностью отключать его.
2. **KISS-правила кода (Гейт 6)**: Прописываются в виде обычных текстовых инструкций в манифесте, автоматически транслируясь во входные промпты ИИ-агентов.
3. **Legacy-директории и Conscious Agreement (Гейт 5)**: Вы просто указываете защищенные пути (например, `protectedPaths: ["src/legacy/**"]`), и ИИ физически не сможет изменить их без вашего подтверждения `[Y/N]` на экране.
4. **Механический авто-откат (Гейт 7)**: Достаточно прописать имя вашей тестовой команды (`testCommand: "npm run test"`) в конфиге. Снапшот-движок будет запускать её в фоновом режиме при каждом рефакторинге.
5. **Границы окружений (Гейт 12)**: Определяются паттернами файлов и сигнатур утечек в project-манифесте для автоматической блокировки на CI.

### 🎯 Результат кастомизации
Никакого спама в консоли. Система инициализируется за 2 секунды, развертывает файлы метаданных, а дальше вы настраиваете всё декларативно в удобном YAML. Любой ИИ-пилот (Gemini, Claude, Codex) при старте сессии считывает эти правила и мгновенно перестраивает свои гейты под ваши правила!

---

## 🧠 Dynamic Captain Mode (Динамический выбор Капитана)

В отличие от традиционных жестко закодированных ИИ-ассистентов, Captain OS поддерживает **Dynamic Captain Mode**:
* Тот рантайм (терминал, сессия или агент), который **первым запускает рабочее окно**, автоматически принимает на себя роль **Активного Капитана** (Captain Gemini, Captain Claude или Captain Codex).
* Другие языковые модели подключаются по ходу выполнения задач в качестве вспомогательных офицеров (crew/officers) или независимых рецензентов (например, Claude Code выступает в качестве внешнего ревизора по SLA для сложных изменений Tier 3+).
* Капитаны общаются на русском языке с владельцем, сохраняя максимальную автономию, но не выходя за рамки разрешенного splash-радиуса изменений.

---

## 🪚 Aerospace-Grade SimplifyCode Pipeline (Садоводство Кода)

Спецификация **SimplifyCode** встроена во все контуры работы Captain OS и обеспечивает максимальную чистоту кодовой базы («из коробки» без переусложнения) при соблюдении авиационных стандартов безопасности.

### 🌊 Схема жизненного цикла изменений и рефакторинга

```mermaid
graph TD
    Start(["✏️ 1. Разработчик ставит задачу"]) --> KISS["🧠 2. Изначальная простота (KISS от ЛЛМ) <br> Изменение минимум строк и функций с опорой на RAG"]
    KISS --> CodeChange["📝 3. Внесение изменений в рамках Splash Radius"]
    CodeChange --> CLI["⚡ Запуск npx captain-os simplify"]
    
    subgraph CLISimplifier["🪚 Конвейер Упрощения и Безопасности"]
        CLI --> GitStatus{"🔍 Git-статус файлов"}
        
        %% Ветвь новых файлов
        GitStatus -->|"NEW / untracked / A"| NewFiles["🟢 Новые файлы"]
        NewFiles --> AutoRefactor["✨ Авто-упрощение и рефакторинг <br> (Уплощение, Guard Clauses)"]
        
        %% Ветвь старых файлов
        GitStatus -->|"MODIFY / M"| OldFiles["🔒 Старые стабильные файлы"]
        OldFiles --> AgreementGate{"🚨 Conscious Agreement <br> (Осознанный ручной выбор)"}
        AgreementGate -->|"Одобрено разработчиком (Y)"| AutoRefactor
        AgreementGate -->|"Отклонено разработчиком (N)"| SkipOld["🚫 Пропустить рефакторинг файла"]
        
        %% Авиационное резервирование
        AutoRefactor --> Backup["✈️ Аварийный снапшот резервирования <br> (.captain-os/snapshots/)"]
        Backup --> RunTests{"🧪 Прогон тестов проекта <br> (bun test / npm run test)"}
        
        %% Развилка тестов
        RunTests -->|"✅ Пройдены"| Telemetry["📊 Логирование в Реестр ремонта <br> (.ship/repair-ledger.json)"]
        RunTests -->|"❌ Сломались"| Rollback["🔄 Mechanical Rollback <br> Жесткий откат из снапшота"]
    end
    
    Telemetry --> Done(["🎉 Чистый и стабильный код!"])
    SkipOld --> Done
    Rollback --> Error(["⚠️ Возврат к исходному состоянию"])

    style Start fill:#f5f5f5,stroke:#333,color:#333
    style KISS fill:#e8f5e9,stroke:#28a745,color:#333
    style CodeChange fill:#e8f4fd,stroke:#4a90d9,color:#333
    style CLI fill:#fffde7,stroke:#fbc02d,color:#333
    style GitStatus fill:#fff8e1,stroke:#f9a825,color:#333
    style NewFiles fill:#e8f5e9,stroke:#28a745,color:#333
    style OldFiles fill:#efebe9,stroke:#5d4037,color:#333
    style AgreementGate fill:#ffebee,stroke:#c62828,color:#333
    style AutoRefactor fill:#e8f4fd,stroke:#4a90d9,color:#333
    style SkipOld fill:#fafafa,stroke:#9e9e9e,color:#333
    style Backup fill:#efebe9,stroke:#5d4037,color:#333
    style RunTests fill:#fff8e1,stroke:#f9a825,color:#333
    style Telemetry fill:#e8f5e9,stroke:#28a745,color:#333
    style Rollback fill:#ffebee,stroke:#c62828,color:#333
    style Done fill:#d4edda,stroke:#28a745,color:#333
    style Error fill:#ffebee,stroke:#c62828,color:#333
    style CLISimplifier fill:#f8f9fa,stroke:#6c757d,color:#333
```

### 🎯 Ключевые принципы конвейера SimplifyCode

1. **Изначальная простота (KISS from the Start)**:
   * Агенты обязаны изменять минимум строк, добавлять минимум функций и классов, полностью опираясь на RAG-контекст проекта и узкий splash-радиус.
   * Упрощение — это не лечение сложного кода задним числом, а изначальный фокус на минималистичных диффах.
2. **Строгая защита легаси (Conscious Agreement)**:
   * Сплэш-радиус задачи может затрагивать старые стабильные файлы, но они **никогда не изменяются автоматически**.
   * Любая оптимизация легаси-кода требует ручного `[Y/N]` согласия разработчика в интерактивном режиме консоли с выводом Side-by-Side разницы.
3. **Беспрепятственная чистка новых файлов**:
   * Все абсолютно новые файлы, написанные в рамках задачи, уплощаются и чистятся автоматически до идеального плоского вида.
4. **Авиационная отказоустойчивость (Mechanical Rollback)**:
   * Перед любым физическим изменением файлов система делает полную резервную копию. Если после рефакторинга падают тесты проекта, происходит моментальный механический откат, гарантирующий 100% стабильность рантайма.

---

## 🧙‍♂️ Быстрый старт & Интерактивный онбординг (`init` / `setup`)

Для быстрого развертывания Captain OS на любом новом проекте предусмотрен интерактивный онбординг-мастер.

### 1. Установка и запуск инициализации

Перейдите в корень вашего проекта и выполните команду:
```bash
npx -y captain-os init
```
Мастер настройки поприветствует вас, автоматически определит используемый пакетный менеджер (`bun`, `npm`, `pnpm`, `yarn`) и задаст несколько ключевых вопросов:
1. **Имя проекта** (по умолчанию берется из папки).
2. **Имя владельца/разработчика** (для персонализации общения).
3. **Доступные LLM рантаймы** (будут сгенерированы соответствующие адаптеры для Gemini, Claude или Codex).
4. **Директории исходников для RAG** (будут добавлены в конфигурацию поиска).
5. **Путь к реестру ремонта** (для контроля качества изменений).

После завершения настройки мастер автоматически сгенерирует файлы конфигурации `.captain-os/project.yaml` и `.captain-os/runtime-adapters.yaml`, а также предложит сразу запустить индексацию базы знаний RAG.

### 2. Проверка статуса готовности (`doctor` / `readiness`)

Вы всегда можете проверить готовность вашей операционной системы к работе с помощью команды:
```bash
npx captain-os doctor
```
Или локального скрипта оценки готовности в репозитории проекта:
```bash
npm run captain:readiness
```

Вы увидите красивый интерактивный прогресс-бар:
```text
======================================================
📊 Статус готовности Captain OS: [████████████████████] 100%
======================================================

🎉 Поздравляем! Ваша Captain OS настроена на 100% мощности и полностью готова к полету.
```

### 3. Интерактивный генератор целей (`formulate` / `goal-builder`)

Для нетехнических операторов и разработчиков, которым сложно вручную формулировать задачи по строгому DDP-паттерну (Declarative-Deterministic-Proactive), предусмотрена интерактивная утилита:
```bash
npx captain-os formulate
```

Этот мастер-помощник задаст вам несколько простых вопросов на естественном языке и автоматически:
1. **Обнаружит Scope (границы):** Просканирует Git-статус проекта на наличие измененных или Untracked файлов и предложит их в качестве жестких границ для ИИ-ассистента.
2. **Определит команду верификации:** Прочитает ваш `package.json` и найдет все доступные тестовые и сборочные скрипты, предложив выбрать один из них.
3. **Подключит когнитивные фреймворки:** Добавит инструкции по вызову **Octopus Framework** (анализ Blast Radius) для глубокой проверки зависимостей.
4. **Сгенерирует готовый файл цели:** Сохранит итоговый, безупречно структурированный промпт в `.captain-os/goal.md` и выведет его в консоль для удобного копирования в команду `/goal`.

### 4. 🧠 L1/L2 Semantic Router (Умная маршрутизация)

Captain OS не заставляет вас писать громоздкие контракты для каждой мелочи. В CLI встроен интеллектуальный **Intent Router**, который анализирует ваш запрос "на лету" (например: `npx captain-os formulate "поменяй цвет кнопки"`):

1. **Fast-Path (Тривиальные задачи):** Если вы просите "добавь комментарий" или "подвинь кнопку", роутер классифицирует это как низкий Blast Radius и передает исполнителю напрямую без генерации DDP-манифеста. Это экономит время и токены.
2. **Deep-Path (Архитектурные задачи):** Если в запросе звучат слова "архитектура", "рефакторинг" или "база данных", роутер автоматически запускает сборку жесткого DDP-манифеста.
3. **Explicit Gate:** При запуске сложного пути (Deep-Path), система обязательно покажет вам сгенерированный контракт и запросит явное согласие `[Y/N]` перед тем, как отдать управление исполнителю.

### 5. 🚀 Zero-Friction Autopilot (Ultra Quality Mode)

Вы также можете использовать систему в режиме "разговорного промптинга", передавая интент сразу аргументом:
```bash
npx captain-os formulate "сделай дизайн интерфейса охуенно"
```

Если система обнаруживает триггеры качества премиум-класса (например, слова *охуенно*, *perfect*, *premium*), она активирует **Единый Манифест Премиум-Качества**. В этом режиме агент автоматически подключит:
- Жесткую проверку UI/UX и соблюдение токенов дизайн-системы.
- Проверку семантики доступности (a11y).
- Архитектурную чистоту (backend) и изоляцию сайд-эффектов.
- Механизмы Octopus Framework для глубокой оценки рисков.

---

## 🛠️ Архитектурные компоненты в репозитории

Кодовая база ядра Captain OS имеет четкую, модульную структуру:

```text
├── packages/
│   ├── core/         # Универсальные классификаторы, менеджер блокировок ресурсов и гейты
│   ├── cli/          # Командный интерфейс (index.js, snapshot-engine.js)
│   └── adapters/     # Конфигурационные профили (Gemini, Claude, Codex)
├── templates/        # Скелетные заготовки (project.yaml, runtime-adapters.yaml, managed-blocks)
├── schemas/          # Схемы валидации манифестов и локфайлов
├── fixtures/         # Синтетические тесты окружения
└── docs/             # Документация по безопасности и контракты адаптеров
```

---

## 📦 GitHub-интеграция из коробки (Git & GitHub Integration)

Captain OS поставляется с готовым набором шаблонов для GitHub, позволяющих мгновенно развернуть полноценный контур автоматического контроля качества на вашем проекте. 

Шаблоны находятся в папке `templates/github/` и включают:
1. **`pull_request_template.md`** — Шаблон Pull Request с контрольным списком гейтов качества (KISS, Conscious Agreement, Mechanical Rollback, `validate-lock` и лимит размера PR).
2. **`ISSUE_TEMPLATE/captain-repair-issue.md`** — Шаблон для создания задач и дефектов с разметкой Splash/Blast Radius и выделением уникального `REPAIR-ID`.
3. **`workflows/captain-ci-gate.yml`** — CI-пайплайн GitHub Actions, автоматически проверяющий целостность локфайла (`validate-lock`), готовность системы (`doctor`) и запускающий тесты проекта при коммитах и пуллах.

### Как применить в своем проекте:
Просто скопируйте содержимое папки `templates/github/` в директорию `.github/` вашего проекта:
```bash
cp -r templates/github/ .github/
```

---

## 🧠 Специальные когнитивные фреймворки (Special Cognitive Skills)

Для глубокого анализа кодовых баз, решения многоуровневых архитектурных задач и обеспечения максимального уровня безопасности в Captain OS встроены три передовых когнитивных фреймворка. 

Вы можете рекомендовать вашим ИИ-пилотам использовать эти протоколы при выполнении комплексных задач рефакторинга:

### 1. Hardwork Framework (Гомеостатическое мышление)
Фреймворк жесткого технического анализа и поддержания гомеостаза. Он ориентирован на планомерное, глубокое исследование системы перед внесением изменений:
* **Принцип:** Запрещает делать поспешные выводы. Требует прохождения 5 фаз анализа: Исследование $\rightarrow$ Формулирование гипотез $\rightarrow$ Математическое доказательство стабильности $\rightarrow$ Локализация изменений $\rightarrow$ Контроль энтропии.
* **Применение:** Идеально подходит для исправления сложных багов race-condition, проектирования баз данных или внедрения новых критических систем безопасности.

### 2. Octopus Framework (Глубокий анализ зависимостей и Blast Radius)
Инструмент прецизионного анализа архитектурных связей и каскадных побочных эффектов (подробнее в [документации фреймворка](file:///Users/antontitov/Projects/captain-os/docs/protocols/octopus-framework.md)):
* **Принцип:** Моделирует изменение кода как организм осьминога, щупальца которого тянутся сквозь весь проект. При изменении конкретного метода или структуры данных фреймворк вычисляет точечный Splash/Blast Radius по 4 направлениям: каскады импортов, типы данных/интерфейсы, схемы валидации/базы данных и UI-элементы.
* **Применение:** Исключает каскадные ошибки в отдаленных модулях системы. Гарантирует, что разработчик и ИИ видят полную карту последствий рефакторинга перед внесением изменений.

### 3. Multi-LLM Fire Chat Protocol (Параллельный ИИ-консенсус)
Протокол тройного перекрестного ИИ-аудита (подробнее в [документации протокола](file:///Users/antontitov/Projects/captain-os/docs/protocols/fire-chat-protocol.md)):
* **Принцип:** Запуск одной и той же экспертной роли параллельно на трех независимых движках разных семейств: **Gemini 3.1 Pro** (контекст и глубина), **Claude 4.7** (структура и типы) и **Codex 5.3 / GPT-5.5** (алгоритмы).
* **Стратегическое применение:** Для оптимального баланса скорости и стоимости протокол применяется на двух ключевых этапах: **на этапе планирования** (для согласования идеальной архитектурной стратегии) и **на этапе финального анализа** (перед отправкой ветки в деплой). Промежуточные же быстрые микро-итерации и локальное судейство выполняются сверхбыстрыми изолированными агентами-судьями (такими как **Gemini 3.5 Flash**).

---

## 📄 Лицензия

Проект распространяется под лицензией MIT. Разработано ИИ-Капитанами и командой Advanced Agentic Coding.
