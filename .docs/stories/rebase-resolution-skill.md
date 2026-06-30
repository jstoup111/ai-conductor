**Status:** Accepted

# Stories: Gated rebase-conflict resolution skill

Source PRD: `.docs/specs/2026-06-29-rebase-resolution-skill.md` (FR-1..FR-12). Tier: MEDIUM.
"Done When" is the success gate. All scenarios are concrete Given/When/Then.

> Domain note: there is no HTTP/auth surface here. The relevant negative-path categories are
> **partial failure & rollback** (rebase --continue), **data integrity** (branch-current / commit
> preservation invariants), **dependency unavailability** (git/skill failure), and
> **invariant side-effect on alternate branches** (the HALT must still fire on every give-up path).

> Cross-story precedence (from conflict-check 2026-06-29):
> 1. The configured attempt cap is evaluated **before** any dispatch — cap `0` (FR-7) short-circuits
>    to immediate HALT and FR-1's dispatch never happens.
> 2. "Exactly N attempts before HALT" (FR-3) describes the all-fail case **without** an FR-6
>    short-circuit; an explicit unsafe-to-resolve signal may HALT after fewer attempts.
> 3. The manual `/rebase` invoke (FR-10) is operator-initiated only — implementation agents must
>    never invoke it mid-build (honors the "no ad-hoc rebase mid-build" rule).

---

## Story: Dispatch resolver on conflict instead of parking immediately

**Requirement:** FR-1

As the daemon, I want a rebase `conflict_halt` to trigger the resolution skill before any HALT,
so a resolvable conflict doesn't park a human needlessly.

### Acceptance Criteria

#### Happy Path
- Given a daemon run where `performRebase` returns `conflict_halt`, when `runRebaseStep` handles
  the outcome, then the resolution skill is dispatched and `.pipeline/HALT` is NOT written yet.
- Given the resolver completes the rebase successfully, when the step finishes, then no HALT file
  exists and the rebase gate verdict is written by the existing `applyRebaseVerdicts`.

#### Negative Paths
- Given `performRebase` returns `noop` / `changed` / `changelog_resolved` (not `conflict_halt`),
  when `runRebaseStep` runs, then the resolver is NOT dispatched (no wasted dispatch).
- Given a daemon `conflict_halt`, when the dispatch mechanism itself throws/errors, then the step
  falls back to writing `.pipeline/HALT` (resolver failure must never silently pass the gate).

### Done When
- [ ] `runRebaseStep` routes a `conflict_halt` (daemon) through the resolver before `writeHalt`.
- [ ] A non-`conflict_halt` outcome bypasses the resolver entirely (asserted by test).
- [ ] A dispatch error degrades to HALT, not to a satisfied gate.

---

## Story: Resolver resolves conflicts and continues the paused rebase

**Requirement:** FR-2

As the resolution skill, I want to resolve the conflicted files and run `git rebase --continue`,
so the branch lands on the latest base.

### Acceptance Criteria

#### Happy Path
- Given a rebase paused on conflicted files, when the resolver resolves each file, stages it, and
  runs `git -c core.editor=true rebase --continue`, then the rebase completes (no `rebase-merge`/
  `rebase-apply` state dir remains; `rebaseStateActive` is false).
- Given the `--continue` surfaces a further conflict hunk in a later replayed commit, when the
  resolver re-resolves and continues again, then the full rebase is driven to completion.

#### Negative Paths
- Given the resolver stages files but a later `--continue` still reports unmerged paths, when the
  attempt ends, then the attempt is counted as failed (not treated as complete).
- Given `git` is unavailable / not a work tree, when the resolver runs, then it reports failure
  cleanly (no throw escaping the step) and the outcome degrades toward HALT.

### Done When
- [ ] Resolver completes a multi-hunk rebase to a clean state in the happy-path test.
- [ ] A still-conflicted tree after `--continue` is classified as a failed attempt.
- [ ] `rebaseStateActive` is the completion check (not merely "no unmerged paths").

---

## Story: Bound resolution attempts; default 3, configurable, 0 disables

**Requirement:** FR-3, FR-7

As the operator, I want resolution capped at a configurable number of attempts, so the daemon
can't loop forever and I can opt back into pure immediate-HALT behavior.

### Acceptance Criteria

#### Happy Path
- Given no config override, when resolution runs, then the attempt cap resolves to **3**.
- Given a config override of N (e.g. 5), when resolution runs and keeps failing, then exactly N
  attempts are made before HALT.

#### Negative Paths
- Given the attempt cap is configured to **0**, when a `conflict_halt` occurs, then the resolver
  is NOT dispatched and `.pipeline/HALT` is written immediately — byte-for-byte today's behavior.
- Given a negative or non-numeric config value, when the cap is resolved, then it falls back to
  the default (3) rather than disabling or looping unbounded.

### Done When
- [ ] Default cap is 3, sourced from resolved-config (not a hardcoded literal at the call site).
- [ ] `0` reproduces immediate HALT (no dispatch) — asserted against the pre-feature output.
- [ ] Exactly N attempts occur for a configured N when all fail (counter asserted).
- [ ] Invalid config degrades to default 3.

---

## Story: A code-changing resolution re-verifies downstream

**Requirement:** FR-4

As the daemon, I want a successful resolution that changed code/test paths to invalidate
`build` (and `manual_test` if it ran), so a possibly-wrong auto-merge is caught by the suite.

### Acceptance Criteria

#### Happy Path
- Given the resolver completes a rebase that changed code/test paths, when the outcome is
  re-classified, then it is `changed` and `applyRebaseVerdicts` kicks back `build` (+ `manual_test`
  when not skipped) via the existing kickback verdicts.
- Given the resolver completes a rebase that changed only docs/CHANGELOG, when re-classified, then
  it is `noop`/`changelog_resolved` and NO downstream kickback occurs.

#### Negative Paths
- Given the resolution completed but changed code/test paths, when the gate verdict is written,
  then `build` is never left "satisfied" from a prior run — the kickback unsatisfies it.
- Given `manual_test` was skipped for this feature, when a code-changing resolution lands, then
  only `build` is kicked back (not a phantom `manual_test`).

### Done When
- [ ] A code-changing resolution routes through the unchanged `applyRebaseVerdicts` kickback path.
- [ ] Docs-only resolution causes no kickback.
- [ ] `manual_test` kickback is conditional on it having run.

---

## Story: Exhaust all attempts, then HALT with the count recorded

**Requirement:** FR-5

As the operator, I want a clean HALT after the resolver gives up, so I know it tried and how
many times before I take over.

### Acceptance Criteria

#### Happy Path
- Given every one of N attempts fails to complete the rebase, when the cap is reached, then
  `.pipeline/HALT` is written, the rebase is left paused, and the conflicted files are listed.
- Given the HALT note is written, when I read it, then it states that N resolution attempts were
  made and failed.

#### Negative Paths
- Given attempts are exhausted, when the step returns, then the rebase gate verdict is
  `satisfied: false` (the loop must HALT, never proceed to finish).
- Given attempts are exhausted, when the HALT lands, then the rebase is NOT `--abort`ed (resume
  procedure stays valid for the human).

### Done When
- [ ] After N failed attempts, `.pipeline/HALT` exists, rebase paused, conflicts listed.
- [ ] HALT note records the attempt count.
- [ ] Rebase gate verdict is unsatisfied on exhaustion.

---

## Story: Resolver may short-circuit to HALT before exhausting attempts

**Requirement:** FR-6

As the resolution skill, I want to stop early and HALT when I judge a conflict unsafe to guess,
so I don't burn attempts (or risk a bad merge) on something a human must decide.

### Acceptance Criteria

#### Happy Path
- Given the resolver determines on attempt 1 that it cannot safely resolve, when it reports
  "cannot resolve" with a reason, then HALT is written immediately without further attempts.
- Given the short-circuit HALT, when I read the note, then it carries the resolver's stated reason.

#### Negative Paths
- Given a short-circuit on attempt 1 of 3, when the step ends, then attempts 2 and 3 are NOT run
  (the early give-up is honored, not overridden by the cap).
- Given a malformed/empty "cannot resolve" signal from the skill, when interpreted, then it is
  treated as a failed attempt (not as a satisfied gate).

### Done When
- [ ] An explicit unsafe-to-resolve signal HALTs immediately with the reason recorded.
- [ ] Remaining attempts are skipped on short-circuit.
- [ ] A malformed give-up signal cannot satisfy the gate.

---

## Story: Never report a non-current branch as satisfied

**Requirement:** FR-8

As the harness, I want the satisfied verdict to require the branch be genuinely current with the
base, so no resolution can ship a stale/half-rebased branch.

### Acceptance Criteria

#### Happy Path
- Given a resolution attempt reports success, when the gate verdict is computed, then it is
  satisfied ONLY if `isBranchCurrent(git, base.ref)` is true afterward.

#### Negative Paths
- Given the resolver claims success but the branch is NOT current with base (e.g. it left HEAD
  detached / mid-rebase), when the verdict is computed, then the gate is unsatisfied → HALT.
- Given `git rev-list HEAD..base` cannot be computed (unknown ref), when currentness is checked,
  then it is treated as NOT current (fail closed), never satisfied.

### Done When
- [ ] Satisfied requires a passing `isBranchCurrent` post-resolution (asserted).
- [ ] A "success"-claiming resolver that leaves a non-current branch → HALT.
- [ ] Indeterminate currentness fails closed.

---

## Story: Reject a resolution that drops feature commits

**Requirement:** FR-9

As the harness, I want to verify the feature's commits survive `rebase --continue`, so a
resolution that silently drops work can never pass as done.

### Acceptance Criteria

#### Happy Path
- Given a resolution completes, when the post-rebase branch is inspected, then it still contains
  the feature's commits ahead of the base (commit-preservation check passes) before satisfied.

#### Negative Paths
- Given `rebase --continue` silently dropped one or more feature commits, when the preservation
  check runs, then the resolution is rejected and HALT is written (commit-loss is never satisfied).
- Given the feature legitimately had its changes fully absorbed by the base (empty after rebase),
  when inspected, then this is distinguished from a drop (not a false-positive HALT).

### Done When
- [ ] A commit-preservation assertion runs after every completed `--continue`.
- [ ] A dropped-commit resolution is rejected → HALT.
- [ ] Legitimate empty-after-rebase is not misclassified as a drop.

---

## Story: Interactive mode unchanged; skill manually invokable

**Requirement:** FR-10

As a human in interactive mode, I want the rebase step to stay a no-op (I rebase manually), but
be able to invoke the resolver on demand.

### Acceptance Criteria

#### Happy Path
- Given a NON-daemon run, when `runRebaseStep` executes, then it is a self-satisfying no-op — no
  git rebase, no resolver dispatch (unchanged from today).
- Given I invoke `/rebase` manually, when there is a paused rebase, then the resolution skill runs
  against the current worktree independently of the daemon loop.

#### Negative Paths
- Given a NON-daemon run with a real conflict in the live worktree, when the step runs, then it
  does NOT touch git (no corruption of the interactive branch).
- Given `/rebase` is invoked with no rebase in progress, when it runs, then it reports "nothing to
  resolve" and makes no changes.

### Done When
- [ ] `!daemon` path remains a no-op (no dispatch, no git) — existing guard preserved.
- [ ] `/rebase` skill is independently runnable by a human.
- [ ] Manual invoke with no paused rebase is a safe no-op.

---

## Story: Emit resolution lifecycle events

**Requirement:** FR-11

As the operator watching the dashboard, I want structured events for the resolution loop, so I
see attempts rather than a silent jump from conflict to HALT.

### Acceptance Criteria

#### Happy Path
- Given resolution runs, when each attempt starts/succeeds/fails, then the conductor emits a
  structured event carrying the attempt index and the cap N.
- Given attempts are exhausted, when HALT lands, then a resolution-exhausted event is emitted.

#### Negative Paths
- Given an event emission throws, when it is emitted, then the resolution result is unaffected
  (best-effort emission, mirroring `emitRebaseEvent`).
- Given resolution is disabled (cap 0), when a conflict HALTs immediately, then no resolution
  attempt events are emitted (no misleading "attempt 0" noise).

### Done When
- [ ] Attempt-started / succeeded / failed / exhausted events exist in the event type union.
- [ ] Events carry attempt index and cap.
- [ ] Emission failure never alters the rebase result.

---

## Story: Author the rebase skill so the integrity suite passes

**Requirement:** FR-12

As a harness maintainer, I want `skills/rebase/SKILL.md` to be a valid skill, so the repo's
integrity checks and model table stay green.

### Acceptance Criteria

#### Happy Path
- Given `skills/rebase/SKILL.md` is authored, when `test/test_harness_integrity.sh` runs, then it
  passes: valid YAML frontmatter (`name`, `description`, `enforcement`, `phase`), a HARNESS.md
  model-table row for `rebase`, valid agent/template references, valid cross-skill references, no
  duplicate section numbers.

#### Negative Paths
- Given the skill references an agent persona, when the agent file is missing, then the integrity
  suite fails (must add the agent or remove the reference before commit).
- Given the skill omits a required frontmatter field, when the suite runs, then it fails (caught
  before commit, not after).

### Done When
- [ ] `skills/rebase/SKILL.md` exists with all required frontmatter fields.
- [ ] HARNESS.md model-selection table has a `rebase` row.
- [ ] `test/test_harness_integrity.sh` passes with the new skill present.
