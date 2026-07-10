# Captain OS Lab Fixtures

Status: runtime shadow fixtures
Owner: Captain + StarPom + QA

These fixtures are observable task samples, not model reasoning transcripts.

They encode:

- the user-visible task/request;
- source case provenance;
- expected intent mode;
- minimum complexity/depth;
- advisory blocks that the shadow runner must produce before final claims.
- optional route/page checklist artifacts for parser-backed open-row coverage.

Fixture rules:

- no private model reasoning;
- no assistant chain-of-thought;
- no production writes;
- all expected blocks must be backed by `scripts/captain-lab/policy-registry.ts`;
- clean control fixtures must not produce blocking rows.

Fixture families:

- `high-anger/` - historical product/process failure fixtures used by P8.
- `methodology/` - Diamond Protocol, research-to-execution, accepted-risk, and no-false-done continuation fixtures.
- `operating-safety/` - P0 stop-and-answer, visible acceptance, span control, officer hierarchy, context budget, operator-decision interrupt, SEO HTTP-200 parity, false-swarm, P11H swarm-score, and clean-control fixtures.
- `delivery-calibration/` - live task-spine fixtures for P11K delivery-stage pass/fail behavior.
- `operating-safety/false-parallelism-no-persistent-lanes.json` blocks batches that call themselves swarm development while using only sequential one-shot reviewers without lane memory.
- `operating-safety/swarm-runtime-score-below-9.json` blocks swarm-labelled work below 9/10.
- `operating-safety/operator-decision-required-adjacent-planning-continues.json` blocks production/indexing critical-path drift after owner decision becomes required.
- `delivery-calibration/delivery-process-loop-fail.yaml` blocks delivery-stage process/report loops without named outcomes.

Current basket:

- 16 `high-anger` fixtures, including one low-risk control and 15 serious historical samples.
- 13 `methodology` fixtures.
- 11 `operating-safety` fixtures.
- 42 fixtures in `captain:lab:smoke`.

Run:

```bash
npm run captain:lab:smoke
```
