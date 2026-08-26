# ADR: Uncommitted work is a build-completion floor, enforced at both doors to `status:done`

**Date:** 2026-08-03
**Status:** APPROVED
**Deciders:** Operator (jstoup111), via /engineer DECIDE for jstoup111/ai-conductor#1270
**Feature:** `build-reports-step-completed-status-done-while-lea`
**Extends:** `adr-2026-07-23-trailer-union-build-step-routing` (#859) and
`adr-2026-07-23-commit-movement-liveness-floor` — does NOT supersede either. The routing-vs-authority
split is preserved verbatim; this ADR adds a conjunct to the routing pre-filter and a guard on the
liveness ADR's budget-exhaustion escape. It does not alter task-resolution semantics, the stall
predicate's count comparison, or `build_review`'s standing as sole completion authority.
**Adjacent, deliberately not addressed:** #1249 (retained `wiring_check` pass across a BUILD repair),
#1269 (daemon parks on unsatisfied prerequisites instead of re-running them).

<!-- Filename stem is the identifier: adr-2026-08-03-uncommitted-work-floor-under-build-completion -->

## Context

On 2026-08-03 a BUILD session on `changelog-unreleased-is-a-shared-write-target-conf` emitted
`step_completed status:done` having committed nothing. Three tracked files (44 insertions, 9
deletions across `conductor.ts` and two test files) sat in the working tree. The work was correct —
the operator re-ran the suite against the dirty tree and got 669 files / 10,176 passed — yet every
downstream consumer read committed state, `build_review` blocked on unsatisfied prerequisites, and
the feature parked until an operator committed the session's work by hand. Provider was
`codex` / `gpt-5.6-terra`; whether the omission is provider-specific is **unverified** (one
observation, one session).

Three source facts make this structural rather than incidental (all read directly this session):

1. **`status` is a hardcoded literal.** There is exactly one `step_completed` emit site
   (`conductor.ts:6745-6758`) and it writes `status: 'done'` unconditionally. Nothing derives it
   from observed state.
2. **No completion predicate observes the working tree.** The `build` predicate
   (`artifacts.ts:1747-1938`) routes on plan-task ids ∪ `Task:` trailers and nothing else.
   Dirty-tree detection exists in the engine (`worktree-shared.ts:80-82`, `setup-triage.ts:101`,
   `leak-triage.ts:483`, `live-boundary.ts:291`) but **no caller is in the step-execution path** —
   every one serves `/engineer` authoring, bootstrap setup, or main-checkout leak triage.
3. **There are two doors to `done`, not one.** Besides the completion gate, the liveness ADR's
   budget-exhaustion escape (`conductor.ts:5640-5680`) sets `succeeded = true` and breaks straight
   to the success tail whenever `anyAttemptMovedHead` — *bypassing the completion gate entirely*.

The engine's whole progress model rests on an assumption nothing enforces: **that a session's work
becomes commits.** `docs/explanation/gates.md:213` states it outright — "commit movement is the
liveness authority." Uncommitted work is therefore not merely unrecorded, it is *anti-recorded*:
HEAD unmoved reads as "no work happened", so `wiring_check`'s recorded-head equality
(`artifacts.ts:1322-1348`) sees prior-HEAD evidence as current, and the manual-test whitewash guard
and the stall breaker inherit the same blind spot.

The repository's own design principle names the remedy: prompt discipline already exists for this
exact failure — `skills/pipeline/SKILL.md:427-431` instructs the agent to "check for uncommitted
changes (`git status`)" — and it did not hold. Per CLAUDE.md, "when an agent repeatedly violates a
rule, the fix is machinery that stamps/validates/rejects at the moment of the mistake."

## Options Considered

### Option A: Dirty-tree conjunct in the build completion predicate + guard on the exhaustion escape (CHOSEN)

Add an optional injected `worktreeStatus` probe to `CompletionContext`, built once in
`completionCtx` (`conductor.ts:1191-1364`) as a thin closure over `this.git`/`projectRoot` —
the identical shape as the existing `getHeadSha`, `isHeadPushed`, `wiringProbe`, and
`fullSuiteInspect` injections. The `build` predicate consults it *after* the task-resolution check;
a non-empty porcelain result returns `{ done: false, missing: 'uncommitted', reason: <paths> }`.
Separately, the `anyAttemptMovedHead` escape refuses to route while the tree is dirty and HALTs
naming the paths.

- **Pros:** Deterministic and fail-closed, catching the mistake at the moment it is made. Reuses the
  entire existing miss apparatus for free — `lastError` (`conductor.ts:5021`), the retry hint that
  steers the next dispatch (`:8038-8102`), stall accounting, `step_failed.error`. That makes it
  **self-healing**: the next attempt is told exactly which paths to commit, rather than wedging.
  Provider-agnostic (engine-side, so a Codex-specific sandbox quirk is covered without diagnosing
  it). Zero new stores, steps, gates, or config. Empty diff is clean, so a legitimately no-op build
  is untouched.
- **Cons:** A build whose session genuinely cannot commit (sandbox denial) now burns its retry
  budget before halting instead of failing immediately — bounded, and the halt reason names the
  cause. Predicate semantics change requires test updates on existing `build`-predicate fixtures.

### Option B: Engine auto-commits the residue

Detect dirty at step end and have the engine commit it with an engine-stamped message.

- **Cons:** Makes the engine an author of unreviewed content, colliding head-on with **#1227**
  ("Pipeline commits files outside the active plan before scope review") and with the per-task
  commit floor. It would commit whatever happens to be in the tree — build droppings, a
  half-finished edit, a debug print — and then present it to `build_review` as intentional work.
  Converts a loud, recoverable failure into a silent, plausible-looking one. Rejected.

### Option C: Terminal step failure, no retry

Fail the step immediately and halt.

- **Cons:** Wedges the feature exactly as today, merely with a better message. Discards the
  self-healing the existing retry loop already provides at zero additional cost — the next
  dispatch, told which files to commit, resolves this without an operator. Rejected as the primary
  mechanism, though it remains the *terminal* behavior once the budget exhausts (Decision 4).

### Option D: Enforce in a provider session hook

A `Stop`-style hook that refuses to let the session report done with a dirty tree.

- **Cons:** Hook wiring is host-specific, and the one observed occurrence was Codex — the provider
  least covered by Claude-shaped hook assets. An enforcement that lives per-provider must be
  re-implemented per provider and silently absent wherever it is not. The engine sees every
  provider identically. Rejected; it is also precisely the "prompt/harness discipline" class the
  design principle warns against.

## Decision

Adopt **Option A**, with these constraints:

1. **Routing, not authority.** The conjunct is a *routing* pre-filter, exactly like the trailer
   union it sits beside. It can only ever withhold a handoff to `build_review`; it never asserts
   completion. `build_review`'s plan-vs-diff completeness rubric remains the sole completion
   authority and can still FAIL a build with a spotless tree. This refines — does not reverse —
   #773 and #859.

2. **Both doors, one rule.** The floor is enforced at the completion gate **and** at the
   `anyAttemptMovedHead` escape (`conductor.ts:5640-5680`). A predicate-only fix is explicitly
   rejected as insufficient: an early attempt that committed plus a final attempt that did not
   would take the escape and reproduce #1270 with the new conjunct silently overridden. The
   escape's purpose — let `build_review` judge work that really landed — is preserved, because
   uncommitted work has *not* landed and is invisible to a grader that reads the diff.

3. **Fail direction: closed on dirt, open on absence.** A non-empty porcelain result blocks. A
   *missing* probe (legacy callers, `verifyArtifacts:false` unit contexts, non-git directories)
   skips the check entirely and behaves exactly as today — the same documented fail-open as
   `getHeadSha` (`artifacts.ts:886-891`). A probe that *throws* is treated as indeterminate and
   skips rather than blocks: git being unavailable must never wedge a build.

4. **Terminal behavior names the paths.** When the budget exhausts with a dirty tree, the HALT
   reason leads with the uncommitted paths (truncated to the first 3 plus a count, matching the
   existing unresolved-task reason format). This satisfies #1270's second desired outcome: the
   operator sees the cause without running `git status`.

5. **Untracked files block, and this is a deliberate widening of the intake's wording.** #1270's
   desired outcome says "uncommitted changes to tracked files". We block on tracked modifications
   **and** untracked-not-ignored paths, because the intake's own Impact section names the
   catastrophic case — "the working tree is the only copy: any recovery path that recreates the
   worktree from its branch discards the work outright" — and a newly authored source file that
   was never `git add`ed is exactly that case. `--exclude-standard` semantics mean gitignored
   paths (`.pipeline/`, build output, `node_modules`) never participate, and `land-spec.ts:447`
   sets the in-repo precedent for `--untracked-files=all` when the concern is losing authored
   content. **This is the one place this spec deviates from the intake's literal text; it is
   called out here so it can be reversed at review with a one-line change.**

6. **Scoped to `build` only.** `acceptance_specs` also authors files and has the same exposure,
   but generalizing the conjunct to every step would need each step's clean-tree expectations
   established individually (`rebase` legitimately runs `--autostash`, `worktree` and `complexity`
   stamp their own status atomically). Deferred as follow-up rather than guessed at.

7. **Evidence-label honesty, and nothing more.** `provenanceHeadSha` is **write-only** — verified:
   its only occurrences in `src/` are two type declarations (`full-suite-evidence.ts:34,49`), two
   shape validators (`:212,237`), and three write sites (`full-suite-verifier.ts:649,799,835`). No
   code reads it. `test_suite` freshness is decided by the content fingerprint, which already hashes
   tracked and untracked-not-ignored working-tree files (`full-suite-fingerprint.ts:590-598`) per
   `adr-2026-07-25-content-addressed-full-suite-proof`. The evidence is therefore **not stale — its
   label is incomplete**, and an operator reading a bare `provenanceHeadSha` reasonably misreads it
   as "the state that was tested", which is what happened in #1270. We add one additive optional
   boolean recording tree cleanliness at fingerprint time. We add **no reader**, change **no**
   freshness semantics, and touch **no** gate.

8. **What this ADR does not claim.** #1270's third desired outcome also asks that "a gate blocked by
   a prerequisite whose evidence predates the current working state is distinguishable from one
   blocked by a genuine failure." That is #1249's subject (group-membership retention in
   `resolveGroupMembership`), a different mechanism in a different file, and it is **not** fixed
   here. Once this floor lands, a build can no longer *hand off* with a dirty tree, which removes
   the pathway that produced #1270's specific stale-prerequisite block — but it does not make
   stale-vs-genuine distinguishable in general. Claiming otherwise would overstate the change.

**Verified claims** (read directly from source this session, confidence ~95% unless noted):
single hardcoded `status:'done'` emit site (`conductor.ts:6745-6758`); build predicate's
task-only resolution (`artifacts.ts:1893-1908`); no porcelain caller anywhere in the step path
(repo-wide search for `--porcelain`/`isDirty`/`uncommitted`); the exhaustion escape's
gate-bypassing `break` (`conductor.ts:5640-5680`); `completionCtx` as the single context builder
with four existing optional-probe injections (`conductor.ts:1191-1364`); `provenanceHeadSha` has
zero readers in `src/`; fingerprint hashes untracked-not-ignored working-tree content
(`full-suite-fingerprint.ts:590-598`); `stepSatisfied` admits `done|skipped|stale`
(`state.ts:140-143`).

**Assumption held open, non-blocking** (~60%, inferred): the precise causal chain by which #1270's
`test_suite` recorded a FAIL is not fully established. Because the fingerprint hashes the dirty
tree, the suite should have observed the fix; the recorded FAIL may have been a genuine failure at
that moment, a pre-fix run whose digest was later invalidated, or provider-sandbox interference
(the same event tail carried `Refusing to create helper binaries under temporary dir "/tmp"`). **No
part of this design depends on resolving it** — outcomes 1, 2 and 4 follow from the dirty-tree fact
alone, and Decision 7 deliberately adds a label rather than machinery built on the unverified chain.

> **Amended 2026-08-22 by #1805:** build_review's completeness rubric is retired; prd_audit at SHIP is the completion authority (adr-2026-08-22-one-owner-per-review-question). Every other decision here stands.
