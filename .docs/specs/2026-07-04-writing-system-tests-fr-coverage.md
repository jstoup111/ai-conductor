# PRD: FR→Acceptance-Spec Coverage Gate for Acceptance-Test Generation

**Date:** 2026-07-04
**Status:** Approved
**Source:** Intake jstoup111/ai-conductor#244

## Problem / Background

On the product track, the acceptance-test-generation step derives specs from stories, and its
dedup rules deliberately skip stories whose behavior is covered by lower-layer tests. That skip
is correct for test economy, but it silently drops the guarantee that every functional
requirement in the approved PRD is traceable to a test. The gap surfaces only at SHIP, when the
PRD audit walks the FR list and finds un-aligned requirements — kicking the feature back to
BUILD for another round.

This is not hypothetical: the 2026-07-03 `dependency-ordered-intake-and-dispatch` run needed
**three** audit rounds (8 un-aligned FRs, then 3, then clean) — hours of wall-clock spent
closing gaps that were knowable before the first line of implementation was written.

The fix is to make FR coverage explicit and enforced at the moment acceptance specs are
generated (the RED phase), so the first build round lands aligned.

## Goals & Non-Goals

**Goals**
- Every functional requirement in the approved PRD is explicitly accounted for before
  implementation begins — mapped to a test or to a deliberate, named disposition.
- Coverage gaps are impossible to overlook: an unaccounted-for FR stops the acceptance-test
  step from completing, rather than surfacing later as audit rework.
- The PRD-audit step at SHIP finds round-1 implementations already aligned, eliminating
  routine build→audit rework rounds.

**Non-Goals**
- No change to the TDD cycle (RED → DOMAIN → GREEN → DOMAIN → COMMIT).
- No change to the PRD-audit gate itself — the audit remains the independent verifier; this
  feature makes round 1 pass it, it does not weaken or replace it.
- No new acceptance specs for behavior that lower-layer tests already cover — the existing
  test-economy (dedup) rules stay intact.
- No coverage requirement on the technical track (it has no PRD, hence no FR list).

## Users / Personas

- **The operator (James)** — wants features to clear the SHIP audit in one round instead of
  burning wall-clock on rework loops he has to supervise.
- **The autonomous build daemon** — executes the BUILD phase unattended; a gap it can ignore
  is a gap it will ignore, so visibility must come with enforcement.
- **The SHIP-phase auditor** — walks the FR list at the end; benefits from an existing
  FR→evidence map as its starting point.

## Functional Requirements

- **FR-1:** On the product track, the acceptance-test-generation step produces a coverage
  table with exactly one row per functional requirement (`FR-N`) in the feature's approved
  PRD — no FR omitted, no extra FRs invented.
- **FR-2:** Each coverage row resolves the FR to exactly one of three dispositions:
  (a) **spec-covered** — at least one generated acceptance spec exercises the FR;
  (b) **unit-covered** — the FR's stories are single-operation and will be covered by
  lower-layer tests written during implementation, citing the story that carries the FR;
  (c) **already-tested** — an existing test already asserts the behavior, citing that test.
- **FR-3:** Every acceptance spec counted as covering an FR identifies that FR visibly in the
  spec itself, so a reader (or the SHIP auditor) can find the FR's tests by searching for the
  FR's identifier.
- **FR-4:** A disposition row must cite its evidence: spec-covered names the spec file(s),
  unit-covered names the story, already-tested names the existing test. A row with no
  citation is unresolved.
- **FR-5 (negative):** If any FR is unresolved — missing from the table, or lacking a valid
  disposition/citation — the acceptance-test-generation step reports the specific unresolved
  FRs and does NOT complete; the build cannot proceed to implementation past an unresolved FR.
- **FR-6:** The coverage table is recorded as run evidence alongside the step's existing RED
  evidence (not a committed design artifact), where the operator and later SHIP-phase steps
  can read it.
- **FR-7 (negative):** On the technical track, or when no approved PRD exists for the feature,
  the step performs no FR-coverage work and completes exactly as it does today.

## Non-Functional Requirements

- The coverage check must not weaken existing gates: the RED-evidence requirement (specs
  actually executed and failing) applies unchanged to whatever specs are generated.

## Acceptance Criteria / Success Metrics

- Given an approved PRD with N functional requirements, the step's coverage table has exactly
  N rows, each resolved with a citation, before the step reports success.
- Given one FR with no spec, no qualifying story, and no existing test, the step names that FR
  in its failure output and does not complete.
- A product-track feature built after this change reaches the SHIP audit with zero un-aligned
  FRs attributable to missing test coverage (success metric: audit rounds per feature drops
  to 1 for coverage-related gaps).
- Technical-track features show no behavioral change.

## Scope

### In Scope
- The acceptance-test-generation skill's documented process and its self-enforced completion
  gate, on the product track.
- Harness documentation reflecting the new behavior (docs track features).

### Out of Scope
- The PRD-audit skill and its gating logic.
- The TDD skill and its cycle.
- Engine/conductor code changes (the gate is self-enforced by the skill, per harness
  convention).
- Retroactive coverage tables for already-shipped features.

## Key Decisions & Rationale

- **Disposition-based coverage, not spec-per-FR** (operator-confirmed): forcing an acceptance
  spec for every FR would duplicate lower-layer tests and violate the step's test-economy
  rules. Accountability comes from the explicit, cited disposition — not from redundant specs.
- **Enforced, not advisory** (operator-confirmed): the BUILD phase runs unattended; a visible
  but ignorable gap would be ignored and the audit rework rounds would persist. Blocking on an
  unresolved FR is the only version that changes the outcome.
- **Recorded as run evidence, not a committed artifact**: the table describes one run's
  coverage state, like the existing RED evidence; committing it would create merge noise
  without adding traceability (the specs themselves carry the FR identifiers durably).

## Dependencies

- The PRD authoring step's enumerated `FR-N` convention (pre-existing).
- The story-authoring step's FR tagging (each story names the FR it came from — pre-existing
  traceability this feature consumes).
- The acceptance-test step's existing classification of stories (multi-step vs
  single-operation) and its RED-evidence recording (pre-existing).

## Open Questions

- Exact naming/format of the coverage-table evidence file and the FR-identifier convention
  inside spec files — a load-bearing formatting choice for the implementation plan to settle
  (tier S: no architecture-review runs; there is no engine consumer to coordinate with, so
  the plan may decide it locally).
