# Implementation Plan: Durable Shipped-Record Enforcement and Backfill (#916, #936)

**Date:** 2026-07-25
**Design:** `.docs/decisions/adr-2026-07-25-fail-closed-durable-shipment-evidence.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936.md`
**Stories:** `.docs/stories/durable-shipped-record-enforcement-and-backfill-916-936.md`
**Conflict check:** Clean as amended 2026-07-25

## Summary

Retain the #937 skill-driven record producer proven by #943, then add the unresolved engine-owned
durability gate, required GitHub check, human-merged repair path, and bounded historical backfill.
The narrowed plan has 20 tasks. Tasks 16–18 intentionally add no dedicated automated backfill tests;
their proof is the real complete report, exact record diff, strict verification, and idempotent rerun.

## Technical Approach

- Add one strict, read-only `shipment-evidence.ts` policy beside the existing permissive discovery
  code. It reuses the current record schema, `specHash`, and writer/discovery story-resolution
  semantics; this feature does not migrate historical hashes or rewrite the #937 producer.
- Feed the typed verdict into the still-permissive engine boundaries: `finish-record`, finish
  completion, complete-state verification, daemon ship side effects, merged-PR handling, and rekick.
- Add one deterministic association module shared by an always-reporting PR check, postmerge repair,
  and the one-time audit. False negatives are preferred to fabricated associations.
- Recovery creates or updates a deterministic record-only PR and posts the check result for its exact
  head. It never writes directly to `main`, approves, or merges.
- Add the stable check to ruleset `15933604` only after it has been observed, preserving the complete
  live ruleset and bypass inventory.

## Prerequisites

- #937 and #943 are present on `main`; Task 1 verifies rather than reimplements them.
- The operator has approved enabling Actions-created pull requests for the repair job.
- The live ruleset snapshot is captured immediately before the post-merge protection cutover.

## Tasks

### Task 1: Pin the existing finish producer as a verified prerequisite
**Story:** ST-936-2 AC1 and scope boundary
**Type:** refactor

**Steps:**
1. Run the existing finish-record and shipped-record focused suites on rebased `main`.
2. Inspect #943's final PR-head commit and record on `main`; record the satisfied-by evidence.
3. Make no producer change when the evidence passes.
4. Commit an evidence-only completion with `Evidence: satisfied-by cb9a1996,a427aa30`.

**Files:** none
**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** none

### Task 2: Implement the strict valid-evidence contract
**Story:** ST-916-1 AC1–AC2
**Type:** happy-path

**Steps:**
1. Add a failing table for an exact valid record and an idempotent repeated read.
2. Implement the typed `valid | not-applicable | refusal` result and strict required-field parsing.
3. Recompute identity with the existing plan/resolved-stories hash semantics and return checked metadata.
4. Verify GREEN and commit `feat(conductor): add strict shipment evidence verdict`.

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/src/engine/shipped-record.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`
**Wired-into:** `src/conductor/src/engine/finish-record-cli.ts#dispatchFinishRecord`, `src/conductor/src/engine/artifacts.ts#CUSTOM_COMPLETION_PREDICATES.finish`, `src/conductor/src/engine/complete-verifier.ts#verifyCompleteState`, `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`, `src/conductor/src/engine/merged-pr-guard.ts#checkMergedPrGuard`
**Dependencies:** Task 1

### Task 3: Refuse malformed and mismatched record identity
**Story:** ST-916-1 NP1, NP2, NP5
**Type:** negative-path

**Steps:**
1. Add failing table rows for absent, malformed, incomplete, slug-, PR-, and hash-mismatched records.
2. Assert distinct refusal details and byte-identical repeated evaluation.
3. Implement the closed mapping without repair or cache fallback.
4. Verify GREEN and commit `test(conductor): close shipment identity refusals`.

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`
**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 4: Refuse unreachable or unavailable evidence
**Story:** ST-916-1 NP3–NP4
**Type:** negative-path

**Steps:**
1. Add failing rows for working-tree-only, unpushed, stale-head, file, Git, and GitHub failures.
2. Implement candidate-tree/head reachability through injectable runners.
3. Assert no error or unknown dependency state can become `valid`.
4. Verify GREEN and commit `test(conductor): close shipment reachability failures`.

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`
**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 5: Gate finish-record before terminal writes
**Story:** ST-936-2 AC1, NP1–NP2
**Type:** happy-path

**Steps:**
1. Add failing PR-choice tests with valid and refused evidence.
2. Require `valid` before state, finish-choice, or DONE writes; preserve current ordered persistence.
3. Keep `keep` behavior outside the shipment contract.
4. Verify GREEN and commit `fix(conductor): gate finish recording on durable evidence`.

**Files:** `src/conductor/src/engine/finish-record-cli.ts`, `src/conductor/test/engine/finish-record-cli.test.ts`, `src/conductor/test/acceptance/finish-record-real-binary.acceptance.test.ts`
**Wired-into:** `src/conductor/src/index.ts#main`
**Dependencies:** Tasks 2–4

### Task 6: Gate finish and complete-state predicates
**Story:** ST-936-2 AC1, NP1
**Type:** happy-path

**Steps:**
1. Add failing predicates where fresh local markers exist without valid durable evidence.
2. Inject the shared verdict into finish completion and complete-state verification.
3. Preserve recognized non-shipping outcomes without record requirements.
4. Verify GREEN and commit `fix(conductor): require durable evidence for completion`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/complete-verifier.ts`, `src/conductor/test/engine/artifacts.test.ts`, `src/conductor/test/engine/complete-verifier.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#runStep`
**Dependencies:** Tasks 2–4

### Task 7: Gate daemon ship side effects and preserve retries
**Story:** ST-936-2 AC1, NP1–NP2, NP5
**Type:** negative-path

**Steps:**
1. Add a failing mode/refusal matrix over daemon and inline outcome handling.
2. Allow processed writes, cleanup, watch enrollment, and teardown only after `valid`.
3. Preserve the worktree and write an actionable HALT on refusal or persistence failure.
4. Verify GREEN and commit `fix(conductor): halt false durable shipments`.

**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/daemon-runner.test.ts`, `src/conductor/test/engine/conductor.test.ts`
**Wired-into:** `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`, `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Tasks 5–6

### Task 8: Replace synthetic merged success with verified convergence
**Story:** ST-936-2 AC2, NP3–NP4
**Type:** negative-path

**Steps:**
1. Add failing merged, recordless, invalid, and merge-state-unavailable cases.
2. Route merged PRs with valid merged-history evidence through normal completion.
3. Preserve and HALT every gap instead of writing synthetic markers.
4. Verify GREEN and commit `fix(conductor): verify merged shipment evidence`.

**Files:** `src/conductor/src/engine/merged-pr-guard.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/merged-pr-guard.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemon`, `src/conductor/src/engine/daemon-rekick.ts#resumeRebaseFirst`
**Dependencies:** Tasks 2–4

### Task 9: Classify exact implementation associations
**Story:** ST-916-3 AC1–AC2, NP2–NP3
**Type:** infrastructure

**Steps:**
1. Add failing tables for exact implementation, spec/plan/docs/repair-only, zero-, and multi-match PRs.
2. Implement exact plan stem plus PR metadata plus non-spec diff corroboration.
3. Return `not-applicable` diagnostics for unproven or ambiguous PRs without mutation.
4. Verify GREEN and commit `feat(conductor): classify shipment PR associations`.

**Files:** `src/conductor/src/engine/shipment-association.ts`, `src/conductor/test/engine/shipment-association.test.ts`
**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`
**Dependencies:** Task 2

### Task 10: Add the always-reporting pull-request check
**Story:** ST-916-3 AC1–AC3, NP1
**Type:** infrastructure

**Steps:**
1. Add failing CLI/workflow tests for valid, invalid, and not-applicable immutable heads.
2. Add the thin CLI adapter and path-filter-free pull-request workflow.
3. Emit one stable `shipped-record` result for opened, reopened, and synchronized events.
4. Verify GREEN and commit `ci: check durable shipment evidence on every PR`.

**Files:** `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/src/index.ts`, `.github/workflows/shipped-record.yml`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`
**Wired-into:** `.github/workflows/shipped-record.yml#jobs.shipment-evidence`, `src/conductor/src/index.ts#main`
**Dependencies:** Tasks 3–4, 9

### Task 11: Keep workflow failures non-successful
**Story:** ST-916-3 NP4
**Type:** negative-path

**Steps:**
1. Add failing setup, checkout, classification, and verifier failure cases.
2. Ensure no failure path reports a successful stable context.
3. Preserve useful diagnostics without guessing association.
4. Verify GREEN and commit `test(ci): fail closed on shipment check errors`.

**Files:** `.github/workflows/shipped-record.yml`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`
**Wired-into:** same as Task 10
**Dependencies:** Task 10

### Task 12: Prepare the exact ruleset-preserving cutover
**Story:** ST-916-3 AC4, NP5
**Type:** infrastructure

**Steps:**
1. Add failing snapshot tests for dropped or weakened live rules and bypass actors.
2. Implement dry-run/apply logic that adds only the stable required context after observation.
3. Re-read and compare the complete before/after inventory.
4. Verify GREEN and commit `ci: preserve main rules while requiring shipment evidence`.

**Files:** `src/conductor/src/engine/shipment-protection.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/engine/shipment-protection.test.ts`
**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`
**Dependencies:** Task 10

### Task 13: Resolve aligned and repairable merged shipments
**Story:** ST-916-4 AC1–AC3, NP1–NP2
**Type:** happy-path

**Steps:**
1. Add failing aligned, missing, invalid, ambiguous, and repeated-run cases.
2. Implement deterministic `<implementation-pr>/<slug>` repair identity and record-only diff planning.
3. Preserve accurate records byte-for-byte and leave uncertain cases write-free.
4. Verify GREEN and commit `feat(conductor): plan deterministic shipment repair`.

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`
**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`
**Dependencies:** Tasks 4, 9

### Task 14: Publish one human-merged repair PR and exact-head status
**Story:** ST-916-4 AC1, AC3–AC5
**Type:** infrastructure

**Steps:**
1. Add failing adapter tests for branch reuse, record-only commits, PR reuse, and exact-head status.
2. Implement the merged-event workflow with job-scoped contents/PR/status permissions.
3. Assert no direct-main push, approval, review request, auto-merge, or merge call exists.
4. Verify GREEN and commit `ci: propose human-reviewed shipment repairs`.

**Files:** `.github/workflows/shipped-record.yml`, `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`
**Wired-into:** `.github/workflows/shipped-record.yml#jobs.reconcile`, `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`
**Dependencies:** Tasks 10, 13

### Task 15: Close repair races, permission failures, and invalid heads
**Story:** ST-916-4 NP3–NP5
**Type:** negative-path

**Steps:**
1. Add failing competing-update, API/auth/rate-limit, invalid-head, and insufficient-permission cases.
2. Keep retry identity deterministic and forbid all direct-main or merge fallbacks.
3. Post failure for an invalid repair head and surface write failures visibly.
4. Verify GREEN and commit `test(ci): close shipment repair failure paths`.

**Files:** `.github/workflows/shipped-record.yml`, `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`
**Wired-into:** same as Task 14
**Dependencies:** Task 14

### Task 16: Implement the real-repository audit and complete report
**Story:** ST-916-5 AC1–AC4, NP1–NP5
**Type:** infrastructure

**Steps:**
1. Implement paginated plan/spec and merged-PR enumeration using the shared association/verifier policy.
2. Emit stable aligned/backfilled/unresolved/absent/ambiguous/contradictory classifications.
3. Persist complete/incomplete state before reporting success; return non-success on scan/report failure.
4. Add no dedicated backfill fixture or automated backfill test.
5. Commit `feat(conductor): audit proven historical shipments`.

**Files:** `src/conductor/src/engine/shipment-audit.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/src/index.ts`
**Wired-into:** `src/conductor/src/index.ts#main`, `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`
**Dependencies:** Tasks 4, 9, 13

### Task 17: Run the complete historical audit and inspect every proposal
**Story:** ST-916-5 AC1–AC4, NP1–NP5
**Type:** infrastructure

**Steps:**
1. Run the real audit against complete repository and GitHub history.
2. Inspect every row and generated record against its cited plan/spec and merged implementation PR.
3. Remove any unproven proposal; require the persisted report to remain complete.
4. Add no test fixture, injected failure, or dedicated backfill suite.
5. Commit `chore: record durable shipment audit evidence`.

**Files:** `.docs/audits/2026-07-25-durable-shipped-record-backfill.json`, `.docs/shipped/`
**Wired-into:** none (one-time repository data output)
**Dependencies:** Task 16

### Task 18: Prove generated records and backfill idempotency
**Story:** ST-916-5 AC2–AC4; ST-936-6 AC1
**Type:** infrastructure

**Steps:**
1. Strictly validate every generated record and inspect the exact `.docs/shipped` diff.
2. Run the audit again and require no record diff; prior backfilled rows must become aligned.
3. Preserve every unresolved or ambiguous classification unchanged.
4. Add no dedicated automated backfill test.
5. Commit `chore: backfill proven shipped records` only when the evidence is clean.

**Files:** `.docs/audits/2026-07-25-durable-shipped-record-backfill.json`, `.docs/shipped/`
**Wired-into:** none (one-time repository data output)
**Dependencies:** Task 17

### Task 19: Pin fresh-checkout discovery compatibility
**Story:** ST-936-6 AC1–AC3, NP1–NP4
**Type:** refactor

**Steps:**
1. Extend existing discovery tests only where feature, repair, and backfill landing paths lack coverage.
2. Prove repository evidence skips with an empty cache and cache-write failure cannot redispatch.
3. Pin existing renamed-hash and same-stem behavior while strict completion rejects local-only evidence.
4. Verify GREEN and commit `test(conductor): preserve durable discovery semantics`.

**Files:** `src/conductor/test/engine/shipped-record.test.ts`, `src/conductor/test/engine/daemon-deps.test.ts`, `src/conductor/test/acceptance/shipped-work-dedup.acceptance.test.ts`, `src/conductor/test/integration/empty-ledger-replay-guard.integration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 5–8, 18

### Task 20: Verify the integrated shipment boundary and prepare cutover
**Story:** Supports ST-916-1, ST-936-2, ST-916-3, ST-916-4, ST-916-5, ST-936-6
**Type:** infrastructure

**Steps:**
1. Run focused verifier, finish, daemon, guard, workflow, repair, and discovery suites plus typecheck/build.
2. Run the full repository verification suite and inspect the feature diff.
3. Confirm the audit report, strict record verification, and second-run idempotency evidence.
4. Observe the stable check on the implementation PR; after merge, apply and re-read the exact ruleset cutover.
5. Commit no ordinary documentation-only changes in this task.

**Files:** none
**Wired-into:** none (delivery verification and external ruleset cutover)
**Verify-only:** yes
**Dependencies:** Tasks 11–12, 15, 19

## Task Dependency Graph

```text
1 -> 2 -> {3,4}
{3,4} -> {5,6,9}
{5,6} -> 7
4 -> 8
{3,4,9} -> 10 -> {11,12}
{4,9} -> 13 -> 14 -> 15
{4,9,13} -> 16 -> 17 -> 18
{5,6,7,8,18} -> 19
{11,12,15,19} -> 20
```

## Integration Points

- After Task 4: one strict verifier closes content, identity, reachability, and dependency failures.
- After Task 8: engine completion cannot converge or synthesize success without valid evidence.
- After Task 12: the stable PR check exists and the exact protection cutover is ready.
- After Task 15: missing merged records produce at most one human-merged repair PR.
- After Task 18: the real historical backfill is reviewed, verified, and idempotent without a test suite.
- After Task 20: implementation, recovery, discovery, and live ruleset evidence are complete.

## Post-Merge Protection Cutover

Do not require an unobserved context. After the implementation PR has emitted `shipped-record` and
merged, run the dry-run against live ruleset `15933604`, apply only the additive required-status
change, then re-read and compare every rule, condition, bypass actor, review count, and merge method.

## Coverage Mapping

| Story | Tasks |
|---|---|
| ST-916-1 | 2–4 |
| ST-936-2 | 1, 5–8 |
| ST-916-3 | 9–12 |
| ST-916-4 | 13–15 |
| ST-916-5 | 16–18 |
| ST-936-6 | 18–20 |

## Verification

- [ ] Existing #937/#943 producer behavior is verified and not reimplemented.
- [ ] Every happy and negative acceptance path maps to a task.
- [ ] Every task declares files, wiring, and dependencies; the graph is acyclic.
- [ ] Plan contains 20 tasks, within the normal scope band.
- [ ] Tasks 16–18 add no dedicated automated historical-backfill tests.
- [ ] All reusable verifier, engine, Action, repair, and discovery behavior remains test-covered.
- [ ] The live ruleset gains only the stable required context and retains every prior protection.
