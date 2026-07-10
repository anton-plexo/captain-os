# Swarm Development Runtime

Status: core_protocol_p11h_draft
Owner: Captain OS Core + StarPom
Scope: portable core contract for host projects

## Purpose

Swarm development is the default execution model for non-trivial Captain OS work that can be split into independent lanes.

The core invariant is:

```text
one task spine, multiple bounded active lanes
```

Single-spine does not mean single worker. The spine preserves one strategic memory and one acceptance object. Active lanes preserve parallel execution, lane memory, and accountable evidence.

## Root Problem This Fixes

Captain OS can accidentally become a review committee:

- Captain delegates one narrow task;
- Captain waits for that result;
- the sailor context disappears after return;
- Captain performs too much of the work locally;
- Claude Code runs as an after-the-fact reviewer instead of a standing review lane;
- StarPom audits at the end but cannot see lane memory or unmerged deltas.

That is sequential delegation, not swarm development.

## Runtime Contract

For Tier 2+ work, Captain must choose one of these execution models before implementation:

| Model | Use When | Requirement |
|---|---|---|
| `direct_answer` | T0/T1 answer or tiny read-only clarification. | No lane memory required. |
| `single_lane` | Work cannot be safely split or immediate next action is genuinely blocking. | Record why parallel lanes are unsafe. |
| `parallel_lane_swarm` | Work has independent research, implementation, verification, review, or evidence paths. | Keep 2-4 active lanes when safe. |

Captain remains orchestrator. Captain may do packet writing, synthesis, emergency fixes, and narrow integration. Captain is not the default production worker when a packet has execution lanes.

## Active Lane Contract

Each active lane must have:

- `laneId`
- `owner`
- `runtimeId`
- `role`
- `laneMode`
- `status`
- `assignmentId`
- `heartbeatAt`
- `staleAfterMinutes`
- `allowedScope`
- `forbiddenScope`
- `locks`
- `dependencies`
- `conflictsWith`
- `contextRefs`
- `laneMemoryRef`
- `evidenceOwed`
- `evidenceRefs`
- `nextAction`
- `lastDelta`
- `closeoutCriteria`
- `transferCriteria`
- `stopConditions`

Lane memory is durable working memory for a role across multiple launches. If an agent runtime is one-shot, Captain must pass the lane memory back into the next launch and update it after the result.

Lane modes:

- `persistent_owner` owns a durable lane across launches;
- `one_shot_reviewer` returns a bounded opinion and does not count as a development lane by itself;
- `read_only_judge` verifies evidence or claims;
- `temporary_contractor` executes a bounded disjoint work packet;
- `standing_review` watches plan/code/final-claim phases.

## Parallelism Rule

When `parallel_lane_swarm` is selected:

- keep 2-4 independent active lanes if safe work exists;
- do not wait on a lane if another lane can advance without its output;
- use disjoint write scopes for implementation lanes;
- keep review lanes read-only unless separately packeted;
- use officers if Captain would manage more than five active lanes;
- stop parallel dispatch when shared-file locks collide.

No phantom parallelism: a named lane without a packet, scope, lane memory, and evidence owed is not active work.

## Swarm 9/10 Runtime Gate

Swarm is a scored runtime shape, not a label. A packet may use
`parallel_lane_swarm`, swarm-progress, or readiness language only when it scores
at least 9/10.

Passing shape:

- Captain is orchestrator/integrator, not the main production worker.
- Captain implementation share is `<= 50%` for swarm-labelled work.
- At least two fresh non-review lanes produce critical-path artifacts.
- Review-only, planning-only, or sequential one-shot sessions do not count as
  swarm execution.
- Every active lane has durable lane memory.
- PR-bound work has a fresh Claude Code read-only review lane.
- Every swarm-labelled packet has a fresh StarPom process lane.
- More than five active lanes require officer split or a StarPom red flag.
- Critical path cannot be idle while adjacent work is reported as progress.
- SEO/opening/indexing work cannot claim green without exact evidence lane proof.
- The next packet is started or scheduled; text-only planning is not execution.
- Agent thread capacity is managed: when runtime reports a thread limit,
  Captain captures lane deltas, updates lane memory, closes/recycles finished
  agent threads, then retries spawn or explicitly downgrades to `not_swarm`.

Mechanical gate:

```bash
captain-os swarm-score
```

The gate carries 12 regression simulations: one valid 9+ swarm, one allowed
Captain-direct tiny fix, and failure fixtures covering Captain-local false
swarm, sequential reviewers, stale lanes, adjacent-over-critical drift, missing
Claude/StarPom, over-wide span, planning-only readiness, SEO opening/indexing
false-green, and agent-thread-limit lifecycle. A recycled thread-limit fixture
must pass only after lane memory and closeout deltas are captured.

If a live swarm stays below 9/10 for one 30-minute review window, Captain must
repair the packet/process before allowing more product work to be reported as
swarm progress.

## Standing Review Lanes

Claude Code is a standing review lane when the host SLA triggers it. It should start as early as useful:

```text
packet drafted
-> Claude plan/code review starts in parallel
-> execution lanes continue on disjoint work
-> Captain merges findings
-> StarPom audits aggregation before final claim
```

StarPom is the standing process lane. StarPom must be able to inspect lane memory, assignment logs, evidence, and unmerged deltas.

## Agent Capacity Lifecycle

When a runtime returns `agent thread limit reached`, Captain does not continue
silently as "swarm". The required lifecycle is:

```text
thread_limit
-> identify stale/finished/recyclable lanes
-> capture lane closeout delta and evidence owed
-> attach issue/outcome/evidence refs or exact blocker
-> update `.captain-os/task-spine.yaml` lane memory
-> call the host close/archive primitive for finished agent threads
-> retry spawn for the next bounded lane
-> if retry still fails, downgrade to `allowed_not_swarm` with a visible blocker
```

Finished lane threads must not stay open only because they might be useful later;
their useful context belongs in lane memory, evidence refs, issue links, and next
actions. Closed agents may be resumed only when their lane memory is current.

Productive critical-path artifacts such as issue updates and reports must carry
`outcomeBinding`: issue ref, outcome id, closed outcome state, and evidence
refs. Detached reporting is process work, not swarm movement.

## Spine Shape

Host projects may store this in `.captain-os/task-spine.yaml`:

```yaml
currentState:
  activeExecutionModel: parallel_lane_swarm
  captainRole: orchestrator
  swarmScoreGate:
    minScore: 9
    captainImplementationShareMax: 0.5
    reviewWindowMinutes: 30
    command: captain-os swarm-score
  activeLanes:
    - laneId: execution-content
      owner: public-portal
      status: active
      assignmentId: ASSIGN-...
      laneMemoryRef: .ship/crew-lanes/public-portal/lane-state.md
      nextAction: Produce source-backed draft packet.
```

The lane memory path is host-defined. The portable rule is that the memory exists, is scoped, and is updated after each lane return.

Portable schema: `schemas/task-spine.schema.json`.
Portable template: `templates/task-spine.yaml`.

## Acceptance Rows

| ID | Acceptance Row | Evidence |
|---|---|---|
| `SWARM-001` | Tier 2+ implementation work declares `single_lane` or `parallel_lane_swarm`. | Task spine or packet. |
| `SWARM-002` | Parallel lanes have disjoint scopes, lane memory refs, evidence owed, and stop conditions. | Active lane map. |
| `SWARM-003` | Captain is not the default worker for packeted execution lanes. | Crew plan and assignments. |
| `SWARM-004` | Claude Code review lane starts in parallel when SLA triggers. | Cross-LLM verdict refs or accepted-risk record. |
| `SWARM-005` | StarPom can audit lane memory and unmerged deltas before final claim. | Evidence aggregation plus StarPom verdict. |
| `SWARM-006` | Swarm-labelled work scores at least 9/10 or is downgraded. | `captain-os swarm-score` plus live lane score. |
| `SWARM-007` | Agent thread limit triggers close/recycle lifecycle before Captain-local fallback. | `agentCapacity` in swarm score plus lane closeout refs. |
| `SWARM-008` | Productive critical-path artifacts bind to named outcomes. | Lane `outcomeBinding` plus outcome rows. |

## Stop Conditions

- Captain is the only worker on Tier 2+ work without a recorded `single_lane` reason.
- A repeated one-shot agent is relaunched without lane memory.
- More than five active lanes report directly to Captain without officers.
- Two write lanes touch the same shared file without a lock.
- Final claim is attempted while lane deltas are unmerged or lane memory is stale.
- Agent thread limit is hit and Captain neither closes recyclable lanes nor records a `not_swarm` fallback.
- Critical-path issue/report artifacts are detached from issue/outcome/evidence refs.
