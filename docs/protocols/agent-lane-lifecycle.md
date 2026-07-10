# Agent Lane Lifecycle Runtime

Status: core_protocol_p11l_draft
Owner: Captain OS Core + Runtime + StarPom
Scope: portable lifecycle for agent thread capacity, lane memory, and outcome-bound reporting

## Purpose

Captain OS must treat agent thread capacity as a managed runtime resource. A
thread limit is not permission for Captain to do broad local work while still
using swarm language.

The invariant is:

```text
close threads after preserving lane state, then retry bounded swarm work
```

## Thread Limit Lifecycle

When the host runtime reports `agent thread limit reached`:

1. Identify stale, finished, blocked, and recyclable lanes.
2. Capture each lane closeout delta.
3. Attach issue, outcome, and evidence refs, or record the exact blocker.
4. Update `.captain-os/task-spine.yaml` lane memory.
5. Call the host close/archive primitive for finished agent threads.
6. Retry spawn for the next bounded lane.
7. If retry still fails, downgrade to `allowed_not_swarm` with a visible
   blocker and no broad Captain-local progress claim.

## Required Spine Fields

```yaml
currentLanes:
  swarmCapacity:
    maxOpenAgentThreads: 3
    onThreadLimit: close_finished_lanes_then_retry
    closeRequires:
      - lane delta captured
      - lane memory updated
      - issue/outcome/evidence refs attached or blocker recorded
    closeAgentsAttempted: false
    retrySpawnScheduled: false
```

## Outcome Binding

Critical-path lane artifacts that are issues, reports, or status updates must
bind to a concrete outcome:

```yaml
outcomeBinding:
  issueRef: "#123"
  outcomeId: page:/example
  outcomeState: ready_with_evidence
  evidenceRefs:
    - .ship/evidence/example.json
```

Valid outcome states:

- `ready_with_evidence`
- `not_ready_with_exact_blocker`
- `blocked_owner_decision_required`

Detached issue/reporting work is process work, not delivery or swarm progress.

## Mechanical Guards

- `captain-os agent-lane-lifecycle --outcomes <a,b> --pr <ref>` generates the
  bounded live-monitor corrective packet for thread-limit recovery.
- `captain-os swarm-score` fails swarm-labelled work when thread-limit closeout,
  lane memory, close/recycle, retry, or outcome binding is missing.
- `captain-os delivery-calibration` fails delivery/launch cycles when reporting
  is detached from named closed outcomes.

## Stop Conditions

- Thread limit occurs and no recycle audit is recorded.
- Broad Captain-local implementation continues after thread limit without a
  visible bounded fallback.
- A lane artifact is productive and critical-path, but has no outcome binding.
- Issue/reporting is claimed as delivery while no named outcome moved.
