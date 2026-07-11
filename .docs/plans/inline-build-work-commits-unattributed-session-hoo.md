# Implementation Plan: Inline Build-Work Attribution Enforcement (#505)

**Date:** 2026-07-10
**Design:** .docs/decisions/adr-2026-07-10-inline-work-attribution-enforcement.md (APPROVED)
**Stories:** .docs/stories/inline-build-work-commits-unattributed-session-hoo.md (Accepted)
**Conflict check:** Clean as of 2026-07-10 (.docs/conflicts/inline-build-work-commits-unattributed-session-hoo.md)

## Summary

Adds three cutover-gated enforcement surfaces so unattributed inline task work cannot be
created silently during daemon builds: a fail-closed `commit-msg` branch, a session
PreToolUse mutation/commit gate, and a zero-work-product step-end kickback. 18 tasks.

## Technical Approach

- **One enforcement decision, engine-computed.** A new module
  `attribution-enforcement.ts` owns the predicate: `attribution_enforcement_cutover`
  (validated exactly like `owner_gate_cutover`) read once at startup; when active, the
  engine writes `.pipeline/build-step-active` around the build step's session (removed in
  a `finally`; defensively cleared at every step entry). Hook scripts check ONLY marker
  presence — bash never parses YAML, and marker presence already encodes
  "build step running AND cutover passed."
- **Surface A** extends `COMMIT_MSG_HOOK` in `git-hook-assets.ts`: when the marker
  exists, a non-empty commit whose message carries no `Task:` trailer exits 1 with a
  redirect message. Exemptions short-circuit first: `MERGE_HEAD`, amend
  (`COMMIT_SOURCE == commit` via prepare-side convention is not available in commit-msg,
  so amend/rebase detection mirrors the existing `prepare-commit-msg` checks: rebase
  dirs via `git rev-parse --git-path` + `test -d`, amend via `CONDUCT_ENGINE_COMMIT`-style
  env is NOT used — amend detection uses the sha-unchanged heuristic already precedented
  in the shipped hooks), empty diff + `Evidence:`, and `CONDUCT_ENGINE_COMMIT=1`.
- **Surface B** is a new embedded session-hook asset (`MUTATION_GATE_HOOK`) matched on
  `Edit|Write|NotebookEdit` and `Bash`: with marker present and `.pipeline/current-task`
  absent/empty, mutation tools exit 2 with the ADR's redirect; Bash blocks only commands
  that *invoke* `git commit` (block-destructive-git.sh scanning precedent). Unparseable
  payload → exit 0 (fail-open, #494 degradation rule). Wired by `writeSessionHooks` +
  `wireSessionHookSettings` (merge-preserving, idempotent).
- **Zero-work net** lives at the build-step seam in `conductor.ts`: capture HEAD at step
  entry; PRE dispatch hook appends to `.pipeline/dispatch-count`; at step end (enforcement
  active, completion check FIRST, no halt marker) zero dispatches + unchanged HEAD emits a
  `zero_work_product` event (existing `this.events.emit` channel), increments
  `noEvidenceAttempts` with a reason, and prepends a corrective preamble to the retry
  prompt. Auto-park threshold unchanged.
- **Sequencing:** config → predicate/marker → Surface A → Surface B → net → wiring is
  interleaved per-surface so each lands test-first; docs and CHANGELOG close.

## Prerequisites

- None beyond current main; all seams exist (`step.name === 'build'` spawn path,
  `seedTaskStatus`, hook asset/wiring modules, `task-evidence.json` ledger).

## Tasks

### Task 1: Config key `attribution_enforcement_cutover`
**Story:** TS-0/TS-4 — cutover flag story (absent/past/future/malformed)
**Type:** infrastructure

**Steps:**
1. Write failing tests: absent key → disabled; past ISO instant → enabled; future → disabled; malformed string → hard config error at load (mirror the `owner_gate_cutover` test block).
2. Verify RED.
3. Implement: register the known key and clone the `owner_gate_cutover` ISO-8601 validation for `attribution_enforcement_cutover` in `config.ts`.
4. Verify GREEN.
5. Commit: "feat(config): attribution_enforcement_cutover key with owner-gate-style validation"

**Files:**
- src/conductor/src/engine/config.ts
- src/conductor/test/engine/config.test.ts

**Dependencies:** none

### Task 2: Enforcement predicate + marker helpers module
**Story:** TS-0 — marker lifecycle story ("exactly one production call site writes the marker")
**Type:** infrastructure

**Steps:**
1. Write failing tests for a new `attribution-enforcement.ts`: `isEnforcementConfigured(config, now)` truth table; `markerPath(root)`; `writeBuildStepMarker`/`removeBuildStepMarker` (idempotent remove, content = ISO timestamp).
2. Verify RED.
3. Implement the module (pure decision + tiny fs helpers; no I/O in the predicate).
4. Verify GREEN.
5. Commit: "feat(engine): attribution-enforcement predicate and build-step marker helpers"

**Files:**
- src/conductor/src/engine/attribution-enforcement.ts
- src/conductor/test/engine/attribution-enforcement.test.ts

**Dependencies:** 1

### Task 3: Marker written around the build step, removed in finally
**Story:** TS-0 — happy paths (exists before first tool call; removed on success/failure/throw)
**Type:** happy-path

**Steps:**
1. Write failing conductor tests (daemon-gated, isolated repo pattern): marker exists during a stubbed build-step session when cutover passed; absent after normal end AND after a session that throws; never written when cutover unset.
2. Verify RED.
3. Implement: in the `step.name === 'build'` spawn path, write the marker before session spawn and remove it in a `finally` around the session await.
4. Verify GREEN.
5. Commit: "feat(engine): build-step-active marker scoped to the build session"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/attribution-enforcement.test.ts

**Dependencies:** 2

### Task 4: Stale marker defensively cleared at every step entry
**Story:** TS-0 — negative paths (crash leaves marker; non-build step unaffected; engineer worktrees never see it)
**Type:** negative-path

**Steps:**
1. Write failing tests: stale marker + non-build step entry → removed before spawn; stale marker + build step entry → cleared then re-written fresh (no error); `seedTaskStatus` continues clearing stale `current-task` untouched.
2. Verify RED.
3. Implement the entry-clear beside the existing stale-`current-task` defensive clear.
4. Verify GREEN.
5. Commit: "fix(engine): clear stale build-step marker at step entry"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/task-seed.ts
- src/conductor/test/engine/task-seed.test.ts

**Dependencies:** 3

### Task 5: commit-msg rejects unattributed content commits (Surface A happy path)
**Story:** TS-1 — rejection + actionable message; stamped implementer unaffected
**Type:** happy-path

**Steps:**
1. Write failing bash-level tests in a real hook-wired temp repo: marker present + non-empty staged diff + no `Task:` trailer → exit 1, stderr contains the dispatch/`Task:` redirect; stamp present → prepare stamps, commit-msg passes.
2. Verify RED.
3. Implement the fail-closed branch in `COMMIT_MSG_HOOK` (after existing validations; trailer check via `git interpret-trailers --parse`).
4. Verify GREEN (real `git commit` in the test repo, plus `bash -n` on the emitted script).
5. Commit: "feat(hooks): fail-closed commit-msg rejection of unattributed build commits"

**Files:**
- src/conductor/src/engine/git-hook-assets.ts
- src/conductor/test/engine/git-hook-assets.test.ts

**Dependencies:** 2

### Task 6: Surface A exemptions — merge, amend, rebase
**Story:** TS-1 — exemption matrix rows 1–3
**Type:** negative-path

**Steps:**
1. Write failing tests: merge commit with `MERGE_HEAD` present lands trailer-less; amend of a pre-enforcement commit lands; commits replayed with rebase dirs present (`git rev-parse --git-path rebase-merge` + `test -d`) land.
2. Verify RED.
3. Implement the short-circuit exemptions ahead of the rejection branch.
4. Verify GREEN.
5. Commit: "feat(hooks): merge/amend/rebase exemptions for the attribution commit gate"

**Files:** same as Task 5

**Dependencies:** 5

### Task 7: Surface A exemptions — empty+Evidence, engine env guard, enforcement-inactive
**Story:** TS-1 — exemption matrix rows 4–7 (incl. unknown-id rejection unchanged)
**Type:** negative-path

**Steps:**
1. Write failing tests: empty commit + resolvable `Evidence: satisfied-by` lands; `CONDUCT_ENGINE_COMMIT=1` trailer-less content commit lands; marker absent → trailer-less content commit lands (today's behavior); existing unknown-id rejection still fires identically.
2. Verify RED.
3. Implement env-guard + marker-absent short-circuits.
4. Verify GREEN.
5. Commit: "feat(hooks): evidence/engine/inactive exemptions for the attribution commit gate"

**Files:** same as Task 5

**Dependencies:** 6

### Task 8: Engine bookkeeping commits set CONDUCT_ENGINE_COMMIT=1
**Story:** TS-1 — engine bookkeeping exemption (write side)
**Type:** infrastructure

**Steps:**
1. Grep all engine-spawned `git commit` call sites (rebase.ts, artifacts.ts, shipped-record-cli.ts, setup-triage.ts and any others found); write failing tests asserting the env var is present on those spawns.
2. Verify RED.
3. Implement: pass `CONDUCT_ENGINE_COMMIT: '1'` in the spawn env at each engine commit call site (single helper if practical).
4. Verify GREEN.
5. Commit: "feat(engine): mark engine-authored commits with CONDUCT_ENGINE_COMMIT"

**Files:**
- src/conductor/src/engine/rebase.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/src/engine/shipped-record-cli.ts
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/git-hook-assets.test.ts

**Dependencies:** 7

### Task 9: Mutation-gate session hook asset (Surface B happy path)
**Story:** TS-2 — Edit/Write/NotebookEdit exit-2 unstamped; pass-through stamped
**Type:** happy-path

**Steps:**
1. Write failing payload→exit-code tests (session-hook-assets pattern): marker present + stamp absent + tool Edit/Write/NotebookEdit → exit 2 with the ADR redirect text; stamp present → exit 0; also `bash -n` the emitted script.
2. Verify RED.
3. Implement `MUTATION_GATE_HOOK` as a new embedded asset (pure bash + inline node, no conduct-ts invocation).
4. Verify GREEN.
5. Commit: "feat(hooks): session mutation gate blocks unstamped file mutation during builds"

**Files:**
- src/conductor/src/engine/session-hook-assets.ts
- src/conductor/test/engine/session-hook-assets.test.ts

**Dependencies:** 2

### Task 10: Mutation-gate negative rows
**Story:** TS-2 — marker-absent pass; unparseable fail-open; corrupt stamp blocks; Task: none dispatch blocked
**Type:** negative-path

**Steps:**
1. Write failing tests: marker absent → exit 0 regardless of stamp; unparseable payload → exit 0 (fail-open); empty/whitespace stamp file → treated absent (blocks); simulated `Task: none` context (no stamp by design) → blocks.
2. Verify RED.
3. Implement the guards.
4. Verify GREEN.
5. Commit: "feat(hooks): mutation-gate degradation and corrupt-stamp guards"

**Files:** same as Task 9

**Dependencies:** 9

### Task 11: Bash matcher blocks unstamped `git commit` invocations
**Story:** TS-2 (Bash story) — plain/`--no-verify`/chained forms blocked
**Type:** happy-path

**Steps:**
1. Write failing tests: Bash payloads `git commit -m x`, `git commit --no-verify -m x`, `cd a && git commit -m x` → exit 2 (marker present, stamp absent); stamped → exit 0.
2. Verify RED.
3. Implement invocation detection in `MUTATION_GATE_HOOK` reusing the scannable-copy quote-span approach from hooks/claude/block-destructive-git.sh as precedent.
4. Verify GREEN.
5. Commit: "feat(hooks): session gate blocks unstamped git commit incl. --no-verify"

**Files:** same as Task 9

**Dependencies:** 10

### Task 12: Bash matcher negative rows — mention-only and unrelated commands pass
**Story:** TS-2 (Bash story) — grep/echo mentions pass; other git and non-git commands pass; inactive enforcement passes
**Type:** negative-path

**Steps:**
1. Write failing tests: `grep 'git commit' f`, `echo "git commit"`, `git status`, `npx vitest run`, `conduct-ts task start 3` → exit 0; marker absent + `git commit --no-verify` → exit 0.
2. Verify RED.
3. Tighten detection to invocation-position matching only.
4. Verify GREEN.
5. Commit: "feat(hooks): bash commit detection targets invocation, not substrings"

**Files:** same as Task 9

**Dependencies:** 11

### Task 13: PRE dispatch hook appends the dispatch-count sentinel
**Story:** TS-3 — dispatch-count signal (and TS-0 additive-only PRE change)
**Type:** infrastructure

**Steps:**
1. Write failing tests: every parsed `Task: <id>`/`Task: none` dispatch appends one line to `.pipeline/dispatch-count`; unparseable payload appends nothing; existing PRE behaviors (stamp, grammar gate, overlap guard) byte-identical.
2. Verify RED.
3. Implement the append in the PRE hook asset.
4. Verify GREEN.
5. Commit: "feat(hooks): PRE dispatch hook records a dispatch-count sentinel"

**Files:**
- src/conductor/src/engine/session-hook-assets.ts
- src/conductor/test/engine/session-hook-assets.test.ts
- src/conductor/test/engine/session-hook-behavior.test.ts

**Dependencies:** 9

### Task 14: Wire the mutation gate into worktree provisioning
**Story:** TS-4 — fail-open provisioning, merge-preserving idempotent wiring
**Type:** infrastructure

**Steps:**
1. Write failing tests extending worktree-prepare suites: `writeSessionHooks` emits the mutation-gate script; `wireSessionHookSettings` adds `Edit|Write|NotebookEdit` and `Bash` matcher entries; pre-existing consumer hooks preserved; double-wire idempotent; hook-copy failure → provisioning continues, reported.
2. Verify RED.
3. Implement wiring alongside the existing PRE/POST entries.
4. Verify GREEN.
5. Commit: "feat(engine): wire mutation-gate session hook at worktree provisioning"

**Files:**
- src/conductor/src/engine/worktree-prepare.ts
- src/conductor/test/engine/worktree-prepare.test.ts

**Dependencies:** 12, 13

### Task 15: Zero-work detection at build-step end
**Story:** TS-3 — four gating conditions, completion-check-first, halt-marker routing
**Type:** happy-path

**Steps:**
1. Write failing engine tests: (a) zero dispatches + unchanged HEAD + no halt marker + incomplete tasks → detected; (b) halt marker present → NOT detected (remediation path owns it); (c) dispatches happened but zero commits → detected; (d) all tasks already complete → never detected (completion first); (e) enforcement inactive → never detected.
2. Verify RED.
3. Implement: capture step-entry HEAD, read dispatch-count, order checks per ADR in the build-step end path.
4. Verify GREEN.
5. Commit: "feat(engine): detect zero-work-product build sessions"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/attribution-enforcement.ts
- src/conductor/test/engine/attribution-enforcement.test.ts

**Dependencies:** 3, 13

### Task 16: Zero-work kickback — event, ledger reason, corrective preamble
**Story:** TS-3 — recorded event on #482 channel; noEvidenceAttempts reason; preamble on retry; auto-park threshold intact
**Type:** happy-path

**Steps:**
1. Write failing tests: detection emits `zero_work_product` event (slug + attempt); `noEvidenceAttempts` incremented with reason `zero_work_product` in task-evidence sidecar; next dispatch prompt contains the corrective preamble; threshold crossing still auto-parks exactly as today.
2. Verify RED.
3. Implement event emission via `this.events.emit`, ledger reason in task-evidence.ts, preamble injection in the retry path.
4. Verify GREEN.
5. Commit: "feat(engine): zero-work kickback event, ledger reason, corrective retry preamble"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/task-evidence.ts
- src/conductor/test/engine/task-evidence.test.ts
- src/conductor/test/engine/attribution-enforcement.test.ts

**Dependencies:** 15

### Task 17: Real-binary probe smoke for the mutation gate
**Story:** TS-5 — block AND pass-through proven in a real `claude -p` session; explicit skip
**Type:** happy-path

**Steps:**
1. Write the env-gated smoke (pattern of existing real-binary tests): provision a temp dir with production wiring + marker; headless session instructed to Write → assert block message observed and file absent; with stamp present → file exists. No binary/auth → explicit skip with reason.
2. Verify it runs RED against a stub before wiring (or asserts skip path deterministically).
3. Wire to the production `writeSessionHooks` output (no hand-rolled settings).
4. Verify GREEN locally with the real binary.
5. Commit: "test(acceptance): real-session probe proves mutation gate block and pass-through"

**Files:**
- src/conductor/test/acceptance/mutation-gate-probe.test.ts

**Dependencies:** 14

### Task 18: Docs, SKILL documentation, CHANGELOG + Migration block
**Story:** TS-2/TS-4 Done When rows — docs track features
**Type:** infrastructure

**Steps:**
1. Document `attribution_enforcement_cutover` (default off, restart-to-apply) in README.md and src/conductor/README.md.
2. Update skills/pipeline/SKILL.md: describe the mutation gate + commit gate as engine behavior (documentation, not new prose rules).
3. Add CHANGELOG `[Unreleased]` entry (Added) with a `## Migration` bash block for the hook-wiring surface.
4. Run test/test_harness_integrity.sh; fix any failures.
5. Commit: "docs: attribution enforcement config, SKILL engine-behavior notes, migration block"

**Files:**
- README.md
- src/conductor/README.md
- skills/pipeline/SKILL.md
- CHANGELOG.md

**Dependencies:** 16, 17

## Task Dependency Graph

```
1 → 2 → 3 → 4
    2 → 5 → 6 → 7 → 8
    2 → 9 → 10 → 11 → 12 ┐
        9 → 13 ──────────┼→ 14 → 17 ┐
    3,13 → 15 → 16 ──────────────────┼→ 18
```

## Integration Points

- After Task 4: marker lifecycle observable end-to-end in an isolated daemon test repo.
- After Task 8: Surface A complete — a real `git commit` matrix (reject + all exemptions) passes in a hook-wired repo.
- After Task 14: full session-hook wiring provisioned; Surface B testable in a real worktree.
- After Task 16: the intake's canary scenario is reproducible in tests (unattributed inline commit impossible; zero-work session kicked back).
- After Task 17: end-to-end proof against the real binary.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (exemption matrix: tasks 6, 7, 10, 12; marker negatives: task 4; net negatives: task 15)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
