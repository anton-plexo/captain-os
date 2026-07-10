# Delivery Calibration Runtime

Status: core_protocol_p11k_draft  
Owner: Captain OS Core + StarPom  
Scope: portable delivery/quality/safety proportionality contract

## Purpose

Captain OS must not apply the same process weight to every project stage.
Discovery, planning, delivery, launch/opening, incident repair, and maintenance
need different proportions of delivery volume, quality, and safety.

The invariant is:

```text
stage chooses the ratio; named outcomes prove progress
```

## Stage Contract

| Stage | Use When | Delivery Target | Quality Target | Safety Target | Process Budget Max | Planning-Only Budget | Closed Outcome Requirement |
|---|---|---:|---:|---:|---:|---:|---|
| `discovery` | Unknown space, research, audit, inventory. | 15% | 35% | 20% | 55% | 3 cycles | Named learning/spec/evidence artifact. |
| `planning` | Acceptance matrix, strategy, architecture, phase design. | 25% | 35% | 20% | 45% | 2 cycles | Bounded next delivery packet. |
| `delivery` | Build/fix/ship concrete artifacts. | 50% | 25% | 15% | 25% | 1 cycle | At least one named deliverable/page/cohort closed. |
| `launch_opening` | Prod, deploy, indexing, GSC/Rampify, opening, sitemap/canonical/robots. | 35% | 25% | 30% | 30% | 0 cycles | At least one named readiness/opening outcome or exact blocker. |
| `incident_repair` | False-green, owner decision, production blocker, runtime failure. | 20% | 20% | 40% | 35% | 0 cycles | Blocker closed or `owner_decision_required_interrupt` raised. |
| `maintenance` | Small docs, cleanup, hygiene, low-risk support. | 35% | 30% | 20% | 35% | 2 cycles | Named maintenance artifact or blocker. |

Shares are budget targets, not accounting theatre. They tell Captain where the
next cycle must spend attention. Quality and safety can overlap with delivery
when evidence is produced as part of the deliverable.

## Delivery Outcome States

Delivery/launch work reports progress only through named outcomes:

- `ready_with_evidence`;
- `not_ready_with_exact_blocker`;
- `blocked_owner_decision_required`.

Process artifacts, acceptance matrices, advisory packets, or phase reports count
only when they unblock a named outcome in the current board.

Issue comments, portfolio reports, and status tables are allowed only as
attachments to named outcomes closed in the current cycle. Detached reporting is
process work, not delivery progress.

## Runtime Rules

- Captain chooses `projectStage` before Tier 2+ implementation.
- The task spine carries `deliveryCalibration` and
  `deliveryCalibration.currentCycle`.
- `delivery` and `launch_opening` stages must name the next 1-3 deliverables,
  pages, URL cohorts, or blockers before execution.
- `launch_opening` can spend more on safety, but it still needs named readiness
  outcomes; safety cannot become indefinite adjacent planning.
- `incident_repair` stops adjacent work when owner choice is required.
- If a cycle exceeds the stage process budget, Captain reports
  `fail_recalibrate` and changes the packet before claiming progress.
- Swarm-labelled work still needs P11H. Delivery calibration does not lower
  swarm requirements; it prevents process-heavy swarms from sounding productive.

## Mechanical Gate

```bash
captain-os delivery-calibration
```

When `.captain-os/task-spine.yaml` exists, the command reads the live
`deliveryCalibration.currentCycle` by default. Use `--fixtures` for core
regression simulations, `--input <json>` for explicit scenario JSON, or
`--spine <path>` for a specific task spine.

For `delivery` and `launch_opening`, a missing `currentCycle`, missing named
outcomes, process over budget, planning-only overflow, owner-decision bypass,
or missing safety/quality evidence is a recalibration failure. The next packet
must change the work shape before progress/readiness wording continues.

The fixture gate carries 11 regression simulations:

- discovery source map allowed;
- planning acceptance matrix allowed;
- delivery with three pages closed passes;
- delivery with phase reports only fails;
- launch readiness with safety evidence passes;
- launch false-green without evidence fails;
- incident owner-decision bypass fails;
- incident repair safety-first passes;
- maintenance small doc gate passes;
- fast delivery with quality under-budget fails;
- delivery detached issue/reporting fails.

Additional live-spine fixtures cover:

- live task-spine delivery page batch passes;
- live task-spine delivery process loop fails;
- live task-spine launch owner-decision bypass fails;
- live task-spine detached issue/reporting fails.

## Acceptance Rows

| ID | Acceptance Row | Evidence |
|---|---|---|
| `DELIVERY-CAL-001` | Tier 2+ work declares `projectStage`. | Task spine or crew plan. |
| `DELIVERY-CAL-002` | Delivery/launch cycles name 1-3 outcomes before execution. | Page/cohort/deliverable board. |
| `DELIVERY-CAL-003` | Process share stays below the stage budget or the packet is recalibrated. | `captain-os delivery-calibration`. |
| `DELIVERY-CAL-004` | Launch/opening and false-green risks carry exact safety evidence before green wording. | Evidence map and StarPom verdict. |
| `DELIVERY-CAL-005` | Owner-decision-required incidents stop adjacent work unless Anton approves a timeboxed bypass. | Interrupt packet or accepted-risk record. |
| `DELIVERY-CAL-006` | Issue/reporting work is attached to named closed outcomes, not reported as standalone delivery. | `deliveryCalibration.currentCycle.reportingAttachedToOutcomes`. |

## Stop Conditions

- Delivery/launch work reports progress with no named outcome.
- A phase/process artifact is counted as delivery while no page/cohort/blocker moved.
- Launch/opening safety evidence is missing but readiness wording is attempted.
- Owner decision is required and adjacent planning continues as progress.
- Captain reports swarm progress while the delivery calibration verdict is
  `fail_recalibrate`.
- Issue/reporting is used as progress while no named deliverable/page/cohort was
  closed in the same cycle.
