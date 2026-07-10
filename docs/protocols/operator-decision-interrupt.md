# Operator Decision Interrupt

Status: portable runtime contract
Owner: Captain + StarPom + Runtime

## Purpose

When the user goal is production, opening, indexing, deploy, GSC, sitemap, or another external visibility outcome, a blocker that requires owner choice is a hard interrupt for the critical path. The Captain may not keep generating adjacent planning as the default path.

## Runtime Rule

Emit `operator_decision_required_interrupt` when:

- the original user goal requires production/opening/indexing/deploy visibility; and
- a major blocker requires Anton/operator/owner choice.

Captain must then:

- stop the critical path;
- name exactly 2-3 owner choices;
- mark the next packet as `blocked_waiting_owner` unless it truly moves the original goal;
- forbid adjacent planning as the default continuation;
- allow adjacent planning only as an explicit timeboxed bypass with owner-visible warning.

## Critical Path Gate

Every packet after a major blocker must write one of:

- `moves_original_goal`
- `adjacent_planning_only`
- `evidence_only`
- `blocked_waiting_owner`

It must also state how many adjacent planning/evidence slices have happened after the blocker.

## Blocked-But-Continuing Budget

StarPom raises `blocked_but_continuing_budget` when either is true:

- more than 2 planning-only packets happened after the blocker; or
- more than 2 hours passed after the blocker without owner decision.

The only allowed continuation is owner decision or an explicit timeboxed bypass with warning.

## SEO/Production False-Green

For SEO/opening/production, HTTP 200 is transport evidence only. It is never success without parity evidence for:

- raw HTML;
- rendered HTML;
- canonical;
- robots;
- H1;
- sitemap.

Missing parity emits `seo_http_200_false_green_parity_missing`.

## Planning-Only Closure Language

Generic `ready_for_execution` is forbidden unless a scoped supersession or execution authority is attached. A planning-only/advisory packet with no blockers must close as:

`ready_for_owner_review_planning_only`

## Swarm Guard

Root-repair and portfolio-program packets must use persistent lanes, not sequential one-shot reviewers:

- `activeLanes` / `laneStates`, not one `activeLane`;
- lane memory persists across launches;
- blocker repair, adjacent planning, evidence, and StarPom have separate owner lanes;
- Captain orchestrates and resolves conflicts instead of becoming the hidden primary worker.

## Regression Fixture

`operator-decision-required-adjacent-planning-continues` represents the SEO incident:

- production/GSC/indexing visibility goal;
- `status_200_false_green_raw_spa_shell_rendered_404_sitemap_excluded`;
- `operator_decision_required_no_progress_bump`;
- adjacent planning continued after blocker;
- HTTP 200 used without raw/rendered/canonical/robots/H1/sitemap parity.

Expected blocks:

- `operator_decision_required_interrupt`
- `critical_path_vs_adjacent_work`
- `blocked_but_continuing_budget`
- `seo_http_200_false_green_parity_missing`
