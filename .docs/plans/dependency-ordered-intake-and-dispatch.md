# Implementation Plan: Dependency-Ordered Intake and Dispatch

**Date:** 2026-07-03
**Design:** .docs/specs/2026-07-03-dependency-ordered-intake-and-dispatch.md
**Stories:** .docs/stories/dependency-ordered-intake-and-dispatch.md
**Conflict check:** Clean as of 2026-07-03 (resolution: #200 hard-sequenced behind this feature)
**ADRs:** adr-2026-07-03-issue-dependencies-api-surface, adr-2026-07-03-dependency-gate-backlog-waiting-channel, adr-2026-07-03-dependency-fail-closed-and-cache, adr-2026-07-03-prose-to-link-migration

## Summary

Builds the dependency gate (GitHub blocked-by relations, live) across daemon dispatch and
engineer intake, the WAITING dashboard/status group, and the one-time prose→link migration
command. 26 tasks.

## Technical Approach

- **One new seam, two consumers.** `src/conductor/src/engine/blocker-resolver.ts` exposes
  `createBlockerResolver(deps)` with `resolve(sourceRef): BlockerVerdict` where
  `BlockerVerdict = { kind: 'unblocked' } | { kind: 'blocked'; blockers: IssueRef[] } |
  { kind: 'indeterminate'; detail: string } | { kind: 'cycle'; members: IssueRef[] }` — a
  closed union, no booleans. It shells `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by`
  through an injected runner (same injection pattern as existing gh call sites), memoizes per
  resolver instance (= per scan pass), and detects cycles by walking open blockers'
  `blocked_by` transitively (closed nodes prune the walk). All error paths map to
  `indeterminate` — never a throw into the scan loop, never a default to `unblocked`.
- **Daemon gate:** `discoverBacklog` (daemon-backlog.ts) gains a final gauntlet step after the
  owner-gate block (~line 363–378 pattern): specs with a parseable `Source-Ref` are resolved;
  non-`unblocked` verdicts divert the spec into a new `waiting` list instead of `items`.
  Return shape widens from `BacklogItem[]` to `{ items, waiting }` (waiting:
  `{ slug, sourceRef, verdict }`); `localWorkSource`, `daemon.ts` `pickEligible` call sites,
  and `daemon-dashboard.ts` `scanInheritedState` adapt in the same task so the tree never
  half-compiles. No `Source-Ref` (or no intake marker) ⇒ resolver is never invoked (FR-3);
  a *malformed* marker value ⇒ `indeterminate` (fail closed).
- **Visibility:** dashboard/status gain a WAITING group (precedence: HALTED > PROCESSED >
  IN-PROGRESS > WAITING > ELIGIBLE — a waiting spec appears nowhere else). Announcement is a
  log line keyed on `(slug, verdict-hash)` held in-memory per daemon process (state-change
  re-announce; no durable `.daemon/warned/` entry — that namespace never resets, wrong
  lifecycle, per the fail-soft precedent analysis in the #200 ADR set).
- **Intake deferral:** the claim path (engineer intake queue/ledger walk) filters with the
  same resolver: walk pending entries oldest-first, return the first `unblocked`; deferral
  mutates nothing (no status transition, no attempt increment). New claim outcome
  `{ kind: 'all-blocked', entries: [{ sourceRef, verdict }] }` distinct from the existing
  empty result; `engineer-cli` prints it as JSON like other claim outcomes.
- **Migration:** new `conduct-ts migrate-issue-deps` subcommand (engineer-cli registration
  pattern): scans open issues via `gh issue list`/`gh api`, classifies prose into
  auto-proposed edges (`Gated on #N`, `Depends on(:) #N`, `Blocked by(:) #N`) vs
  manual-review items (reverse-direction, cross-repo, task-list phases), prints the full
  proposal, requires explicit confirmation, then writes via GET-before-POST. Additive-only:
  the writer module exposes exactly one mutating operation (create-link).
- **Sequencing rationale:** resolver first (every consumer depends on it), then daemon gate +
  visibility (the correctness core), then intake, then migration (operator tooling), then
  docs. Build agents: do NOT fetch/rebase/pull mid-build; the daemon's finish-time rebase
  step owns reconciliation.

## Prerequisites

- None beyond the merged spec. No schema, no config keys, no new packages. `gh` ≥ 2.87 already
  a runtime dependency; the issue-dependencies endpoints were live-verified on this repo
  (see adr-2026-07-03-issue-dependencies-api-surface).

## Tasks

### Task 1: BlockerVerdict types + resolver skeleton (unblocked on empty)
**Story:** FR-1 story — resolver baseline
**Type:** infrastructure
**Steps:**
1. Write failing test: resolver with a fake runner returning `[]` yields `{kind:'unblocked'}` for `owner/repo#5`.
2. RED → implement `blocker-resolver.ts` (types, `createBlockerResolver`, gh runner injection, sourceRef parse via existing `parseSourceRef`).
3. GREEN → commit "feat(engine): blocker-resolver skeleton with closed verdict union".
**Files likely touched:** src/conductor/src/engine/blocker-resolver.ts (new), test file (new)
**Dependencies:** none

### Task 2: Open blocker ⇒ blocked, naming blockers
**Story:** FR-1 happy — open blocker reported with name
**Type:** happy-path
**Steps:** failing test: fake returns one open issue → `{kind:'blocked', blockers:[ref]}`; implement state mapping (`state !== 'closed'` ⇒ open); commit.
**Files likely touched:** blocker-resolver.ts + test
**Dependencies:** Task 1

### Task 3: Closed-any-reason satisfies; reopened re-blocks
**Story:** FR-2 happy + negative (not_planned, reopen)
**Type:** negative-path
**Steps:** failing tests: closed/completed → unblocked; closed/not_planned → unblocked; reopened (state open after prior closed fixture) → blocked; implement; commit.
**Dependencies:** Task 2

### Task 4: Mixed blocker set names only open ones; cross-repo honored
**Story:** FR-1 negatives — mixed set, cross-repo enforce-as-returned
**Type:** negative-path
**Steps:** failing tests: [closed, open] → blocked naming only open; blocker item with foreign `repository_url` and open state → blocked; implement (state read per returned item, no repo filtering); commit.
**Dependencies:** Task 2

### Task 5: Per-scan memoization (≤1 call per ref)
**Story:** FR-1 negative — same ref twice, one query
**Type:** negative-path
**Steps:** failing test: counting fake, two `resolve()` calls same ref → 1 runner invocation, same verdict; implement instance-level memo map; commit.
**Dependencies:** Task 2

### Task 6: Errors ⇒ indeterminate, per-ref isolation; malformed ref ⇒ indeterminate
**Story:** FR-7 negatives — error isolation; FR-3 negative — malformed Source-Ref
**Type:** negative-path
**Steps:** failing tests: runner throws for ref A but succeeds for B → A indeterminate, B correct; unparseable sourceRef → indeterminate (no runner call); implement error mapping; commit.
**Dependencies:** Task 2

### Task 7: Cycle detection — transitive walk over open blockers
**Story:** FR-12 happy — 2-node cycle identified with members
**Type:** happy-path
**Steps:** failing test: fixtures A blocked_by B, B blocked_by A (both open) → `{kind:'cycle', members:[A,B]}` for either; implement DFS over open edges reusing the memo; commit.
**Dependencies:** Task 5

### Task 8: No false cycles — chains and closed nodes
**Story:** FR-12 negatives — deep chain; closed node breaks cycle
**Type:** negative-path
**Steps:** failing tests: A→B→C open chain → blocked (not cycle); A→B→A where B closed → A unblocked (closed prunes walk); implement pruning; commit.
**Dependencies:** Task 7

### Task 9: gh real-binary smoke for the resolver adapter
**Story:** FR-1 (adapter correctness — injected-runner tests alone are insufficient for external CLIs)
**Type:** infrastructure
**Steps:** failing (or env-gated) smoke test invoking real `gh api` GET blocked_by against this repo's issue #229, asserting an array response and clean parse; skip cleanly when `gh`/network unavailable (same guard style as existing gh smokes); commit.
**Dependencies:** Task 2

### Task 10: Widen discovery result to { items, waiting } (no behavior change)
**Story:** FR-6 (enabling structure — ADR waiting-channel)
**Type:** infrastructure
**Steps:** failing test: `discoverBacklog` returns `{items, waiting: []}` with existing fixtures; adapt `localWorkSource`, `daemon.ts` call sites, `scanInheritedState` in one change; all existing daemon/dashboard tests stay green; commit.
**Files likely touched:** daemon-backlog.ts, daemon-work-source.ts, daemon.ts, daemon-dashboard.ts + tests
**Dependencies:** none (parallel with resolver tasks)

### Task 11: DependencyGate in the gauntlet — blocked spec diverted to waiting
**Story:** FR-4 happy
**Type:** happy-path
**Steps:** failing test: spec with intake marker Source-Ref + open blocker (fake resolver) → absent from `items`, present in `waiting` with blocked verdict; wire resolver into `discoverBacklog` after the owner-gate block, one resolver instance per pass; commit.
**Dependencies:** Tasks 6, 10

### Task 12: No Source-Ref ⇒ no gate; outage doesn't touch no-origin specs
**Story:** FR-3 happy + negatives
**Type:** negative-path
**Steps:** failing tests: spec without marker → in `items`, zero resolver calls (counting fake); with always-throwing runner → still in `items`; commit.
**Dependencies:** Task 11

### Task 13: Skip is per-cycle — no processed marker, unblock ≤1 cycle, re-block holds
**Story:** FR-4/FR-5 happy + negatives
**Type:** negative-path
**Steps:** failing tests: blocked spec skipped across 3 scans, `isProcessed` false throughout; blocker closes in fake → next scan lists spec in `items`; new link added after an unblocked-but-undispatched scan → next scan diverts to waiting again; commit.
**Dependencies:** Task 11

### Task 14: No head-of-line blocking in pickEligible
**Story:** FR-4 negative — [blocked, unblocked] dispatches unblocked
**Type:** negative-path
**Steps:** failing test: backlog where lexicographically-first spec is waiting → `pickEligible` returns the unblocked one this tick; assert `pickEligible` consumes `items` only; commit.
**Dependencies:** Task 11

### Task 15: Indeterminate fails closed in the daemon
**Story:** FR-7 happy + negatives
**Type:** negative-path
**Steps:** failing tests: throwing runner → gated spec in `waiting` with indeterminate verdict, zero dispatches, no processed marker; recovery fake → dispatch next scan; commit.
**Dependencies:** Task 11

### Task 16: WAITING group in dashboard render — exactly one bucket
**Story:** FR-6 happy + one-bucket negative
**Type:** happy-path
**Steps:** failing tests: `renderDashboard` shows WAITING section with slug + blocker refs (and indeterminate/cycle reasons); slug absent from ELIGIBLE; empty waiting → no section; commit.
**Files likely touched:** daemon-dashboard.ts + tests
**Dependencies:** Task 10

### Task 17: Status output surfaces WAITING identically
**Story:** FR-6 happy — status parity
**Type:** happy-path
**Steps:** failing test: daemon status path includes the WAITING entries; reuse the dashboard group builder; commit.
**Dependencies:** Task 16

### Task 18: Warn-once per state change
**Story:** FR-6 negatives — no spam, re-announce on change
**Type:** negative-path
**Steps:** failing tests: 3 identical-verdict scans → exactly 1 log line; blocker-set change → exactly 1 more; in-memory `(slug → verdict-hash)` map, no durable marker; commit.
**Dependencies:** Task 11

### Task 19: Intake claim defers blocked entries (oldest-unblocked wins)
**Story:** FR-8 happy
**Type:** happy-path
**Steps:** failing test: pending [A blocked, B unblocked] (fake resolver) → claim returns B; A still pending; wire resolver into the claim walk (one instance per claim); commit.
**Files likely touched:** engineer intake queue/loop claim path + tests
**Dependencies:** Tasks 6 (resolver), 19-independent of daemon tasks

### Task 20: Deferral is free; indeterminate defers; walk continues
**Story:** FR-8 negatives
**Type:** negative-path
**Steps:** failing tests: deferred entry keeps status `pending` + attempts unchanged; indeterminate entry deferred; cycle-verdict entry deferred with cycle reason (FR-12 intake negative); [blocked, blocked, unblocked] → third returned; commit.
**Dependencies:** Task 19

### Task 21: All-blocked outcome — distinct, listed, never shadows a claim
**Story:** FR-9 happy + negatives
**Type:** happy-path
**Steps:** failing tests: all pending blocked → `{kind:'all-blocked'}` with per-entry verdicts (≠ empty outcome); empty queue → existing empty result unchanged; one claimable → claim wins, no report; engineer-cli prints the new kind as JSON; commit.
**Files likely touched:** claim path, engineer-cli.ts + tests
**Dependencies:** Task 19

### Task 22: Migration parser — deterministic edges from real issue bodies
**Story:** FR-10 happy
**Type:** happy-path
**Steps:** failing tests over fixture bodies copied from #217–#229: `Gated on #217`, `Depends on: #189 / #190`, `Blocked by #226` each yield the right (issue, blocked_by) edges; implement pattern parser module; commit.
**Files likely touched:** src/conductor/src/engine/engineer/issue-dep-migration.ts (new) + tests
**Dependencies:** none (parallel)

### Task 23: Migration parser negatives — manual-review classification
**Story:** FR-10 negatives
**Type:** negative-path
**Steps:** failing tests: `Blocker for #226` → manual-review (not an edge); `owner/other#5` → manual-review; task-list phase text (#228 fixture) → manual-review; prose referencing a closed issue still yields its edge; commit.
**Dependencies:** Task 22

### Task 24: Migration dry-run + confirm gate; writer is GET-before-POST additive
**Story:** FR-10 confirm negative + FR-11 happy
**Type:** happy-path
**Steps:** failing tests: proposal printed, decline → zero write calls (counting fake); confirm → POST per missing edge only, existing links reported as present; writer module exposes create-link as its only mutation; commit.
**Dependencies:** Task 22

### Task 25: Migration idempotency — re-run, partial failure, boundary audit
**Story:** FR-11 negatives
**Type:** negative-path
**Steps:** failing tests: second run after success → zero writes; one write fails mid-run → re-run creates exactly the missing edges; audit test asserts no edit/close/label/delete calls ever issued; wire `conduct-ts migrate-issue-deps` subcommand (guide text, registration) with its own arg-parse test; commit.
**Dependencies:** Task 24

### Task 26: Docs + CHANGELOG
**Story:** PRD acceptance criteria (docs-track-features convention)
**Type:** infrastructure
**Steps:** update README.md + src/conductor/README.md (WAITING group, claim deferral + all-blocked output, `migrate-issue-deps` command, fail-closed semantics); add CHANGELOG `[Unreleased]` Added entries; run `test/test_harness_integrity.sh`; commit.
**Dependencies:** Tasks 17, 21, 25

## Task Dependency Graph

```
T1 → T2 → {T3, T4, T5, T6, T9}
           T5 → T7 → T8
T10 (independent) ─┐
{T6, T10} → T11 → {T12, T13, T14, T15, T18}
T10 → T16 → T17
T6 → T19 → {T20, T21}
T22 → T23
T22 → T24 → T25
{T17, T21, T25} → T26
```

Acyclic. Parallel tracks after T6: daemon (T10–T18), intake (T19–T21), migration (T22–T25).

## Integration Points

- After Task 11: a daemon scan over a fixture repo demonstrates gate + waiting end-to-end.
- After Task 17: startup dashboard and status visibly explain a blocked backlog.
- After Task 21: `conduct-ts engineer claim` behaves dependency-aware end-to-end.
- After Task 25: migration runnable against the live repo (dry-run first) — links #217–#229.

## Build notes (daemon agents)

- Do NOT fetch/rebase/pull mid-build; the finish-time rebase step owns reconciliation.
- All GitHub access in tests goes through injected fakes except Task 9's guarded smoke.
- #200 (priority scheduling) is hard-sequenced BEHIND this feature; do not attempt to
  reconcile with its unmerged branch during this build.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (Tasks 3–6, 8, 12–15, 18, 20, 23, 25)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
