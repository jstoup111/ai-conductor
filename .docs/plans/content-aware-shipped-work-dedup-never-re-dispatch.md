# Implementation Plan: content-aware shipped-work dedup (never re-dispatch shipped specs)

**Date:** 2026-07-03
**Design:** .docs/decisions/adr-2026-07-03-committed-shipped-record-dispatch-dedup.md (APPROVED)
**Stories:** .docs/stories/content-aware-shipped-work-dedup-never-re-dispatch.md
**Conflict check:** Clean as of 2026-07-03
**Tier:** M — fixes #204, #205

## Summary
Adds a repo-committed `.docs/shipped/<stem>.md` record as the durable dispatch-dedup
authority (stem-primary, content-hash-secondary), guards `rekickSweep` with `isProcessed`,
demotes `.daemon/processed/` to an auto-repaired cache, and backfills records for all
previously shipped specs. 14 tasks.

## Technical Approach
One new engine module `src/conductor/src/engine/shipped-record.ts` owns the whole artifact
contract: `specHash()` (canonical SHA-256 over plan+stories bytes, trailing-newline trim
only), `parseShippedRecord()` / `renderShippedRecord()` (frontmatter: slug, spec_hash, pr,
shipped), `listShippedRecords(treeSource)` (base-branch read via the existing
`BacklogTreeSource` seam), and `writeShippedRecord()` (working-tree write for the finish
flow). `discoverBacklog` (daemon-backlog.ts) gains a dedup block that runs BEFORE the
owner gate: cache hit → stem record → hash match, with cache repair through a new optional
`repairProcessed` injectable (production: the same writer `markProcessed` uses). `rekickSweep`
(daemon-rekick.ts) gains an optional `isProcessed` dep — absent ⇒ today's behavior
(backward-compatible for tests), wired in `daemon-cli.ts` to the ledger-or-shipped-record
resolver. The finish-side write hooks the daemon ship path (`daemon.ts` ship handler, next to
`markProcessed` in `daemon-deps.ts`): write record → `git add` → commit on the impl branch →
included in the existing push; any failure degrades to a single warn. Backfill is a committed
set of records generated once, in this PR. Sequencing: hash/record module first (everything
consumes it), then discovery, then rekick, then finish-side write, then backfill.

## Prerequisites
- None beyond the repo itself (no new packages; node:crypto sha256).

## Tasks

### Task 1: `specHash` canonical function
**Story:** 1 (all criteria)
**Type:** infrastructure
**Steps:**
1. Write failing unit tests: determinism across two calls; trailing-newline equivalence;
   interior-byte sensitivity; null stories → plan-only digest + `storiesIncluded: false`;
   CRLF ≠ LF pinned.
2. RED → implement `specHash(planBytes, storiesBytes|null)` in new
   `src/conductor/src/engine/shipped-record.ts` → GREEN.
3. Commit "feat(dedup): canonical specHash for shipped-record identity (Story 1)".
**Files:** src/conductor/src/engine/shipped-record.ts, test/engine/shipped-record.test.ts
**Dependencies:** none

### Task 2: shipped-record render/parse + working-tree writer
**Story:** 2 (frontmatter shape), 3 (malformed-record tolerance)
**Type:** infrastructure
**Steps:**
1. Failing tests: `renderShippedRecord` emits frontmatter slug/spec_hash/pr/shipped;
   `parseShippedRecord` round-trips; malformed content parses to `{malformed: true, stem}`
   (never throws); `writeShippedRecord` creates `.docs/shipped/<stem>.md`, idempotent when
   content identical.
2. RED → implement in shipped-record.ts → GREEN.
3. Commit "feat(dedup): shipped-record artifact contract (Story 2/3)".
**Files:** shipped-record.ts, shipped-record.test.ts
**Dependencies:** Task 1

### Task 3: `listShippedRecords` over `BacklogTreeSource`
**Story:** 3 (base-branch-only), 4 (single listing per poll)
**Type:** infrastructure
**Steps:**
1. Failing tests with injected tree source: lists records from `.docs/shipped/` on the base
   branch; working-tree-only files invisible (tree source IS the base branch — assert no fs
   fallback); one `listPlanFiles`-style directory read per call.
2. RED → extend `BacklogTreeSource` usage (add a `listShippedFiles`/generic list to the
   source interface with a git + fs impl mirroring `listPlanFiles`) → GREEN.
3. Commit "feat(dedup): read shipped records from the base-branch tree (Story 3)".
**Files:** daemon-backlog.ts (BacklogTreeSource), shipped-record.ts, tests
**Dependencies:** Task 2

### Task 4: discovery dedup — stem match skips + cache repair
**Story:** 3 (happy paths + repair-failure negative)
**Type:** happy-path
**Steps:**
1. Failing tests: candidate with base-branch record and empty ledger → skipped +
   `repairProcessed(slug, record)` called; cache hit → tree source for shipped records never
   consulted; repair throwing → still skipped, error logged, discovery continues.
2. RED → insert dedup block in `discoverBacklog` after content filters, BEFORE owner gate;
   add optional `repairProcessed` to `DiscoverBacklogOpts` → GREEN.
3. Commit "feat(dedup): base-branch shipped record dedups discovery (Story 3)".
**Files:** daemon-backlog.ts, daemon-backlog.test.ts
**Dependencies:** Task 3

### Task 5: discovery dedup — order vs owner gate pinned
**Story:** 3 Done-When (gate-order assertions)
**Type:** negative-path
**Steps:**
1. Failing tests: shipped spec + `daemonOwner: {resolved:false}` → skipped as SHIPPED (log
   asserts dedup reason, not identity-unresolved); shipped spec + foreign owner stamp →
   skipped as SHIPPED (no ownership-skip log); unshipped spec + unresolved identity → still
   fail-closed (hardening behavior intact).
2. RED → ordering already from Task 4; fix if assertions fail → GREEN.
3. Commit "test(dedup): dedup precedes owner gate, hardening intact (Story 3)".
**Files:** daemon-backlog.test.ts
**Dependencies:** Task 4

### Task 6: discovery dedup — hash match across stems
**Story:** 4 (rename skip, warn-once both stems, new-slug repair)
**Type:** happy-path
**Steps:**
1. Failing tests: record `old.md` hash H + candidate `new.md` hashing H → skipped, warn-once
   names both stems, repair under `new`; warn suppressed on second poll via existing
   `hasWarned/markWarned` hooks.
2. RED → compute candidate hash (Task 1 fn over tree-source plan+stories bytes), compare
   against Task 3's record set → GREEN.
3. Commit "feat(dedup): content-hash match dedups renamed specs (Story 4)".
**Files:** daemon-backlog.ts, daemon-backlog.test.ts
**Dependencies:** Task 4

### Task 7: hash-match negative paths
**Story:** 4 (no-match passthrough; identical-content skip; renamed+edited dispatches)
**Type:** negative-path
**Steps:**
1. Failing tests for all three scenarios (renamed+edited pins DISPATCH as expected).
2. RED → GREEN (logic from Task 6).
3. Commit "test(dedup): hash-match boundaries pinned (Story 4)".
**Files:** daemon-backlog.test.ts
**Dependencies:** Task 6

### Task 8: shared `isProcessed` resolver (ledger OR shipped record)
**Story:** 3/5 (one resolver, two call sites)
**Type:** infrastructure
**Steps:**
1. Failing tests: resolver true on ledger entry; true on base-branch record with empty
   ledger; false on neither; ledger read error → falls through to record check.
2. RED → implement `makeIsProcessed(processedDir, treeSource)` in shipped-record.ts (or
   daemon-deps.ts) → GREEN; repoint daemon-cli.ts discovery wiring to it.
3. Commit "feat(dedup): ledger-or-record isProcessed resolver (Story 3/5)".
**Files:** shipped-record.ts, daemon-cli.ts, tests
**Dependencies:** Task 3

### Task 9: rekickSweep consults isProcessed
**Story:** 5 (happy paths)
**Type:** happy-path
**Steps:**
1. Failing tests via injected `RekickSweepDeps`: processed slug → in `skipped`, zero calls to
   `hasRebaseInProgress`/`abortRebase`/`clearMarker`, one-time log; unprocessed slug →
   behavior byte-identical (existing tests keep passing untouched).
2. RED → add optional `isProcessed` to `RekickSweepDeps`, guard at top of the per-slug loop
   (after FR-9 SHA guard) → GREEN.
3. Commit "feat(rekick): skip processed slugs in the re-kick sweep (Story 5, #205)".
**Files:** daemon-rekick.ts, daemon-rekick tests
**Dependencies:** Task 8

### Task 10: rekick negative paths
**Story:** 5 (throwing isProcessed fail-open; per-slug warn-once across advances)
**Type:** negative-path
**Steps:**
1. Failing tests: `isProcessed` throws → slug treated as unprocessed, error logged, sweep
   continues; skip log not repeated on a second sweep at a new SHA.
2. RED → GREEN.
3. Commit "test(rekick): isProcessed failure is fail-open and isolated (Story 5)".
**Files:** daemon-rekick.ts, tests
**Dependencies:** Task 9

### Task 11: finish-side record write on the ship path
**Story:** 2 (pr + merge-local happy paths; idempotent re-run)
**Type:** happy-path
**Steps:**
1. Failing tests: ship handler writes `.docs/shipped/<stem>.md` via Task 2 writer, commits on
   the impl branch before the final push (assert commit present with record content, pr field
   = PR URL); merge-local path carries `pr: local` (alternate-branch invariant); re-run with
   identical content → no duplicate commit.
2. RED → hook the daemon ship path (`daemon.ts` ship handler beside `markProcessed` in
   daemon-deps.ts): write → `git add .docs/shipped/<stem>.md` → commit → existing push →
   GREEN.
3. Commit "feat(dedup): finish commits the shipped record on the impl branch (Story 2)".
**Files:** daemon.ts, daemon-deps.ts, integration test
**Dependencies:** Task 2

### Task 12: finish-side degrade + no-ship paths
**Story:** 2 (write/commit failure degrades; discard/keep write nothing)
**Type:** negative-path
**Steps:**
1. Failing tests: injected fs/git failure → ship still completes, single
   "shipped-record write failed — dedup degraded to local cache for <stem>" warn, finish step
   verdict unchanged; `discard`/`keep` outcomes → no record anywhere.
2. RED → wrap write+commit in a one-shot try/catch with the warn → GREEN.
3. Commit "feat(dedup): record-write failure degrades, never blocks ship (Story 2)".
**Files:** daemon.ts / daemon-deps.ts, tests
**Dependencies:** Task 11

### Task 13: backfill shipped records
**Story:** 6 (all criteria)
**Type:** infrastructure
**Steps:**
1. Generate `.docs/shipped/` records for every current `.daemon/processed/` entry (16) + the
   seven known unmarked shipped specs (ADR list), hashes from current base-branch content;
   ledger entries with no surviving plan get `spec_hash: unknown`.
2. Test: fixture asserting every processed slug has a record; drifted-content case dedups by
   stem alone.
3. Commit "chore(dedup): backfill shipped records for all shipped specs (Story 6)".
**Files:** .docs/shipped/*.md (~23), test fixture
**Dependencies:** Task 2 (writer), Task 4 (stem dedup proves them effective)

### Task 14: empty-ledger dry run + docs
**Story:** 6 Done-When (zero re-dispatch on empty ledger); CLAUDE.md docs rule
**Type:** integration
**Steps:**
1. Failing integration test: `discoverBacklog` over the merged-state tree fixture with an
   EMPTY ledger dispatches zero backfilled specs.
2. GREEN via Tasks 4/6/13.
3. Update `src/conductor/README.md` (+ root README daemon section) for `.docs/shipped/`,
   cache demotion, rekick guard; CHANGELOG `[Unreleased]` Added/Fixed entries.
4. Commit "test+docs(dedup): empty-ledger replay guard, document shipped records".
**Files:** integration test, README.md, src/conductor/README.md, CHANGELOG.md
**Dependencies:** Tasks 4, 6, 13

## Task Dependency Graph
```
T1 ─▶ T2 ─▶ T3 ─▶ T4 ─▶ T5
      │      │     └──▶ T6 ─▶ T7
      │      └──▶ T8 ─▶ T9 ─▶ T10
      └──▶ T11 ─▶ T12
      T2,T4 ──▶ T13 ─▶ T14 (also needs T6)
```

## Integration Points
- After Task 5: discovery dedup end-to-end testable against a fixture tree.
- After Task 10: full daemon poll cycle (discover + rekick) replay-proof in unit harness.
- After Task 12: a real self-host ship produces a record on its PR branch.
- After Task 14: merged tree + empty `.daemon/` provably dispatches nothing already shipped.

## Verification
- [ ] Every happy AND negative criterion in Stories 1–6 maps to a task (coverage: S1→T1,
      S2→T2/T11/T12, S3→T3/T4/T5/T8, S4→T6/T7, S5→T9/T10, S6→T13/T14)
- [ ] No task exceeds ~5 minutes; dependencies explicit and acyclic
- [ ] Docs + CHANGELOG ride the same PR (Task 14)
