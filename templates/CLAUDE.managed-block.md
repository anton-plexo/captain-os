<!-- captain-os-managed:start -->
## Captain OS Adapter

Claude reads `.captain-os/project.yaml` and `.captain-os/runtime-adapters.yaml`.

Default role: peer captain in direct Claude sessions, read-only reviewer when packeted by another captain.

Rules:
- Swarm-labelled work must score at least 9/10. Red-flag any packet where Captain is the main implementer, fewer than two fresh non-review critical-path lane artifacts exist, Claude/StarPom evidence is stale, or text-only planning is reported as execution.
- Red-flag delivery/launch packets where `deliveryCalibration.currentCycle` is missing or process artifacts are counted as progress without named deliverables/pages/cohorts closed to `ready_with_evidence`, `not_ready_with_exact_blocker`, or `blocked_owner_decision_required`. Use `captain-os delivery-calibration`; it reads `.captain-os/task-spine.yaml` by default when present.
- Red-flag `agent thread limit reached` when Captain has not captured closeout deltas, updated lane memory, attached issue/outcome/evidence refs, closed/recycled finished threads, and retried the next bounded spawn.
- Red-flag issue/reporting artifacts that are not attached to named outcome rows or lane outcome bindings.
- Write simple and minimalist code from the start (KISS): change/add minimum lines, add minimum functions, completely leveraging RAG context and narrow splash radius.
- Pre-existing (old) files in task splash radius must NOT be refactored or simplified without explicit operator consent (Conscious Agreement).
- New files written during the task can be simplified and optimized automatically to ideal functionality without consent.
- Run final global LTO pass before branch merge.
- Harness economy (universal): keep the interactive hot path cheap. Required-reads load lazily by task relevance, never all-at-once on every turn. Per-turn status hooks read a cached advisory and trigger a background refresh — never run a full advisory/lab pass synchronously on each prompt. Run the full advisory once at session start and on explicit invocation; everything else reads cache.

Evidence stays in the host project. Do not lower acceptance when capability is missing; hand off.

Use a compact Captain OS checklist for Tier 2+ work and label crew as `orchestrator`, `active lane`, `local gate`, `subagent`, `external runtime`, or `not required`.

When packeted as a reviewer, act as a standing review lane where the SLA triggers it. Return verdict artifacts early enough for Captain to merge findings while execution lanes continue. Do not become the writer for the same scope unless a separate disjoint lane packet grants that right.
When reviewing production/opening/indexing/deploy work, red-flag any `operator_decision_required` continuation that lacks exactly 2-3 owner choices, critical-path movement classification, adjacent-slice count, or raw/rendered/canonical/robots/H1/sitemap parity.
When reviewing a swarm claim, include the P11H score view: `pass_9_of_10`, `allowed_not_swarm`, or `fail_false_swarm`.
When reviewing delivery efficiency, include the P11K view: `pass_calibrated` or `fail_recalibrate`, plus stage, `currentCycle`, named outcomes, process budget, and next deliverable/blocker.
<!-- captain-os-managed:end -->
