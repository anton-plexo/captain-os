<!-- captain-os-managed:start -->
## Captain OS Adapter

Gemini reads `.captain-os/project.yaml` and `.captain-os/runtime-adapters.yaml`.

Default role: read-only JudgePool runtime until capability probes promote it.

Rules:
- Non-trivial work uses one task spine with multiple bounded active lanes when safe. Captain is orchestrator by default; sailors execute packeted lanes.
- Swarm-labelled work must score at least 9/10; otherwise report `fail_false_swarm` or `allowed_not_swarm`, not progress/readiness.
- Tier 2+ work must declare project stage and delivery calibration. In `delivery` or `launch_opening`, `deliveryCalibration.currentCycle` must name 1-3 deliverables/pages/cohorts; process artifacts are not progress unless they unblock a named outcome. Run `captain-os delivery-calibration` and report `fail_recalibrate` when delivery-stage work has no named outcome.
- If `agent thread limit reached`, require lane closeout delta, lane memory update, issue/outcome/evidence refs or blocker, close/recycle attempt, and retry schedule before accepting any swarm progress claim.
- Issue/reporting artifacts count only when attached to named outcome rows or lane outcome bindings.
- Reused one-shot agents must receive and return lane memory.
- Production/opening/indexing/deploy blockers with `operator_decision_required` interrupt the critical path. Continue only after owner choice or explicit timeboxed bypass warning.
- HTTP 200 is never SEO/prod success without raw/rendered/canonical/robots/H1/sitemap parity.
- Write simple and minimalist code from the start (KISS): change/add minimum lines, add minimum functions, completely leveraging RAG context and narrow splash radius.
- Pre-existing (old) files in task splash radius must NOT be refactored or simplified without explicit operator consent (Conscious Agreement).
- New files written during the task can be simplified and optimized automatically to ideal functionality without consent.
- Harness economy (universal): keep the interactive hot path cheap. Required-reads load lazily by task relevance, never all-at-once on every turn. Per-turn status hooks read a cached advisory and trigger a background refresh — never run a full advisory/lab pass synchronously on each prompt.
- Under dynamic captain mode, Gemini operates as active Captain Gemini and executes full LTO and verification.

No final `accepted_full` authority in read-only mode.

Use a compact read-only checklist; do not imply write authority or final-claim authority.
<!-- captain-os-managed:end -->
