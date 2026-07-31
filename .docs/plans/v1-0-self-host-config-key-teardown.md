# Implementation Plan: v1.0 self-host config-key teardown

**Date:** 2026-07-30
**Design:** Technical track; Small tier (architecture review skipped)
**Stories:** `.docs/stories/v1-0-self-host-config-key-teardown.md`
**Conflict check:** Skipped for Small tier

## Summary

Remove dead attribution cutover contracts and obsolete self-host cutover residue while
preserving the pre-1.0 freeze, live audit sampling, and stamped-owner protection. Two scoped
TDD tasks cover the shared schema teardown and owner-gate observability correction.

## Technical Approach

Delete `attribution_enforcement_cutover` and `attribution_judge_cutover` end-to-end because
neither has a production consumer: remove their config types, known-key entries, validation
branches, dead config tests, and stale fixture dependencies. Keep
`attribution_audit_sample_pct`, which is consumed by attribution telemetry. Separately remove
this repository's historical `owner_gate_cutover`; because its absence does not skip unowned
specs, delete the contradictory global warning and retain the accurate per-spec
`unowned-defaulted` notice. Preserve the matching pre-1.0 `version_freeze`; #226 removes it
when `VERSION` becomes `1.0.0`.

The removed shared config keys are a consumer-facing compatibility break. The repository's
release/documentation gate must update the canonical configuration reference and add a
runnable migration that deletes both keys from consumer config files.

## Prerequisites

- The #226 issue comment records the deferred `version_freeze` removal.
- The repository remains below v1.0 while these tasks land.

## Tasks

### Task 1: Remove dead attribution cutover config contracts

**Story:** Retire obsolete self-host cutover residue without weakening ownership — dead-code
teardown and audit-retention criteria

**Type:** refactor

**Steps:**
1. Replace the former acceptance tests with focused assertions that both retired cutover
   keys are rejected as unknown while `attribution_audit_sample_pct` remains accepted and
   resolved.
2. Run the focused config tests and verify the retired-key rejection assertions fail (RED).
3. Remove both fields from `HarnessConfig`, the known-key allow-list, and validation logic;
   remove obsolete config tests and update dependent fixtures that used a no-op cutover value.
4. Keep live telemetry tests and the audit sampling config contract unchanged.
5. Run the focused config, attribution wiring, template, and consumer-config isolation tests;
   verify they pass (GREEN).
6. Commit with message: `refactor: remove retired attribution cutover config`.

**Files:**
- `src/conductor/src/types/config.ts`
- `src/conductor/src/engine/config.ts`
- `src/conductor/test/engine/config.test.ts`
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts`
- `src/conductor/test/engine/config-template.test.ts`
- `src/conductor/test/acceptance/non-daemon-projects-inherit-self-host-config-inste.acceptance.test.ts`

**Wired-into:** none (removes dead production surfaces)

**Dependencies:** none

### Task 2: Clean self-host residue and align owner-gate observability

**Story:** Retire obsolete self-host cutover residue without weakening ownership — owner,
freeze, and notice criteria

**Type:** negative-path

**Steps:**
1. Add focused `daemon-backlog` tests proving that a resolved owner with no cutover emits no
   false global "un-owned specs skipped" notice, an unowned spec still emits its accurate
   default-build notice, and a differently stamped owner still skips.
2. Run the focused test and verify the new no-cutover assertion fails (RED).
3. Remove the contradictory no-cutover warning branch and its unused dedup key/helper without
   changing `decideSpecGate` or stamped-owner matching.
4. Remove `owner_gate_cutover` and the commented retired judge-cutover block from
   `.ai-conductor/config.yml`; verify both retired attribution cutovers remain absent while
   audit sampling and the matching pre-1.0 freeze remain.
5. Run the focused test and the repository's test-file-covering typecheck; verify both pass
   (GREEN).
6. Run `test/test_harness_integrity.sh` as the mandatory repository validation.
7. Commit with message: `fix: retire obsolete self-host cutover residue`.

**Files:**
- `.ai-conductor/config.yml`
- `src/conductor/src/engine/daemon-backlog.ts`
- `src/conductor/test/engine/daemon-backlog.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

## Task Dependency Graph

Task 1 → Task 2

## Integration Points

- After Task 1: retired attribution cutover keys have no type, parser, validator, or fixture
  dependencies; live audit telemetry remains configurable and covered.
- After Task 2: backlog discovery accurately reports unowned default-build behavior while
  preserving different-owner gating, and the self-host config contains only retained
  lifecycle keys.

## Story Coverage

- Dead enforcement/judge code paths, tests, and fixtures → Task 1.
- Audit sampling remains live → Task 1 steps 1, 4, and 5.
- Different-owner stamped spec remains gated → Task 2 steps 1, 3, and 5.
- Unowned spec default-build notice remains accurate → Task 2 steps 1, 3, and 5.
- Repo-local key decisions and premature freeze-removal prevention → Task 2 step 4.
- Consumer migration and canonical documentation → release/documentation gate after Task 2.

## Verification

- [ ] Every happy and negative acceptance criterion maps to a task or mandatory release gate.
- [ ] Both tasks own focused RED/GREEN tests at the narrowest credible seam.
- [ ] No real daemon, provider, GitHub, or other third-party service is called by tests.
- [ ] Dependencies are explicit and acyclic.
- [ ] Mandatory harness integrity validation follows the final implementation task.
