# Implementation Plan: halt-monitor issue auto-close (deterministic closure sweep)

**Date:** 2026-07-08
**Design:** .docs/decisions/adr-2026-07-08-halt-issue-closure-sweep.md (APPROVED),
.docs/decisions/architecture-review-2026-07-08-halt-issue-auto-close.md (conditions C1–C3)
**Stories:** .docs/stories/halt-monitor-filed-issues-never-auto-close-no-link.md (Accepted)
**Conflict check:** Clean as of 2026-07-08

## Summary

Builds `conduct-ts halt-issues sweep`: a deterministic, fully-DI'd module in
`src/conductor/src/engine/halt-issues/` that parses monitor.log verdicts into an
operator-local ledger, stamps `Halt-Slug:` markers, and closes shipped-and-guarded
issues via the existing gh seam. 14 tasks.

## Technical Approach

- **New module** `src/conductor/src/engine/halt-issues/` with five files:
  `verdict-parser.ts` (pure: log text → `{slug, issue}` + haltAt extraction),
  `ledger.ts` (schema v1, atomic tmp+rename, quarantine+rebuild),
  `resolution.ts` (pure-ish: injected fs reads of `.daemon/processed/<slug>` and
  `.docs/shipped/<slug>.md`; strict `>` recurrence guard),
  `closer.ts` (stamp + comment + close via injected gh runner; single exported
  comment-body constant), and `sweep.ts` (orchestrator: parse → upsert → stamp →
  resolve → close, per-entry try/catch into `lastError`, summary line, `dryRun`).
- **Gh access** exclusively through `pr-labels.ts` primitives (`makeProductionGh`
  injected at the CLI entry only; tests use a call-counting fake) — condition C3.
- **Quota (C1):** resolution decisions are local-filesystem-only; gh is invoked only
  for entries transitioning (unstamped, or newly closable), never in steady state.
- **CLI:** `halt-issues-cli.ts` mirroring the `shipped-record` subcommand pattern —
  detect/dispatch in `index.ts`, declaration in `cli.ts` for `--help`. Flags:
  `--dry-run --repo-dir --gh-repo --monitor-log --ledger`.
- **Fixtures:** verbatim excerpts of the real `~/.ai-conductor/halt-monitor/monitor.log`
  (multi-paragraph RESULT with embedded verdict, double-verdict RESULT, covered-by,
  malformed lines) committed under `test/fixtures/halt-issues/`.
- **Sequencing:** pure parser first, then state (ledger), then the two decision
  modules (resolution, closer) which depend on both, then the orchestrator, then CLI
  + smoke + docs. Every task is test-first (vitest, `rtk proxy npx vitest run`).
- Commit trailers: stamp `Task: <id>` with the ids below (numeric; `task-N` alias
  also accepted by the evidence gate).

## Prerequisites

- Worktree-local `npm install` in `src/conductor` (per-worktree convention).
- No migrations, no new dependencies, no VERSION change (frozen at 0.99.19).

## Tasks

### Task 1: Commit monitor.log fixtures
**Story:** Verdict parser — all criteria
**Type:** infrastructure
**Steps:**
1. Create `src/conductor/test/fixtures/halt-issues/monitor-log-real.txt` with verbatim
   excerpts: embedded single verdict, one RESULT containing two verdicts (one
   `covered by`, one `filed`), a `covered by`-only RESULT, NEW HALT lines with ISO
   timestamps, a malformed `HALT -> filed #` line, and TRIAGE INCOMPLETE noise.
2. Add a fixture-README line citing the source log and capture date.
3. Commit: "test(halt-issues): real monitor.log fixtures for verdict parsing"
**Files likely touched:** src/conductor/test/fixtures/halt-issues/monitor-log-real.txt
**Dependencies:** none

### Task 2: Verdict parser — extraction happy paths
**Story:** Verdict parser (happy 1–3)
**Type:** happy-path
**Steps:**
1. Write failing tests `test/engine/halt-issues/verdict-parser.test.ts`: embedded
   verdict mid-text yields `{slug, issue}`; double-verdict RESULT yields only the
   `filed` entry; re-parse is idempotent (dedupe by issue number); `covered by`
   ignored.
2. Verify RED.
3. Implement `src/engine/halt-issues/verdict-parser.ts`: global regex scan
   `HALT (<slug chars>) -> filed #(\d+)` over the whole log text.
4. Verify GREEN. Commit.
**Files likely touched:** src/conductor/src/engine/halt-issues/verdict-parser.ts, test/engine/halt-issues/verdict-parser.test.ts
**Dependencies:** Task 1

### Task 3: Verdict parser — negatives + haltAt
**Story:** Verdict parser (happy 4; negatives 1–3)
**Type:** negative-path
**Steps:**
1. Failing tests: malformed verdict skipped and counted `unparseable`; `haltAt` =
   newest NEW-HALT ISO timestamp for the slug in the fixture; repo comes from config
   not text.
2. RED → implement (haltAt scan of `NEW HALT:` lines) → GREEN. Commit.
**Files likely touched:** verdict-parser.ts, verdict-parser.test.ts
**Dependencies:** Task 2

### Task 4: Ledger — schema + atomic write + idempotent upsert
**Story:** Ledger (happy 1); Verdict parser (happy 3)
**Type:** happy-path
**Steps:**
1. Failing tests `ledger.test.ts`: upsert new entries keyed by issue; existing entry
   fields preserved on re-upsert; write is tmp-file-then-rename in same dir (assert
   no partial content under injected rename failure); schema
   `{version:1, entries:{[issue]:{issue,repo,slug,haltAt,status,stampedAt?,closedAt?,closedBy?,lastError?}}}`.
2. RED → implement `ledger.ts` (injected path + fs) → GREEN. Commit.
**Files likely touched:** src/engine/halt-issues/ledger.ts, test/engine/halt-issues/ledger.test.ts
**Dependencies:** Task 2

### Task 5: Ledger — corruption quarantine + rebuild
**Story:** Ledger (happy 2; negatives 1–2)
**Type:** negative-path
**Steps:**
1. Failing tests: invalid JSON → preserved as `ledger.json.corrupt-<ts>` (injected
   clock), fresh rebuild from parse + injected issue-state reader restores
   `closed` for already-closed issues; unwritable dir → stderr report, non-zero exit
   signal, zero gh writes flag.
2. RED → implement → GREEN. Commit.
**Files likely touched:** ledger.ts, ledger.test.ts
**Dependencies:** Task 4

### Task 6: Resolution detector — ship evidence + recurrence guard
**Story:** Close on ship evidence (happy 1–2; negatives 1–2, 6)
**Type:** happy-path
**Steps:**
1. Failing tests `resolution.test.ts` (injected repo-dir fixture): processed marker
   `{status:'shipped', prUrl}` with mtime > haltAt → resolvable with prUrl; shipped
   record `pr:` fallback; evidence mtime == haltAt → guarded (strict >); prUrl null →
   unresolved; HALT.cleared without ship → `cleared-no-ship` report state.
2. RED → implement `resolution.ts` → GREEN. Commit.
**Files likely touched:** src/engine/halt-issues/resolution.ts, test/engine/halt-issues/resolution.test.ts
**Dependencies:** Task 4

### Task 7: Closer — Halt-Slug stamping
**Story:** Stamping (all criteria)
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests `closer.test.ts` with fake gh: body lacking marker → one body-edit
   appending `Halt-Slug: <slug>` line + `stampedAt`; marker present → no edit,
   `stampedAt` observed; edit failure → `lastError`, others continue; not-found →
   `closedBy:'external'`; body stamped with DIFFERENT slug → no edit, `lastError`
   conflict, excluded from close.
2. RED → implement stamp half of `closer.ts` → GREEN. Commit.
**Files likely touched:** src/engine/halt-issues/closer.ts, test/engine/halt-issues/closer.test.ts
**Dependencies:** Task 6

### Task 8: Closer — comment + close with guards
**Story:** Close on ship evidence (happy 1; negatives 3–5)
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: closable entry → marker-tagged `upsertIssueComment` with the exact
   documented body (single exported constant) then close, ledger
   `closed/sweep/closedAt`; `halt-sweep:keep-open` label → skip, `kept-open (label)`;
   comment ok + close fails → next run does not duplicate comment, retries close;
   already closed → no writes, `closedBy:'external'`.
2. RED → implement close half of `closer.ts` (uses `pr-labels.ts` upsertIssueComment
   + REST close) → GREEN. Commit.
**Files likely touched:** closer.ts, closer.test.ts
**Dependencies:** Task 7

### Task 9: Sweep orchestrator — pipeline + summary + error isolation
**Story:** CLI/backfill (happy 2); Stamping (negative 1); Ledger (negative 2)
**Type:** happy-path
**Steps:**
1. Failing tests `sweep.test.ts`: full pass over fixture state produces summary line
   `halt-issues sweep: parsed N, stamped S, closed C, guarded G, errors E`; one
   entry's gh failure doesn't stop others (`lastError` recorded, exit-signal 0);
   unauthenticated gh → parse/ledger still complete, all gh actions skipped as
   errors, exit 0.
2. RED → implement `sweep.ts` → GREEN. Commit.
**Files likely touched:** src/engine/halt-issues/sweep.ts, test/engine/halt-issues/sweep.test.ts
**Dependencies:** Tasks 3, 5, 6, 8

### Task 10: Sweep — quota proof (C1) + dry-run
**Story:** Quota discipline (all criteria)
**Type:** negative-path
**Steps:**
1. Failing tests with call-counting fake gh: all-stamped/none-closable ledger →
   ZERO gh invocations; 50 open entries without local evidence → zero calls; one
   newly-closable entry → calls bounded to that entry (≤1 state read + comment +
   close + label read); `dryRun` → zero write calls, planned actions printed.
2. RED → implement (short-circuit ordering: local checks before any gh) → GREEN. Commit.
**Files likely touched:** sweep.ts, sweep.test.ts
**Dependencies:** Task 9

### Task 11: CLI wiring — halt-issues-cli.ts + dispatch
**Story:** CLI/backfill (happy 3 flags; negative 2)
**Type:** infrastructure
**Steps:**
1. Failing tests `halt-issues-cli.test.ts`: flag parsing (`--dry-run --repo-dir
   --gh-repo --monitor-log --ledger`), defaults (ledger
   `~/.ai-conductor/halt-issues/ledger.json`, monitor-log
   `~/.ai-conductor/halt-monitor/monitor.log`), unknown flag → non-zero + usage.
2. RED → implement `halt-issues-cli.ts` (mirror shipped-record-cli pattern: detect +
   dispatch in `index.ts`, `.command('halt-issues')` help in `cli.ts`; production
   wiring `makeProductionGh` + real paths ONLY here) → GREEN. Commit.
**Files likely touched:** src/engine/halt-issues/halt-issues-cli.ts, src/index.ts, src/cli.ts, test/engine/halt-issues/halt-issues-cli.test.ts
**Dependencies:** Task 10

### Task 12: Backfill fixture test — 11 historical issues
**Story:** CLI/backfill (happy 1)
**Type:** happy-path
**Steps:**
1. Failing test: `sweep --dry-run` over the full real-log fixture plans entries for
   exactly #297 #300 #302 #354 #358 #385 #386 #403 #407 #415 #416 with per-issue
   dispositions.
2. RED → fix parser/fixture gaps if any → GREEN. Commit.
**Files likely touched:** test/engine/halt-issues/backfill.test.ts, fixtures
**Dependencies:** Task 11

### Task 13: Real-binary smoke test
**Story:** CLI/backfill (Done When 4); Test isolation (all)
**Type:** infrastructure
**Steps:**
1. Failing smoke test (acceptance dir): build conduct-ts, run
   `halt-issues sweep --dry-run --repo-dir <tmp> --monitor-log <fixture> --ledger <tmp>`
   as a real child process; assert summary line and exit 0; guarded by the
   production-spawn kill-switch convention (real spawn allowed only in this smoke).
2. RED → wire → GREEN. Commit.
**Files likely touched:** src/conductor/test/acceptance/halt-issues-smoke.acceptance.test.ts
**Dependencies:** Task 11

### Task 14: Docs — README, conductor README, CHANGELOG, hook line
**Story:** CLI/backfill (happy 3; Done When 3)
**Type:** infrastructure
**Steps:**
1. Document the subcommand + flags in `README.md` and `src/conductor/README.md`,
   including the exact monitor hook line `conduct-ts halt-issues sweep || true` and
   the note that monitor.sh itself is out-of-repo (#355), plus the
   `halt-sweep:keep-open` label contract and ledger rebuild semantics.
2. Add CHANGELOG `## [Unreleased]` → Added entry. (Additive subcommand — no
   migration block; not a breaking surface.)
3. Run `test/test_harness_integrity.sh`; commit.
**Files likely touched:** README.md, src/conductor/README.md, CHANGELOG.md
**Dependencies:** Task 13

## Task Dependency Graph

```
1 → 2 → 3 ─┐
    2 → 4 → 5 ─┤
        4 → 6 ─┼→ 9 → 10 → 11 → 12
        6 → 7 → 8 ─┘            11 → 13 → 14
```

## Integration Points

- After Task 9: full sweep runs end-to-end in tests against fixtures.
- After Task 11: `conduct-ts halt-issues sweep --dry-run` runs for real (backfill
  preview against the live monitor.log is now possible manually).
- After Task 13: binary-level behavior proven; operator may add the hook line to
  monitor.sh (manual, out-of-repo step) and run the real backfill.

## Verification

- [ ] All happy path criteria covered: parser 1–4 (T2/T3), ledger 1–2 (T4/T5),
      stamping 1–2 (T7), closure 1–2 (T8), quota 1–2 (T10), CLI 1–3 (T11/T12/T14),
      isolation (T13 + every test task DI'd)
- [ ] All negative path criteria covered: parser (T3), ledger (T5), stamping (T7),
      closure 1–6 (T6/T8), quota (T10), CLI (T9/T11/T13)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
