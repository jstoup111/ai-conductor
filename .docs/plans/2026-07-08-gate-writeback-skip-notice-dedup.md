# Implementation Plan: gate-writeback skip-notice warn-once dedup

**Date:** 2026-07-08
**Design:** technical track — no PRD; decision record `.memory/decisions/2026-07-08-gate-writeback-skip-notice-dedup.md`
**Stories:** `.docs/stories/2026-07-08-gate-writeback-skip-notice-dedup.md`
**Conflict check:** skipped — Tier S (`.docs/complexity/2026-07-08-gate-writeback-skip-notice-dedup.md`)

## Summary

Dedup the three per-pass gate-writeback skip notices (no-PR, terminal PR state, no usable
Source-Ref) to once per `(slug, reason)` per daemon run via an in-memory Set injected through
`GateWritebackDeps`, and reword them as benign will-retry skips. 12 tasks, logging-only —
announce/upsert behavior and the non-throwing contract are unchanged.

## Technical Approach

- **Dedup seam:** add an optional `warnedSkips?: Set<string>` field to `GateWritebackDeps`
  (`src/conductor/src/engine/gate-writeback.ts:62`). A module-private helper
  `logSkipOnce(deps, slug, reason, msg)` implements the policy: no `warnedSkips` injected →
  log every call (legacy/tests fallback, prior behavior); Set injected → log only when
  `` `${slug}:${reason}` `` is absent, then record it. Set operations cannot throw, so the
  best-effort contract is untouched.
- **Reason keys** (stable strings, one per skip site): `no-pr`, `pr-terminal`,
  `no-source-ref`. Keying by `(slug, reason)` means a spec that transitions reasons logs
  once per reason, and the PR-path/issue-path notices never mask each other.
- **Wording:** each notice self-identifies as benign and states what is missing + that the
  daemon retries, keeping the `[gate-writeback]` prefix and quoted slug:
  - no-pr: `[gate-writeback] nothing to announce for gated spec "<slug>" (no PR) — will retry when one exists`
  - pr-terminal: `[gate-writeback] nothing to announce for gated spec "<slug>" (PR <url> is <STATE>) — will retry if it revives`
  - no-source-ref: `[gate-writeback] nothing to announce on an issue for gated spec "<slug>" (no usable Source-Ref, got "<raw>") — will retry when one exists`
- **Production wiring:** `daemon-cli.ts` (~line 884) constructs `gatedWritebackDeps` once
  per daemon run; add `warnedSkips: new Set<string>()` there. The Set's lifetime IS the
  daemon run — a restart re-surfaces each notice once, exactly the requested semantics.
- **Sequencing:** helper + no-pr site first (Tasks 1–4), then the other two sites reuse it
  (Tasks 5–10), then production wiring + suite/CHANGELOG sweep (Tasks 11–12).
- **Test runner:** `rtk proxy npx vitest run test/engine/gate-writeback.test.ts` from
  `src/conductor`.

## Prerequisites

None — no migrations, no new dependencies. `src/conductor` `npm install` must exist in the
build worktree (standing repo convention).

## Tasks

### Task 1: Dedup seam + no-PR skip logs once per run (reworded)
**Story:** Story 1, happy path 1 + Story 4 wording (no-pr site)
**Type:** happy-path

**Steps:**
1. Write failing test: `announceGatedPr` called twice for slug `S` with falsy `prUrl` and a
   shared `warnedSkips: new Set()` in deps logs exactly ONE line matching
   `nothing to announce for gated spec "S" (no PR)` (assert log array length for
   `[gate-writeback]` lines === 1, zero gh calls both passes).
2. Verify test fails (RED) — current code logs twice with the old wording.
3. Implement: add `warnedSkips?: Set<string>` to `GateWritebackDeps`; add module-private
   `logSkipOnce(deps, slug, reason, msg)`; route the no-PR skip through it with reason
   `no-pr` and the new wording.
4. Verify test passes (GREEN).
5. Commit: "feat(gate-writeback): dedup no-PR skip notice once per (slug, reason) per run"

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts` — deps field, helper, no-PR site
- `src/conductor/test/engine/gate-writeback.test.ts` — new test

**Dependencies:** none

### Task 2: No-PR dedup is per-slug and per-run
**Story:** Story 1, happy paths 2–3
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) two DIFFERENT slugs with no PR against one shared Set → one
   line each (two total); (b) same slug against a FRESH Set (simulated restart) → the
   notice appears once again.
2. Verify RED (only if Task 1's key construction is wrong these fail — write them to pin
   the key shape either way; if GREEN immediately, keep as regression pins and note it).
3. Implement: adjust key construction if needed.
4. Verify GREEN.
5. Commit: "test(gate-writeback): pin per-slug and per-run dedup semantics"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 1

### Task 3: No-injection fallback logs every call (no-PR site)
**Story:** Story 1, negative path 2
**Type:** negative-path

**Steps:**
1. Write failing test: deps WITHOUT `warnedSkips` (as existing tests construct them),
   `announceGatedPr` twice with falsy `prUrl` → the notice logs on BOTH calls.
2. Verify RED or GREEN-by-construction (fallback branch); pin it.
3. Implement: ensure `logSkipOnce` logs unconditionally when `warnedSkips` is undefined.
4. Verify GREEN. Also update the existing "no PR found (falsy prUrl) skips with a notice
   and makes zero gh calls" test (test file line ~295) to the new wording.
5. Commit: "test(gate-writeback): legacy callers without dedup state keep log-every-call"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`
- `src/conductor/src/engine/gate-writeback.ts` (only if fallback branch needs fixing)

**Dependencies:** Task 1

### Task 4: Suppressed skip never blocks a later real announcement
**Story:** Story 1, negative path 1
**Type:** negative-path

**Steps:**
1. Write failing test: shared Set; pass 1 `prUrl` falsy (skip logged + recorded); pass 2
   same slug with a real OPEN/MERGED `prUrl` and a fake `runGh` → assert label ensure+add
   and comment upsert calls all happen on pass 2.
2. Verify RED/GREEN (should be GREEN by construction — dedup guards only the log
   statement; pin it as the safety regression test).
3. Implement: nothing expected; fix if the guard was misplaced around the announce work.
4. Verify GREEN.
5. Commit: "test(gate-writeback): dedup suppresses only the skip log, never announcements"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 1

### Task 5: Terminal-PR-state skip dedup + rewording
**Story:** Story 2, happy path 1 + Story 4 wording (pr-terminal site)
**Type:** happy-path

**Steps:**
1. Write failing test: fake `runGh` reporting `CLOSED`; two passes, shared Set → exactly
   one terminal-state line matching `(PR <url> is CLOSED) — will retry if it revives`.
2. Verify RED.
3. Implement: route the terminal-state skip (gate-writeback.ts:161–166) through
   `logSkipOnce` with reason `pr-terminal` and new wording. Update the existing "skips
   silently when the target PR is already CLOSED" test (~line 236) to the new wording.
4. Verify GREEN.
5. Commit: "feat(gate-writeback): dedup terminal-PR-state skip notice"

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts`
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 1

### Task 6: Same slug, different reasons → one line per reason
**Story:** Story 2, happy path 2
**Type:** happy-path

**Steps:**
1. Write failing test: shared Set; pass 1 slug `S` with falsy `prUrl` (no-pr line logged);
   pass 2 slug `S` with a `CLOSED` PR → terminal-state line IS logged (two lines total,
   one per reason).
2. Verify RED/GREEN (pins the `(slug, reason)` key — fails if keyed by slug alone).
3. Implement: fix key construction if needed.
4. Verify GREEN.
5. Commit: "test(gate-writeback): reason transitions log once per reason"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Tasks 1, 5

### Task 7: Terminal-state negatives — non-throwing with dedup; fallback logs both
**Story:** Story 2, negative paths 1–2
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) dedup state present, injected `runGh` throws during
   `prMergeState` on a later pass → `announceGatedPr` resolves without throwing (extend
   the existing never-throws test shape at ~line 208 with `warnedSkips` present);
   (b) no `warnedSkips` injected, `CLOSED` skip fires twice → logs both calls.
2. Verify RED/GREEN; pin both.
3. Implement: nothing expected.
4. Verify GREEN.
5. Commit: "test(gate-writeback): terminal-state dedup keeps non-throwing + legacy fallback"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 5

### Task 8: No-usable-Source-Ref skip dedup + rewording
**Story:** Story 3, happy path 1 + Story 4 wording (no-source-ref site)
**Type:** happy-path

**Steps:**
1. Write failing test: `announceGatedIssue` twice for slug `S` with a malformed
   `sourceRef` (e.g. `"not-a-ref"`) and shared Set → exactly one line matching
   `nothing to announce on an issue for gated spec "S"`.
2. Verify RED.
3. Implement: route the parse-failure skip (gate-writeback.ts:207–214) through
   `logSkipOnce` with reason `no-source-ref` and new wording; update any existing
   assertions pinned to the old Source-Ref wording.
4. Verify GREEN.
5. Commit: "feat(gate-writeback): dedup no-Source-Ref skip notice"

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts`
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 1

### Task 9: PR-path and issue-path reasons dedupe independently; valid ref still announces
**Story:** Story 3, happy path 2 + negative path 1
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) shared Set; `announceGatedPr` skip (no-pr) for slug `S`, then
   `announceGatedIssue` skip (no-source-ref) for `S` → BOTH lines logged (independent
   keys); (b) shared Set with `S:no-source-ref` already recorded, then
   `announceGatedIssue` with a VALID `sourceRef` and fake `runGh` → issue label + comment
   upsert calls happen.
2. Verify RED/GREEN; pin both.
3. Implement: nothing expected.
4. Verify GREEN.
5. Commit: "test(gate-writeback): independent reason keys; dedup never blocks issue announce"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Tasks 1, 8

### Task 10: Absent sourceRef stays silent; no-injection fallback (issue site)
**Story:** Story 3, negative paths 2–3
**Type:** negative-path

**Steps:**
1. Write/keep tests: (a) `sourceRef` undefined with dedup state present → behavior
   identical to today (existing absent-ref tests pass unmodified — no NEW log lines);
   (b) no `warnedSkips` injected, malformed ref twice → logs both calls.
2. Verify existing absent-ref tests still pass; add the fallback test; verify GREEN.
3. Implement: nothing expected.
4. Verify GREEN.
5. Commit: "test(gate-writeback): absent Source-Ref behavior unchanged; issue-site fallback"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 8

### Task 11: Wire the per-run dedup Set at the daemon call site
**Story:** Story 4, Done When 3
**Type:** infrastructure

**Steps:**
1. Implement: in `src/conductor/src/daemon-cli.ts` (~line 884), extend
   `gatedWritebackDeps` to `{ cwd: projectRoot, log, warnedSkips: new Set<string>() }` —
   constructed once per daemon run, shared by every `announceGatedPr`/`announceGatedIssue`
   call across all discover passes.
2. Typecheck: `rtk proxy npx tsc --noEmit` (or the repo's build script) passes.
3. Grep-verify: exactly one `new Set` injection at the call site; no other production
   caller constructs gate-writeback deps without it.
4. Run the full gate-writeback test file — GREEN.
5. Commit: "feat(daemon): inject per-run gate-writeback skip dedup state"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — one-line deps extension

**Dependencies:** Tasks 1, 5, 8

### Task 12: Wording sweep, full suite, CHANGELOG
**Story:** Story 4, Done When 1–2 + repo release gate
**Type:** infrastructure

**Steps:**
1. Sweep: `grep -rn "skipping label/comment\|skipping issue announcement\|no PR known"
   src/ test/` inside `src/conductor` → zero hits outside historical docs; every
   assertion matches the NEW strings exactly (no test green by matching neither wording).
2. Run `rtk proxy npx vitest run test/engine/gate-writeback.test.ts` → GREEN; then the
   engine test directory (`rtk proxy npx vitest run test/engine`) for collateral damage.
3. Add `CHANGELOG.md` `[Unreleased]` → `### Fixed` entry: gate-writeback skip notices now
   log once per (slug, reason) per daemon run with benign will-retry wording (#379).
4. Run `test/test_harness_integrity.sh` from the repo root (repo validation rule).
5. Commit: "docs(changelog): gate-writeback skip-notice dedup entry (#379)"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts` — any stragglers
- `CHANGELOG.md`

**Dependencies:** Tasks 1–11

## Task Dependency Graph

```
Task 1 ──┬─ Task 2
         ├─ Task 3
         ├─ Task 4
         ├─ Task 5 ──┬─ Task 6 (also needs 1)
         │           └─ Task 7
         ├─ Task 8 ──┬─ Task 9 (also needs 1)
         │           └─ Task 10
         └─ Task 11 (needs 1, 5, 8)
Tasks 1–11 ── Task 12
```

## Integration Points

- After Task 4: the no-PR site is fully deduped, reworded, and proven not to block
  announcements — the pattern the other two sites copy.
- After Task 11: end-to-end production semantics exist — an idle daemon with a gated,
  PR-less spec writes each skip notice once per run to `.daemon/daemon.log`.

## Verification

- [ ] All happy path criteria covered by at least one task (Stories 1–3 happy → Tasks 1–2,
      5–6, 8–9; Story 4 → Tasks 1, 5, 8, 12)
- [ ] All negative path criteria covered by explicit tasks (Tasks 3–4, 7, 9–10)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Announce/upsert behavior and non-throwing contract asserted unchanged (Tasks 4, 7, 9)
- [ ] CHANGELOG `[Unreleased]` entry added (Task 12)
