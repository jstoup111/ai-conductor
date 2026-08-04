**Status:** Accepted

# Stories: BUILD cannot report done with uncommitted work (#1270)

Technical track — no PRD. Acceptance derives from intake jstoup111/ai-conductor#1270's desired
outcomes (O1–O4) under APPROVED `adr-2026-08-03-uncommitted-work-floor-under-build-completion`.

**Outcome keys used throughout:**

- **O1** — a BUILD step cannot report `status:done` while its worktree has uncommitted changes; that condition is a failure of the step, surfaced with the offending paths.
- **O2** — the recorded reason names the uncommitted paths, so the operator sees the cause without running `git status`.
- **O3** — verification evidence records the state it actually ran against.
- **O4** — a BUILD session that legitimately produces no changes still completes normally; an empty diff is not a dirty worktree.

**Governing invariants** (from the ADR, unchanged by every story below): `build_review` remains the
sole completion authority; this floor is a routing pre-filter that can only withhold a handoff.
Absence of the probe is fail-open (behaves exactly as today); a dirty tree is fail-closed.

---

## Story S1: An injected working-tree probe on the completion context

**Requirement:** O1 · ADR Decision 1, 3

As the engine, I want the completion context to carry an optional working-tree-status probe,
built once in `completionCtx` alongside the existing `getHeadSha` / `isHeadPushed` / `wiringProbe`
/ `fullSuiteInspect` injections, so that completion predicates can observe uncommitted work
without any predicate reaching for git directly.

### Happy Path

- Given a `Conductor` running against a real git worktree, when `completionCtx` builds a context, then the context carries a `worktreeStatus` probe.
- Given a worktree with two modified tracked files, when the injected probe is invoked, then it returns a non-empty porcelain string naming both paths.
- Given a worktree with no changes at all, when the injected probe is invoked, then it returns an empty string.
- Given a worktree whose only changes are gitignored (e.g. files under `.pipeline/`), when the injected probe is invoked, then it returns an empty string — gitignored paths never participate.
- Given a worktree containing an untracked, non-ignored file, when the injected probe is invoked, then it returns a non-empty string naming that file (`--untracked-files=all` semantics, ADR Decision 5).

### Negative Paths

- Given a context built by a legacy caller that supplies no probe, when a predicate consults it, then the probe is absent and the predicate skips the check entirely rather than throwing.
- Given a probe that throws (git binary missing, not a repository), when a predicate invokes it, then the error is caught and treated as indeterminate — the predicate proceeds as if clean, and never propagates the throw.
- Given a directory that is not a git repository, when `completionCtx` builds a context, then context construction still succeeds and no build is wedged by the absence of git.

### Done When
- [ ] `CompletionContext` declares an optional `worktreeStatus?: () => Promise<string | null>`, documented with the same fail-open contract as `getHeadSha` (`artifacts.ts:886-891`).
- [ ] `conductor.ts`'s `completionCtx` injects it as a thin closure over `this.git` / `this.projectRoot`.
- [ ] Unit tests cover: dirty tracked, untracked-non-ignored, gitignored-only, clean, probe-absent, probe-throws.

---

## Story S2: The build predicate withholds completion while the tree is dirty

**Requirement:** O1, O2 · ADR Decision 1, 2, 4

As the engine, I want the `build` completion predicate to return not-done when the worktree has
uncommitted changes, with a reason naming the offending paths, so that a session which authored
work but never committed it can never be routed onward as complete.

### Happy Path

- Given every plan task is resolved and the worktree is dirty with `src/a.ts` modified, when the build predicate is evaluated, then it returns `done: false` and the reason names `src/a.ts`.
- Given the same conditions, when the predicate returns, then the result carries a distinct `missing: 'uncommitted'` classification so callers can tell this miss apart from an unresolved-task miss.
- Given a dirty tree with seven offending paths, when the predicate builds its reason, then it names the first three and reports the remaining count, matching the existing unresolved-task truncation format.
- Given the predicate returns not-done for uncommitted work, when the conductor records the failure, then `step_failed.error` carries that reason verbatim, so the operator reads the paths without running `git status` (O2).

### Negative Paths

- Given the halt marker `.pipeline/halt-user-input-required` is present AND the tree is dirty, when the predicate is evaluated, then it returns the existing halt-marker reason — check ordering is unchanged and the halt marker still wins.
- Given the plan is unresolvable or empty AND the tree is dirty, when the predicate is evaluated, then it returns the existing plan reason — the new conjunct never masks an earlier fail-closed branch.
- Given plan tasks are still unresolved AND the tree is dirty, when the predicate is evaluated, then it returns the unresolved-task reason — the dirty check runs after task resolution, never instead of it.
- Given no `worktreeStatus` probe is present on the context, when the predicate is evaluated with all tasks resolved, then it returns `done: true` exactly as it does today (fail-open on absence, ADR Decision 3).

### Done When
- [ ] The `build` predicate consults `ctx.worktreeStatus` after the task-resolution check and returns `{ done: false, missing: 'uncommitted', reason }` on a non-empty result.
- [ ] Reason format and truncation match the existing unresolved-task reason.
- [ ] Ordering tests pin halt-marker > plan > task-resolution > uncommitted.

---

## Story S3: The budget-exhaustion escape refuses to route a dirty tree

**Requirement:** O1 · ADR Decision 2

As the engine, I want the `anyAttemptMovedHead` escape to refuse to route the build onward while
the worktree is dirty, so that the second, gate-bypassing door to `status:done` cannot reproduce
the defect the completion-gate conjunct closes.

This is the story that makes the fix real. `conductor.ts:5640-5680` sets `succeeded = true` and
breaks straight to the success tail **without consulting the completion gate**. A build that
committed on an early attempt and left its final attempt's work uncommitted takes this door.

### Happy Path

- Given the retry budget is exhausted, at least one attempt moved HEAD, and the worktree is clean, when the escape is evaluated, then the build routes to `build_review` exactly as it does today and `build_routed_reason` is recorded unchanged.
- Given the retry budget is exhausted, at least one attempt moved HEAD, and the worktree is dirty, when the escape is evaluated, then the build does NOT route: no `step_completed status:done` is emitted for the step.
- Given that same dirty-tree exhaustion, when the run halts, then the HALT reason leads with the uncommitted paths rather than a generic "retries exhausted" (O2).

### Negative Paths

- Given the retry budget is exhausted, no attempt moved HEAD, and the worktree is dirty, when the escape is evaluated, then the pre-existing remediation-then-HALT path runs unchanged — the new guard adds no second halt and no duplicate marker.
- Given no `worktreeStatus` probe is available, when the escape is evaluated with commit movement, then it routes exactly as today — the guard is fail-open on absence and never strands a build in an environment without git.
- Given the escape declines to route because the tree is dirty, when the halt is written, then `build_review` is never dispatched and no build-review verdict is consumed — a grader must not judge a diff that omits the session's work.

### Done When
- [ ] The `anyAttemptMovedHead` branch consults the worktree probe before setting `succeeded = true`.
- [ ] A regression test constructs exactly the bypass shape — early attempt commits, final attempt leaves tracked files dirty, budget exhausts — and asserts no `step_completed status:done` is emitted.
- [ ] The clean-tree routing path is pinned unchanged by a parity test.

---

## Story S4: A no-op build still completes normally

**Requirement:** O4 · ADR Decision 3

As the engine, I want a build session that legitimately produced no changes to complete exactly as
it does today, so that an empty diff is never mistaken for uncommitted work.

### Happy Path

- Given every plan task is resolved and `git status --porcelain` is empty, when the build predicate is evaluated, then it returns `done: true` and the step stamps `status:done`.
- Given a build whose tasks were all resolved by commits from a prior attempt and whose tree is clean, when the predicate is evaluated, then it returns done — a build with nothing left to do is not penalised.
- Given a worktree whose only residue is gitignored run state under `.pipeline/`, when the predicate is evaluated, then the tree reads as clean and the build completes.

### Negative Paths

- Given a build that produced no commits AND left tracked files modified, when the predicate is evaluated, then it returns not-done — "no commits" alone is never sufficient to infer "no work"; the tree is what decides.
- Given a worktree containing only an untracked file that IS gitignored, when the predicate is evaluated, then it returns done — ignored paths must never block (guards the false-positive tail of ADR Decision 5).

### Done When
- [ ] A clean-tree fixture asserts `done: true` with an unchanged reason/shape.
- [ ] A gitignored-residue fixture asserts the tree reads clean.

---

## Story S5: The next attempt is told which paths to commit

**Requirement:** O1, O2 · ADR Decision 1

As the engine, I want the uncommitted-work miss to steer the next build dispatch, so that the
common case self-heals without an operator committing on the session's behalf.

### Happy Path

- Given a build attempt missed completion because the tree was dirty, when the next attempt is dispatched, then its retry hint instructs the session to commit the named uncommitted paths.
- Given that hint is followed and the next attempt commits the work, when the predicate re-evaluates, then the tree is clean, the build completes, and HEAD has moved.
- Given the hint fires, when the retry is counted, then it is counted under the existing retry budget — no new budget, no new counter.

### Negative Paths

- Given the completion miss was an unresolved-task miss (not uncommitted), when the next attempt is dispatched, then the pre-existing hint text is used unchanged — the new branch must not capture unrelated misses.
- Given the next attempt commits the work but the tree becomes dirty again, when the predicate re-evaluates, then it misses again and the loop remains bounded by the existing retry budget — no unbounded commit-dirty oscillation.

### Done When
- [ ] `buildRetryHint` gains an `uncommitted` branch keyed on the `missing` classification from Story 2.
- [ ] Tests assert the hint names the paths, and that non-uncommitted misses keep today's text byte-for-byte.

---

## Story S6: Fail-open on absence, fail-closed on dirt

**Requirement:** O1 · ADR Decision 3

As a maintainer, I want the failure direction to be explicit and pinned, so that a missing or
broken git environment degrades to today's behavior while genuine uncommitted work always blocks.

### Happy Path

- Given a dirty tree and a working probe, when any guarded path is evaluated, then it blocks (fail-closed on dirt).
- Given `verifyArtifacts: false` mocked-dispatch unit contexts, when a build runs, then no probe is consulted and behavior is byte-for-byte today's.

### Negative Paths

- Given the probe throws, when a guarded path is evaluated, then the condition is treated as indeterminate and does NOT block — git unavailability must never wedge a build.
- Given the probe returns `null`, when a guarded path is evaluated, then it does not block.
- Given the probe returns a non-empty string, when a guarded path is evaluated, then it blocks — an indeterminate result and a dirty result are never conflated.

### Done When
- [ ] Both guarded call sites (Story 2 predicate, Story 3 escape) share one helper so the fail direction cannot drift between them.
- [ ] Tests pin throw → no block, null → no block, non-empty → block.

---

## Story S7: The post-rebase closure check is pinned against autostash

**Requirement:** O1 · ADR Decision 6, architecture review risk 3

As the engine, I want the post-rebase build closure check's behavior with a dirty tree to be
explicitly pinned, because `rebase.ts:590` runs `git rebase --autostash` precisely because "a
daemon build/lint step can leave uncommitted changes in the worktree" — so a reapplied autostash
can legitimately leave the tree dirty at `conductor.ts:7651`.

### Happy Path

- Given a clean rebase whose autostash reapplied nothing, when the build closure check runs, then it behaves exactly as today.
- Given a rebase that reapplied an autostash leaving tracked files modified, when the build closure check runs, then its behavior is asserted explicitly by test rather than left incidental.

### Negative Paths

- Given a rebase left the tree dirty, when the closure check reports build completion, then the feature is not silently advanced past uncommitted work without that decision being visible in the recorded reason.
- Given a rebase halted on conflict, when the closure path is reached, then existing conflict handling runs unchanged — this story adds no new behavior to the conflict path.

### Done When
- [ ] A test exercises the post-rebase closure check with a dirty tree and asserts the chosen behavior.
- [ ] The chosen behavior is documented in `docs/reference/steps.md`'s `build` row alongside the new condition.

---

## Story S8: Suite evidence records whether the tree was clean

**Requirement:** O3 · ADR Decision 7

As an operator, I want `test-suite-evidence.json` to record whether the working tree was clean when
its fingerprint was taken, so that `provenanceHeadSha` cannot be misread as "the state that was
tested" — the exact misreading that occurred in #1270.

Deliberately narrow: `provenanceHeadSha` has **zero readers** in `src/`, and suite freshness is
decided by the content fingerprint, which already hashes dirty and untracked-not-ignored files. The
evidence is not stale; its label is incomplete. This story adds a label and no reader.

### Happy Path

- Given the suite runs with a clean worktree, when evidence is written, then it records tree-clean as true alongside the existing `provenanceHeadSha`.
- Given the suite runs with a dirty worktree, when evidence is written, then it records tree-clean as false, so the recorded SHA is never read as a complete description of what ran.
- Given both PASS and FAIL outcomes, when evidence is written, then the field is present on each.

### Negative Paths

- Given evidence written before this change (no such field), when it is read back, then it validates and is usable exactly as today — the field is optional and additive, and its absence is never an error.
- Given the cleanliness cannot be determined, when evidence is written, then the field is omitted rather than guessed — an absent field must never be read as "clean".
- Given this field is added, when the `test_suite` completion predicate runs, then freshness is still decided solely by the content fingerprint — no gate consults the new field, and no freshness semantics change.

### Done When
- [ ] One additive optional field on the pass and fail evidence shapes, with validators accepting its absence.
- [ ] A round-trip test proves pre-existing evidence still validates.
- [ ] A test asserts the `test_suite` gate verdict is unchanged in every case.
