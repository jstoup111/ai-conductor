# Complexity: rebase-invalidated-test-failures-never-reach-build

Tier: M

## Rationale

Medium. Internal engine work with no new external surface, but more than a localized patch.

**Signals present**
- **Cross-module state contract.** Attribution moves from a transient gate-verdict field to a
  durable read of the event spine (`.pipeline/events.jsonl`), changing the contract between
  `rebase.ts`, `gate-verdicts.ts`, `test-suite-remediation.ts`, `build-review-inputs.ts` and
  `conductor.ts`. Five modules, one invariant.
- **A causal join with correctness consequences in both directions.** Under-attribute and the
  churn persists; over-attribute and genuinely unplanned deletions get laundered (desired
  outcome 4 is an explicit anti-goal guard). The join needs its own design decision and its
  own negative-path coverage.
- **Generalization across call sites.** Repair recording is currently `test_suite`-only at two
  hardcoded sites; it must become gate-agnostic without disturbing the kickback-budget paths
  those sites sit inside.
- **New operator-visible provenance.** Grading-provenance recording is an additive surface that
  needs a durable home and a reader.
- **Concurrent in-flight neighbour.** `repeated-build-review-semantic-failures-can-churn-` edits
  the same two grader-input files; sequencing is a real planning constraint.

**Signals absent**
- No data model, migration, or persistence schema beyond one existing JSON ledger's shape.
- No authentication, authorization, or external integration.
- No user-facing UI, API, or CLI surface change.
- No new provider or third-party boundary.

Not Small: it is not a one-file change and it carries a design decision (the causal join) that
needs architecture review and conflict-check against in-flight work.
Not Large: bounded to one subsystem, no new state machine, no schema or contract migration for
consumers, and an estimated single-digit story count.
