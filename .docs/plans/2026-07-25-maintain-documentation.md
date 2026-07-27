# Implementation Plan: Maintain documentation

**Date:** 2026-07-25
**Design:** Technical intent in `.docs/track/maintain-documentation.md`; APPROVED ADRs in
`.docs/decisions/adr-2026-07-25-*.md`
**Stories:** `.docs/stories/maintain-documentation.md`
**Conflict check:** Clean as of 2026-07-25; one operator-accepted degrading sequencing overlap

## Summary

Add a repository-local documentation judgment gate, a generic opt-in custom-step completion
artifact, deterministic changelog PR-link finalization, and notable-content-triggered releases.
Nineteen TDD tasks preserve existing behavior when the custom configuration or token is absent.

## Technical Approach

- Extend `StepConfig` with a custom-only exact `.pipeline/` artifact path. Configuration rejects
  unsafe paths; the conductor treats a configured marker as a completion check and requires it to
  be fresh for the attempt or current session.
- Scaffold one canonical skill under `.agents/skills/maintain-documentation/`, symlink it into the
  repository's Claude discovery path, and insert it after `rebase` in this repository only.
- Keep documentation judgment in the skill. Static contract tests pin modes, taxonomy, writing,
  scope, evidence, and changelog rules without pretending to judge prose quality mechanically.
- Add a small `conduct-ts finalize-changelog-pr` primitive. It replaces exactly one token after PR
  creation; finish commits/pushes the result before shipped-record and finish-record.
- Make `[Unreleased]` content the release trigger. The workflow succeeds without mutation when
  empty; the self-host gate retains integrity and migration checks but drops its non-empty check.

## Prerequisites

- Node 20.5+, repository dependencies installed, and the feature worktree active.
- Use the `skill-creator` scaffold script for the canonical repository-local skill.
- Do not migrate existing `README.md` or `docs/` content in this implementation.

## Tasks

### Task 1: Add valid custom completion-artifact configuration
**Story:** Configure an opt-in custom-step completion artifact — happy path
**Type:** infrastructure

**Steps:**
1. Write a failing config test that accepts a custom step with an exact `.pipeline/` artifact.
2. Verify RED.
3. Add `StepConfig.completion_artifact` and recognize the key during validation.
4. Verify GREEN.
5. Commit with message: `feat(config): accept custom completion artifacts`.

**Files:** `src/conductor/src/types/config.ts`; `src/conductor/src/engine/config.ts`;
`src/conductor/test/engine/config.test.ts`
**Wired-into:** `src/conductor/src/engine/config.ts#validateConfig`
**Dependencies:** none

### Task 2: Reject unsafe and built-in completion-artifact configuration
**Story:** Configure an opt-in custom-step completion artifact — both negative paths and absent-key compatibility
**Type:** negative-path

**Steps:**
1. Add failing table tests for empty, absolute, traversal, glob, directory-only, and built-in use.
2. Verify RED.
3. Implement custom-only normalized `.pipeline/<file>` validation with field-specific errors.
4. Verify GREEN, including an unconfigured custom step and unchanged built-ins.
5. Commit with message: `fix(config): reject unsafe completion artifact paths`.

**Files:** `src/conductor/src/engine/config.ts`; `src/conductor/test/engine/config.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Accept a fresh exact completion marker
**Story:** Require fresh pass evidence — both happy paths
**Type:** happy-path

**Steps:**
1. Add failing artifact tests for attempt-fresh and session-fresh exact markers.
2. Verify RED.
3. Add exact-file completion evaluation using attempt start, then session start.
4. Verify GREEN, including filesystem timestamp tolerance.
5. Commit with message: `feat(gates): accept fresh custom completion markers`.

**Files:** `src/conductor/src/engine/artifacts.ts`; `src/conductor/test/engine/artifacts.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 2

### Task 4: Fail closed on missing or unverifiable completion evidence
**Story:** Require fresh pass evidence — all three negative paths
**Type:** negative-path

**Steps:**
1. Add failing tests for absent, stale, no-floor, and stale-marker-plus-BLOCKED-report cases.
2. Verify RED.
3. Return actionable incomplete reasons without deleting review evidence.
4. Verify GREEN.
5. Commit with message: `fix(gates): reject stale custom completion evidence`.

**Files:** `src/conductor/src/engine/artifacts.ts`; `src/conductor/test/engine/artifacts.test.ts`
**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 5: Make conductor completion detection config-aware
**Story:** Configure completion artifacts and require fresh pass evidence — conductor wiring
**Type:** infrastructure

**Steps:**
1. Write a failing conductor test showing a configured custom step enters post-dispatch checking.
2. Verify RED.
3. Make completion-check detection consult resolved config and preserve built-in predicates/globs.
4. Verify GREEN at every detection call site.
5. Commit with message: `feat(conductor): gate configured custom completion artifacts`.

**Files:** `src/conductor/src/engine/conductor.ts`; `src/conductor/test/engine/conductor.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 4

### Task 6: Prove custom gate-loop pass and block behavior
**Story:** Require fresh pass evidence — advance, retry/HALT, and stale-marker integration
**Type:** negative-path

**Steps:**
1. Add failing gate-loop scenarios for a fresh marker and a returned step with no fresh marker.
2. Verify RED.
3. Complete any conductor context threading needed by real loop execution.
4. Verify fresh PASS reaches finish once; missing/stale evidence retries or HALTs before finish.
5. Commit with message: `test(conductor): prove custom completion gate convergence`.

**Files:** `src/conductor/src/engine/conductor.ts`; `src/conductor/test/integration/gate-loop.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 7: Scaffold and discover the repository-local skill
**Story:** Discover and run one canonical repository-local skill — all criteria
**Type:** infrastructure

**Steps:**
1. Add a failing repository contract test for canonical path, Claude symlink, valid config, and order.
2. Verify RED.
3. Run the skill-creator scaffold, create the repo-local symlink, and configure the gating step
   after `rebase` with its completion artifact.
4. Verify both discovery paths resolve the same file and an unconfigured fixture remains unchanged.
5. Commit with message: `feat(skills): add repository documentation gate`.

**Files:** `.agents/skills/maintain-documentation/SKILL.md`;
`.claude/skills/maintain-documentation`; `.ai-conductor/config.yml`;
`src/conductor/test/engine/maintain-documentation-contract.test.ts`
**Wired-into:** `.ai-conductor/config.yml#steps.maintain-documentation`
**Dependencies:** Task 6

### Task 8: Define invocation modes and evidence lifecycle
**Story:** Produce a scoped documentation impact verdict — mode and artifact criteria
**Type:** happy-path

**Steps:**
1. Add failing contract assertions for pre-finish, documentation-only, and manual-audit modes.
2. Verify RED.
3. Define mode-specific input, output, commit, changelog, review, PASS, and BLOCKED behavior.
4. Verify the review is always overwritten and the pass marker is PASS-only.
5. Commit with message: `feat(skills): define documentation review modes`.

**Files:** `.agents/skills/maintain-documentation/SKILL.md`;
`src/conductor/test/engine/maintain-documentation-contract.test.ts`
**Wired-into:** same as Task 7
**Dependencies:** Task 7

### Task 9: Define impact, authority, and mutation boundaries
**Story:** Produce a scoped documentation impact verdict — impact, no-op, conflict, deletion, and `.docs` paths
**Type:** negative-path

**Steps:**
1. Add failing contract assertions for impact surfaces, source precedence, no-op, obsolete removal,
   unresolved conflicts, source-comment flags, and read-only `.docs/`.
2. Verify RED.
3. Add the decision matrix and hard mutation boundaries to the skill.
4. Verify contradictions BLOCK, safe no-ops create no commit, and `.docs/` has no write exception.
5. Commit with message: `feat(skills): constrain documentation impact decisions`.

**Files:** same as Task 8
**Wired-into:** same as Task 7
**Dependencies:** Task 8

### Task 10: Define taxonomy, audiences, and README ownership
**Story:** Apply a reader-centered documentation system — destination and README criteria
**Type:** happy-path

**Steps:**
1. Add failing assertions for audience order, approved taxonomy, new-category approval, and README contract.
2. Verify RED.
3. Define type selection, canonical ownership, quick-start requirements, and the repo-local README refinement.
4. Verify consumer behavior is explicitly unchanged and flat existing docs remain transitional.
5. Commit with message: `feat(skills): define documentation taxonomy and audiences`.

**Files:** same as Task 8
**Wired-into:** same as Task 7
**Dependencies:** Task 9

### Task 11: Define writing, verification, and troubleshooting rules
**Story:** Apply a reader-centered documentation system — repetition, voice, verification, and scope criteria
**Type:** negative-path

**Steps:**
1. Add failing assertions for concise active instructions, prohibited styles, source-of-truth links,
   impact-scoped verification, troubleshooting placement, artifacts, and code organization.
2. Verify RED.
3. Add per-document writing rules and the BLOCKED-on-unverifiable-claim contract.
4. Verify inline comments/docstrings remain flag-only and dry humor is clarity-gated.
5. Commit with message: `feat(skills): define documentation writing and verification rules`.

**Files:** same as Task 8
**Wired-into:** same as Task 7
**Dependencies:** Task 10

### Task 12: Define notable changelog decisions and exact format
**Story:** Add only notable implementation changelog entries — all criteria
**Type:** negative-path

**Steps:**
1. Add failing assertions for notable implementation selection, exclusions, one sentence, tense,
   reader outcome, optional spec PR, required token, and separate migration blocks.
2. Verify RED.
3. Add the changelog decision and formatting section to the skill.
4. Verify non-notable implementations may PASS without an entry and missing required entries BLOCK.
5. Commit with message: `feat(skills): define notable changelog contract`.

**Files:** same as Task 8
**Wired-into:** same as Task 7
**Dependencies:** Task 11

### Task 13: Parse and replace one implementation-PR token
**Story:** Finalize the changelog link — canonical URL replacement happy path
**Type:** happy-path

**Steps:**
1. Add failing unit tests for canonical GitHub URL parsing and one-token replacement.
2. Verify RED.
3. Implement an injectable atomic changelog finalizer returning changed/no-op state.
4. Verify the exact `[implementation PR #N](URL)` result.
5. Commit with message: `feat(changelog): finalize implementation PR links`.

**Files:** `src/conductor/src/engine/changelog-pr-finalizer-cli.ts`;
`src/conductor/test/engine/changelog-pr-finalizer-cli.test.ts`
**Wired-into:** `src/conductor/src/index.ts#main`
**Dependencies:** none

### Task 14: Refuse malformed or ambiguous PR-link finalization
**Story:** Finalize the changelog link — no-token, invalid URL, unreadable file, duplicate, and atomic-failure paths
**Type:** negative-path

**Steps:**
1. Add failing tests for every refusal plus the absent-token no-op.
2. Verify RED.
3. Implement zero-write validation and atomic failure handling.
4. Verify no token changes no bytes and every refusal leaves the changelog byte-identical.
5. Commit with message: `fix(changelog): fail closed on ambiguous PR link finalization`.

**Files:** same as Task 13
**Wired-into:** same as Task 13
**Dependencies:** Task 13

### Task 15: Wire the finalizer into the real CLI
**Story:** Finalize the changelog link — production command and real-dispatch Done When
**Type:** infrastructure

**Steps:**
1. Add failing argv detection and real-binary acceptance tests.
2. Verify RED.
3. Register `finalize-changelog-pr --pr-url <url>` before pipeline fallthrough.
4. Build and verify the real binary reaches the finalizer; malformed use never launches a pipeline.
5. Commit with message: `feat(cli): expose changelog PR link finalizer`.

**Files:** `src/conductor/src/index.ts`;
`src/conductor/src/engine/changelog-pr-finalizer-cli.ts`;
`src/conductor/test/engine/changelog-pr-finalizer-cli.test.ts`;
`src/conductor/test/acceptance/finalize-changelog-pr-real-binary.acceptance.test.ts`
**Wired-into:** `src/conductor/src/index.ts#main`
**Dependencies:** Task 14

### Task 16: Order finalization inside finish and preserve refusal semantics
**Story:** Finalize the changelog link — commit/push ordering, failure refusal, and absent-token compatibility
**Type:** negative-path

**Steps:**
1. Add failing static contract tests for post-PR finalization, conditional commit/push, and STOP behavior.
2. Verify RED.
3. Amend finish so finalization precedes shipped-record and finish-record and is a no-op without a token.
4. Verify finalization/push failure writes neither durable ship record nor finish choice.
5. Commit with message: `feat(finish): finalize changelog PR links before shipment records`.

**Files:** `skills/finish/SKILL.md`;
`src/conductor/test/finish-documentation-finalization.test.ts`
**Wired-into:** `skills/finish/SKILL.md#Option 2: Push & PR`
**Dependencies:** Task 15

### Task 17: Classify pending release content and wire the workflow no-op
**Story:** Release only when notable content is pending — both workflow happy paths and no-mutation negative path
**Type:** happy-path

**Steps:**
1. Add failing script tests for non-empty, empty, subheader-only, and missing-header inputs.
2. Verify RED.
3. Add a deterministic release-state script and call it before release mutation steps.
4. Verify empty content exits green with every mutation step skipped; non-empty preserves the sequence.
5. Commit with message: `feat(release): trigger releases from notable changelog content`.

**Files:** `.github/scripts/release-unreleased-state.sh`; `.github/workflows/release.yml`;
`test/test_release_unreleased_state.sh`
**Wired-into:** `.github/workflows/release.yml#jobs.release`
**Dependencies:** Task 12

### Task 18: Retire only the self-host non-empty changelog sub-gate
**Story:** Release only when notable content is pending — self-host happy path and integrity/migration negatives
**Type:** negative-path

**Steps:**
1. Change tests to fail until empty content passes while missing structure and migrations still fail elsewhere.
2. Verify RED.
3. Remove the non-empty verdict from composed release gating without weakening integrity or migration checks.
4. Verify breaking, uncertain, waiver, missing-script, timeout, and integrity-failure cases remain green.
5. Commit with message: `feat(self-host): allow no-release implementation finishes`.

**Files:** `src/conductor/src/engine/self-host/release-gate.ts`;
`src/conductor/test/engine/self-host/release-gate.test.ts`;
`src/conductor/test/engine/self-host/wiring.test.ts`
**Wired-into:** `src/conductor/src/engine/self-host/wiring.ts#productionSelfHostGuardrails`
**Dependencies:** Task 17

### Task 19: Reconcile repository-local release and README policy
**Story:** Release only when notable content is pending and Apply a reader-centered documentation system — policy Done When
**Type:** infrastructure

**Steps:**
1. Add failing repository contract assertions for conditional changelog entries, empty-release no-op,
   and README destination refinement.
2. Verify RED.
3. Update the repository instruction and PR template; do not alter the global consumer-project rule.
4. Verify notable entries remain required when applicable and consumer behavior is explicitly unchanged.
5. Commit with message: `chore(policy): align release and README documentation rules`.

**Files:** `CLAUDE.md`; `.github/pull_request_template.md`;
`src/conductor/test/engine/maintain-documentation-contract.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 12, Task 17, Task 18

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 ─┬→ 17 → 18 ─┐
                                                     │             ├→ 19
13 → 14 → 15 → 16                                   └─────────────┘
```

## Integration Points

- After Task 6: generic custom completion artifacts converge through the real gate loop.
- After Task 12: the repository-local skill is discoverable, configured, and contract-complete.
- After Task 16: a PR URL can be finalized through the real CLI and ordered finish path.
- After Task 19: notable-only judgment, self-host finish, and post-merge release behavior agree.

## Coverage Mapping

| Story | Happy paths | Negative paths | Tasks |
|---|---|---|---|
| Discover and run one canonical repository-local skill | both | both | 7 |
| Configure an opt-in custom-step completion artifact | both | both | 1-2 |
| Require fresh pass evidence before advancing | both | all three | 3-6 |
| Produce a scoped documentation impact verdict | all three | all three | 8-9 |
| Apply a reader-centered documentation system | all four | all four | 9-11, 19 |
| Add only notable implementation changelog entries | all three | all three | 12, 17 |
| Finalize the changelog link without weakening finish | all three | all three | 13-16 |
| Release only when notable changelog content is pending | all three | all three | 17-19 |

## Verification

- [x] All happy-path criteria map to at least one task.
- [x] All negative-path criteria map to at least one task.
- [x] Tasks are scoped to one small RED/GREEN increment.
- [x] Dependencies are explicit and acyclic.
- [x] Every new production surface has a `Wired-into:` contract derived from architecture review.
- [x] Existing human-facing documentation migration is excluded.
