<!-- captain-os-managed:start -->
## Captain OS Adapter

Project manifest: `.captain-os/project.yaml`
Runtime adapter: `.captain-os/runtime-adapters.yaml`
Evidence path: `.ship/lab/runs`
Global blocking: disabled by default

Rules:
- Non-trivial work uses one task spine with multiple bounded active lanes when safe. Captain is orchestrator by default; sailors execute packeted lanes.
- For Tier 2+ implementation, choose `single_lane` with a reason or `parallel_lane_swarm` with 2-4 active lanes, lane memory, disjoint scope, evidence owed, and stop conditions.
- Swarm-labelled work must score at least 9/10. Captain implementation share must be `<= 50%`, at least two fresh non-review critical-path lane artifacts must exist, Claude Code and StarPom must be fresh when required, and text-only planning is not execution. Run `captain-os swarm-score` before PR/final swarm claims.
- Tier 2+ work must declare `projectStage` (`discovery`, `planning`, `delivery`, `launch_opening`, `incident_repair`, or `maintenance`) and apply delivery calibration. Delivery/launch cycles must fill `deliveryCalibration.currentCycle`, name 1-3 deliverables/pages/cohorts, and close them to `ready_with_evidence`, `not_ready_with_exact_blocker`, or `blocked_owner_decision_required`; process artifacts count only when they unblock a named outcome. `captain-os delivery-calibration` reads `.captain-os/task-spine.yaml` by default; if it returns `fail_recalibrate`, the next packet must change shape before progress/readiness wording continues.
- If `agent thread limit reached`, capture lane closeout deltas, attach issue/outcome/evidence refs or blocker, update lane memory, close/archive finished threads, then retry the next bounded spawn. Broad Captain-local fallback without that lifecycle is not swarm.
- Issue/reporting artifacts count as delivery or critical-path swarm movement only when bound to a named `outcomeRows` entry or lane `outcomeBinding`.
- Reused one-shot agents must receive their previous lane memory and must return an updated lane delta.
- If production/opening/indexing/deploy work hits `operator_decision_required`, stop the critical path, name exactly 2-3 owner choices, and do not continue adjacent planning unless the owner explicitly approves a timeboxed bypass with visible warning.
- Each packet after a major blocker must state `criticalPathMovement`, `adjacentPlanningSlicesAfterBlocker`, and whether it moves the original user goal. HTTP 200 is never SEO/prod success without raw/rendered/canonical/robots/H1/sitemap parity.
- Write simple and minimalist code from the start (KISS): change/add minimum lines, add minimum functions, completely leveraging RAG context and narrow splash radius.
- Pre-existing (old) files in task splash radius must NOT be refactored or simplified without explicit operator consent (Conscious Agreement).
- New files written during the task can be simplified and optimized automatically to ideal functionality without consent.
- Harness economy (universal): keep the interactive hot path cheap. Required-reads load lazily by task relevance, never all-at-once on every turn. Per-turn status hooks read a cached advisory and trigger a background refresh — never run a full advisory/lab pass synchronously on each prompt.
- Under dynamic captain mode, the active LLM runs final global link-time optimization (LTO) before branch merge.

Use a compact Captain OS checklist for Tier 2+ work:

```text
Captain OS: T?/D? shadow|advisory
✓ intent classified
✓ context pack attached
✓ splash radius attached
✓ crew: Captain orchestrator; active lanes <count>; Runtime local gate; StarPom local gate
✓ critical path: <moves_original_goal|adjacent_planning_only|evidence_only|blocked_waiting_owner>; adjacent slices after blocker: <n>
✓ swarm score: <n/10 or not_swarm>; Captain implementation share: <n%>
✓ delivery calibration: <stage>; outcomes: <closed/named>; process budget: <ok|over>
✓ lane memory: <refs or single_lane reason>
✓ evidence: <run/report path or ->
✓ stops checked
---
```
<!-- captain-os-managed:end -->
