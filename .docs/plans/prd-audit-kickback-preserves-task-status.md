# Implementation Plan: engine-owned, git-derived task-status.json (#302)

**Date:** 2026-07-05
**Design:** `.docs/decisions/adr-2026-07-05-engine-owned-task-status.md` (APPROVED, Fable-validated;
binding constraints H1–H9) + `.docs/decisions/architecture-review-prd-audit-kickback-preserves-task-status.md`
**Stories:** `.docs/stories/prd-audit-kickback-preserves-task-status.md` (Status: Accepted)
**Conflict check:** Clean as of 2026-07-05 (`.docs/conflicts/2026-07-05-engine-owned-task-status.md`)
**Source:** jstoup111/ai-conductor#302. Tier **L** — 27 tasks across 3 slices; the scope was
reviewed and accepted at complexity assessment (a coordinated engine + skill-contract change, not
a bundle of unrelated features). Slices are independently shippable checkpoints.

## Summary

Inverts ownership of `.pipeline/task-status.json`: the engine seeds it from the plan, derives
completion from `Task: <id>` commit trailers, and persists durable state in an engine-only
sidecar; the build agent only implements + commits. 27 TDD tasks: Slice 1 (tasks 1–17) eliminates
the wipe-and-loop, Slice 2 (18–21) makes remediation extend the plan, Slice 3 (22–27) adds the
survivable auto-park.

## Technical Approach

- **New engine module `task-evidence.ts`** (sidecar): evidence stamps (`taskId → {sha, form}`),
  the no-evidence attempt counter, and the migration-grandfather set live in
  `.pipeline/task-evidence.json` — written only by engine code, atomic temp-file+rename,
  corruption degrades to re-derivation (git is ground truth; the sidecar caches derivation +
  counters).
- **`autoheal.ts` is promoted and renamed in behavior, not location**: `listCommits` gains
  trailer reading (`%(trailers:key=Task,valueonly)` + `Evidence:` trailers), plan-anchored
  ranges, and fail-closed merge-base; `findMatchingCommit` becomes trailer-first (legacy
  `T<id>`/`#<id>` subject forms only for grandfather-era rows); `parsePlanTaskPaths` grows
  id→{name, paths} capture. Derive never demotes.
- **`artifacts.ts` build predicate** stops reading rows as truth: it calls seed+derive (injected
  via the existing completion-context seam) and evaluates the derived state; agent-written
  `completed`/`skipped` without an engine stamp are ignored; missing/corrupt JSON is rebuilt,
  never terminal.
- **`conductor.ts`**: the `autoHealAttempted` once-guard is dropped for build; derive runs before
  every gate evaluation and before the stall-breaker count; `buildRetryHint` is rewritten
  (trailer-directed; `'no tasks'`/`'missing'` direct at the plan); the engine records the active
  plan path at plan-step completion.
- **Skill contracts**: `/pipeline` (entry-guard removal, field-level write partition, dispatch
  template injects the task id, pre-completion scan → `Evidence:` commits), `/tdd` (trailer gate
  in the commit checklist), `/remediate` (plan-append contract), `finish` (status write dropped);
  `hooks/claude/post-commit-pipeline-sync.sh` removed with a CHANGELOG migration block.
- **Sequencing rationale**: sidecar + evidence reader are the foundation (tasks 1–4); seed/derive/
  gate build on them (5–10); wiring + contracts complete Slice 1 (11–17). Slice 2's id grammar
  (18) must precede the remediation upsert (19–21). Slice 3 reuses the Slice-1 counter for the
  park trigger (22–27).

## Prerequisites

- `src/conductor` vitest suite green on the branch base (run via `rtk proxy npx vitest run`).
- Daemon-mode specs use `daemon: true` + an isolated repo (the established rebase-test convention).

## Tasks

## Slice 1 — loop-and-wipe elimination

### Task 1: Sidecar module — read/write/atomicity
**Story:** "Durable engine state lives in an engine-only sidecar" (happy 1; negative: corrupt/missing)
**Type:** infrastructure
**Steps:**
1. Write failing tests: `task-evidence.test.ts` — round-trips evidence stamps, counter, grandfather set; missing file → empty state; corrupt JSON → empty state + logged anomaly (no throw).
2. RED. 3. Implement `src/conductor/src/engine/task-evidence.ts` (read/write with temp-file+rename). 4. GREEN.
5. Commit: `feat(engine): task-evidence sidecar for engine-only durable state`
**Files likely touched:** `src/conductor/src/engine/task-evidence.ts`, `src/conductor/test/task-evidence.test.ts`, `.gitignore`/templates (sidecar path gitignored)
**Dependencies:** none

### Task 2: Trailer-aware commit reader
**Story:** "Completion evidence is the `Task: <id>` trailer…" (happy 1–3; negative: body-only trailer, malformed forms)
**Type:** happy-path
**Steps:**
1. Failing tests in an isolated repo: body-only `Task: 3` trailer is read; two trailers in one commit yield both ids; `Task:3`/`task: 3`/`Tasks: 3` are NOT parsed as trailers; `Evidence:` trailer values captured.
2. RED. 3. Extend `listCommits` → `listCommitsWithTrailers` (`git log --format` including `%(trailers)`; parse `Task`/`Evidence` keys). 4. GREEN.
5. Commit: `feat(engine): read Task/Evidence trailers from commit bodies`
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, `src/conductor/test/autoheal.test.ts`
**Dependencies:** none

### Task 3: Fail-closed merge-base + plan-anchored range
**Story:** "Evidence range is plan-anchored and fails closed…" (all criteria)
**Type:** negative-path
**Steps:**
1. Failing tests: repo without `origin/main` → zero commits + logged anomaly (pin: never `HEAD -n 100`); commits before the plan-anchor sha are excluded; unreachable anchor → merge-base bound + logged.
2. RED. 3. Implement range resolution (anchor param, fail-closed fallback). 4. GREEN.
5. Commit: `fix(engine): evidence range fails closed and anchors to the plan`
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, tests
**Dependencies:** Task 2

### Task 4: Plan parser returns id→{name, paths}
**Story:** "Engine seeds task-status.json…" (seed needs names); "Completion evidence…" (trailer-only for no-file tasks)
**Type:** infrastructure
**Steps:**
1. Failing tests: `parsePlanTaskPaths` (or a new `parsePlanTasks`) returns name + paths per id for `### Task N: Title` headers; existing path extraction unchanged.
2. RED. 3. Implement (numeric grammar for now — Task 18 extends it). 4. GREEN.
5. Commit: `feat(engine): plan parser captures task names for seeding`
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, tests
**Dependencies:** none

### Task 5: seedTaskStatus — merge/upsert by id
**Story:** "Engine seeds task-status.json from the plan at build entry" (happy 1–3; negative: wipe repair, atomic write)
**Type:** happy-path
**Steps:**
1. Failing tests: fresh build → one `pending` row per plan task; re-seed preserves engine-stamped `completed` (stamp from sidecar) + `in_progress`; new plan task upserted; second re-seed byte-identical; wholesale-wiped file fully restored; write is atomic.
2. RED. 3. Implement `seedTaskStatus(projectRoot, planPath)` in a new `task-seed.ts` (uses Tasks 1+4). 4. GREEN.
5. Commit: `feat(engine): engine seeds task-status.json by merge/upsert (H1)`
**Files likely touched:** `src/conductor/src/engine/task-seed.ts`, tests
**Dependencies:** Tasks 1, 4

### Task 6: Migration grandfather stamp
**Story:** "In-flight features migrate via the grandfather stamp…" (all criteria)
**Type:** happy-path
**Steps:**
1. Failing tests: first seed over a pre-cutover file stamps terminal rows `migration-grandfather` in the sidecar (exactly once); rows appearing after first seed get no stamp; grandfathered rows count complete at the gate.
2. RED. 3. Implement in `task-seed.ts` (first-seed detection = sidecar absent). 4. GREEN.
5. Commit: `feat(engine): migration-grandfather stamp on first seed (H8)`
**Files likely touched:** `src/conductor/src/engine/task-seed.ts`, `task-evidence.ts`, tests
**Dependencies:** Task 5

### Task 7: deriveCompletion — trailer-first authoritative matching
**Story:** "Completion evidence is the `Task: <id>` trailer…" (happy 1, 4; negatives: `(#3)` subject non-match, path-corroboration mismatch)
**Type:** happy-path
**Steps:**
1. Failing tests: trailer + touched plan file → `completed` with `evidencedBy`; trailer-only completes a no-file task; `(#3)` subject never evidences post-cutover; trailer with zero path overlap (task has paths) → not completed + audit-trail entry; legacy subject forms accepted ONLY for grandfather-era evaluation.
2. RED. 3. Rework `findMatchingCommit`/`attemptAutoHeal` → `deriveCompletion` writing stamps to the sidecar. 4. GREEN.
5. Commit: `feat(engine): trailer-first authoritative completion derivation (H5)`
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, `task-evidence.ts`, tests
**Dependencies:** Tasks 2, 3, 4, 1

### Task 8: No-op evidence commits (`Evidence: satisfied-by` / `skipped`)
**Story:** "Commit-less completions use a no-op evidence commit" (all criteria)
**Type:** happy-path
**Steps:**
1. Failing tests: empty commit `Task: 5` + `Evidence: satisfied-by <valid sha>` → completed; `Evidence: skipped <reason>` → `skipped` and gate-acceptable; dangling `satisfied-by` sha → NOT completed + audit log; bare `Task: <id>` empty commit without `Evidence:` → no evidence; a skip never completes dependents.
2. RED. 3. Implement in `deriveCompletion`. 4. GREEN.
5. Commit: `feat(engine): Evidence trailer forms for commit-less completions (H5)`
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, tests
**Dependencies:** Task 7

### Task 9: Never-demote pinned
**Story:** "In-flight features migrate…" (negative: evidence loss → status unchanged)
**Type:** negative-path
**Steps:**
1. Failing test: task evidenced then its commit removed (rebase sim) → derive leaves `completed` untouched.
2. RED. 3. Implement guard (derive only promotes). 4. GREEN.
5. Commit: `test(engine): pin never-demote on evidence loss (H8)`
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, tests
**Dependencies:** Task 7

### Task 10: Gate recomputes — build predicate rework
**Story:** "The gate recomputes completion on every evaluation…" (happy 1; negatives: forged rows, deleted file, corrupt JSON); "Engine seeds…" (empty/missing plan never `done`)
**Type:** happy-path
**Steps:**
1. Failing tests: forged all-completed rows + zero commits → gate fails; deleted `task-status.json` mid-run → re-seed + evidence verdict (never `missing`-forever); corrupt JSON → rebuilt + logged; empty plan → `done:false` with the park/hint reason (empty-is-done removed at the engine layer).
2. RED. 3. Rework `CUSTOM_COMPLETION_PREDICATES.build` to run seed+derive (context seam carries projectRoot/planPath) and evaluate stamps, not raw rows. 4. GREEN.
5. Commit: `feat(engine): build gate recomputes completion from evidence (H6)`
**Files likely touched:** `src/conductor/src/engine/artifacts.ts`, `conductor.ts` (context), tests
**Dependencies:** Tasks 5, 6, 7, 8

### Task 11: Per-gate derive cadence — drop the once-guard
**Story:** "The gate recomputes…" (happy 2–3; negative: once-guard regression)
**Type:** happy-path
**Steps:**
1. Failing tests: two consecutive gate evaluations in one run both derive (attempt-2 commits seen); stall breaker reads post-derive counts (committed work ≠ `no_task_progress`); regression spec fails if `autoHealAttempted` gates build.
2. RED. 3. Remove the build once-guard at `conductor.ts:1306-1308`; order derive before `countResolvedTasks`. 4. GREEN.
5. Commit: `fix(engine): derive on every build gate evaluation (H7)`
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, tests
**Dependencies:** Task 10

### Task 12: Durable no-evidence counter
**Story:** "Durable engine state…" (happy 2–3); "No evidence after N attempts parks…" (negatives: persistence across restarts, reset on progress)
**Type:** happy-path
**Steps:**
1. Failing tests: no-evidence gate miss increments the sidecar counter; a fresh engine process reads the count (simulated re-kick); completed-count increase resets it.
2. RED. 3. Implement counter maintenance in the gate path (Task 10's seam). 4. GREEN.
5. Commit: `feat(engine): durable no-evidence attempt counter (H7, #280 delta)`
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, `task-evidence.ts`, tests
**Dependencies:** Tasks 1, 10

### Task 13: buildRetryHint rewrite + new cases
**Story:** "Third writers are eliminated…" (happy 3); "#115 retryReason keeps working" (negatives: per-case hints)
**Type:** happy-path
**Steps:**
1. Failing tests: `tasks not completed` hint instructs trailer commits (never "update task-status.json yourself"); `'no tasks'` and `'missing'` produce plan-directed hints; default case unchanged.
2. RED. 3. Rewrite `buildRetryHint`. 4. GREEN.
5. Commit: `fix(engine): retry hints direct at trailer commits and the plan (H6)`
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, tests
**Dependencies:** none (wording layer; coordinate with Task 11 ordering at merge)

### Task 14: Engine records the active plan path
**Story:** "Engine seeds…" (happy 4; negative: ambiguous plan → no glob-guess)
**Type:** happy-path
**Steps:**
1. Failing tests: plan-step completion records the plan path (from the plan snapshot) in engine state; seed reads it and ignores a disagreeing agent `plan_ref`; no engine-recorded path + multiple plans → empty/missing route + log (never glob-first).
2. RED. 3. Implement (state file field + seed lookup). 4. GREEN.
5. Commit: `feat(engine): engine-recorded plan path is the seed source (H8)`
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, `task-seed.ts`, tests
**Dependencies:** Task 5

### Task 15: Remove the post-commit hook + finish write
**Story:** "Third writers are eliminated…" (happy 1–2; negative: consumer migration)
**Type:** infrastructure
**Steps:**
1. Failing check: integrity/grep test asserting no hook writes task-status (Task 16's audit covers steady-state; this task makes it true).
2. Remove `hooks/claude/post-commit-pipeline-sync.sh` + its `bin/install` wiring; drop the `finish` SKILL.md status-write line; add CHANGELOG `## Migration` block (removes stale hook wiring in consumers).
3. GREEN (integrity suite + install tests).
5. Commit: `fix(harness): remove non-engine task-status writers (H4) + migration`
**Files likely touched:** `hooks/claude/post-commit-pipeline-sync.sh` (deleted), `bin/install`, `skills/finish/SKILL.md`, `CHANGELOG.md`
**Dependencies:** Task 10 (engine must own completion before writers are removed)

### Task 16: Writer-audit integrity check
**Story:** "Third writers are eliminated…" (negative: repo-wide audit encoded)
**Type:** negative-path
**Steps:**
1. Write the failing check first: a test/integrity assertion that greps `src/conductor`, `skills/`, `hooks/`, `bin/` for `task-status.json` writers and fails on any outside the engine + sanctioned agent scheduling writes.
2. RED (fails until 15 lands). 3. Wire into `test/test_harness_integrity.sh` or a vitest spec. 4. GREEN.
5. Commit: `test(harness): writer audit for task-status.json single authority`
**Files likely touched:** `test/test_harness_integrity.sh` or `src/conductor/test/`, docs
**Dependencies:** Task 15

### Task 17: /pipeline + /tdd contract text
**Story:** "The trailer contract reaches the committing agent…" (all criteria); "Commit-less completions…" (Done When 3)
**Type:** infrastructure
**Steps:**
1. Failing check: integrity guard (Task 16 family) or review checklist asserting: no authoritative-write instruction remains; entry-guard early-exit removed; dispatch template injects id; `/tdd` checklist requires the trailer (incl. refactor commits) + documents `Evidence:` forms; user-exit `in_progress → pending` contract restated.
2. Edit `skills/pipeline/SKILL.md` + `skills/tdd/SKILL.md`. 3. Validation suite green.
5. Commit: `feat(skills): trailer-first commit contract in /pipeline and /tdd (H2)`
**Files likely touched:** `skills/pipeline/SKILL.md`, `skills/tdd/SKILL.md`
**Dependencies:** Task 15 (single-authority prerequisite)

## Slice 2 — remediation extends the plan

### Task 18: Task-id grammar extension
**Story:** "Remediation tasks are plan tasks with deterministic, parseable ids" (negative: grammar round-trip, dotted ids)
**Type:** infrastructure
**Steps:**
1. Failing tests: `taskHeader`/`expandTaskIds` accept `[A-Za-z0-9._-]+` ids (decision recorded in the plan note: extend the grammar rather than annotate numerics — one grammar everywhere); dotted `1.2` no longer dropped; shared fixture proves parser grammar == emitter grammar; trailer `idRe` accepts the same set.
2. RED. 3. Implement parser + matcher extension. 4. GREEN.
5. Commit: `feat(engine): alphanumeric task-id grammar across parser and matcher (H9)`
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, shared fixture in tests, `skills/plan/SKILL.md` (id grammar note)
**Dependencies:** Task 7

### Task 19: /remediate plan-append contract + validation
**Story:** "Remediation tasks are plan tasks…" (happy 1; negative: empty-id rejection, gate-source prefix)
**Type:** happy-path
**Steps:**
1. Failing tests: engine-side plan-append validates non-empty deterministic id (reject otherwise); ids carry gate-source prefix (`rem-fr10-…`, `rem-adr-…`, `rem-test-…`); appended header parses via Task 18.
2. RED. 3. Implement the append helper + `skills/remediate/SKILL.md` contract update (plan-append in addition to `remediation.json`). 4. GREEN.
5. Commit: `feat(engine): remediation extends the plan with validated deterministic ids (H3/H9)`
**Files likely touched:** `src/conductor/src/engine/` (append helper near `planRemediation`), `skills/remediate/SKILL.md`, tests
**Dependencies:** Task 18

### Task 20: Idempotent upsert semantics
**Story:** "Remediation tasks are plan tasks…" (happy 3; negatives: content drift, cross-gate collision)
**Type:** negative-path
**Steps:**
1. Failing tests: same-id re-round → exactly one task; completed row never mutated (content drift → ordinal/content-suffix id); constructed cross-gate collision stays distinct.
2. RED. 3. Implement. 4. GREEN.
5. Commit: `fix(engine): remediation upsert never mutates completed tasks (H9)`
**Files likely touched:** append helper + tests
**Dependencies:** Task 19

### Task 21: Remediation end-to-end
**Story:** "Remediation tasks are plan tasks…" (happy 2)
**Type:** happy-path (integration)
**Steps:**
1. Failing integration spec: blocking gap → plan append → re-seed shows `pending` → trailer commit → gate passes.
2. RED. 3. Wire the kickback path (`planRemediation` outcome triggers append + re-seed). 4. GREEN.
5. Commit: `feat(engine): prd-audit kickback rides the plan, end-to-end (#302)`
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, integration test
**Dependencies:** Tasks 19, 20, 10

## Slice 3 — survivable auto-park

### Task 22: Auto-park marker with distinct provenance
**Story:** "No evidence after N attempts parks…" (happy 1 partial; negative: dashboard mislabel)
**Type:** infrastructure
**Steps:**
1. Failing tests: `writeAutoPark(root, slug, reason)` writes `.daemon/parked/<slug>` with body `auto-parked: <reason>` (+timestamp); `isOperatorParked` still true (existence); a provenance reader distinguishes auto vs operator.
2. RED. 3. Extend `park-marker.ts`. 4. GREEN.
5. Commit: `feat(engine): auto-park marker with machine provenance (Slice 3)`
**Files likely touched:** `src/conductor/src/engine/park-marker.ts`, tests
**Dependencies:** none

### Task 23: Daemon park trigger — N attempts / empty plan
**Story:** "No evidence after N attempts parks…" (happy 1, 4)
**Type:** happy-path
**Steps:**
1. Failing daemon-mode tests (daemon:true, isolated repo): N no-evidence misses (sidecar counter) → auto-park written + event emitted + dispatch stops; empty/missing plan at seed → same path with `empty/missing plan` reason.
2. RED. 3. Implement at the daemon gate layer (has slug + daemon root; the predicate does not — wiring per the review). 4. GREEN.
5. Commit: `feat(daemon): survivable auto-park replaces the infinite re-kick loop (#302)`
**Files likely touched:** `src/conductor/src/engine/conductor.ts` / daemon layer, tests
**Dependencies:** Tasks 12, 22

### Task 24: Re-kick survival + unpark resume
**Story:** "No evidence after N attempts parks…" (happy 2–3)
**Type:** happy-path
**Steps:**
1. Failing tests: `rekickSweep` skips the auto-parked slug (existence check — pin it); `unpark` verb removes the marker, resets the counter, feature resumes on next tick.
2. RED. 3. Wire counter reset into unpark. 4. GREEN.
5. Commit: `feat(daemon): auto-park survives re-kick; unpark resets the evidence counter`
**Files likely touched:** `src/conductor/src/engine/daemon-rekick.ts` (tests only if behavior holds), unpark verb handler, tests
**Dependencies:** Tasks 22, 23

### Task 25: Dashboard provenance + park visibility
**Story:** "No evidence after N attempts parks…" (negatives: provenance shown, event emitted)
**Type:** negative-path
**Steps:**
1. Failing tests: dashboard groups auto-parks distinctly (provenance line rendered); the park emission is a logged event line the halt-monitor surface can watch; a park with no emitted event fails the spec.
2. RED. 3. Implement dashboard read + event emission assertions. 4. GREEN.
5. Commit: `feat(daemon): auto-parks are visible — provenance in dashboard, logged event`
**Files likely touched:** `src/conductor/src/engine/daemon-cli.ts` (dashboard), events, tests
**Dependencies:** Tasks 22, 23

### Task 26: Interactive path unchanged
**Story:** "No evidence after N attempts parks…" (negative: non-daemon); "#115…" (mechanism untouched)
**Type:** negative-path
**Steps:**
1. Failing tests: `daemon:false` in the same no-evidence state → no park marker written, existing stall-REPL/recovery path reached.
2. RED. 3. Guard the trigger on daemon mode. 4. GREEN.
5. Commit: `test(engine): interactive runs never auto-park`
**Files likely touched:** daemon layer guard, tests
**Dependencies:** Task 23

### Task 27: Docs + #115 regression sweep
**Story:** "#115 retryReason keeps working" (Done When); harness "docs track features"
**Type:** infrastructure
**Steps:**
1. Run the full `src/conductor` suite + `test/test_harness_integrity.sh`; fix wording-only #115 assertion updates (call them out in the PR).
2. Update `README.md` + `src/conductor/README.md` (engine-owned task-status, trailer contract, auto-park + unpark, sidecar) and `CHANGELOG.md` `[Unreleased]`.
5. Commit: `docs: engine-owned task-status contract, auto-park, migration notes`
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** all prior

## Task Dependency Graph

```
1 ──┬─────────────► 5 ──► 6 ──┐
4 ──┘                         │
2 ──► 3 ──► 7 ──► 8 ──────────┼─► 10 ──► 11
            7 ──► 9           │    10 ──► 12 (needs 1)
                              │    10 ──► 15 ──► 16
                              │          15 ──► 17
5 ──► 14                      │
13 (independent wording)      │
7 ──► 18 ──► 19 ──► 20 ──► 21 (needs 10)
22 ──► 23 (needs 12) ──► 24, 25, 26
all ──► 27
```
Acyclic; Slice boundaries: {1–17} → {18–21} → {22–27}.

## Integration Points

- **After Task 11:** the wipe-and-loop is dead end-to-end — a forged/wiped/emptied
  `task-status.json` can no longer pass, fail-forever, or stall the gate. Slice 1 shippable
  after Task 17.
- **After Task 21:** a prd-audit kickback rides the plan end-to-end (the #302 trigger path).
- **After Task 26:** the last-resort park replaces the infinite HALT loop; feature complete.

## Verification

- [ ] All happy path criteria covered: seed (T5,6,14), evidence (T2,7,8), gate (T10,11), sidecar
      (T1,12), contracts (T15,17), remediation (T19–21), park (T22–25)
- [ ] All negative path criteria covered: T3 (fail-closed/anchor), T8 (dangling/bare/skip-dependents),
      T9 (never-demote), T10 (forged/deleted/corrupt/empty), T11 (once-guard), T12+T24 (counter
      persistence/reset), T16 (writer audit), T18 (grammar round-trip), T20 (drift/collision/empty-id),
      T25 (visibility), T26 (interactive)
- [ ] No task exceeds ~5 minutes of agent work
- [ ] Dependencies explicit and acyclic
- [ ] Every commit carries the `Task: <id>` trailer once Task 17 lands (self-hosting note: until
      then, this feature's own build uses the pre-change contract)
