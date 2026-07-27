**Status:** Accepted

# Stories: Builds stall when work lands without Task: trailer stamps (commit-movement liveness floor)

Technical track — no PRD. Acceptance derives from the operator-directed intent ("a build making
real committed progress is never terminally HALTed as no_task_progress") under APPROVED
adr-2026-07-23-commit-movement-liveness-floor, honoring review conditions C1–C4. Governing
invariants throughout: `build_review` remains the sole completion authority (#773/#859); the
attributed-task count is advisory and can never solely kill a build; a genuinely wedged build
(no commits, no count movement) still stalls and HALTs exactly as today.

Regression source of truth: the live halted-worktree shape (2026-07-23,
`engineer-unclaim-requeue-verb-stale-claimed-ledger`) — 20 real commits since merge-base, 11
grammar-valid dispatches, trailers for only 3 task ids, terminal HALT "resolved tasks stayed
at 3 after 3 attempt(s)", feature shipped unchanged after unpark.

---

## Story 1: Liveness floor — committed work is never classified as a stall

**Requirement:** ADR §1 · desired outcome 1

As the build loop, I want the stall breaker to classify `no_task_progress` only when the
attributed count is pinned AND HEAD did not move during the attempt, so that real committed
work — attributed or not — is never read as a stall.

### Acceptance Criteria

#### Happy Path
- Given attempt ≥ 2 where `resolvedTasksAfter <= resolvedTasksBefore` but HEAD at attempt end differs from HEAD at attempt start, when the breaker classifies the attempt, then `stalled` is NOT set, the retry proceeds under the normal budget, and an `unattributed_progress` event is emitted carrying the pinned count and both SHAs.
- Given the regression fixture (plan of N tasks, commits landing each attempt, only a minority trailer-stamped — the 20-commit/3-trailer shape), when the build loop runs attempts 2..budget, then no attempt classifies `no_task_progress` and no terminal "resolved tasks stayed at" HALT is written.
- Given an attempt where the count MOVES (resolvedAfter > resolvedBefore), when the breaker classifies, then the existing #280 progress-bypass fires exactly as today (bypass keys on count movement; the floor adds no interference).

#### Negative Paths
- Given attempt ≥ 2 with count pinned AND HEAD identical at attempt start/end (no commits), when the breaker classifies, then `stalled = 'no_task_progress'` exactly as today — the floor loosens nothing for genuinely commit-less attempts.
- Given `.pipeline/halt-user-input-required` exists (skill-requested halt) AND HEAD moved this attempt, when the breaker classifies, then `stalled = 'halt_marker'` — an explicit halt request is never overridden by commit movement.
- Given `currentCommitSha` fails for the attempt baseline or endpoint (git error), when the breaker classifies, then the floor treats HEAD as unmoved (fail-closed toward today's behavior: a git error can cause a stall classification but can never suppress one incorrectly — no false liveness from missing data).

### Done When
- [ ] Breaker classification in `conductor.ts` requires `headUnmovedThisAttempt` as a conjunct for `no_task_progress`; unit/engine tests cover moved-HEAD (no stall), pinned-HEAD (stall), halt-marker precedence, and sha-read-failure (fail-closed) cases.
- [ ] `unattributed_progress` event type exists in `types/events.ts` and is emitted with `{step, attempt, resolvedCount, headBefore, headAfter}`.
- [ ] The 20-commit/3-trailer regression fixture runs the loop to budget exhaustion with zero `no_task_progress` classifications.

---

## Story 2: Per-attempt SHA baseline — movement credits only the attempt that earned it

**Requirement:** ADR §2 · condition C2

As the stall breaker, I want the HEAD baseline re-captured at the start of every attempt (rolled
at loop bottom like `resolvedTasksBefore`), so that one early commit cannot blind wedge
detection for the rest of the step.

### Acceptance Criteria

#### Happy Path
- Given attempt 1 produces commits and attempt 2 produces commits, when each attempt is classified, then each compares against its OWN start-of-attempt SHA (attempt 2's movement is attempt 2's commits, not attempt 1's).

#### Negative Paths
- Given attempt 1 produces one commit and attempts 2..N produce none with the count pinned (the C2 shape — the exact bug the per-step `headShaBeforeBuild` const would cause), when attempts 2..N are classified, then each classifies `no_task_progress` and the build reaches #569 remediation → HALT as today. This scenario MUST exist as a test that would FAIL if the floor were implemented against the per-step const.
- Given the per-step `headShaBeforeBuild` (`conductor.ts:3054`) and its zero-work telemetry consumers, when the floor is added, then that const and its uses are byte-for-byte unchanged (the floor introduces its own per-attempt baseline; it does not repurpose the step-entry capture).

### Done When
- [ ] A per-attempt SHA baseline variable exists inside the retry loop, re-captured/rolled per attempt alongside `resolvedTasksBefore`.
- [ ] C2 regression test: commit-then-wedge fixture asserts attempts 2+ still stall and HALT (test is constructed to fail under a per-step-baseline implementation).
- [ ] Per-step `headShaBeforeBuild` usage sites show no diff.

---

## Story 3: Budget exhaustion with real work routes to build_review, not terminal HALT

**Requirement:** ADR §3 · condition C1 · desired outcome 1

As the daemon, I want a build whose retry budget exhausts while attempts produced real commits
to advance to `build_review` through the same step-advance seam the completion gate uses, so
that the fail-closed authority judges the diff instead of the loop killing worked builds.

### Acceptance Criteria

#### Happy Path
- Given the retry budget exhausts and at least one attempt moved HEAD (with unresolved plan ids remaining), when the loop exits the retry cycle, then the build step advances to `build_review` with a recorded routed-reason (naming the unresolved ids and the movement evidence), and NO terminal `no_task_progress` HALT is written.
- Given the routing branch fires, when step state is compared against a run where the completion gate's `done` path advanced the step, then the persisted step state is identical (C1 — one advance seam, asserted by test).

#### Negative Paths
- Given the retry budget exhausts and NO attempt moved HEAD, when the loop exits, then today's behavior is preserved: `no_task_progress` → #569 remediation → terminal HALT with the existing reason shape.
- Given the routed build reaches `build_review` and the rubric FAILs the diff, when the verdict lands, then the existing kickback path fires and total build↔review cycles remain bounded by `MAX_KICKBACKS_PER_GATE` (no new loop).
- Given a session that games the floor with no-op commits each attempt, when budget exhausts and routing fires, then `build_review` FAILs the incomplete diff and kicks back — gaming buys retries, never a ship (negative-path guarantee that routing-only is not always-pass).

### Done When
- [ ] Routing branch implemented at the retry-exhaustion tail reusing the completion-gate advance seam (no second advance code path); C1 identity test present.
- [ ] Fixture: budget exhaustion + real commits ⇒ step advances to build_review, no HALT file; budget exhaustion + no commits ⇒ HALT exactly as today (both asserted).
- [ ] Kickback-bound test: routed-then-FAIL cycles stop at `MAX_KICKBACKS_PER_GATE`.

---

## Story 4: A plan task with no work is still caught (authority negative path)

**Requirement:** condition C3 · desired outcome "not always-pass"

As the operator, I want a plan task that produced no corresponding work to still surface as a
failure at `build_review`, so that demoting the count to advisory never turns the pipeline into
an always-pass gate.

### Acceptance Criteria

#### Happy Path
- Given a build with real commits covering tasks 1..N-1 but nothing addressing task N, when the build routes to `build_review` (via completion or via exhausted-budget routing), then the completeness rubric FAILs naming task N's gap and the kickback re-dispatches with that gap in the retry context.

#### Negative Paths
- Given the same build, when observing the routing layer alone, then nothing in the breaker/routing changes claims task N is complete — the routed-reason lists it as unresolved (routing forward is explicit about outstanding ids, never silent).
- Given `build_review` is unavailable/errors on the routed pass, when the step runs, then the existing grader-failure handling applies unchanged (this feature adds no new bypass around the authority).

### Done When
- [ ] End-to-end fixture: N-1 worked tasks + 1 untouched task ⇒ routed forward ⇒ review FAIL names the untouched task ⇒ kickback observed.
- [ ] Routed-reason text includes the unresolved id list (assertable string shape).

---

## Story 5: Genuine wedge and halt-marker behavior preserved byte-for-byte

**Requirement:** ADR §5 · condition C4 · desired outcome "breaker must not go blind"

As the daemon operator, I want genuinely wedged builds to stall, remediate, and HALT exactly as
today, so that the liveness floor removes only false HALTs, never real ones.

### Acceptance Criteria

#### Happy Path
- Given attempt ≥ 2 with count pinned and HEAD pinned in daemon auto mode, when the stall is diagnosed, then the #569 remediation prompt is synthesized with the same content shape as today (`Build stall: no forward progress (resolved X → Y tasks). Completion gate: <reason>.`) and the remediation dispatch proceeds unchanged.
- Given remediation cannot close the stall and retries exhaust with no commits, when the loop terminates, then the terminal HALT reason retains the existing recognizable shape ("build stalled: no task progress…") so `daemon-cli.ts` re-kick display and operators see no format break.

#### Negative Paths
- Given the `.pipeline/halt-user-input-required` marker is set, when the attempt is classified, then `halt_marker` takes precedence over both count and SHA signals (path untouched).
- Given the #280 attempt-ceiling is reached by a count-progressing build, when the ceiling branch fires, then its park/halt behavior and reason text are unchanged (the floor never feeds the ceiling logic).
- Given the #280/#569 story contracts (`daemon-halts-a-build-that-is-making-forward-progre.md`, `build-stall-remediation-skips-no-task-progress.md`), when conflict-check sweeps them (C4), then no Given/When/Then in those files is contradicted without an explicit reconciliation note in this file.

### Done When
- [ ] Wedge fixture (no commits across attempts) reproduces today's full path: no_task_progress → remediation synthesis → terminal HALT, with reason-shape assertions.
- [ ] halt_marker precedence test passes unchanged.
- [ ] #280 ceiling tests pass unmodified; C4 sweep recorded in the conflict-check artifact.

---

## Story 6: Count demoted to advisory — consumers unchanged, contract text consistent

**Requirement:** ADR §4 · desired outcome "stated consistently in one place"

As a harness consumer, I want the attributed-task count's role stated and enforced as advisory
(hints, eligibility, bypass — never sole cause of build death), so that the telemetry-vs-gating
ambiguity that produced #895 and this defect is closed.

### Acceptance Criteria

#### Happy Path
- Given a completion-gate miss, when the retry hint is built, then it still names the unresolved ids from `countResolvedTasks`' fold (hint quality preserved).
- Given `daemon-cli.ts` re-kick eligibility and the kickback-escalation baselines (`conductor.ts:1922/1945`), when this feature lands, then their observed values across mixed fixtures are identical pre/post (parity test).
- Given the contract docs (`skills/pipeline/SKILL.md`, `docs/daemon-operations.md`, `src/conductor/README.md`), when read after this change, then each states: count = advisory routing/telemetry; commit movement = liveness authority; `build_review` = completion authority — with no residual text claiming the count alone halts builds.

#### Negative Paths
- Given a grep over the shipped tree for the old contract claim (count-based stall as terminal authority), when docs are audited in CI-reviewable form, then no contradicting statement remains (the #859 §6 sync failure mode — ADR says one thing, contract text another — is not repeated).
- Given any future call site that tries to terminal-HALT on count alone, when engine tests run, then the wedge-fixture suite fails unless HEAD-pinned evidence accompanies the classification (the invariant is executable, not prose).

### Done When
- [ ] Parity tests for re-kick eligibility and kickback baselines pass.
- [ ] All three contract docs updated in the same diff; CHANGELOG `[Unreleased]` entry present.
- [ ] Invariant test exists: `no_task_progress` classification unreachable without pinned HEAD in the fixture suite.
