# PRD: Single Full-Suite Verification Gate

**Date:** 2026-07-25
**Status:** Approved

## Problem / Background

The delivery workflow repeatedly runs the full local test suite against an unchanged project.
Implementation cycles, batch boundaries, final review, completion verification, and pre-push
verification can each request another full run even when no test-relevant input has changed.
Feature #927 recorded at least fourteen BUILD and SHIP-remediation full-suite runs before its
later completion checks.

This repetition increases delivery time and local resource consumption without producing new
evidence. At the same time, moving verification too late would delay feedback and prevent the
automated flow from routing a failing suite back to implementation before SHIP begins.

## Goals & Non-Goals

**Goals**

- Run the full local suite no more than once after the final test-relevant mutation and before
  pull-request creation.
- Make full-suite verification an explicit pre-SHIP gate whose failure returns work to BUILD.
- Keep ordinary implementation and intermediate review fast through scoped tests.
- Apply the same verification guarantees to automated delivery and direct-Claude guidance.
- Retain an independent authoritative CI run.

**Non-Goals**

- Changing the tests contained in a project's suite.
- Removing scoped verification during implementation.
- Changing post-mutation verification for automated conflict resolution or CI repair.
- Changing the legacy Bash conductor.
- Moving the repository's harness-integrity validation into this feature; a dedicated pre-finish
  validation step may be handled separately.

## Users / Personas

- **Feature operator:** wants delivery to remain safe without waiting for redundant local runs.
- **Autonomous-build operator:** wants suite failures routed back to implementation without manual
  intervention.
- **Direct-Claude operator:** wants the guided workflow to enforce the same pre-SHIP safety gate.
- **Project maintainer:** wants a clear way to identify the project's authoritative local suite.

## Functional Requirements

- **FR-1:** Automated delivery must include an explicit full-suite verification gate after BUILD
  quality checks and before any SHIP validation begins.
- **FR-2:** Direct-Claude guidance must include the equivalent full-suite verification gate after
  BUILD and before any SHIP validation begins.
- **FR-3:** A successful, current full-suite result must satisfy the gate without executing the
  unchanged suite again.
- **FR-4:** From the final test-relevant mutation through pull-request creation, an unchanged set
  of verification inputs must execute the full local suite no more than once.
- **FR-5:** Ordinary implementation cycles, batch boundaries, parallel-work joins, and evaluator
  reviews must use scoped or impacted tests rather than independently requiring the full suite.
- **FR-6:** When a broad or uncertain change requires an earlier full-suite run, that successful
  result must satisfy the later gate if no test-relevant input changes afterward.
- **FR-7:** A failing full suite in automated delivery must block SHIP and route the feature back
  to BUILD with the failure output needed for remediation.
- **FR-8:** A failing full suite in direct-Claude guidance must block SHIP and direct the operator
  back to implementation with the failure output needed for remediation.
- **FR-9:** A project must be able to identify its authoritative local full-suite operation.
- **FR-10:** If the authoritative suite operation is missing, cannot be resolved, cannot launch,
  times out, or exits unsuccessfully, the gate must fail closed and block SHIP.
- **FR-11:** Changes to source, tests, configuration, dependencies, migrations, test
  infrastructure, or relevant execution-environment inputs must invalidate an earlier successful
  result.
- **FR-12:** Documentation-only changes must not invalidate an otherwise current successful
  result.
- **FR-13:** Completion verification must accept a current successful gate result and must run the
  full suite itself only when that result is missing or stale.
- **FR-14:** Pre-push pull-request preparation must not independently rerun the local suite.
- **FR-15:** CI must continue to execute its independent authoritative full suite for every
  applicable pull-request revision.
- **FR-16:** The workflow must visibly report whether full-suite verification executed, reused a
  current result, failed, or became stale, including the reason for failure or invalidation.
- **FR-17:** Automated conflict resolution and CI repair must retain their existing post-mutation
  suite checks.

## Non-Functional Requirements

- Freshness decisions must fail closed when required verification inputs cannot be determined.
- Verification status and failure evidence must survive step and session boundaries within the
  same feature delivery.
- Equivalent project state must produce equivalent run-versus-reuse decisions in automated and
  direct-Claude flows.
- Failure output must be bounded enough for operational use while retaining the failing test names
  and actionable error details.

## Acceptance Criteria / Success Metrics

- A Medium or Large feature with multiple implementation batches performs only scoped tests during
  those batches and executes one full local suite before SHIP.
- An unchanged feature proceeds through completion and pull-request preparation without a second
  local full-suite execution.
- A source or test change after a successful run makes the prior result stale and causes a new run
  before SHIP.
- A dependency, migration, test-infrastructure, or relevant environment change makes the prior
  result stale and causes a new run before SHIP.
- A documentation-only change preserves the successful result.
- A failing suite automatically returns automated delivery to BUILD and prevents all SHIP
  validators from running.
- A failing suite blocks direct-Claude progression to SHIP and presents actionable remediation
  evidence.
- Missing or unlaunchable suite configuration blocks SHIP rather than passing or skipping.
- Standalone completion verification runs the full suite when no current result exists.
- Pull-request preparation performs no additional local suite run, while CI still runs its
  independent suite.

## Scope

### In Scope

- Full-suite gate behavior in the TypeScript conductor.
- Equivalent gate behavior in the direct-Claude SDLC flow.
- Current-result recognition, invalidation, and completion fallback behavior.
- Removal of redundant full-suite requirements from implementation, batch, evaluator, conductor,
  and pull-request guidance.
- Workflow status and failure reporting for the gate.
- Documentation for declaring a project's authoritative local suite.

### Out of Scope

- Legacy Bash conductor behavior.
- CI suite contents or CI required-check policy.
- Automated conflict-resolution and CI-repair suite behavior.
- Repository harness-integrity scheduling.
- General-purpose caching of arbitrary lint, typecheck, security, or manual-test results.

## Key Decisions & Rationale

- **Full-suite verification is a first-class pre-SHIP gate.** This discovers regressions early
  enough for automated BUILD remediation while keeping SHIP validators off an unverified tree.
- **Earlier workflow checks are scoped.** Fast feedback remains available without repeatedly
  proving the entire unchanged project.
- **Current successful verification is reusable.** Re-executing identical verification adds no
  signal.
- **Missing verification fails closed.** Absence of a runnable authoritative suite is not evidence
  that the project is safe to ship.
- **Completion provides the fallback; pull-request preparation does not.** Standalone completion
  remains safe, while the normal flow does not duplicate work immediately before push.
- **CI remains independent.** Local reuse never weakens the remote merge gate.
- **Automated and direct-Claude flows share the same product guarantees.** Operators receive the
  same safety and efficiency regardless of orchestration surface.

## Dependencies

- Projects must have an authoritative local full-suite operation.
- The existing BUILD remediation loop must remain capable of receiving verification failures.
- CI remains the independent final authority for pull-request revisions.

## Open Questions

- What declaration mechanism should projects use for their authoritative local suite?
- Which project and environment inputs should form the freshness identity, and how should
  indeterminate inputs be handled without weakening fail-closed behavior?
- How should bounded failure output retain enough detail for automated remediation across
  different test runners?
