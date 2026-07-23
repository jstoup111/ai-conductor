# Implementation Plan: Canonical tracker-client seam with per-backend transport contract (#846)

**Date:** 2026-07-22
**Design:** .docs/decisions/adr-2026-07-22-canonical-tracker-client-seam.md (APPROVED); architecture-review-2026-07-22-canonical-tracker-client-seam.md (APPROVED WITH CONDITIONS 1–3)
**Stories:** .docs/stories/canonical-tracker-client-seam-with-per-backend-tra.md (Accepted, TR-1..TR-6)
**Conflict check:** Clean as of 2026-07-22 (zero blocking; .docs/conflicts/2026-07-22-canonical-tracker-client-seam.md)
**Source:** jstoup111/ai-conductor#846 (Refs #774)

## Summary

Creates `engine/tracker-client.ts` — the canonical `TrackerClient` interface, `GhRunner`
type, and the only kill-switch-guarded `makeProductionGh` — then migrates every
issue-side call site onto it, folds in halt-issues' `GhAbstraction`, adds a checked-in
grep gate, and documents the reserved `tracker` config contract. 16 tasks.

## Technical Approach

- **Module direction (no import cycle):** `tracker-client.ts` HOSTS
  `assertRealExecAllowed` (moved from `pr-labels.ts`, where it is currently a
  non-exported internal at pr-labels.ts:41-58), `GhRunner`, and `makeProductionGh`.
  `pr-labels.ts` becomes a thin re-export
  (`export { makeProductionGh, type GhRunner } from './tracker-client.js'`) and imports
  the guard for its own `makeProductionGit` — a one-way pr-labels → tracker-client
  dependency, keeping every existing importer of `pr-labels.ts` working (Condition 1:
  ~40-line hookup diff, no PR-machinery function bodies touched).
- **Interface:** `TrackerClient` = object interface over the verified issue-op union:
  `getIssueLabels`, `addIssueLabel`, `getBlockedBy`, `commentOnIssue`, `createIssue`,
  `viewIssue`, `closeIssue`, `viewerIdentity`, `listAssignedIssues`, plus the body/edit
  ops halt-issues needs (`getIssueBody`, `upsertIssueBody`, `upsertIssueComment`,
  `getIssueState`). `createGithubTrackerClient(runner)` maps each to the exact argv the
  pre-migration call sites produce (argv parity is the test currency throughout).
- **Migration order:** leaf modules first (backlog-priority, blocker-resolver,
  wiring-probe, identity, dep-migration, file-issue, github-issues), then composition
  roots (engineer-cli, daemon-cli, halt-issues-cli), then the grep gate that freezes
  the end state. `dependency-claim.ts` is untouched (intake-only pin).
- **Signature widening:** today's no-`cwd` runners (`BlockerRunner`,
  wiring-probe's local `GhRunner`) widen to the canonical `(args, { cwd })`;
  construction sites (`overlap-scan.ts`, engineer-cli, daemon-cli) supply `cwd`.
- **Contract-not-code (Condition 3):** the `tracker` config key is documented in docs
  only; no `HarnessConfig` field, no engine read, no new dependency.

## Prerequisites

None — no migration, no new dependency; `gh` CLI behavior unchanged throughout.

## Tasks

### Task 1: Create tracker-client.ts with guard, canonical GhRunner, and makeProductionGh; pr-labels re-export shim
**Story:** TR-1 (canonical module), TR-5 (pr-labels minimal diff)
**Type:** infrastructure

**Steps:**
1. Write failing test: importing `GhRunner`, `makeProductionGh`, `assertRealExecAllowed` from `engine/tracker-client.ts` typechecks; `makeProductionGh()` under `AI_CONDUCTOR_NO_REAL_EXEC=1` throws before any child process spawns (spy on child_process)
2. Verify test fails (RED)
3. Implement: new `engine/tracker-client.ts` hosting the moved `assertRealExecAllowed`, the canonical `GhRunner` type, and the single `makeProductionGh`; `pr-labels.ts` deletes its local copies, adds `export { makeProductionGh, assertRealExecAllowed, type GhRunner } from './tracker-client.js'` and imports the guard for `makeProductionGit`
4. Verify test passes (GREEN); `pr-labels` test file passes UNMODIFIED
5. Commit: "feat(tracker-client): canonical GhRunner + single guarded makeProductionGh; pr-labels re-export shim"

**Files:**
- src/conductor/src/engine/tracker-client.ts — new module
- src/conductor/src/engine/pr-labels.ts — re-export shim only
- src/conductor/test/tracker-client.test.ts — new tests

**Wired-into:** src/conductor/src/engine/pr-labels.ts#makeProductionGit (guard import; existing importers resolve via re-export)
**Dependencies:** none

### Task 2: TrackerClient interface + GitHub client read ops (labels, view, state, identity, blocked_by, list)
**Story:** TR-2 (argv parity — read ops)
**Type:** happy-path

**Steps:**
1. Write failing tests: with a fake runner, `getIssueLabels`/`viewIssue`/`getIssueState`/`viewerIdentity`/`getBlockedBy`/`listAssignedIssues` produce byte-exact pre-migration argv (label read per backlog-priority.ts:335, blocked_by per blocker-resolver.ts:151, identity per identity.ts:72, issue view per wiring-probe.ts:539, assignee-scoped list per github-issues poll)
2. Verify RED
3. Implement: `TrackerClient` interface + `createGithubTrackerClient(runner)` read ops
4. Verify GREEN
5. Commit: "feat(tracker-client): TrackerClient interface + GitHub read ops with argv parity"

**Files:**
- src/conductor/src/engine/tracker-client.ts — interface + read ops
- src/conductor/test/tracker-client.test.ts — argv parity tests

**Wired-into:** none (inert until src/conductor/src/engine/engineer-cli.ts)
**Dependencies:** Task 1

### Task 3: GitHub client write ops (comment, create, close, label add, body upsert)
**Story:** TR-2 (argv parity — write ops)
**Type:** happy-path

**Steps:**
1. Write failing tests: `commentOnIssue`/`createIssue`/`closeIssue`/`addIssueLabel`/`upsertIssueBody`/`upsertIssueComment` argv parity (comment + label add per github-issues.ts:299-321, create per file-issue.ts:135, close/edit per halt-issues-cli.ts:107-183 incl. cross-repo targeting parity with the old `GH_REPO` env form)
2. Verify RED
3. Implement write ops
4. Verify GREEN
5. Commit: "feat(tracker-client): GitHub write ops with argv parity"

**Files:**
- src/conductor/src/engine/tracker-client.ts — write ops
- src/conductor/test/tracker-client.test.ts — argv parity tests

**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 4: Client error semantics — non-zero exit, JSON parse failure, 404 evidence
**Story:** TR-1 negative (loud rejection), TR-2 negatives
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) runner non-zero exit → method rejects with error carrying argv + stderr; (b) invalid JSON stdout on a parsing op → rejects with parse error naming the operation; (c) 404-shaped gh failure → rejection preserves the 404 evidence (so `forget`'s advisory label strip keeps working)
2. Verify RED
3. Implement error wrapping in `createGithubTrackerClient`
4. Verify GREEN
5. Commit: "feat(tracker-client): loud error semantics (argv+stderr, parse errors, 404 evidence)"

**Files:**
- src/conductor/src/engine/tracker-client.ts — error wrapping
- src/conductor/test/tracker-client.test.ts — negative tests

**Wired-into:** same as Task 2
**Dependencies:** Task 3

### Task 5: Migrate backlog-priority.ts (delete ExecRunner)
**Story:** TR-3 (leaf migration)
**Type:** refactor

**Steps:**
1. Write failing test: type-level + behavior — `ghIssueLabelReader` accepts the canonical `GhRunner` import; existing backlog-priority suite green with canonical injection; `ExecRunner` no longer exported
2. Verify RED (type/test)
3. Implement: replace `ExecRunner` declaration (backlog-priority.ts:7) with `import type { GhRunner }`; `IssueLabelReader` semantic seam untouched (priority-banded pin)
4. Verify GREEN — full backlog-priority suite
5. Commit: "refactor(backlog-priority): canonical GhRunner import; drop ExecRunner"

**Files:**
- src/conductor/src/engine/backlog-priority.ts — type swap
- src/conductor/test/backlog-priority.test.ts — mechanical type rename only

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 6: Migrate blocker-resolver.ts + supply cwd at construction sites
**Story:** TR-3 (cwd widening; spec-authoring coordination)
**Type:** refactor

**Steps:**
1. Write failing test: `createBlockerResolver` accepts the canonical runner; closed-blocker filtering behavior unchanged (existing suite)
2. Verify RED
3. Implement: `BlockerRunner` (blocker-resolver.ts:23) → canonical `GhRunner`; update construction sites to supply `cwd`: engineer-cli.ts claim path, daemon-backlog.ts, overlap-scan.ts
4. Verify GREEN — blocker-resolver + overlap-scan suites
5. Commit: "refactor(blocker-resolver): canonical GhRunner with cwd; update construction sites"

**Files:**
- src/conductor/src/engine/blocker-resolver.ts — signature widening
- src/conductor/src/engine/overlap-scan.ts — supply cwd
- src/conductor/src/engine/daemon-backlog.ts — supply cwd
- src/conductor/test/blocker-resolver.test.ts — mechanical updates

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 7: Migrate wiring-probe, owner-gate/identity, issue-dep-migration
**Story:** TR-3 (leaf migrations)
**Type:** refactor

**Steps:**
1. Write failing test: each module's suite green with the canonical type imported; local declarations gone (wiring-probe.ts:503 no-cwd shape widens, caller supplies cwd)
2. Verify RED
3. Implement the three type swaps
4. Verify GREEN — three suites
5. Commit: "refactor(engine): canonical GhRunner in wiring-probe, identity, issue-dep-migration"

**Files:**
- src/conductor/src/engine/wiring-probe.ts — type swap + cwd
- src/conductor/src/engine/owner-gate/identity.ts — type swap
- src/conductor/src/engine/engineer/issue-dep-migration.ts — type swap

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 8: Migrate file-issue.ts onto TrackerClient createIssue
**Story:** TR-3, TR-2 (create parity)
**Type:** refactor

**Steps:**
1. Write failing test: `fileIntakeIssue` drives `TrackerClient.createIssue` (fake client); `FileIssueGhRunner` deleted; existing file-issue suite green incl. cross-repo `--repo` targeting
2. Verify RED
3. Implement migration
4. Verify GREEN
5. Commit: "refactor(file-issue): TrackerClient.createIssue; drop FileIssueGhRunner"

**Files:**
- src/conductor/src/engine/engineer/intake/file-issue.ts — client injection
- src/conductor/test/file-issue.test.ts — fake client

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 9: Migrate github-issues adapter (poll/report/label ops) preserving pinned invariants
**Story:** TR-3 (adapter migration; engineer-handoff + intake-only pins)
**Type:** refactor

**Steps:**
1. Write failing test: adapter suite green with injected `TrackerClient`; `report()` advisory-catch (no exception propagates; remediation stderr; ledger advance) and caller-supplied-cwd selection preserved; `poll()` enqueue byte-equivalent (assignee-scoped list via `listAssignedIssues`)
2. Verify RED
3. Implement: replace local `GhRunner` (github-issues.ts:24) with client injection; `dependency-claim.ts` NOT touched
4. Verify GREEN — github-issues + intake acceptance suites
5. Commit: "refactor(github-issues): adapter on TrackerClient; report/poll invariants preserved"

**Files:**
- src/conductor/src/engine/engineer/intake/github-issues.ts — client injection
- src/conductor/test/github-issues.test.ts — mechanical fake swap

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 10: Engineer CLI composition root on the canonical seam
**Story:** TR-3 (roots; kill-switch hole #1)
**Type:** refactor

**Steps:**
1. Write failing test: engineer CLI wiring test — `buildIntake` + claim/poll/forget/resolve paths construct client/runner from `tracker-client.ts`; local `makeProductionGh` (engineer-cli.ts:513) deleted; under `AI_CONDUCTOR_NO_REAL_EXEC` the CLI paths cannot spawn gh
2. Verify RED
3. Implement root rewiring (incl. `ghIssueLabelReader`/blocker-resolver construction with cwd)
4. Verify GREEN — engineer-cli + acceptance suites
5. Commit: "refactor(engineer-cli): compose TrackerClient from canonical seam; close kill-switch bypass"

**Files:**
- src/conductor/src/engine/engineer-cli.ts — root wiring
- src/conductor/src/intake-loop-cli.ts — import path follows
- src/conductor/test/cli/engineer-cli.test.ts — wiring assertions

**Wired-into:** src/conductor/src/engine/engineer-cli.ts#buildIntake, src/conductor/src/engine/engineer-cli.ts#dispatchEngineer
**Dependencies:** Task 9, Task 6

### Task 11: daemon-cli composition root — inline runner duplicates replaced
**Story:** TR-3 (roots)
**Type:** refactor

**Steps:**
1. Write failing test: daemon-cli's four anonymous inline gh runners (daemon-cli.ts:919, 1062, 1425, 1535) are gone; wiring uses `makeProductionGh`/client from tracker-client
2. Verify RED
3. Implement
4. Verify GREEN — daemon-cli suite
5. Commit: "refactor(daemon-cli): canonical runner at composition root"

**Files:**
- src/conductor/src/engine/daemon-cli.ts — root wiring

**Wired-into:** src/conductor/src/engine/daemon-cli.ts#daemonCommand
**Dependencies:** Task 1

### Task 12: halt-issues sweep/closer fold-in with call-count parity
**Story:** TR-4 (GhAbstraction → TrackerClient)
**Type:** refactor

**Steps:**
1. Write failing tests: sweep/closer suites on a fake `TrackerClient`; call-count invariants pinned — steady-state sweep = ZERO tracker calls; transitioning entry ≤ exact pre-migration bound (one state read + comment upsert + close + conditional label read); per-operation injected failures degrade exactly as before (`reject:false` parity)
2. Verify RED
3. Implement: sweep.ts:30 + closer.ts:19 depend on `TrackerClient`; `GhAbstraction` deleted
4. Verify GREEN
5. Commit: "refactor(halt-issues): fold GhAbstraction into TrackerClient with call-count parity"

**Files:**
- src/conductor/src/engine/halt-issues/sweep.ts — interface swap
- src/conductor/src/engine/halt-issues/closer.ts — interface swap
- src/conductor/test/halt-issues/sweep.test.ts — call-count + failure parity

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 13: halt-issues CLI root — guarded factory, repo targeting parity
**Story:** TR-4 (kill-switch hole #2)
**Type:** refactor

**Steps:**
1. Write failing test: halt-issues CLI constructs its client via the guarded canonical factory (local object factory at halt-issues-cli.ts:103-190 deleted); cross-repo targeting equivalent to old `GH_REPO` env injection; under `AI_CONDUCTOR_NO_REAL_EXEC` no real gh spawn possible
2. Verify RED
3. Implement
4. Verify GREEN — halt-issues CLI suite
5. Commit: "refactor(halt-issues-cli): guarded canonical client; close kill-switch bypass"

**Files:**
- src/conductor/src/engine/halt-issues/halt-issues-cli.ts — root wiring

**Wired-into:** src/conductor/src/engine/halt-issues/halt-issues-cli.ts#main
**Dependencies:** Task 12

### Task 14: Checked-in grep gate — no runner declarations outside the canonical module
**Story:** TR-3 negative (Condition 2)
**Type:** negative-path

**Steps:**
1. Write failing test (it should PASS only after Tasks 5-13; write, confirm current state, land after migrations): scans `src/conductor/src` for gh-runner-shaped type declarations (`=> Promise<{ stdout` pattern + names `ExecRunner|BlockerRunner|FileIssueGhRunner|GhAbstraction`) outside `tracker-client.ts`, and for `makeProductionGh` definition sites outside it; PR-side `CommandRunner` (handoff.ts) exempt
2. Verify it fails against any reintroduced duplicate (mutation check)
3. Implement scan test
4. Verify GREEN on the migrated tree
5. Commit: "test(engine): grep gate — canonical seam is the only runner declaration site"

**Files:**
- src/conductor/test/tracker-client-canonical-gate.test.ts — new gate test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5, Task 6, Task 7, Task 8, Task 9, Task 10, Task 11, Task 13

### Task 15: PR-side invariance verification
**Story:** TR-5
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Verify `git diff main -- src/conductor/src/engine/engineer/issue-ref.ts src/conductor/src/engine/engineer/intake/delivery-guard.ts src/conductor/src/engine/engineer/handoff.ts` shows type-import-only changes (or empty)
2. Verify `pr-labels.ts` diff is the Task-1 re-export hookup only; pr-labels test file unmodified and green
3. Verify a `pr-labels` importer typechecks unchanged (compile check)
4. Empty commit with trailers: `Task: 15`, `Evidence: skipped verify-only-pr-side-invariance-diff-inspection`

**Files:** none

**Wired-into:** none (no new production surface)
**Dependencies:** Task 14

### Task 16: Reserved tracker config contract docs + CHANGELOG
**Story:** TR-6 (Condition 3)
**Type:** infrastructure

**Steps:**
1. Write failing check: docs contain the reserved contract block; `rg "\btracker\b" src/conductor/src --type ts` shows no config consumption; `package.json` diff shows no new dependency
2. Verify RED (docs absent)
3. Implement: `docs/configuration.md` + `src/conductor/README.md` document `tracker: { backend: github|jira, transport?: api|mcp, credentials?: <reference> }` marked "reserved — not read by the engine; consumed by #845 (selection) and #849 (Jira transports); github is the zero-config default". `CHANGELOG.md` `[Unreleased]` → Added (seam) + Changed (canonicalized runners)
4. Verify GREEN
5. Commit: "docs: reserved per-project tracker config contract (#845/#849) + changelog"

**Files:**
- docs/configuration.md — reserved contract
- src/conductor/README.md — reserved contract
- CHANGELOG.md — [Unreleased] entries

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 (canonical module + pr-labels shim)
├── Task 2 (read ops) ── Task 3 (write ops) ── Task 4 (error semantics)
│                             │                    ├── Task 9 (github-issues) ──┐
│                             └── Task 8 (file-issue)                           │
│                                                  └── Task 12 (halt-issues) ── Task 13 (halt-issues CLI)
├── Task 5 (backlog-priority) ──────────────────────────────────────────────┐
├── Task 6 (blocker-resolver + cwd) ── Task 10 (engineer-cli root, also ← Task 9)
├── Task 7 (wiring-probe/identity/dep-migration) ───────────────────────────┤
├── Task 11 (daemon-cli root)                                               │
└── Task 16 (docs + changelog)                                              │
                                                                            ▼
Tasks 5,6,7,8,9,10,11,13 ── Task 14 (grep gate) ── Task 15 (PR-side verify-only)
```

## Integration Points

- After Task 4: the client is fully testable standalone (argv parity + error semantics).
- After Task 10: the engineer claim/poll path runs end-to-end on the seam.
- After Task 13: every issue-side production path is on the seam; kill-switch uniform.
- After Task 14: the end state is frozen by a checked-in gate.

## Verification

- [ ] All happy path criteria covered: TR-1→T1; TR-2→T2,T3 (+T8,T9,T13 parity at call sites); TR-3→T5–T11; TR-4→T12,T13; TR-5→T1,T15; TR-6→T16
- [ ] All negative path criteria covered: TR-1 kill-switch→T1,T10,T13; TR-1 loud-failure→T4; TR-2 parse/404→T4; TR-3 grep gate→T14; TR-3 cwd-widening callers→T6,T7; TR-3 report/poll pins→T9; TR-4 failure/call-count parity→T12,T13; TR-5 diff bounds→T15; TR-6 unread/no-dep→T16
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies explicit and acyclic (graph above)
