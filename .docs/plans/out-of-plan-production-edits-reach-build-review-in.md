# Implementation Plan: Non-blocking plan-scope containment recorder

**Date:** 2026-08-09
**Stories:** .docs/stories/out-of-plan-production-edits-reach-build-review-in.md
**Decisions:** `.docs/decisions/adr-2026-08-09-non-blocking-plan-scope-containment.md`,
`.docs/decisions/adr-2026-08-09-hook-owned-containment-event-ledger.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-09-out-of-plan-production-edits-reach-build-review-in.md`
**Conflict check:** Clean as of 2026-08-09 —
`.docs/conflicts/2026-08-09-out-of-plan-production-edits-reach-build-review-in.md`
**Source:** intake `jstoup111/ai-conductor#1390`

## Summary

Turns the merged report-only plan-scope containment check into a non-blocking recorder: widens its
floor so adjacent files stop reading as violations, attaches a rationale to every out-of-floor path,
and records a check that cannot reach a verdict as a `ConductorEvent`. 15 tasks.

## Technical Approach

Everything this plan needs already exists on `main` from PR #1349 — the containment evaluator, the
`Scope:` trailer grammar, the widening harvest, and `build_review`'s
`## Engine-accepted scope widenings` prompt section. No new subsystem is introduced. The work is
concentrated in four seams:

**1. The floor predicate (`plan-scope-containment.ts`).** `evaluateScopeContainment` currently
filters staged paths through `fileMatchesPlanPath` (exact or `/`-boundary suffix) plus a two-entry
`MACHINERY_AUTHORED_PATHS` allowlist. Three additions widen it: a declared file's test siblings, a
declared file's same-directory neighbors, and docs/generated artifacts. All three are **unconditional**
— they only ever make the check quieter, so they are not gated on config. The existing
`fileMatchesPlanPath` `/`-boundary semantics are reused rather than reimplemented, because plans
commonly declare bare suffixes and a looser matcher would let `src/other/unrelated-config.test.ts`
satisfy a declaration of `config.ts`.

**2. Rationale resolution.** A small resolver, shared by `runScopeCheck` (commit time) and
`runContainmentFloor` (build-step time), maps each out-of-floor path to a rationale: the commit's
`Scope:` trailer verbatim when present (`derived: false`), otherwise the commit's subject and body
(`derived: true`). It can never return empty — an unexplained widening is exactly what makes
`build_review` kick back, which is the failure this feature exists to remove.

**3. The exit-code contract.** `runScopeCheck` today returns `1` for four unrelated conditions,
including any thrown exception, and the hook swallows every non-0/non-2 code. That collapses "not
applicable" and "crashed" into one indistinguishable outcome. They split: `0` silently for allowed
and for all not-applicable conditions, `0` with an advisory for out-of-floor, `3` for a check that
could not reach a verdict. `2` is retired and **reserved** — no code path returns it — so a future
enforcement decision can adopt it without renumbering. Crucially the hook gains no blocking branch;
a consumer on the previously generated hook sees `3` fall into its existing non-0/non-2 branch and
behaves exactly as today.

**4. Telemetry.** The unresolvable case is recorded as a new `ConductorEvent` variant appended to
`.pipeline/hook-events.jsonl` — a hook-owned, single-writer sibling ledger in the existing union.
The engine ledger is never written from the hook process, because `parseLedger` nulls an entire
ledger on one malformed line and cross-process append can interleave. The record is read back at the
build-step boundary by `runContainmentFloor`, which already writes `.pipeline/containment-floor.json`
via `step-runners.ts` — that report *is* the build record the intake asks the ambiguity to be visible
in. A live engine tail that re-emits hook events onto the running bus is deliberately **out of scope**
here; `adr-2026-08-09-hook-owned-containment-event-ledger` E1–E3 do not require one, and adding
engine lifecycle code would widen this change for no gain against the stated outcomes.

**Sequencing.** Floor work (1–4) is independent and lands first because every later task's tests
depend on knowing what counts as out-of-floor. Rationale (5–6) and the exit-code split (7–8) are
independent of each other. The hook regeneration (9) depends on the exit codes existing. Telemetry
(10–12) chains: variant, then appender, then reader. Presentation (13) and configuration (14) are
independent tails. Task 15 removes documentation-comment drift that would otherwise license the
oscillation the conflict check found.

**Not in this plan.** Human-facing documentation (`docs/reference/configuration.md`,
`docs/explanation/gates.md`, `docs/reference/cli.md`'s exit-code table) is delivered by this
repository's `maintain-documentation` custom step, which discharges review condition C6. Condition
C1 and the five predecessor-story amendments are already applied in this spec's own diff and are not
re-tasked here.

## Prerequisites

- None. PR #1349's containment machinery is on `main` and is the substrate this plan edits.
- Coordination note (advisory): PR #1395 is OPEN and adds a variant to
  `src/conductor/src/types/events.ts`. Whichever of the two lands second rebases that file. Additive
  variants on a discriminated union do not conflict semantically.

## Tasks

### Task 1: Test siblings of a declared file are inside the floor
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a task declaring `src/conductor/src/engine/config.ts` with
   `src/conductor/src/engine/config.test.ts` staged returns `{ allowed: true }`.
2. Verify test fails (RED).
3. Implement: add a test-sibling predicate to `evaluateScopeContainment`'s filter, deriving the
   sibling form from each declared path and comparing with `fileMatchesPlanPath`.
4. Verify test passes (GREEN).
5. Commit: "feat(containment): treat a declared file's test siblings as in-scope"

**Files likely touched:**
- `src/conductor/src/engine/plan-scope-containment.ts` — sibling predicate
- `src/conductor/src/engine/plan-scope-containment.test.ts` — sibling cases

**Wired-into:** src/conductor/src/engine/scope-check-cli.ts#runScopeCheck, src/conductor/src/engine/per-task-commit-floor.ts#runContainmentFloor
**Dependencies:** none

---

### Task 2: Same-directory neighbors of a declared file are inside the floor
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a task declaring `src/conductor/src/engine/config.ts` with
   `src/conductor/src/engine/resolved-config.ts` staged returns `{ allowed: true }`.
2. Verify test fails (RED).
3. Implement: add a same-directory predicate comparing the staged path's directory against each
   declared path's directory, resolved through the same `/`-boundary rule.
4. Verify test passes (GREEN).
5. Commit: "feat(containment): treat same-directory neighbors of a declared file as in-scope"

**Files likely touched:**
- `src/conductor/src/engine/plan-scope-containment.ts` — same-directory predicate
- `src/conductor/src/engine/plan-scope-containment.test.ts` — neighbor cases

**Wired-into:** same as Task 1
**Dependencies:** none

---

### Task 3: Docs and generated artifacts join the machinery allowlist
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: with `docs/reference/configuration.md` and `CHANGELOG.md` staged alongside a
   declared path, the evaluator returns `{ allowed: true }`.
2. Verify test fails (RED).
3. Implement: extend `MACHINERY_AUTHORED_PATHS` with the docs/generated prefixes; keep
   `.docs/shipped/` and `.pipeline/` unchanged.
4. Verify test passes (GREEN).
5. Commit: "feat(containment): allow docs and generated artifacts without a widening"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — `MACHINERY_AUTHORED_PATHS`
- `src/conductor/src/engine/plan-scope-containment.test.ts` — allowlist cases

**Wired-into:** same as Task 1
**Dependencies:** none

---

### Task 4: An unrelated path still reports as out-of-floor
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a path in an undeclared directory returns `{ allowed: false }` naming
   exactly that path; (b) a declaration of bare `config.ts` does **not** admit
   `src/other/unrelated-config.test.ts`; (c) an empty declared-files list still short-circuits to
   allowed; (d) a declared path absent from disk does not throw.
2. Verify tests fail (RED).
3. Implement: tighten the Task 1–3 predicates so widening cannot swallow an unrelated path; relocate
   the `#1074` regression fixture's out-of-floor path **outside** the declared directory, since the
   same-directory rule would otherwise make that fixture stop discriminating (conflict report CF-1).
4. Verify tests pass (GREEN).
5. Commit: "test(containment): pin the widened floor's discrimination boundary"

**Files likely touched:**
- `src/conductor/src/engine/plan-scope-containment.ts` — predicate tightening
- `src/conductor/src/engine/plan-scope-containment.test.ts` — discrimination cases
- `test/integration/git-hooks-attribution.test.ts` — relocate the `#1074` fixture path

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1, Task 2, Task 3

---

### Task 5: A `Scope:` trailer is recorded verbatim and flagged authored
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: an out-of-floor path with a matching `Scope: <path> — <rationale>` trailer
   produces a widening carrying the path, the verbatim rationale, the task id, the sha, and
   `derived: false`.
2. Verify test fails (RED).
3. Implement: add a rationale resolver returning `{ rationale, derived }`, trailer-first, reusing
   `parseScopeTrailers`; add the `derived` field to `AcceptedScopeWidening`.
4. Verify test passes (GREEN).
5. Commit: "feat(containment): record an authored Scope trailer verbatim on its widening"

**Files likely touched:**
- `src/conductor/src/engine/per-task-commit-floor.ts` — resolver, `AcceptedScopeWidening.derived`
- `src/conductor/src/engine/per-task-commit-floor.test.ts` — authored-rationale cases

**Wired-into:** src/conductor/src/engine/per-task-commit-floor.ts#runContainmentFloor
**Dependencies:** none

---

### Task 6: A path with no trailer falls back to a derived rationale, never empty
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) no trailer → rationale drawn from commit subject+body, `derived: true`;
   (b) subject-only commit → subject recorded, never empty/null/"unexplained"; (c) two out-of-floor
   paths with one trailer → one authored, one derived; (d) a trailer naming an unstaged path is
   ignored and the real path still gets a derived rationale; (e) a malformed `Scope:` line falls back
   to derived; (f) an over-long body is bounded with truncation visible in the value.
2. Verify tests fail (RED).
3. Implement: message fallback and bounding in the resolver.
4. Verify tests pass (GREEN).
5. Commit: "feat(containment): derive a rationale from the commit message when no trailer is present"

**Files likely touched:**
- `src/conductor/src/engine/per-task-commit-floor.ts` — fallback and bounding
- `src/conductor/src/engine/per-task-commit-floor.test.ts` — fallback cases

**Wired-into:** same as Task 5
**Dependencies:** Task 5

---

### Task 7: Not-applicable exits 0 and unresolvable exits 3
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: no `Task:` trailer → 0; task not `in_progress` → 0; empty declared files →
   0; absent `task-status.json` → 0; malformed `task-status.json` → 3; evaluator throwing after the
   task resolved → 3.
2. Verify tests fail (RED).
3. Implement: replace `runScopeCheck`'s catch-all `return 1` with the split, classifying the
   not-applicable conditions before the try/catch can conflate them with a failure.
4. Verify tests pass (GREEN).
5. Commit: "feat(scope-check): split not-applicable from an unresolvable check"

**Files likely touched:**
- `src/conductor/src/engine/scope-check-cli.ts` — exit-code split
- `src/conductor/src/engine/scope-check-cli.test.ts` — per-condition cases

**Wired-into:** src/conductor/src/engine/git-hook-assets.ts#COMMIT_MSG_HOOK
**Dependencies:** none

---

### Task 8: The out-of-floor path is advisory, never a refusal
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: an out-of-floor path returns 0 with stderr naming the task id, each offending
   path, and a copy-pasteable `Scope:` line; the rendered text contains no refusal wording; no
   `runScopeCheck` path returns 2; a 200-path case produces bounded output.
2. Verify tests fail (RED).
3. Implement: reword `renderScopeRefusal` to advisory, return 0 on violation regardless of the
   resolved config flag's effect on *recording*, bound the rendered path list.
4. Verify tests pass (GREEN).
5. Commit: "feat(scope-check): make an out-of-floor path advisory instead of a refusal"

**Files likely touched:**
- `src/conductor/src/engine/scope-check-cli.ts` — advisory rendering, no exit 2
- `src/conductor/src/engine/scope-check-cli.test.ts` — advisory cases

**Wired-into:** same as Task 7
**Dependencies:** Task 7

---

### Task 9: The generated hook stops swallowing and never blocks
**Story:** 3
**Type:** integration

**Steps:**
1. Write failing test: an integration test performs a real `git commit` with an out-of-floor staged
   path against the generated hook and asserts the commit object exists, the advisory reached stderr,
   and the hook never executed `exit 1`.
2. Verify test fails (RED).
3. Implement: regenerate `COMMIT_MSG_HOOK` — drop the `rc == 2 → exit 1` branch, handle `3` as a
   recorded ambiguity rather than an unnamed abstention, preserve every existing exemption
   (merge, amend, rebase replay, engine bookkeeping).
4. Verify test passes (GREEN).
5. Commit: "feat(hooks): commit-msg containment is advisory and records ambiguity"

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts` — `COMMIT_MSG_HOOK`
- `test/integration/git-hooks-attribution.test.ts` — real-commit assertions

**Wired-into:** same as Task 7
**Dependencies:** Task 7, Task 8

---

### Task 10: A `ConductorEvent` variant carries the unresolvable check
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test: the new variant type-checks in the union and carries the failure
   classification, the resolvable task id, and `ts`.
2. Verify test fails (RED).
3. Implement: add the variant to the `ConductorEvent` union.
4. Verify test passes (GREEN).
5. Commit: "feat(events): add a containment-check-unresolved event variant"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new union member

**Wired-into:** src/conductor/src/engine/scope-check-cli.ts#runScopeCheck
**Dependencies:** none

---

### Task 11: The appender writes one JSON line and can never throw into the hook
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: an event appends exactly one line to `.pipeline/hook-events.jsonl`;
   `.pipeline/events.jsonl` is byte-identical before and after; a message containing `"`, `\`, and
   newlines round-trips as one parseable line; an unwritable ledger path swallows the failure and
   returns normally; two rapid appends both parse.
2. Verify tests fail (RED).
3. Implement: a best-effort appender building the record with `JSON.stringify` (never string
   concatenation, condition C2) and swallowing every write failure (condition C3); call it from
   `runScopeCheck` on the exit-3 path.
4. Verify tests pass (GREEN).
5. Commit: "feat(scope-check): record an unresolvable containment check to a hook-owned ledger"

**Files likely touched:**
- `src/conductor/src/engine/scope-check-cli.ts` — appender and its call site
- `src/conductor/src/engine/scope-check-cli.test.ts` — encoding and failure cases

**Wired-into:** src/conductor/src/engine/scope-check-cli.ts#runScopeCheck
**Dependencies:** Task 7, Task 10

---

### Task 12: The containment floor reads the sibling ledger into the build record
**Story:** 5
**Type:** integration

**Steps:**
1. Write failing tests: recorded unresolved checks appear in `ContainmentFloorReport`; an absent
   sibling ledger is tolerated and reported as unrecorded; a malformed line in the sibling ledger
   leaves engine-ledger records readable.
2. Verify tests fail (RED).
3. Implement: read `.pipeline/hook-events.jsonl` in `runContainmentFloor`, merge by `ts`, and surface
   the unresolved-check entries on the report that `step-runners.ts` already persists to
   `.pipeline/containment-floor.json` and renders.
4. Verify tests pass (GREEN).
5. Commit: "feat(containment-floor): surface unresolved containment checks in the build record"

**Files likely touched:**
- `src/conductor/src/engine/per-task-commit-floor.ts` — ledger read and report field
- `src/conductor/src/engine/per-task-commit-floor.test.ts` — tolerant-read cases

**Wired-into:** src/conductor/src/engine/step-runners.ts#runContainmentFloor
**Dependencies:** Task 10, Task 11

---

### Task 13: `build_review` sees whether a rationale was authored or derived
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: the rendered prompt's `## Engine-accepted scope widenings` section
   distinguishes an authored trailer from a derived rationale for each widening.
2. Verify test fails (RED).
3. Implement: render the `derived` state in `build-review-prompt.ts`; thread the field through
   `build-review-inputs.ts`.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): distinguish authored from derived scope rationales"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — rendering
- `src/conductor/src/engine/build-review-inputs.ts` — field pass-through
- `src/conductor/src/engine/build-review-prompt.test.ts` — rendering cases

**Wired-into:** src/conductor/src/engine/step-runners.ts#buildGraderPrompt
**Dependencies:** Task 5, Task 6

---

### Task 14: Consumers keep today's behavior; this repository opts in
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests: no `build_review` block resolves `scopeContainmentEnforced` to `false`; a
   non-boolean value falls back to `false`, never to an enforcing state; an unreadable or malformed
   config returns `false` and does not throw; the widened floor applies with the flag `false`.
2. Verify tests fail (RED).
3. Implement: leave `DEFAULT_SCOPE_CONTAINMENT_ENFORCED` at `false` (condition C5), confirm the
   resolver's fallback path, and set `build_review.scopeContainmentEnforced: true` in this
   repository's own `config.yml`. Do **not** rename the key.
4. Verify tests pass (GREEN).
5. Commit: "feat(config): opt this repository into containment recording, consumers unchanged"

**Files likely touched:**
- `src/conductor/src/engine/resolved-config.ts` — default assertions
- `src/conductor/src/engine/scope-check-cli.test.ts` — fallback cases
- `config.yml` — this repository's opt-in

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1, Task 8

---

### Task 15: Remove the stale enforcement-flip guidance
**Story:** 3
**Type:** refactor

**Steps:**
1. Write failing test: a source assertion that the enforcement-flip phrasing is absent from
   `scope-check-cli.ts` and the generated `COMMIT_MSG_HOOK`.
2. Verify test fails (RED).
3. Implement: correct the comments at `scope-check-cli.ts` lines 17-20 and 48-51 ("Flip this single
   value only after live containment-floor evidence supports enforcing scope refusals") and the
   matching `COMMIT_MSG_HOOK` comment, replacing them with the recorded decision and a pointer to
   `adr-2026-08-09-non-blocking-plan-scope-containment`. A comment that contradicts an APPROVED ADR
   is the oscillation vector the conflict check identified (CF-2).
4. Verify test passes (GREEN).
5. Commit: "docs(containment): retire the enforcement-flip guidance the ADR withdrew"

**Files likely touched:**
- `src/conductor/src/engine/scope-check-cli.ts` — comments
- `src/conductor/src/engine/git-hook-assets.ts` — hook comment

**Wired-into:** none (no new production surface)
**Dependencies:** Task 8, Task 9

---

## Task Dependency Graph

```
Task 1 ─┐
Task 2 ─┼─► Task 4
Task 3 ─┘
Task 1 ─────────────────────────► Task 14
Task 5 ──► Task 6 ──► Task 13
Task 7 ──► Task 8 ──► Task 9 ──► Task 15
Task 7 ─┐
Task 10 ┴─► Task 11 ──► Task 12
Task 8 ─────────────────► Task 14
Task 8 ─────────────────► Task 15
```

Acyclic. Four independent entry points: Task 1/2/3 (floor), Task 5 (rationale), Task 7 (exit codes),
Task 10 (event variant).

## Integration Points

- **After Task 4** — the widened floor is end-to-end testable in isolation: declared, sibling,
  neighbor, docs, and unrelated paths all classify correctly.
- **After Task 9** — a real `git commit` against the generated hook exercises the full commit-time
  path: floor, advisory, no refusal.
- **After Task 12** — the intake's outcome 4 is demonstrable end-to-end: a crashed check at commit
  time is visible in `.pipeline/containment-floor.json` at the build-step boundary.
- **After Task 13** — `build_review` receives every out-of-floor path with a rationale, which is the
  behavior the four observed kickbacks needed.

## Coverage Mapping

| Story | Covered by |
|---|---|
| 1 — widened floor | Tasks 1, 2, 3, 4 |
| 2 — rationale, never absent | Tasks 5, 6, 13 |
| 3 — never blocks | Tasks 8, 9, 15 |
| 4 — unresolvable recorded | Tasks 7, 10 |
| 5 — single-writer sibling ledger | Tasks 11, 12 |
| 6 — consumer default unchanged | Task 14 |

Every happy-path and negative-path criterion in the six stories maps to at least one task. Negative
paths are explicit tasks (4, 6, 14) or explicit RED cases inside the task owning the behavior, never
a catch-all.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] No task names another feature's sealed artifact
### Task rem-build-review-1: src/conductor/test/engine/scope-check-cli.test.ts:42-47 — restore the absent-key/default-false test to its merge-base form so it is no longer counted as changed, leaving Task 14's production-sensitive fallback cases as separate tests
### Task rem-build-review-2: src/conductor/test/integration/audit-trail-completeness.integration.test.ts:550-568 — assert containment_check_unresolved is registered by src/conductor/src/engine/event-sinks.ts with persist true and audit false before asserting AuditTrailWriter emits no audit record, and verify the targeted test fails against merge-base production
### Task rem-build-review-4: src/conductor/test/engine/scope-check-cli.test.ts:42-55 — add a production-sensitive loadScopeCheckEnforcement case whose build_review.scopeContainmentEnforced value is non-boolean and assert the resolved value is false without throwing
### Task rem-build-review-5: src/conductor/test/engine/scope-check-cli.test.ts — invoke loadScopeCheckEnforcement with an injected configuration loader that rejects, exercising src/conductor/src/engine/scope-check-cli.ts:28-38, and assert it resolves false without throwing
### Task rem-build-review-6: src/conductor/test/engine/scope-check-cli.test.ts — invoke loadScopeCheckEnforcement with an injected malformed-config ConfigResult whose ok value is false, exercising src/conductor/src/engine/scope-check-cli.ts:28-38, and assert it resolves false without throwing
### Task rem-build-review-1-349831: src/conductor/test/engine/scope-check-cli.test.ts:42-47 — remove the no-op branch-only parameterization and restore the existing absent-key default assertion as unchanged coverage; keep new fallback behaviors in dedicated production-distinguishing tests
### Task rem-build-review-2-0ad021: src/conductor/test/integration/audit-trail-completeness.integration.test.ts:51-150,550-580 — exclude containment_check_unresolved from the audit-writer-owned event type and fixture map, undo the tautological drift-guard rename, and retain production-forcing EVENT_SINKS coverage proving the hook event is persisted but not audited
### Task rem-build-review-3: src/conductor/src/types/events.ts:144-159, src/conductor/src/engine/scope-check-cli.ts:82-148, and src/conductor/test/engine/scope-check-cli.test.ts:272-283 — add the raw commit-message payload to post-read containment_check_unresolved events, serialize it only through JSON.stringify, and assert after JSON.parse that quote, backslash, and newline content round-trips exactly in one JSONL record; keep the event an unresolved-check record and do not write accepted scope-widening state
### Task rem-build-review-4-22bca9: src/conductor/test/engine/scope-check-cli.test.ts:42-55 — add a loadScopeCheckEnforcement regression using a non-boolean build_review.scopeContainmentEnforced value and assert it resolves false without entering the enforcing state
### Task rem-build-review-5-21c02c: src/conductor/test/engine/scope-check-cli.test.ts:42-55 — invoke loadScopeCheckEnforcement with an injected loader that rejects as an unreadable configuration and assert the promise resolves false without throwing
### Task rem-build-review-6-6122cd: src/conductor/test/engine/scope-check-cli.test.ts:42-55 — invoke loadScopeCheckEnforcement with an injected loader returning the malformed-config failure result and assert it resolves false without throwing
### Task rem-build-review-tautology-exit-code-1: src/conductor/test/engine/scope-check-cli.test.ts:99-107 — replace the runScopeCheck source grep with behavioral allowed, advisory, unresolvable, and not-applicable cases asserting respective exit codes 0, 0, 3, and 0, with every result explicitly unequal to reserved code 2
### Task rem-build-review-tautology-prose-1: src/conductor/test/engine/scope-check-cli.test.ts:83-95 — remove the five-phrase source/comment assertion without restoring stale production comments; retain the observable advisory/no-refusal coverage in the Task 8 runScopeCheck tests and Task 9 generated-hook integration test
### Task rem-build-review-tautology-rationale-1: src/conductor/test/engine/per-task-commit-floor.test.ts:288-298 — parameterize the exact expected derived rationale for the unstaged and malformed Scope-line commits, assert the full subject/body-derived value, and assert the Task: trailer and Commit message unavailable placeholder are absent
### Task rem-build-review-scope-wiring-1: .ai-conductor/config.yml:70-76 — remove the entire wiring.entry_points block while preserving build_review.scopeContainmentEnforced: true and all unrelated existing configuration
### Task rem-build-review-completeness-absent-config-1: src/conductor/test/engine/scope-check-cli.test.ts:41-43 — reinsert the blank line after the config.yml writeFile call so the absent-key/default-false test is byte-identical to merge-base, leaving the non-boolean, rejected-loader, and malformed-result cases as separate tests
### Task rem-build-review-tautology-exit-code-source-mirror-1: src/conductor/test/engine/scope-check-cli.test.ts:99-107 — replace the source slice and return-2 regex with behavioral allowed, advisory, unresolvable, and not-applicable runScopeCheck cases asserting exit codes 0, 0, 3, and 0 and explicitly asserting every result is not 2
### Task rem-build-review-tautology-prose-source-mirror-1: src/conductor/test/engine/scope-check-cli.test.ts:83-97 — delete the five-phrase source/comment assertion without restoring stale production comments, retaining the Task 8 runScopeCheck advisory tests and Task 9 generated-hook integration test as behavioral no-refusal proof
### Task rem-build-review-tautology-consumer-default-1: src/conductor/test/acceptance/plan-scope-containment.acceptance.test.ts:74,184 — pass report.acceptedWidenings into graderPrompt instead of literal [], then assert the disabled-recording production result leaves the out-of-floor path absent from the rendered prompt
### Task rem-build-review-scope-wiring-scope-1: .ai-conductor/config.yml:70-75 — remove the entire wiring.entry_points block while preserving build_review.scopeContainmentEnforced: true and all unrelated configuration
### Task rem-build-review-completeness-wiring-1: .ai-conductor/config.yml:70-75 — fulfill rem-build-review-scope-wiring-1 by deleting the wiring.entry_points block and leaving build_review.scopeContainmentEnforced: true plus all unrelated configuration unchanged
### Task rem-build-review-completeness-absent-config-retry-1: src/conductor/test/engine/scope-check-cli.test.ts:42-44 — reinsert the blank line after the config.yml writeFile call so the absent-key/default-false test is byte-identical to merge base, leaving non-boolean, rejected-loader, and malformed-result cases separate
### Task rem-build-review-completeness-prose-1: src/conductor/test/engine/scope-check-cli.test.ts:83-97 — complete rem-build-review-tautology-prose-1 by deleting the five-phrase source/comment assertion without restoring stale comments, relying on Task 8 and Task 9 behavioral coverage
### Task rem-build-review-completeness-exit-code-1: src/conductor/test/engine/scope-check-cli.test.ts:99-108 — complete rem-build-review-tautology-exit-code-1 by replacing the source grep with allowed, advisory, unresolvable, and not-applicable runScopeCheck assertions for 0, 0, 3, and 0, each also unequal to 2
### Task rem-build-review-completeness-derived-rationale-1: src/conductor/test/engine/per-task-commit-floor.test.ts:288-298 — parameterize the exact expected derived rationale for the unstaged-trailer and malformed-Scope-line cases, assert the full subject/body-derived value, and assert the Task: trailer line and Commit message unavailable placeholder are absent
