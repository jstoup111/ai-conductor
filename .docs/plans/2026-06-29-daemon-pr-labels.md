# Implementation Plan: Daemon PR Labeling

**Date:** 2026-06-29
**Design:** .docs/specs/2026-06-29-daemon-pr-labels.md (FR-1…FR-16)
**Stories:** .docs/stories/daemon-pr-labels.md
**ADR:** .docs/decisions/adr-015-daemon-pr-labeling-sweep.md (APPROVED)
**Conditions:** C1–C4 in .docs/decisions/architecture-review-2026-06-29-daemon-pr-labels.md
**Conflict check:** Clean as of 2026-06-29 (one degrading conflict resolved → FR-16)

## Summary
Two daemon-mode PR-labeling behaviors behind one best-effort `gh` seam: ~20 TDD tasks across three
new modules (`pr-labels.ts`, `build-failure-escalation.ts`, `mergeable-sweep.ts`), a per-repo watch
registry, three wiring sites, and docs.

## Technical Approach
- **`src/engine/pr-labels.ts`** — the single seam over `gh`. Injected `runGh`/`runGit` (prod
  defaults via `execFile`+`promisify`, mirroring `makeProductionGh()`), every primitive try/caught
  and **non-throwing**: `ensureLabel`, `addLabel`, `removeLabel`, `prMergeState`, `findOrCreatePr`,
  `comment`, `setReady`. Mergeability is parsed once into `{state, mergeable, hasFailingOrPendingChecks, labels}` (C4: `UNKNOWN`/failing/pending ⇒ not mergeable).
- **`src/engine/build-failure-escalation.ts`** — `escalateBuildFailure({projectRoot, failureReason,
  log, runGit?, runGh?})`: derive branch+base (origin/HEAD symbolic-ref, never hardcode `main`),
  count `mergeBase..HEAD`; zero commits ⇒ return (FR-6); else push → find/create **draft** PR →
  ensure+add `needs-remediation` → comment the reason. Each step swallowed (FR-7).
- **`src/engine/mergeable-sweep.ts`** — owns the per-repo registry `.daemon/mergeable-watch.jsonl`
  (`readWatch`/`enrollWatch`/`rewriteWatch`) and `sweepMergeableLabels({projectRoot, log, runGh?})`:
  for each tracked PR, `prMergeState` then the decision tree (prune MERGED/CLOSED/404 FR-13 →
  exclude `needs-remediation` FR-12 → add when green FR-10 → else remove FR-11). Idempotent (C2).
- **Wiring (3 sites):** (1) `conductor.ts` ~926-945 build-failure block — after the HALT+state
  writes, guarded `mode==='auto' && step==='build'`, call escalation wrapped so it cannot throw (C1).
  (2) `daemon-runner.ts` done-branch (~109-119) — FR-16 clear-on-success + enroll, before teardown;
  call the sweep after each feature. (3) `daemon.ts` — call the sweep on startup reconciliation and
  per poll tick (cadence per ADR-015).
- **Sequencing:** seam first (it's the dependency), then each behavior module against fake runners,
  then the wiring against the real conductor/daemon, then docs. The diagrams already reflect this
  design (built from the same breakdown) — no plan-update re-run needed; architecture-review is done.

## Prerequisites
- None beyond the existing conductor toolchain. Tests: `npm test` (vitest) in `src/conductor/`;
  type gate: `npm run typecheck`. New tests go in `test/engine/*.test.ts`; sources in `src/engine/`.

## Tasks

### Task 1: pr-labels seam scaffold + ensureLabel
**Story:** "Open a draft needs-remediation PR" (label idempotency) — FR-2
**Type:** infrastructure
**Steps:**
1. Write failing test (`test/engine/pr-labels.test.ts`): `ensureLabel(runGh, cwd, 'x', 'B60205')` calls `gh label create x --color B60205 --force -R <cwd>` and, when `runGh` rejects, resolves without throwing.
2. RED.
3. Implement `src/engine/pr-labels.ts`: `GhRunner`/`GitRunner` types, prod factories via `execFile`+`promisify`, `ensureLabel` (try/caught).
4. GREEN.
5. Commit: "feat(pr-labels): gh seam scaffold + idempotent ensureLabel".
**Files:** `src/engine/pr-labels.ts`, `test/engine/pr-labels.test.ts`
**Dependencies:** none

### Task 2: addLabel / removeLabel
**Story:** keep-in-sync add/remove — FR-2, FR-11
**Type:** infrastructure
**Steps:** 1. Test: `addLabel`/`removeLabel` invoke `gh pr edit <url> --add-label`/`--remove-label` and swallow runner errors. 2. RED. 3. Implement both. 4. GREEN. 5. Commit.
**Files:** `src/engine/pr-labels.ts`, test
**Dependencies:** Task 1

### Task 3: prMergeState + mergeability parse (C4)
**Story:** "Apply mergeable when ready" — FR-10, FR-14; "in sync" — FR-11
**Type:** infrastructure
**Steps:**
1. Test: given fake `gh pr view --json state,mergeable,statusCheckRollup,labels` outputs — OPEN+MERGEABLE+all-SUCCESS ⇒ mergeable true; zero checks ⇒ true; any FAILURE/ERROR/PENDING ⇒ false; `mergeable:UNKNOWN` ⇒ false; CONFLICTING ⇒ false; non-OPEN ⇒ false. A runner error ⇒ returns a safe "not mergeable / skip" result (no throw).
2. RED.
3. Implement `prMergeState` returning `{state, mergeable, hasFailingOrPendingChecks, labels}` and a `isMergeable()` predicate.
4. GREEN.
5. Commit.
**Files:** `src/engine/pr-labels.ts`, test
**Dependencies:** Task 1

### Task 4: findOrCreatePr (reuse + draft)
**Story:** "Reuse an existing PR" — FR-5; draft — FR-4
**Type:** infrastructure
**Steps:**
1. Test: when `gh pr view <branch> --json url,state` returns an OPEN PR, reuse its url and do NOT call `pr create`; when none, call `gh pr create --draft --head <branch> --base <base> ...` and parse url via `extractPrUrl`; a closed/merged existing PR ⇒ does not resurrect (create-new/log).
2. RED. 3. Implement using `extractPrUrl` from `state.ts`. 4. GREEN. 5. Commit.
**Files:** `src/engine/pr-labels.ts`, test
**Dependencies:** Task 1

### Task 5: comment + setReady
**Story:** comment reason — FR-3; un-draft on success — FR-16
**Type:** infrastructure
**Steps:** 1. Test: `comment(url, body)` calls `gh pr comment <url> --body …` and swallows errors; `setReady(url)` calls `gh pr ready <url>` and swallows errors. 2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** `src/engine/pr-labels.ts`, test
**Dependencies:** Task 1

### Task 6: escalation — branch/base derivation + commit gate (FR-6)
**Story:** "No GitHub artifacts when no commits" — FR-6; "Recognize failure" base derivation — FR-2
**Type:** happy-path + negative-path
**Steps:**
1. Test (`test/engine/build-failure-escalation.test.ts`): with fake `runGit`, zero commits in `mergeBase..HEAD` ⇒ returns `{}` and makes NO gh calls; base derived from `git symbolic-ref refs/remotes/origin/HEAD` (not hardcoded `main`); a git error in counting ⇒ conservative no-op (no PR), no throw.
2. RED. 3. Implement `escalateBuildFailure` skeleton + commit-count gate. 4. GREEN. 5. Commit.
**Files:** `src/engine/build-failure-escalation.ts`, test
**Dependencies:** Task 1

### Task 7: escalation — push step, swallow on failure (FR-7)
**Story:** "Best-effort / never blocks" — FR-7; "Open draft PR" push — FR-2
**Type:** happy-path + negative-path
**Steps:** 1. Test: with ≥1 commit, calls `git push -u origin <branch>`; when push rejects ⇒ returns `{}` (no PR), logs, no throw. 2. RED. 3. Implement push step. 4. GREEN. 5. Commit.
**Files:** `src/engine/build-failure-escalation.ts`, test
**Dependencies:** Task 6

### Task 8: escalation — draft PR + needs-remediation label (FR-2/4/5)
**Story:** "Open a draft needs-remediation PR"; "Reuse existing PR"
**Type:** happy-path
**Steps:** 1. Test: after push, calls `findOrCreatePr(draft=true)` then `ensureLabel`+`addLabel('needs-remediation')`; reuses an existing open PR (no duplicate create); a `pr create` failure ⇒ no label/comment attempted, no throw. 2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** `src/engine/build-failure-escalation.ts`, test
**Dependencies:** Tasks 4, 7

### Task 9: escalation — failure-reason comment (FR-3), per-step swallow
**Story:** "Comment the failure reason" — FR-3; FR-7
**Type:** happy-path + negative-path
**Steps:** 1. Test: posts a comment containing the failure reason + trimmed error + "manual remediation required"; a `comment` failure is swallowed and the label step still ran; a very long error is trimmed (bounded). 2. RED. 3. Implement comment build (trim) + call order. 4. GREEN. 5. Commit.
**Files:** `src/engine/build-failure-escalation.ts`, test
**Dependencies:** Tasks 5, 8

### Task 10: wire escalation into Conductor (C1)
**Story:** "Recognize irrecoverable failure" — FR-1; FR-7, FR-8
**Type:** integration
**Steps:**
1. Test (`test/engine/conductor-build-escalation.test.ts`): in `mode='auto'`, build retries exhausted ⇒ `escalateBuildFailure` invoked AFTER `.pipeline/HALT` + state are written; with escalation stubbed to **throw**, the HALT file still exists, state is written, and `run()` returns cleanly; `loop_halt` carries the prUrl when present.
2. RED.
3. Implement: in `conductor.ts` ~926-945, after HALT+state writes, `if (step.name==='build') await escalateBuildFailure(...).catch(()=>{})`; thread prUrl into the emitted event.
4. GREEN. 5. Commit.
**Files:** `src/engine/conductor.ts`, test
**Dependencies:** Task 9

### Task 11: interactive-mode guard (FR-8)
**Story:** "Recognize irrecoverable failure" — FR-8
**Type:** negative-path
**Steps:** 1. Test: build failure with `mode!=='auto'` ⇒ escalation NOT called (zero gh side effects). 2. RED. 3. Confirm/enforce the `mode==='auto'` guard. 4. GREEN. 5. Commit.
**Files:** `src/engine/conductor.ts`, test
**Dependencies:** Task 10

### Task 12: watch registry helpers (C3)
**Story:** enrollment + pruning — FR-9, FR-13
**Type:** infrastructure
**Steps:**
1. Test (`test/engine/mergeable-sweep.test.ts`): `enrollWatch` appends `{prUrl,slug,repoCwd}` to `.daemon/mergeable-watch.jsonl`; `readWatch` parses it (tolerates missing file / malformed line); `rewriteWatch` prunes entries; a rewrite failure is swallowed.
2. RED. 3. Implement helpers in `src/engine/mergeable-sweep.ts`. 4. GREEN. 5. Commit.
**Files:** `src/engine/mergeable-sweep.ts`, test
**Dependencies:** none

### Task 13: sweep decision tree (FR-10/11/12/13)
**Story:** apply/sync/exclude/prune
**Type:** happy-path + negative-path
**Steps:**
1. Test: for each tracked PR via fake `prMergeState`/`runGh` — MERGED/CLOSED/404 ⇒ pruned (FR-13); carries `needs-remediation` ⇒ ensure `mergeable` absent, never add (FR-12); open+green+no-conflict ⇒ add `mergeable` (FR-10); not-mergeable/UNKNOWN ⇒ remove if present (FR-11); a read failure on one PR ⇒ skip it, continue others (FR-15).
2. RED. 3. Implement `sweepMergeableLabels`. 4. GREEN. 5. Commit.
**Files:** `src/engine/mergeable-sweep.ts`, test
**Dependencies:** Tasks 2, 3, 12

### Task 14: sweep idempotency (C2)
**Story:** "Keep mergeable in sync" no-thrash — FR-11
**Type:** negative-path
**Steps:** 1. Test: running the sweep twice on an unchanged green PR adds the label at most once and issues no redundant remove; an already-correctly-labeled PR ⇒ no add/remove call. 2. RED. 3. Add the "only change on actual state delta" guard (read current labels, act on diff). 4. GREEN. 5. Commit.
**Files:** `src/engine/mergeable-sweep.ts`, test
**Dependencies:** Task 13

### Task 15: daemon-runner enroll on done (FR-9)
**Story:** "Only fully-shipped PRs eligible" — FR-9, FR-15
**Type:** integration
**Steps:**
1. Test (`test/engine/daemon-runner-mergeable.test.ts`): outcome `done`+pr_url ⇒ `enrollWatch` called before teardown; `halted`/`error` or no-pr_url ⇒ not enrolled; an enroll failure is swallowed and teardown/markProcessed still run.
2. RED. 3. Implement in `daemon-runner.ts` done-branch (~109-119). 4. GREEN. 5. Commit.
**Files:** `src/engine/daemon-runner.ts`, test
**Dependencies:** Task 12

### Task 16: FR-16 clear-on-success
**Story:** "Clear the failure signal when a re-kicked feature succeeds" — FR-16
**Type:** happy-path + negative-path
**Steps:**
1. Test: on `done` enrollment, if the PR carries `needs-remediation` ⇒ `removeLabel('needs-remediation')` + `setReady` (best-effort); no-op when the label is absent; a failed clear is swallowed (enrollment/teardown proceed); only `done` (not halted/error) triggers it.
2. RED. 3. Implement clear-on-success in the done-branch before enroll. 4. GREEN. 5. Commit.
**Files:** `src/engine/daemon-runner.ts`, `src/engine/pr-labels.ts`, test
**Dependencies:** Tasks 2, 5, 15

### Task 17: sweep cadence wiring (FR-14)
**Story:** "Apply mergeable when ready" re-check over time — FR-14, FR-15
**Type:** integration
**Steps:**
1. Test: the sweep is invoked (a) after each feature in `daemon-runner`, and (b) on daemon startup reconciliation and per poll tick in `daemon.ts`; a sweep throw is swallowed and does not disrupt feature processing.
2. RED. 3. Wire the calls (best-effort). 4. GREEN. 5. Commit.
**Files:** `src/engine/daemon-runner.ts`, `src/engine/daemon.ts`, test
**Dependencies:** Tasks 13, 15

### Task 18: type gate + full-suite green
**Story:** all
**Type:** infrastructure
**Steps:** 1. `npm run typecheck` clean. 2. `npm test` green. 3. Fix any fallout. 4. Commit.
**Files:** as needed
**Dependencies:** Tasks 10–17

### Task 19: docs — READMEs + SKILL + CHANGELOG
**Story:** Docs-track-features (repo rule)
**Type:** infrastructure
**Steps:**
1. `src/conductor/README.md`: add "needs-remediation PR on irrecoverable build failure" (note distinct from intake `needs-manual`) and "mergeable label sweep" (done-only, kept-in-sync, watch registry, cadence).
2. `README.md`: one line each on the two labels in the daemon section.
3. `skills/conduct/SKILL.md` §3: note daemon-mode escalation + post-finish mergeable labeling.
4. `CHANGELOG.md` `[Unreleased]` → Added: shipped behavior (supersede the PRD-only entry).
5. Commit.
**Files:** `src/conductor/README.md`, `README.md`, `skills/conduct/SKILL.md`, `CHANGELOG.md`
**Dependencies:** Task 18

### Task 20: harness integrity gate
**Story:** repo validation rule
**Type:** infrastructure
**Steps:** 1. Run `test/test_harness_integrity.sh` ⇒ all pass. 2. Fix any reference/frontmatter fallout from the SKILL.md edit. 3. Commit.
**Files:** as needed
**Dependencies:** Task 19

## Task Dependency Graph
```
1 → 2,3,4,5
1 → 6 → 7 → 8 → 9 → 10 → 11
   (4 ──────────↗)
12 → 13 → 14
2,3 ─↗
12 → 15 → 16
13,15 → 17
10,11,14,16,17 → 18 → 19 → 20
```

## Integration Points
- After Task 11: needs-remediation surfacing works end-to-end against fake runners + the real conductor build-failure path (incl. the C1 throw-safety guarantee).
- After Task 17: the mergeable lifecycle (enroll → clear-on-success → sweep add/remove/prune) runs on the real daemon cadence.
- After Task 20: PR-ready; ship gates (manual-test auto-skip likely — no HTTP endpoints; prd-audit; as-built review) follow.

## Verification
- [ ] All happy-path criteria covered (Tasks 1–9, 12–17)
- [ ] All negative-path criteria covered (Tasks 3,6,7,8,9,11,13,14,16; C1 in 10)
- [ ] Conditions C1 (Task 10), C2 (Task 14), C3 (Task 12), C4 (Tasks 3,13) covered
- [ ] No task exceeds ~5 min; dependencies explicit + acyclic
- [ ] 20 tasks — within normal range

## Coverage map (FR → task)
FR-1→10 · FR-2→8 · FR-3→9 · FR-4→4,8 · FR-5→4,8 · FR-6→6 · FR-7→7,9,10 · FR-8→11 · FR-9→15 ·
FR-10→3,13 · FR-11→2,13,14 · FR-12→13 · FR-13→12,13 · FR-14→17 · FR-15→13,17 · FR-16→16
