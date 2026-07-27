# Implementation Plan: missing-session-hook-files-terminally-halt-a-build

**Date:** 2026-07-23
**Issue:** jstoup111/ai-conductor#896
**Design:** `.docs/decisions/adr-2026-07-23-session-hook-repair-before-halt.md` (APPROVED);
`.docs/architecture/2026-07-23-missing-session-hook-files-terminally-halt-a-build.md`
**Review:** `.docs/decisions/architecture-review-2026-07-23-missing-session-hook-files-terminally-halt-a-build.md` (APPROVED)
**Stories:** `.docs/stories/missing-session-hook-files-terminally-halt-a-build.md` (Accepted, TI-1…TI-5)
**Conflict check:** Clean as of 2026-07-23 (`.docs/conflicts/2026-07-23-missing-session-hook-files-terminally-halt-a-build.md`)
**Tier:** M (`.docs/complexity/missing-session-hook-files-terminally-halt-a-build.md`)

## Summary

Stop terminally halting a build because `.pipeline/session-hooks/*.sh` went missing. The scripts
are pure constants in `session-hook-assets.ts`, so the build preflight re-provisions them in place,
logs the repair, re-stats the filesystem, and proceeds — HALTing only when the repair itself
cannot write. The gate is **not** removed: `pre-dispatch.sh`'s `.pipeline/current-task` stamp still
feeds two live gating consumers (the #505 Surface B mutation gate, and the
`Task:` trailer → `resolveTaskIds` → `countResolvedTasks` → `no_task_progress` stall breaker).
7 tasks.

## Technical Approach

- **Extract an outcome-reporting repair primitive.** `writeSessionHooks` (`worktree-prepare.ts:262`)
  and `wireSessionHookSettings` (`:143`) are private and fail-open (they swallow errors so
  provisioning never blocks). Wrap them in a new exported
  `ensureSessionHooks(worktreeRoot, log?): Promise<{ repaired: string[]; failed: Array<{file: string; error: string}> }>`.
  The internals keep catching; the wrapper *reports*. `prepareWorktree` calls the wrapper and
  ignores the outcome, preserving its posture exactly (risk R2).
- **Repair-then-recheck at one branch.** In `checkAttributionMachineryIntact`
  (`conductor.ts:688-766`), the `missingHooks.length > 0` block (`:740-746`) becomes: call
  `ensureSessionHooks`, `console.warn('[session-hooks] restored <file> in <root>')` per restored
  file, then **re-run the same `accessFile` loop over `expectedHooks`**. Return `null` if the
  re-stat is clean; otherwise return a new diagnostic naming the repair failure. The re-stat is the
  safety mechanism, not the repair's return value (risk R1) — a repair that lies must still HALT.
- **`expectedHooks` (the halt-check set) is unchanged**: the same three enforcement scripts.
  `docs-guard.sh` is provisioned by the repair but never checked, so it can never halt (risk R4).
- **Logging via `console.warn`, not a new event type.** The daemon captures `console.warn` into
  `daemon.log` — precedent: the `[warn] [autoheal]` lines visible in `.daemon/daemon.log.1`, and
  `clearStaleMarker`'s `[task-seed]` warning. No `types/events.ts` change, no renderer plumbing.
- **No new call sites.** The guard is already reached only for
  `step.name === 'build' && isEnforcementConfigured(this.config)` (`conductor.ts:3200-3202`), so
  repair never runs on non-build steps or unconfigured projects (risk R5).
- **Ordering is preserved verbatim.** `writeBuildStepMarker` at `:3207` still runs only under
  `!machineryIssue`. This plan does not touch `:3204-3207`.
- **Sequencing:** primitive first (TI-1), then the guard seam (TI-2), then the arming invariant
  tests (TI-3), then wiring repair (TI-4), then docs (TI-5).

## Prerequisites

None. All machinery exists; changes are additive plus one export.

## Task Dependency Graph

```
Task 1 (ensureSessionHooks primitive)
  ├─▶ Task 2 (prepareWorktree routes through it — no behavior change)
  └─▶ Task 3 (guard: repair-then-recheck)
        ├─▶ Task 4 (arming invariant: re-stat, not return value)
        ├─▶ Task 5 (branch-isolation regressions + supersede the old test)
        └─▶ Task 6 (settings wiring repair)
              └─▶ Task 7 (docs + CHANGELOG + integrity suite)
```

## Tasks

### Task 1: `ensureSessionHooks` — exported, idempotent, outcome-reporting
**Story:** TI-1 (all criteria)
**Type:** implementation
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/worktree-prepare.test.ts`: (a) empty worktree
   → all four scripts exist at 0755 with contents `=== PRE_DISPATCH_HOOK` etc.; (b) only
   `mutation-gate.sh` deleted → restored, `repaired` names exactly it; (c) second call → contents
   unchanged, `failed` empty; (d) `.pipeline/session-hooks/` chmod 0500 → no throw, every script in
   `failed` with an error string; (e) partial failure keeps script and settings failures distinct.
2. Add the `SessionHookRepairOutcome` type and `ensureSessionHooks(worktreeRoot, log?)` to
   `worktree-prepare.ts`, delegating to the existing private writers.
3. Have the private writers report per-file success/failure upward while still never throwing.
4. Run `npm test -- worktree-prepare` in `src/conductor/`.
5. Commit: "feat(worktree-prepare): exported idempotent ensureSessionHooks repair primitive"

**Wired-into:** `worktree-prepare.ts` module exports; consumed by Task 2 and Task 3.

---

### Task 2: `prepareWorktree` routes through the primitive with unchanged posture
**Story:** TI-1 ("prepareWorktree routes through it and its observable behavior is unchanged")
**Type:** refactor
**Dependencies:** Task 1

**Steps:**
1. Write a failing/regression test: `prepareWorktree` completes without throwing when the hooks
   directory is unwritable, and still calls `runProjectSetup` (risk R2).
2. Replace the `writeSessionHooks` + `wireSessionHookSettings` pair at `worktree-prepare.ts:75-76`
   with the single `ensureSessionHooks(worktreePath, log)` call, discarding the outcome.
3. Confirm `session-hooks-provisioning.test.ts` and `worktree-prepare.test.ts` pass untouched.
4. Commit: "refactor(worktree-prepare): provision session hooks via ensureSessionHooks"

**Wired-into:** `prepareWorktree` (`worktree-prepare.ts:67-79`).

---

### Task 3: Guard repairs missing hooks, then re-stats, then proceeds
**Story:** TI-2 (all criteria)
**Type:** implementation
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `src/conductor/test/engine/attribution-conductor-wiring.test.ts`:
   (a) all three enforcement scripts absent, everything else intact → guard returns `null` and the
   three files now exist; (b) only `post-dispatch.sh` absent → `null`, restored; (c) all four
   present → `null`, **no** `console.warn` emitted and no file mtime changes (silent healthy path);
   (d) scripts absent + hooks dir unwritable → diagnostic that matches `/could not restore/i` and
   names the unwritten files, and is textually DISTINCT from today's
   `"missing expected script(s)"` message; (e) `docs-guard.sh` alone absent → `null`, repaired.
2. Replace the `missingHooks.length > 0` block at `conductor.ts:740-746` with: `ensureSessionHooks`
   → per-file `console.warn('[session-hooks] …')` → re-run the `expectedHooks` `accessFile` loop →
   `null` on clean, else the repair-failure diagnostic.
3. Keep the `.pipeline`-absent early return (`:706-708`) ahead of everything, so no repair is
   attempted on an uninitialized project.
4. Run `npm test -- attribution-conductor-wiring`.
5. Commit: "fix(engine): repair missing session hooks at the build preflight instead of halting (#896)"

**Wired-into:** `checkAttributionMachineryIntact` (`conductor.ts:688`), reached from
`seedAndCheckAttributionMachinery` (`:668`) and the build seam (`:3200-3202`).

---

### Task 4: Pin the arming invariant — re-stat, never the repair's word
**Story:** TI-3 (all criteria)
**Type:** test
**Dependencies:** Task 3

**Steps:**
1. Write failing tests: (a) inject/stub `ensureSessionHooks` to report success while
   `mutation-gate.sh` stays absent → guard returns a diagnostic AND
   `.pipeline/build-step-active` is absent afterwards; (b) partial repair (pre-dispatch restored,
   mutation-gate not) → diagnostic naming `mutation-gate.sh`, marker unwritten; (c) genuine repair
   → marker written and `mutation-gate.sh` exists at the path recorded in
   `.claude/settings.local.json`.
2. If the stub requires it, thread an injectable `ensureSessionHooks` dependency into the guard
   (default = the real one) — the minimum seam needed to force the lying-repair case.
3. Assert on the marker FILE, not only on the guard's return value (risk R1).
4. Run `npm test -- attribution-conductor-wiring`.
5. Commit: "test(engine): pin that the build-step marker never arms against a missing gate script"

**Wired-into:** guarded seam `conductor.ts:3204-3207` (asserted, not modified).

---

### Task 5: Branch-isolation regressions + supersede the stale HALT assertion
**Story:** TI-2 negative paths
**Type:** test
**Dependencies:** Task 3

**Steps:**
1. Update `attribution-conductor-wiring.test.ts:1085` — the case
   `'(a) session-hooks missing → seedAndCheckAttributionMachinery still returns the session-hooks
   diagnostic unchanged'`. This assertion is **intentionally superseded** by the ADR; rewrite it to
   assert repair-then-`null`, and add a comment citing #896 + the ADR so a reader does not restore
   it as a "regression". Do NOT silently delete it.
2. Verify the sibling cases still pass byte-identically: `(b)` stamp-path unwritable (`:1100`),
   `(c)` no `.pipeline/` (`:1125`), plan-unresolvable (`:874`), seed-write-failure (`:911`),
   resumed-progress preservation (`:1018`).
3. Add a regression test that a plan-unresolvable worktree still returns its own diagnostic when
   hooks are ALSO missing — branch precedence unchanged.
4. Run the full `src/conductor` suite.
5. Commit: "test(engine): supersede the session-hooks HALT assertion; pin every other guard branch"

**Wired-into:** existing guard test suite.

---

### Task 6: Repair the settings wiring alongside the scripts
**Story:** TI-4 (all criteria)
**Type:** implementation
**Dependencies:** Task 3

**Steps:**
1. Write failing tests: (a) scripts present, session-hook entries stripped from
   `.claude/settings.local.json` (operator keys retained) → after the guard's repair path all six
   engine entries are present exactly once and operator keys survive byte-for-byte; (b) settings
   file unwritable while scripts are fine → guard returns `null` (a wiring failure alone NEVER
   halts, TI-4 negative path); (c) wiring already complete → parsed settings unchanged.
2. Confirm `ensureSessionHooks` always performs the wiring merge, so no separate guard branch is
   introduced.
3. Run `npm test -- worktree-prepare attribution-conductor-wiring`.
4. Commit: "fix(engine): re-arm session-hook settings wiring during preflight repair"

**Wired-into:** `ensureSessionHooks` (Task 1); no new guard branch.

---

### Task 7: Docs, CHANGELOG, integrity suite, release-gate posture
**Story:** TI-5 (all criteria)
**Type:** docs
**Dependencies:** Task 6

**Steps:**
1. `docs/daemon-operations.md`: new subsection — session hooks self-heal at the build preflight;
   grep `[session-hooks]` in `daemon.log`; a *recurring* repair for one feature indicates a
   `.pipeline`-wipe defect (cf. #549 / PR #770), not a hook defect; operators no longer need to
   park or hand-restore `.pipeline/session-hooks/` for this condition.
2. `src/conductor/README.md`: note `ensureSessionHooks` as the single provisioning/repair entry
   point.
3. `CHANGELOG.md` under `## [Unreleased] → Fixed`: entry referencing #896. **Do NOT touch
   `VERSION`** (frozen pre-v1).
4. If the self-host release gate flags a breaking surface for `worktree-prepare.ts`, add
   `.docs/release-waivers/missing-session-hook-files-terminally-halt-a-build.md` with
   `Waives: hook wiring` and a real rationale (wiring *content* and schema unchanged; only an
   additional idempotent invocation point). Do NOT invent an empty migration block.
5. Run `test/test_harness_integrity.sh` and the full `src/conductor` test suite.
6. Commit: "docs: session hooks self-heal at the build preflight (#896)"

**Wired-into:** `docs/daemon-operations.md`, `src/conductor/README.md`, `CHANGELOG.md`.

## Out of Scope

- Removing `.pipeline/dispatch-count` or its now-consumer-less telemetry (noted in the ADR, not
  acted on).
- The `plan could not be resolved` HALT branch that actually halted
  `demote-task-stamping-to-telemetry` — a different branch of the same guard.
- Relocating `.pipeline` run-state (PR #770's territory — the root cause, complementary).
- Any change to hook script contents (PR #629's territory).
- Anything in `artifacts.ts` (#897's territory).
