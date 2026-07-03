# Implementation Plan: Surface Owner-Gated Specs in Dashboard and Status

**Date:** 2026-07-03
**Design:** `.docs/specs/2026-07-03-surface-owner-gated-specs-dashboard-status.md` (Approved)
**Stories:** `.docs/stories/2026-07-03-surface-owner-gated-specs-dashboard-status.md` (Accepted, 7 stories)
**ADRs:** `adr-2026-07-03-owner-gate-gated-channel`, `adr-2026-07-03-gated-snapshot-status-read-model`,
`adr-2026-07-03-gated-writeback-announcements` (all APPROVED)
**Conflict check:** Clean as of 2026-07-03 (0 blocking; 4 degrading accepted — see report for
the serialization rider: issue #208 is blocked-by the priority-scheduling and content-dedup
issues so the daemon builds the discovery-touching specs serially)

## Summary

Makes owner-gate skips first-class visible state: a `gated` channel in the discovery result,
a GATED dashboard group, a per-pass `.daemon/gated.json` snapshot read by `daemon status`,
and warn-once GitHub announcements. 21 TDD tasks in 5 phases.

## Technical Approach

- **Gated channel (ADR gated-channel):** `discoverBacklog` (src/engine/daemon-backlog.ts)
  returns `{ items, waiting, gated }`. `gated` carries per-spec entries
  `{ kind: 'spec', slug, reason, otherOwner?, remedy }` (reason ∈ the three skip
  `GateReason`s from src/engine/owner-gate/gate.ts) and repo-scoped entries
  `{ kind: 'repo', warning: 'identity-unresolved' | 'no-cutover', remedy }`. The gate
  consumption site (daemon-backlog.ts:398-415) collects instead of `continue`-dropping;
  the fail-closed early return (:325-328) returns a repo entry instead of a bare empty
  result. Remedy strings derive from `ownershipSkipMessage` (:481-502) so log lines and
  dashboard hints never drift. Gate decisions themselves are untouched — a regression test
  pins byte-identical `items`.
- **Two look-alike states stay distinct:** `opts.daemonOwner` ABSENT = legacy unwired
  (silent, no gated output); present-but-unresolved = fail-closed + repo warning. Both
  pinned by tests.
- **Dashboard (mirrors #246's WAITING):** `scanInheritedState` (daemon-dashboard.ts) adds
  `gated` to `InheritedState` from the same `discover()` tick; precedence chain pinned as
  `HALTED > PROCESSED > IN-PROGRESS > GATED > WAITING > ELIGIBLE` (conflict-check
  resolution). `renderDashboard` adds the GATED section with reason + remedy per slug,
  repo warnings as section-level lines, explicit empty form.
- **Snapshot (ADR snapshot-read-model):** a single serializer module writes
  `.daemon/gated.json` `{ schemaVersion: 1, writtenAt, repoWarnings, gated }` via
  temp-file + `rename` at the end of EVERY pass (populated, empty, and early-return),
  fed from the same in-memory list the dashboard consumes. Write failure is advisory.
- **Status CLI (read-only):** `runDaemonStatus` (daemon-observe-cli.ts) reads the snapshot
  per registered repo, renders slug/reason/remedy + age from `writtenAt`; missing,
  unparseable, or unknown `schemaVersion` → explicit "gated state unknown". Zero git/gh
  on this path.
- **Write-back (ADR writeback-announcements):** a `gate-writeback` orchestrator (template:
  build-failure-escalation.ts) runs after snapshot write, per gated spec: `owner-gated`
  label + hidden-marker (`<!-- conductor:owner-gated -->`) comment upsert on the spec PR;
  same marker upsert on the Source-Ref issue (parsed only via issue-ref.ts). Re-announce =
  upsert body changes on reason transition. Repo warnings never write back. All
  fire-and-forget; local state (channel + snapshot) is committed before any GitHub call.
- **Sequencing:** channel first (everything consumes it), then dashboard, snapshot, status,
  write-back, wiring+docs last. Tests: vitest in src/conductor (`rtk proxy npx vitest run`);
  worktree needs its own `npm install` in src/conductor.

## Prerequisites

- `npm install` in `src/conductor` (fresh worktree).
- No migrations, no new dependencies.

## Tasks

### Task 1: Gated types + widened discovery return shape
**Story:** S1 (Done When 1) — infrastructure
**Steps:** 1. Failing type-level/unit test: `discoverBacklog` result has `gated: []` on a
no-spec fixture. 2. RED. 3. Add `GatedItem` union (spec/repo kinds) in daemon-backlog.ts;
return `{ items, waiting, gated: [] }`; update `localWorkSource.discover()`
(daemon-work-source.ts) and `scanInheritedState`'s discover typing to pass it through
(unused as yet); fix compile in existing tests. 4. GREEN. 5. Commit.
**Files:** src/engine/daemon-backlog.ts, daemon-work-source.ts, daemon-dashboard.ts (type only), tests.
**Dependencies:** none

### Task 2: Collect `other-owner` skips into the gated list
**Story:** S1 HP-1
**Steps:** failing test: fixture spec stamped `Owner: alice`, daemon `bob` → gated entry
`{ slug, reason: 'other-owner', otherOwner: 'alice' }`, slug absent from items; implement by
collecting at the `!decision.build` branch (daemon-backlog.ts:411-414) keeping the existing
`warnOnce` log line.
**Files:** daemon-backlog.ts, daemon-backlog tests. **Dependencies:** Task 1

### Task 3: Collect both un-owned reasons with remedy hints
**Story:** S1 HP-2, HP-3; S2 HP-2 (hint content)
**Steps:** failing tests: post-cutover fixture → `unowned-post-cutover` with Owner-marker
remedy; indeterminate-merge fixture → `unowned-indeterminate` with cutover remedy; implement
remedy derivation as a pure `gateRemedy(decision)` next to `ownershipSkipMessage`.
**Files:** daemon-backlog.ts, tests. **Dependencies:** Task 2

### Task 4: Exclusions + byte-identical items regression
**Story:** S1 NP-1..NP-4 (negative-path)
**Steps:** failing tests on one mixed fixture (owned, other-owned, un-owned, blank `Owner:`,
content-ineligible): owned spec in items not gated; content-ineligible in neither list;
blank `Owner:` treated un-owned (no crash); `items` deep-equal to pre-change behavior
(golden fixture run with gate collection active vs. a control expectation).
**Files:** daemon-backlog tests. **Dependencies:** Task 3

### Task 5: Repo-level no-cutover warning entry
**Story:** S3 HP-1, NP-3 (negative-path included)
**Steps:** failing test: active gate, no cutover, un-owned spec encountered → one repo-kind
entry `no-cutover` (plus the existing log line); cutover set + all owned → zero repo
entries; implement inside `warnGateNoCutoverOnce` call site.
**Files:** daemon-backlog.ts, tests. **Dependencies:** Task 1

### Task 6: Identity-unresolved early return emits repo warning
**Story:** S3 NP-1 (negative-path)
**Steps:** failing test: `daemonOwner.resolved === false` → result is
`{ items: [], waiting: [], gated: [repo identity-unresolved entry] }`; implement at the
early return (:325-328).
**Files:** daemon-backlog.ts, tests. **Dependencies:** Task 1

### Task 7: Legacy gate-unwired silence pinned
**Story:** S3 NP-2 (negative-path)
**Steps:** failing test: no `daemonOwner` in opts → `gated` is empty, no repo warnings, items
unchanged (legacy silent fail-open preserved distinctly from Task 6's fail-closed).
**Files:** daemon-backlog tests. **Dependencies:** Task 6

### Task 8: `InheritedState` carries gated entries with pinned precedence
**Story:** S2 NP-1; conflict-check resolution
**Steps:** failing test: slug both processed and gated → appears only in PROCESSED; implement
`gated` on `InheritedState`, filtered by the pinned chain
`HALTED > PROCESSED > IN-PROGRESS > GATED > WAITING > ELIGIBLE` in `scanInheritedState`.
**Files:** src/engine/daemon-dashboard.ts, tests. **Dependencies:** Task 2

### Task 9: Render the GATED section (populated, empty, failure forms)
**Story:** S2 HP-1, HP-2, NP-2, NP-3
**Steps:** failing render tests: populated section shows slug + reason + remedy (other-owner
names the owner); repo warnings render as section-level lines; explicit empty form matches
WAITING's empty convention; discovery-failure fallback mirrors ELIGIBLE's existing failure
line; implement in `renderDashboard`.
**Files:** daemon-dashboard.ts, tests. **Dependencies:** Task 8

### Task 10: Exactly-one-bucket invariant test
**Story:** S2 Done When 2 (negative-path)
**Steps:** fixture with a slug in every bucket type (halted, in-progress, waiting, gated,
eligible, processed) → each slug appears exactly once across the render; test-only task.
**Files:** daemon-dashboard tests. **Dependencies:** Task 9

### Task 11: Snapshot serializer with atomic write
**Story:** S4 Done When 1-2 — infrastructure
**Steps:** failing unit tests: `writeGatedSnapshot(daemonDir, state, clock, fs)` writes
`{ schemaVersion: 1, writtenAt, repoWarnings, gated }` via temp+rename; injected-fs test
asserts rename (not direct write); single helper consumes the same list object the dashboard
gets. New module `src/engine/gated-snapshot.ts`.
**Files:** src/engine/gated-snapshot.ts (new), tests. **Dependencies:** Task 1

### Task 12: Snapshot written on EVERY pass (populated, empty, early-return)
**Story:** S4 HP-1, HP-2, NP-1, NP-2
**Steps:** failing tests: pass with 2 gated + 1 warning → full snapshot; next pass with zero
→ explicit empty snapshot with fresh `writtenAt` (stale file overwritten); identity-
unresolved early return still writes (repo warning, empty gated); wire the write into the
discovery tick completion in daemon-cli.ts's discover path (single call site).
**Files:** src/daemon-cli.ts, gated-snapshot.ts, tests. **Dependencies:** Tasks 6, 11

### Task 13: Snapshot failure is advisory; torn reads impossible
**Story:** S4 NP-3, NP-4 (negative-path)
**Steps:** failing tests: unwritable `.daemon/` → failure logged, scan result + dashboard
unaffected, dispatch proceeds; concurrent-read simulation via injected fs sees old-or-new
complete file only.
**Files:** gated-snapshot tests, daemon-cli tests. **Dependencies:** Task 12

### Task 14: Snapshot reader with explicit unknown states
**Story:** S5 NP-1, NP-2, NP-3 (negative-path)
**Steps:** failing unit tests: `readGatedSnapshot(repoPath)` → `{ kind: 'ok', ... }` |
`{ kind: 'unknown', why: 'missing' | 'unreadable' | 'version' }` for absent file, invalid
JSON, unknown `schemaVersion`.
**Files:** gated-snapshot.ts, tests. **Dependencies:** Task 11

### Task 15: `daemon status` renders per-repo GATED section with age
**Story:** S5 HP-1, HP-2, NP-4, NP-5
**Steps:** failing tests on `runDaemonStatus`: ok snapshot → slugs + reasons + remedies +
"as of Nm ago" (injected clock); empty snapshot → explicit none-gated line; unknown states →
verbatim unknown wording; `path-missing` repo skips the read; injected-runner recording
asserts zero git/gh spawns added.
**Files:** src/engine/daemon-observe-cli.ts, tests. **Dependencies:** Task 14

### Task 16: Real-binary status smoke
**Story:** S5 Done When 3 — integration
**Steps:** smoke test (or scripted check) running built `conduct-ts daemon status` against a
fixture repo with a written snapshot; asserts the GATED section appears (injected-runner argv
tests are insufficient per harness feedback).
**Files:** test/ or src/conductor test with real spawn. **Dependencies:** Task 15

### Task 17: Gate write-back orchestrator — PR label + marker comment
**Story:** S6 HP-1, HP-2
**Steps:** failing tests: newly gated spec with PR → `ensureLabel`+`addLabel('owner-gated')`
(REST) + `upsertComment` with new `OWNER_GATED_MARKER`; 10 repeated passes → exactly one
comment, one label. New module `src/engine/gate-writeback.ts` following
build-failure-escalation.ts; marker constant in pr-labels.ts.
**Files:** src/engine/gate-writeback.ts (new), pr-labels.ts, tests. **Dependencies:** Task 3

### Task 18: Reason-transition re-announce
**Story:** S6 HP-3
**Steps:** failing test: gated as `unowned-indeterminate`, next pass `other-owner` →
same single comment, body updated in place.
**Files:** gate-writeback tests. **Dependencies:** Task 17

### Task 19: Write-back failure semantics (advisory, terminal PATCH, missing PR)
**Story:** S6 NP-1..NP-5 (negative-path)
**Steps:** failing tests: merged PR target succeeds; gh non-zero → logged once, no retry
storm, snapshot/channel already written (ordering asserted via call-recorder); PATCH failure
→ no fallback create; no PR found → skip with notice, zero branch mutation
(no `findOrCreatePr`); label race conflict swallowed, comment still lands.
**Files:** gate-writeback tests. **Dependencies:** Task 17

### Task 20: Source-Ref issue announcements
**Story:** S7 all (negative-path heavy)
**Steps:** failing tests: marker with valid `Source-Ref` → issue comment upsert (parse via
issue-ref.ts only); absent marker → silent skip; malformed ref → logged skip, no gh call;
closed issue → still comments; PR-succeeded/issue-failed → independent, pass completes;
repo warnings → zero GitHub writes.
**Files:** gate-writeback.ts, tests. **Dependencies:** Task 19

### Task 21: Wire write-back into the daemon tick + docs + changelog
**Story:** S6/S7 integration; repo doc rules
**Steps:** failing integration test: discovery tick with gated specs runs snapshot write
THEN write-back (fire-and-forget, injected); wire in daemon-cli.ts after Task 12's call
site; update README.md + src/conductor/README.md (GATED section, `daemon status` output,
`owner-gated` label, gated.json); add CHANGELOG `[Unreleased]` Added entry.
**Files:** src/daemon-cli.ts, README.md, src/conductor/README.md, CHANGELOG.md, tests.
**Dependencies:** Tasks 12, 20

## Task Dependency Graph

```
T1 ─┬─ T2 ── T3 ─┬─ T4
    │            ├─ T17 ── T18
    │            │         T19 ── T20 ─┐
    │            └─ T8 ── T9 ── T10    │
    ├─ T5                              │
    ├─ T6 ── T7                        │
    │    └───────┐                     │
    └─ T11 ─┬─ T12 ── T13              │
            │    └─────────────────────┴─ T21
            └─ T14 ── T15 ── T16
```
(T12 depends on T6 + T11; T17→T19 sequential; T21 depends on T12 + T20.)

## Integration Points

- After Task 4: gated channel fully testable via discovery fixtures (dashboard untouched).
- After Task 10: startup dashboard shows GATED end-to-end from a scan tick.
- After Task 16: phone-check path works — snapshot written by a pass, read by real binary.
- After Task 21: full loop — scan → dashboard + snapshot → status + GitHub announcements.

## Verification

- [ ] All happy path criteria covered (S1:T2-3, S2:T9, S3:T5, S4:T12, S5:T15, S6:T17-18, S7:T20)
- [ ] All negative path criteria covered (S1:T4, S2:T8-10, S3:T5-7, S4:T13, S5:T14-15, S6:T19, S7:T20)
- [ ] No task exceeds 5 minutes; dependencies explicit and acyclic
- [ ] Precedence chain + byte-identical regression pinned (T8, T4)
- [ ] Docs + CHANGELOG in the same PR (T21)
