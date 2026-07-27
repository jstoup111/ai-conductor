# Implementation Plan: wiring_check re-derives stale evidence instead of re-dispatching (#897)

**Date:** 2026-07-23
**Stem:** wiring-check-retries-on-evidence-it-invalidated-it
**Track:** technical (no PRD)
**Tier:** S
**Stories:** `.docs/stories/wiring-check-retries-on-evidence-it-invalidated-it.md`
**Conflict check:** N/A — skipped at Tier S (per `/engineer` tier rules)

## Summary

Change the `wiring_check` completion predicate so that evidence whose recorded `head` no longer
matches the current HEAD is **re-derived in-process** via the already-injected
`CompletionContext.wiringProbe` instead of being rejected with a staleness reason that costs a
full LLM re-dispatch. 11 tasks, all inside one predicate plus tests and docs.

## Technical Approach

**What the freshness key is, and what changes.** The acceptance condition is unchanged: evidence
is trusted only when `evidence.head === currentHead`. That equality is a deliberately conservative
proxy for "this verdict was computed over the range now under review", and it is **not** relaxed —
this change never accepts evidence stamped at a different HEAD. What changes is the *remedy on
mismatch*: today the predicate returns `done: false` with a staleness reason, the step retries, and
a fresh LLM session re-materialises the identical verdict at the new HEAD (22 occurrences in two
days; 19/19 traced ones passed on the next attempt; one burned the retry budget to a terminal
failure). After this change the predicate discards the mismatched evidence and re-derives the
verdict deterministically at the current HEAD, then decides the gate on that fresh verdict.

**Why re-derivation is legitimate here.** `ctx.wiringProbe` is wired unconditionally by the real
`Conductor` (`src/conductor/src/engine/conductor.ts:1014` → `computeWiringEvidence`), and this same
predicate already calls it to compute evidence from scratch on the *absent-file* path. The gate's
evidence has always been deterministically engine-computed — `conductor.ts`'s own kickback comment
says so ("wiring_check's evidence is deterministically computed (no LLM grader session)"). Nothing
about the gate becomes engine-native and nothing is reordered relative to `build_review` (both
directions were rejected in PR #891 / issue #879): the `/conduct wiring-check` dispatch that
*remediates* reachability gaps is untouched. Only the re-derivation of a value the engine can
compute itself stops being paid for with a dispatch.

**Why the two alternatives in #897 lose on merit.** A diff-content freshness key does not fix the
bug: `runWiringProbe` analyses `git diff <base>...HEAD` — committed content only — so a fix commit
changes the content digest exactly as it changes the sha, rejecting the same cases. Write-ordering
("commit before writing evidence") is prompt discipline, which this repo's Design Principle
forbids where machinery can do the job, and is unenforceable anyway because the engine itself
writes evidence on the absent path.

**Shape of the code change** (all in `src/conductor/src/engine/artifacts.ts`):

1. Extract the existing "compute via `ctx.wiringProbe` → `mkdir` → `writeFile`" block from the
   absent-file branch into a module-local helper (no new export) so both call sites share one
   persistence path and the recomputed evidence **replaces** the file wholesale.
2. Split validation into two phases for an existing evidence file:
   - `validateWiringEvidence(parsed)` **without** `currentHead` → schema/shape validity. A failure
     here returns today's reason unchanged (malformed evidence is never "repaired" by recompute).
   - Then the freshness comparison. On mismatch **and** `ctx.wiringProbe` present **and**
     `currentHead` non-null: re-derive once via the helper and continue with the fresh verdict.
     Otherwise fall through to today's staleness rejection (this preserves every existing
     no-probe/fixture test, including `test/engine/artifacts.test.ts`'s "stale (prior-HEAD)
     evidence is still rejected").
3. Re-validate the re-derived evidence with `currentHead`. If it is still off-range (HEAD moved
   again during the probe) return the staleness reason — **at most one** re-derivation per
   completion check, no loop.
4. Gap evaluation is unchanged and now runs against the fresh verdict, so a real finding reaches
   `conductor.ts`'s `wiring_check` kickback with verbatim gap text instead of a contentless retry.

**Sequencing.** Task 1 is a behavior-preserving refactor; Tasks 2–3 are the RED/GREEN core; Tasks
4–9 are the negative paths (one task each, per the stories); Tasks 10–11 are docs/changelog; the
final task runs the mandatory validation suite.

## Prerequisites

- None. No new dependency, no config key, no schema migration, no step-topology change.

## Known adjacencies (informational — no coordination performed)

- Issue **#896** (attribution session-hooks preflight, `src/conductor/src/engine/conductor.ts`
  ~715-760) is being specced concurrently. **No file overlap** with this plan's implementation
  surface: this change edits `artifacts.ts`, `step-runners.ts` (comment only) and `README.md`; it
  does not touch `conductor.ts`.
- Open spec PR **#890** (#878, trailer scans re-spawning identical git subprocess fans on an
  unchanged HEAD, `autoheal.ts`) shares a *conceptual* theme — HEAD-keyed freshness/caching — but
  no code surface. Note the inverse relationship worth keeping consistent: #878 avoids repeating
  work when HEAD is **unchanged**; #897 avoids repeating a *dispatch* when HEAD **changed** but the
  value is cheaply re-derivable. If both land, neither introduces a shared cache; there is nothing
  to reconcile beyond wording.

## Tasks

### Task 1: Extract the compute-and-persist evidence helper (behavior-preserving)
**Story:** Story 1 (enabling refactor)
**Type:** refactor

**Steps:**
1. Write failing test: assert the absent-evidence path still computes via `ctx.wiringProbe` and
   writes `.pipeline/wiring-evidence.json` (characterization test if not already covered).
2. Verify test fails / passes as characterization (RED where the assertion is new).
3. Implement: extract the `computed = await ctx.wiringProbe()` + `mkdir` + `writeFile(path, …)`
   block into a module-local (non-exported) `deriveAndPersistWiringEvidence(dir, path, ctx)`
   returning either the evidence or a `{ reason }` failure; call it from the absent-file branch.
4. Verify tests pass (GREEN) — no behavior change intended.
5. Commit: "refactor(engine): extract wiring evidence compute-and-persist helper"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — extract helper, call from the absent-file branch
- `src/conductor/test/wiring-evidence.test.ts` — characterization assertion

**Wired-into:** `src/conductor/src/engine/artifacts.ts#CUSTOM_COMPLETION_PREDICATES.wiring_check`
**Dependencies:** none

### Task 2: RED — stale evidence + live probe completes without a staleness retry
**Story:** Story 1, happy path 1 & 2
**Type:** happy-path

**Steps:**
1. Write failing test: evidence file stamped `head: 'H1'`, `ctx.getHeadSha` → `'H2'`,
   `ctx.wiringProbe` → gap-free evidence stamped `head: 'H2'`. Assert
   `checkStepCompletion(dir, 'wiring_check', ctx)` returns `{ done: true }` and that the reason
   (when present) does not match `/stale/`. Assert the on-disk file now records `H2`.
2. Verify test fails (RED — today it returns `done:false` with the staleness reason).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for wiring evidence re-derivation on HEAD advance"

**Files likely touched:**
- `src/conductor/test/wiring-evidence.test.ts` — new describe block

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 3: GREEN — two-phase validation with single re-derivation on head mismatch
**Story:** Story 1, happy path 1 & 2; Story 3 negative path
**Type:** happy-path

**Steps:**
1. Write failing test: covered by Task 2.
2. Verify RED.
3. Implement in the `wiring_check` predicate: for an existing evidence file, call
   `validateWiringEvidence(parsed)` with no `currentHead` first and return its reason on failure;
   then, when `currentHead != null && parsed.head !== currentHead && ctx.wiringProbe`, call the
   Task 1 helper once, replace `parsed` with the result, and re-validate with `currentHead`
   (returning the staleness reason if it is still off-range). When any of those conditions is
   unmet, fall through to the existing `validateWiringEvidence(parsed, currentHead)` rejection.
4. Verify tests pass (GREEN).
5. Commit: "fix(engine): re-derive stale wiring evidence instead of rejecting it (#897)"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `wiring_check` predicate body

**Wired-into:** `src/conductor/src/engine/artifacts.ts#CUSTOM_COMPLETION_PREDICATES.wiring_check`
**Dependencies:** Task 2

### Task 4: Negative — re-derived verdict with gaps fails with the gap text, not a staleness reason
**Story:** Story 1, negative path 1; Story 2 happy path 2
**Type:** negative-path

**Steps:**
1. Write failing test: stale evidence (clean) + probe returning evidence at the current HEAD
   carrying an orphan-export gap. Assert `done: false`, reason contains the gap message verbatim,
   and reason does **not** match `/stale/`.
2. Verify test fails (RED).
3. Implement: satisfied by Task 3; add nothing unless the assertion exposes a gap.
4. Verify GREEN.
5. Commit: "test(engine): re-derived wiring gaps surface verbatim, not as staleness"

**Files likely touched:**
- `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 5: Negative — a throwing probe fails closed
**Story:** Story 1, negative path 2
**Type:** negative-path

**Steps:**
1. Write failing test: stale evidence + `ctx.wiringProbe` that rejects. Assert `done: false` with a
   reason matching `/wiring probe failed/` and that the stale verdict is never accepted.
2. Verify RED.
3. Implement: ensure the shared helper's `try/catch` reason is returned on the stale path too.
4. Verify GREEN.
5. Commit: "test(engine): stale-path probe failure fails closed"

**Files likely touched:**
- `src/conductor/test/wiring-evidence.test.ts`
- `src/conductor/src/engine/artifacts.ts` — only if the catch path needs threading

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 6: Negative — fresh evidence does not invoke the probe
**Story:** Story 1, happy path 3
**Type:** negative-path

**Steps:**
1. Write failing test: evidence stamped at the current HEAD, gap-free, with a counting
   `ctx.wiringProbe`. Assert `{ done: true }` and probe call count `=== 0`.
2. Verify RED (or characterization).
3. Implement: guard the re-derivation strictly on head inequality.
4. Verify GREEN.
5. Commit: "test(engine): fresh wiring evidence short-circuits without probing"

**Files likely touched:**
- `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 7: Negative — malformed evidence is not repaired by recompute
**Story:** Story 2, negative path 2
**Type:** negative-path

**Steps:**
1. Write failing test: non-JSON evidence, and separately schema-invalid evidence (missing
   `layer2`), each with a counting probe injected. Assert the existing reasons
   (`invalid JSON in …`, the schema reason) and probe call count `=== 0`.
2. Verify RED.
3. Implement: keep the schema phase strictly before the freshness phase.
4. Verify GREEN.
5. Commit: "test(engine): malformed wiring evidence still fails closed, never recomputed"

**Files likely touched:**
- `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 8: Negative — no probe injected, and indeterminate HEAD, both behave exactly as today
**Story:** Story 3, happy path 1 & 2
**Type:** negative-path

**Steps:**
1. Write failing test: (a) stale evidence with no `ctx.wiringProbe` → the verbatim existing
   staleness reason; (b) `ctx.getHeadSha` absent / resolving `null` → no freshness failure and
   probe count `=== 0`.
2. Verify RED/characterization.
3. Implement: no change expected — confirms the fall-through guards.
4. Verify GREEN, and confirm `src/conductor/test/engine/artifacts.test.ts`'s existing
   "rejects evidence recorded at a prior HEAD…" test passes **unmodified**.
5. Commit: "test(engine): preserve no-probe and indeterminate-HEAD wiring behavior"

**Files likely touched:**
- `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 9: Negative — one re-derivation only, and it replaces the file wholesale
**Story:** Story 3, negative path; Story 2, negative path 1
**Type:** negative-path

**Steps:**
1. Write failing test: (a) probe returns evidence stamped at a *third* sha → assert exactly one
   probe call and a `done: false` staleness reason (no recursion); (b) leftover evidence carrying
   `tasks`/`waivers` entries → after re-derivation the on-disk JSON deep-equals the probe's result
   with no carried-over entries.
2. Verify RED.
3. Implement: single-shot re-derivation; whole-file `writeFile` (no merge).
4. Verify GREEN.
5. Commit: "test(engine): single-shot wiring re-derivation replaces evidence wholesale"

**Files likely touched:**
- `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 10: Docs — README evidence paragraph + correct the stale `step-runners.ts` comment
**Story:** repo convention (Documentation Upkeep, CLAUDE.md)
**Type:** infrastructure

**Steps:**
1. Write failing test: none (docs).
2. n/a
3. Implement: in `src/conductor/README.md` §"Wiring reachability gate (`wiring_check`)", rewrite the
   **Evidence** paragraph to state that evidence recorded at a prior HEAD is re-derived in-process
   via `CompletionContext.wiringProbe` (single-shot) rather than rejected, that a schema-invalid or
   probe-failing case still fails closed, and that a matching HEAD short-circuits without probing.
   Separately, correct the inaccurate comment above `wiring_check` in
   `src/conductor/src/engine/step-runners.ts` (it claims the step is "engine-native … never
   dispatched"; the step is in fact dispatched via `stepRunner.run` with the `/conduct wiring-check`
   prompt — this stale comment is the confusion behind the rejected PR #891).
4. n/a
5. Commit: "docs(conductor): wiring evidence re-derivation + correct wiring_check dispatch comment"

**Files likely touched:**
- `src/conductor/README.md`
- `src/conductor/src/engine/step-runners.ts` — comment only

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 11: CHANGELOG entry + full validation suite
**Story:** repo release gate (CLAUDE.md §Release & Update Gates)
**Type:** infrastructure

**Steps:**
1. Write failing test: none.
2. n/a
3. Implement: add a `### Fixed` bullet under `## [Unreleased]` in `CHANGELOG.md` describing the
   wiring-evidence re-derivation and referencing #897. Do **not** touch `VERSION` (frozen pre-v1).
   No `## Migration` block is required — no change to `settings.json` schema, hook wiring, skill
   symlink targets, or the `bin/conduct` CLI.
4. Run `test/test_harness_integrity.sh` and the conductor test suite; both must pass.
5. Commit: "chore: changelog for wiring evidence re-derivation (#897)"

**Files likely touched:**
- `CHANGELOG.md`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 (extract helper)
  └─ Task 2 (RED)
       └─ Task 3 (GREEN: two-phase validate + single re-derivation)
            ├─ Task 4 (gaps surface verbatim)
            ├─ Task 5 (probe throws → fail closed)
            ├─ Task 6 (fresh → no probe)
            ├─ Task 7 (malformed → no recompute)
            ├─ Task 8 (no-probe / indeterminate HEAD unchanged)
            ├─ Task 9 (single-shot + wholesale replace)
            └─ Task 10 (docs)
                 └─ Task 11 (changelog + validation suite)
```

## Integration Points

- **After Task 3:** the end-to-end behavior is testable — an evidence file stamped at a prior HEAD
  plus a live probe drives the gate to a verdict with no staleness retry.
- **After Task 9:** the full negative surface is locked in; the gate cannot degenerate into an
  unconditional accept.

## Coverage Mapping

| Story / criterion | Task(s) |
|---|---|
| S1 happy 1 & 2 (re-derive, persist at current HEAD) | 2, 3 |
| S1 happy 3 (fresh evidence, no probe) | 6 |
| S1 negative 1 (gaps surface verbatim) | 4 |
| S1 negative 2 (probe throws → fail closed) | 5 |
| S2 happy 1 & 2 (leftover verdict never used / never masks a defect) | 3, 4 |
| S2 negative 1 (wholesale replacement) | 9 |
| S2 negative 2 (malformed not repaired) | 7 |
| S3 happy 1 & 2 (no-probe reject; indeterminate HEAD) | 8 |
| S3 negative 1 (at most one re-derivation) | 9 |
| Repo gates (docs, changelog, integrity suite) | 10, 11 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries a `**Wired-into:**` line
- [ ] `test/test_harness_integrity.sh` passes before commit
