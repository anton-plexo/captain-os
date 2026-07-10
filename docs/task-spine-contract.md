# Task Spine Contract

Status: portable_contract_p11h_draft

Captain OS host projects keep task state in `.captain-os/task-spine.yaml`.

The portable invariant is:

```text
one task spine, multiple bounded lane states
```

The spine is not a transcript and not a second backlog. It is the live routing object that points to issues, packets, lane memory, evidence, and next actions.

## Required Shape

```yaml
schemaVersion: captain-task-spine.v1
spineId: HOST-PROJECT-SPINE
status: active
mode: shadow
updatedAt: "YYYY-MM-DD"
owner: captain-codex

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
      - issue/outcome/evidence refs attached or blocker recorded
    lastThreadLimitAt: null
    closeAgentsAttempted: false
    retrySpawnScheduled: false
  active: []

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

laneStates: []
laneMemory: {}
```

## Lane State

Each lane state is a live owner record:

- `laneId`
- `title`
- `ownerRegistryId`
- `runtimeId`
- `laneMode`: `persistent_owner`, `one_shot_reviewer`, `read_only_judge`, `temporary_contractor`, or `standing_review`
- `status`: `queued`, `active`, `blocked`, `review`, `merged`, `closed`, or `stale`
- `assignmentId`
- `heartbeatAt`
- `staleAfterMinutes`
- `allowedScope`
- `forbiddenScope`
- `locks`
- `dependencies`
- `conflictsWith`
- `contextRefs`
- `contextBudgetRefs`
- `laneMemoryRef`
- `acceptanceRows`
- `evidenceOwed`
- `evidenceRefs`
- `lastDelta`
- `decisions`
- `openQuestions`
- `blockers`
- `nextAction`
- `closeoutCriteria`
- `transferCriteria`

## False Parallelism Block

A task must not call itself swarm development when all active lanes are one-shot reviewers, no lane has memory, or lane deltas are not merged into the spine.

Block code: `false_parallelism_no_persistent_lanes`.

## Swarm Score Block

A task must not call itself swarm development when the current runtime shape
scores below 9/10. Captain implementation share above 50%, fewer than two fresh
non-review critical-path lane artifacts, stale Claude/StarPom lanes, text-only
next packets, or missing SEO/opening evidence must downgrade the packet to
direct execution, planning support, or review support.

Block code: `swarm_runtime_score_below_9`.

## Agent Lane Lifecycle Block

When a host runtime reports `agent thread limit reached`, Captain must preserve
lane state before recycling capacity: capture closeout deltas, update lane
memory, attach issue/outcome/evidence refs or blockers, close/archive finished
threads, then retry the next bounded spawn. Broad Captain-local fallback without
that lifecycle is not swarm and must not be reported as progress.

Block code: `agent_lane_lifecycle_fail`.

## Delivery Calibration Block

Tier 2+ work records `deliveryCalibration.projectStage`:

- `discovery`
- `planning`
- `delivery`
- `launch_opening`
- `incident_repair`
- `maintenance`

Delivery and launch/opening stages must name outcomes in
`deliveryCalibration.currentCycle` before execution and close at least one
outcome per cycle to `ready_with_evidence`,
`not_ready_with_exact_blocker`, or `blocked_owner_decision_required`. Process
artifacts, reports, and acceptance matrices count only when they unblock a named
outcome in the current board.

Issue/reporting rows must live inside `deliveryCalibration.currentCycle.outcomeRows`
or an equivalent named outcome board. Detached reporting is process work and
does not close delivery outcomes.

`captain-os delivery-calibration` reads `.captain-os/task-spine.yaml` by default
when it exists. Missing `currentCycle` in delivery/launch is a recalibration
failure, not an advisory warning.

Block code: `delivery_calibration_fail_recalibrate`.

## Final Claim Rule

Final readiness claims are blocked when any required lane is stale, blocked, missing closeout, missing evidence, or has an unmerged delta.
