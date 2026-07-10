# Runtime Adapter Contract

All runtimes use the same adapter shape.

```yaml
runtimeId: codex | claude-code | gemini-coding
ownerRegistryId: captain-codex | captain-claude | captain-gemini
instructionEntrypoint: AGENTS.md | CLAUDE.md | GEMINI.md
captainEligibility: primary | secondary | dynamic | crew_only | disabled
defaultRole: captain | captain_first | read_only_judge | worker
swarmRole: orchestrator_and_integrator | standing_review_lane | optional_judge_or_packeted_lane | packet_worker
capabilities: {}
constraints: {}
captainOsHooks: {}
handoff: {}
```

Capability absence does not lower acceptance. The runtime must hand off or block final claim when it cannot gather required evidence.

## Swarm Development Runtime

Captain OS uses one task spine, not one worker. Non-trivial work should declare an execution model before implementation:

- `direct_answer` for T0/T1 answer-only work;
- `single_lane` when the work genuinely cannot be split;
- `parallel_lane_swarm` when independent execution, research, review, or evidence lanes can advance at the same time.

In `parallel_lane_swarm`, Captain is the orchestrator and keeps 2-4 bounded active lanes when safe. Each lane needs a packet, assignment id, allowed scope, forbidden scope, lane memory reference, heartbeat/staleness rule, evidence owed, closeout criteria, and stop conditions. One-shot agents are allowed only when their lane memory is passed back into the next launch.

Adapters should expose or emulate an `agentLaneLifecycle` hook. When the host
runtime hits `agent thread limit reached`, the hook must close or archive
finished lanes only after lane delta, lane memory, and issue/outcome/evidence
refs are captured, then retry the next bounded spawn.

Portable protocol: `docs/protocols/swarm-development-runtime.md`.
Agent lifecycle protocol: `docs/protocols/agent-lane-lifecycle.md`.
Portable spine contract: `docs/task-spine-contract.md`.

## Delivery Calibration Runtime

Every Tier 2+ packet declares a `projectStage` before execution:

- `discovery`
- `planning`
- `delivery`
- `launch_opening`
- `incident_repair`
- `maintenance`

The stage sets the expected proportion of delivery, quality, safety, and process
budget. Delivery and launch/opening packets must name 1-3 deliverables, pages,
URL cohorts, or blockers and close them to `ready_with_evidence`,
`not_ready_with_exact_blocker`, or `blocked_owner_decision_required`.

Process artifacts count as progress only when they directly unblock a named
outcome in the current board.

Issue comments, status reports, and portfolio summaries are delivery evidence
only when attached to named `outcomeRows` or an equivalent closed outcome board.

Runtime adapters write the current cycle to
`deliveryCalibration.currentCycle` before progress/readiness wording. The
portable `captain-os delivery-calibration` command reads
`.captain-os/task-spine.yaml` by default when present; missing `currentCycle` in
delivery/launch is a hard recalibration signal.

Portable protocol: `docs/protocols/delivery-calibration.md`.

## Operator Decision Interrupt

For production/opening/indexing/deploy goals, `operator_decision_required` is a critical-path interrupt. Captain must stop the path, name exactly 2-3 owner choices, and continue adjacent planning only through an owner-approved timeboxed bypass with visible warning.

Every packet after the blocker records `criticalPathMovement` and `adjacentPlanningSlicesAfterBlocker`. For SEO/prod work, HTTP 200 never counts as success without raw/rendered/canonical/robots/H1/sitemap parity.

Portable protocol: `docs/protocols/operator-decision-interrupt.md`.
