# Implementation Plan: provider-neutral preventive controls for protected DECIDE artifacts (#1254)

**Date:** 2026-08-07
**Stories:** .docs/stories/codex-lacks-preventive-hook-parity-protected-artif.md
**Design:** .docs/decisions/adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md
**Architecture:** .docs/architecture/codex-lacks-preventive-hook-parity-protected-artif.md
**Conflict check:** Clean as of 2026-08-07 (C1 resolved, C2/C3 accepted degrading, C4 advisory)

## Summary

Nineteen tasks that move preventive protected-artifact enforcement into an engine-owned,
provider-neutral git `pre-commit` hook, close the plan scanner's target-vs-citation ambiguity, and
make the preventive control's wiring fail closed.

## Technical Approach

**One shared predicate, three consumers.** The root defect is that "protected" has two definitions:
`PROTECTED_ARTIFACT_DIRECTORIES` (`protected-artifact-seal.ts:17-22`) omits `.docs/decisions` while
`classifyMutationTarget` (`:205-207`) covers all of `.docs/`. Tasks 1–2 unify this first, because the
new hook, the scanner, and the seal must all agree before anything else is built on top.

**The commit is the enforcement point.** The seal's own violation condition is a *committed* content
change (`protected-artifact-seal.ts:697`), so gating `pre-commit` matches the authority it protects
and is method-blind by construction — an editor tool, a heredoc, and an inline interpreter all
converge on the same commit. The hook is written into `.pipeline/git-hooks/`, already wired
worktree-scoped via `core.hooksPath` (`worktree-prepare.ts:453-457`), so no new wiring seam is
introduced. It is phase-scoped to BUILD/SHIP (C3) so DECIDE-phase ADR authoring stays writable.

**Ambiguity, not prose harvesting.** Per conflict C1, the scanner does not read prose for targets.
A `**Files:**` line is the disambiguator: declared → scan declared targets (unchanged); undeclared
with no protected path → pass (unchanged); undeclared *with* a foreign protected path → reject as
ambiguous. Measured at 7 of 3,099 tasks.

**Sequencing.** Predicate (1–2) → scanner (3–7) → hook asset (8–15) → wiring (16–17) →
remediation (18–19). `worktree-prepare.ts` edits are deliberately concentrated in tasks 15–17 and
kept small, because C4 reports 19+ unmerged branches touching that file.

## Prerequisites

- `test/test_harness_integrity.sh` passes before each commit (repo validation rule).
- Do **not** touch `VERSION` or `CHANGELOG.md` — the bot-owned release PR is their sole writer.

## Release & Migration Requirements

Not tasks; requirements on the publication step.

- **A real `## Migration` block is mandatory in the PR body.** Hook wiring is a canonical breaking
  surface per `CLAUDE.md`; a release waiver is **not** appropriate here because consumer-visible hook
  behavior genuinely changes.
- **Release metadata:** `Release-Disposition: note`, `Release-Category: Fixed`,
  `Release-Semver: minor` (a new gate is additive behavior).
- **Documentation** — the control-classification inventory and the `docs/reference/settings-and-hooks.md`
  update are owned by this repository's `maintain-documentation` custom step, not by plan tasks (the
  plan skill's documentation boundary forbids documentation tasks). The inventory's source table is in
  the architecture doc.

## Tasks

### Task 1: Unify the protected-path predicate to cover `.docs/decisions`
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: `classifyMutationTarget` and the directory-set predicate agree that `.docs/decisions/adr-x.md` is protected.
2. Verify test fails (RED).
3. Implement: add `.docs/decisions` to `PROTECTED_ARTIFACT_DIRECTORIES` and export one shared `isProtectedArtifactPath` used by both call paths.
4. Verify test passes (GREEN).
5. Commit: "fix(seal): cover .docs/decisions in the protected-path predicate"

**Files:** src/conductor/src/engine/protected-artifact-seal.ts; src/conductor/test/protected-artifact-seal.test.ts

**Wired-into:** same as existing — `src/conductor/src/engine/conductor.ts#verifyProtectedArtifactSeal`, `src/conductor/src/engine/plan-protected-targets.ts#scanPlanProtectedTargets`

**Dependencies:** none

---

### Task 2: Classify a glob over a protected directory as indeterminate
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: `.docs/plans/*.md` classifies as indeterminate, not as a resolvable target.
2. Verify test fails (RED).
3. Implement: extend `canonicalWorkspaceTarget` glob handling so a wildcard over a protected directory returns indeterminate.
4. Verify test passes (GREEN).
5. Commit: "fix(seal): treat a glob over a protected directory as indeterminate"

**Files:** src/conductor/src/engine/protected-artifact-seal.ts; src/conductor/test/protected-artifact-seal.test.ts

**Wired-into:** same as Task 1

**Dependencies:** Task 1

---

### Task 3: Expose per-task `**Files:**` presence from the plan parser
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: parsing a plan reports which task ids carried a `**Files:**` line and which did not.
2. Verify test fails (RED).
3. Implement: surface the existing internal `hasFilesLine` state on the parser's returned shape without changing current path-resolution behavior.
4. Verify test passes (GREEN).
5. Commit: "feat(plan-parse): expose per-task Files-line presence"

**Files:** src/conductor/src/engine/plan-task-parse.ts; src/conductor/test/plan-task-parse.test.ts

**Wired-into:** src/conductor/src/engine/plan-protected-targets.ts#scanPlanProtectedTargets

**Dependencies:** none

---

### Task 4: Detect a foreign protected path in an undeclared task body
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: a task body naming `` `.docs/specs/other-feature.md` `` with no `**Files:**` line is reported as carrying a foreign protected reference; the same body under the plan's own stem is not.
2. Verify test fails (RED).
3. Implement: body scan reusing `isProtectedArtifactPath` and `namesOwnFeature`, tolerating a trailing `:NN` line suffix.
4. Verify test passes (GREEN).
5. Commit: "feat(plan-parse): detect foreign protected references in undeclared tasks"

**Files:** src/conductor/src/engine/plan-task-parse.ts; src/conductor/test/plan-task-parse.test.ts

**Wired-into:** same as Task 3

**Dependencies:** Task 1, Task 3

---

### Task 5: Reject an ambiguous task and name the required declaration
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: the isolated #1254 Task 16 fixture exits non-zero, names `.docs/specs/2026-07-04-operator-park.md`, and instructs the author to declare `**Files:**`.
2. Verify test fails (RED).
3. Implement: emit an ambiguity violation from `scanPlanProtectedTargets` for undeclared tasks carrying a foreign protected reference.
4. Verify test passes (GREEN).
5. Commit: "feat(plan): reject undeclared tasks that name a protected artifact"

**Files:** src/conductor/src/engine/plan-protected-targets.ts; src/conductor/test/plan-protected-targets.test.ts

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec, src/conductor/src/cli.ts#planProtectedTargetsCommand

**Dependencies:** Task 4

---

### Task 6: A declared task citing a foreign artifact in prose still passes
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: a task with `**Files:** src/x.ts` that also cites `` `.docs/specs/other.md` `` in prose reports no violation.
2. Verify test fails (RED).
3. Implement: gate the body scan on the absence of a `**Files:**` line so a declaration suppresses it.
4. Verify test passes (GREEN).
5. Commit: "test(plan): a declared task may cite a protected artifact as context"

**Files:** src/conductor/src/engine/plan-protected-targets.ts; src/conductor/test/plan-protected-targets.test.ts

**Wired-into:** same as Task 5

**Dependencies:** Task 5

---

### Task 7: Corpus regression — exactly seven ambiguous tasks
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: scanning every plan under `.docs/plans/` yields exactly 7 ambiguous tasks across 5 plans, and no previously-passing task newly fails.
2. Verify test fails (RED).
3. Implement: adjust only if the count diverges; the test pins the measured blast radius so a future widening cannot silently regress it.
4. Verify test passes (GREEN).
5. Commit: "test(plan): pin the ambiguous-task corpus blast radius at seven"

**Files:** src/conductor/test/plan-protected-targets-corpus.test.ts

**Wired-into:** none (no new production surface)

**Dependencies:** Task 6

---

### Task 8: Block a commit staging a foreign protected artifact
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: with a BUILD phase marker present, staging `.docs/specs/other-feature.md` makes the hook exit non-zero.
2. Verify test fails (RED).
3. Implement: add `PRE_COMMIT_HOOK` reading `git diff --cached --name-only` and classifying each staged path via the shared predicate.
4. Verify test passes (GREEN).
5. Commit: "feat(hooks): add a pre-commit gate for protected DECIDE artifacts"

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/git-hook-assets.test.ts

**Wired-into:** src/conductor/src/engine/worktree-prepare.ts#writeGitHooks

**Dependencies:** Task 1

---

### Task 9: The gate applies only during BUILD and SHIP
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: with no phase marker, and with a DECIDE-phase marker, staging an ADR under `.docs/decisions/` commits successfully; under a BUILD marker it is refused.
2. Verify test fails (RED).
3. Implement: phase-scope the hook, mirroring `isActiveStepArtifactException`'s BUILD/SHIP condition.
4. Verify test passes (GREEN).
5. Commit: "feat(hooks): scope the pre-commit gate to BUILD and SHIP"

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/git-hook-assets.test.ts

**Wired-into:** same as Task 8

**Dependencies:** Task 8

---

### Task 10: Own-feature artifacts and allowlisted paths commit normally
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: staging the active feature's own spec commits; so does `.docs/release-waivers/x.md`; so does `.docs/retros/x.md` under the retro step's allowlist.
2. Verify test fails (RED).
3. Implement: honor `namesOwnFeature` and the `allow:` prefixes carried in `.pipeline/phase-active`.
4. Verify test passes (GREEN).
5. Commit: "feat(hooks): honor own-feature and allowlisted paths in the pre-commit gate"

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/git-hook-assets.test.ts

**Wired-into:** same as Task 8

**Dependencies:** Task 9

---

### Task 11: A mixed commit is refused even when one path is allowlisted
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: a commit staging both `.docs/retros/x.md` and a foreign `.docs/specs/y.md` is refused.
2. Verify test fails (RED).
3. Implement: evaluate every staged path and refuse if any is a violation — an allowed path must not launder the change set.
4. Verify test passes (GREEN).
5. Commit: "fix(hooks): an allowlisted path does not launder a mixed commit"

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/git-hook-assets.test.ts

**Wired-into:** same as Task 8

**Dependencies:** Task 10

---

### Task 12: `CONDUCT_ENGINE_COMMIT=1` bypasses the gate
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: with `CONDUCT_ENGINE_COMMIT=1`, staging a protected path commits successfully.
2. Verify test fails (RED).
3. Implement: early exit on the env var, matching the existing check at `git-hook-assets.ts:140`.
4. Verify test passes (GREEN).
5. Commit: "feat(hooks): honor CONDUCT_ENGINE_COMMIT in the pre-commit gate"

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/git-hook-assets.test.ts

**Wired-into:** same as Task 8

**Dependencies:** Task 11

---

### Task 13: Chain to a repository-own `pre-commit` hook
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a `$GIT_COMMON_DIR/hooks/pre-commit` returning non-zero refuses an otherwise-permitted commit.
2. Verify test fails (RED).
3. Implement: chain after the gate passes, following the pattern at `git-hook-assets.ts:60-67`.
4. Verify test passes (GREEN).
5. Commit: "feat(hooks): chain the pre-commit gate to a repository-own hook"

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/git-hook-assets.test.ts

**Wired-into:** same as Task 8

**Dependencies:** Task 12

---

### Task 14: Fail closed on an unclassifiable staged path, and name the artifact and phase
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: an unclassifiable staged path is refused; a refusal names every offending artifact, its owning DECIDE phase, and the amendment route; a repeated identical commit is byte-identically refused.
2. Verify test fails (RED).
3. Implement: default-deny the indeterminate branch and emit the structured diagnostic.
4. Verify test passes (GREEN).
5. Commit: "feat(hooks): fail closed with an actionable protected-artifact diagnostic"

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/git-hook-assets.test.ts

**Wired-into:** same as Task 8

**Dependencies:** Task 13

---

### Task 15: Write the hook asset into the worktree
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: after `prepareWorktree`, `.pipeline/git-hooks/pre-commit` exists with mode `0755`.
2. Verify test fails (RED).
3. Implement: add the asset to `writeGitHooks`'s table alongside the two existing hooks.
4. Verify test passes (GREEN).
5. Commit: "feat(worktree): install the pre-commit gate into prepared worktrees"

**Files:** src/conductor/src/engine/worktree-prepare.ts; src/conductor/test/worktree-prepare.test.ts

**Wired-into:** src/conductor/src/engine/daemon-deps.ts#prepareWorktree

**Dependencies:** Task 14

---

### Task 16: Fail closed when the preventive hook cannot be installed
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: an unwritable hooks directory, and a failing `core.hooksPath` config, each make `prepareWorktree` throw rather than log and continue.
2. Verify test fails (RED).
3. Implement: split `writeGitHooksAndWire` by control class — attribution hooks keep failing open, the preventive hook rethrows with a diagnostic naming the wiring failure.
4. Verify test passes (GREEN).
5. Commit: "fix(worktree): fail closed when the preventive hook cannot be installed"

**Files:** src/conductor/src/engine/worktree-prepare.ts; src/conductor/test/worktree-prepare.test.ts

**Wired-into:** same as Task 15

**Dependencies:** Task 15

---

### Task 17: Correct the module's fail-open convention comment
**Story:** 4
**Type:** refactor

**Steps:**
1. Write failing test: none — comment-only change covered by Task 16's suite.
2. Verify Task 16's tests still pass (RED not applicable).
3. Implement: amend the comment at `worktree-prepare.ts:115` so the convention reads as conditional — attribution fails open, preventive controls fail closed.
4. Verify the suite passes (GREEN).
5. Commit: "docs(worktree): record the conditional fail-open convention"

**Files:** src/conductor/src/engine/worktree-prepare.ts

**Wired-into:** none (no new production surface)

**Dependencies:** Task 16

---

### Task 18: Redirect a remediation gap whose protected target is only in the rationale
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: a `build` gap whose protected target appears only in `gap.rationale` is rewritten to `plan` and excluded from the plan-task append; the same holds for `acceptance_specs`.
2. Verify test fails (RED).
3. Implement: include `gap.rationale` in the synthesized text fed to the sealed-artifact predicate at `conductor.ts:9094-9104`.
4. Verify test passes (GREEN).
5. Commit: "fix(remediate): redirect gaps whose protected target is only in the rationale"

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/remediation-routing.test.ts

**Wired-into:** src/conductor/src/engine/conductor.ts#planRemediation

**Dependencies:** Task 1

---

### Task 19: An incidental rationale mention does not trigger a redirect
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: a `build` gap whose rationale mentions a protected artifact as context while its tasks target only source files is **not** redirected; a gap naming the active feature's own artifact is not redirected; a gap with no rationale is handled without throwing.
2. Verify test fails (RED).
3. Implement: apply `namesOwnFeature` and require a resolvable foreign protected path before redirecting; emit a log line naming the gap id and artifact when it fires.
4. Verify test passes (GREEN).
5. Commit: "fix(remediate): do not redirect on incidental rationale mentions"

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/remediation-routing.test.ts

**Wired-into:** same as Task 18

**Dependencies:** Task 18

---

## Task Dependency Graph

```text
Task 1 (shared predicate) ──┬── Task 2 (glob indeterminate)
                            ├── Task 8 ── 9 ── 10 ── 11 ── 12 ── 13 ── 14 ── 15 ── 16 ── 17
                            └── Task 18 ── 19

Task 3 (Files presence) ──── Task 4 ── Task 5 ── Task 6 ── Task 7
                                 ↑
                            Task 1
```

Three independent lanes after Task 1: the scanner lane (3–7), the hook lane (8–17), and the
remediation lane (18–19). Tasks 3 and 1 may run concurrently.

## Integration Points

- **After Task 7** — the scanner lane is complete and independently verifiable: the #1254 Task 16 case is rejected, citations still pass, and the corpus blast radius is pinned.
- **After Task 15** — the hook is installed in real prepared worktrees and the gate is exercisable end-to-end on both providers.
- **After Task 17** — the preventive control is installed fail-closed, completing the enforcement boundary.
- **After Task 19** — remediation can no longer route a protected-artifact gap back to BUILD.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries a `**Files:**` line with repo-relative paths
- [ ] No task names another feature's sealed artifact in its `**Files:**` set
- [ ] `conduct-ts plan-protected-targets` passes on this plan
