**Status:** Accepted

# Stories: Trailer-union build completion (fix false no_task_progress halt at 100%, #859)

Technical track — no PRD. Acceptance derives from intake #859's desired outcomes (O1–O4) under
APPROVED adr-2026-07-23-trailer-union-build-step-routing. Governing invariant throughout:
`build_review` remains the sole completion authority; trailers only route the handoff.

---

## Story 1: Shared task-resolution definition (union fold with canonical id matching)

**Requirement:** O2 (one resolution definition) · ADR Decision 2, 4, 5

As the engine, I want one shared `resolveTaskIds(projectRoot, planIds)` resolution — status rows
`completed|skipped` ∪ distinct `Task:` commit trailers, `canonicalTaskId`-matched against plan
ids — so that every consumer (build exit gate, stall breaker, re-kick eligibility) answers "is
this task resolved?" identically.

### Acceptance Criteria

#### Happy Path
- Given a plan id whose task-status row is `completed`, when `resolveTaskIds` runs, then that id is in the resolved set.
- Given a plan id whose task-status row is `skipped`, when `resolveTaskIds` runs, then that id is in the resolved set.
- Given a plan id with no resolving row but a branch commit carrying `Task: <id>`, when `resolveTaskIds` runs, then that id is in the resolved set.
- Given a plan id `2` and a commit trailer `Task: T2` (canonical alias), when `resolveTaskIds` runs, then plan id `2` is in the resolved set (same alias fold as `countResolvedTasks` today).
- Given `countResolvedTasks` refactored onto the resolver, when it runs over any fixture that exercises rows-only, trailers-only, and mixed resolution, then it returns exactly the same count as the pre-refactor implementation (parity — protects the stall breaker, kickback baselines `conductor.ts:1909/1932`, and daemon re-kick eligibility `daemon-cli.ts:434`).

#### Negative Paths
- Given a trailer value matching no plan id (e.g. `Task: 99` with plan ids 1–5), when `resolveTaskIds` runs, then it contributes nothing to the resolved set (no phantom resolution).
- Given `git log` fails in `projectRoot` (non-repo dir or git error), when `resolveTaskIds` runs, then the trailer contribution is empty (fail-soft) and resolution degrades to rows-only — it never throws and never fabricates a resolved id.
- Given a task-status row with status `in_progress` or `pending`, when `resolveTaskIds` runs, then that row contributes nothing (only `completed|skipped` rows resolve).
- Given a malformed task-status shape (legacy map form, missing fields), when `resolveTaskIds` runs, then rows normalize via the existing tolerant parse (`normalizeTasks`) and malformed entries degrade to no contribution, not a throw.

### Done When
- [ ] `resolveTaskIds(projectRoot, planIds)` is exported from `src/conductor/src/engine/task-progress.ts` and `countResolvedTasks` delegates to it (no duplicated fold logic).
- [ ] Unit tests cover: row-resolved, trailer-resolved, canonical-alias match, unknown-trailer no-op, git-failure fail-soft, non-resolving statuses.
- [ ] A parity test asserts `countResolvedTasks` pre/post-refactor equivalence across mixed fixtures.

---

## Story 2: All-evidenced build exits to build_review (the #859 regression shape)

**Requirement:** O1, O4 · ADR Decision 1, 2

As the daemon, I want the build completion predicate to report `done` when every plan task id is
resolved under the shared definition, so that a fully-committed build hands off to `build_review`
instead of halting `no_task_progress`.

### Acceptance Criteria

#### Happy Path
- Given a plan with N tasks all carrying `Task:` trailers on branch commits and a task-status.json with ZERO `completed` rows (rows `pending`/`in_progress` — the exact flow-examples #786 state), when `checkStepCompletion('build')` runs with projectRoot/planPath context, then it returns `done: true` and the step loop advances to `build_review` without evaluating the stall breaker.
- Given some tasks row-resolved and the rest trailer-resolved (mixed evidence), when the predicate runs, then it returns `done: true`.

#### Negative Paths
- Given `.pipeline/task-status.json` is missing, when the predicate runs, then it returns `done: false` with the existing "missing task-status" reason (fail-closed, unchanged).
- Given task-status.json contains invalid JSON, when the predicate runs, then it returns `done: false` with the existing invalid-JSON reason (fail-closed, unchanged).
- Given the plan file is unreadable or contains no task headings, when the predicate runs, then it returns `done: false` with the existing plan-validation reason (unchanged).
- Given the `.pipeline/halt-user-input-required` marker is present alongside full trailer evidence, when the predicate runs, then it returns `done: false` with the halt-marker reason (marker check keeps precedence — an explicit halt is never overridden by evidence).
- Given a caller without projectRoot/planPath context (legacy fallback branch), when the predicate runs, then behavior is byte-for-byte today's rows-only check (fallback unchanged).

### Done When
- [ ] Regression test: all-trailer-resolved + zero-completed-rows fixture ⇒ `done: true` (named as the #859 shape).
- [ ] Fail-closed tests: missing file, corrupt JSON, empty plan, halt-marker each ⇒ `done: false` with their existing reasons.
- [ ] Legacy no-context fallback tests still pass unmodified.

---

## Story 3: Completion-miss reasons name only truly-unresolved tasks

**Requirement:** O2 · ADR Decision 2

As the build loop, I want the predicate's not-done reason to enumerate only ids unresolved under
the shared definition, so that retry dispatches are steered away from already-resolved tasks and
never re-issue a committed one.

### Acceptance Criteria

#### Happy Path
- Given plan ids 1–5 where 1–3 are resolved (2 by trailer only, 3 by row) and 4–5 are unresolved, when the predicate runs, then `done: false` and the reason lists exactly `4, 5` with count `2/5` — ids 1–3 (including trailer-only 2) never appear.
- Given that reason threaded into the build retry hint, when the next build session is dispatched, then its prompt names only the unresolved ids as remaining work.

#### Negative Paths
- Given a task whose trailer-carrying commit was later reverted on the branch, when the predicate runs, then the id still counts as resolved (documented shipped-breaker semantics; `build_review`'s plan-vs-diff verdict — not this gate — catches genuinely missing work; ADR surfaced assumption).
- Given ALL ids unresolved (no rows, no trailers, fresh build), when the predicate runs, then the reason lists the first ids with the existing `(+N more)` truncation — formatting behavior unchanged.

### Done When
- [ ] Unit test asserts reason id-set equals plan ids − union-resolved set (no resolved id ever named).
- [ ] Existing reason-format tests (`x/y tasks`, truncation) pass with union semantics.

---

## Story 4: Genuine stalls still halt; the breaker is never consulted at the ceiling

**Requirement:** O3, O4 · ADR Decision 2

As the daemon, I want the stall circuit breaker's behavior on genuinely stalled builds to be
unchanged, so that this fix removes only the false halt at 100% completion.

### Acceptance Criteria

#### Happy Path
- Given a build with unresolved tasks whose resolved count does not move between attempt 2 and attempt 3 (no new commits, no row changes), when the retry loop evaluates, then it stalls `no_task_progress` with the same reason string (`build stalled: no task progress (resolved tasks stayed at N after M attempt(s))`) and the same HALT/handoff routing as today.
- Given an attempt that resolves at least one more task than the prior attempt, when the retry loop evaluates, then the progress-bypass path (`build_progress_halt`) behaves exactly as today (movement resets the stall).

#### Negative Paths
- Given all plan tasks resolved under the union (the ceiling), when the completion check runs first and returns `done`, then the stall predicate is never evaluated for that attempt — the count-pinned-at-ceiling misread is structurally unreachable.
- Given the halt marker written by the pipeline skill mid-build, when the retry loop evaluates, then `halt_marker` stall routing fires exactly as today (unchanged precedence over count deltas).

### Done When
- [ ] Genuine-stall fixture (unresolved tasks, pinned count, attempts ≥ 2) still produces `no_task_progress` with the unchanged reason string.
- [ ] The #859 fixture (Story 2) demonstrably never reaches the stall evaluation (asserted via step-loop routing to build_review).
- [ ] `build_progress_halt` bypass/ceiling tests pass unmodified.

---

## Story 5: Contract text and docs match the shipped semantics (same PR)

**Requirement:** ADR Decision 6 · repo "Docs track features" rule

As an operator reading the harness docs, I want the pipeline skill contract and engine docs to
state the routing/authority split, so that no artifact still promises the deleted derivation
machinery.

### Acceptance Criteria

#### Happy Path
- Given `skills/pipeline/SKILL.md`, when read after the change, then steps 5–6 state that `Task:` trailers ROUTE the build→build_review handoff (non-authoritative) and `build_review` judges completion — no text claims "the engine derives completion from this trailer".
- Given `CHANGELOG.md`, when read, then `[Unreleased]` carries a Fixed entry for #859.
- Given `src/conductor/README.md` and `docs/daemon-operations.md`, when read, then the build-completion/stall-semantics sections describe the union routing and unchanged genuine-stall HALT.

#### Negative Paths
- Given the full repo docs tree (`skills/`, `docs/`, `src/conductor/README.md`, `artifacts.ts` comment block), when grepped for "derives completion" trailer claims, then zero stale matches remain (a doc asserting the deleted machinery is a failure of this story).
- Given `test/test_harness_integrity.sh`, when run after the SKILL.md edit, then it passes (frontmatter/reference checks intact).

### Done When
- [ ] `skills/pipeline/SKILL.md` contract text corrected (routing vs authority).
- [ ] `CHANGELOG.md` `[Unreleased]` Fixed entry present referencing #859.
- [ ] `src/conductor/README.md` + `docs/daemon-operations.md` updated.
- [ ] `artifacts.ts` build-predicate comment block updated to the union semantics.
- [ ] Harness integrity suite passes.
