# Conflict Check: intake claim closed-issue guard + brain reconciliation sweep

**Date:** 2026-07-22
**Stories scanned:** `.docs/stories/intake-claim-closed-issue-guard-and-brain-sweep.md` (TR-1..TR-10)
**Also considered:** existing intake behavior (poll `--state open`, `engineer:handled` label skip,
`maybeReopen` PR-state re-eligibility, delivery-guard PR heal), per the ADR
`adr-2026-07-22-intake-closed-issue-reconciliation`.
**Verdict:** PASSED CLEAN — 0 blocking, 0 degrading conflicts.

## Method

All 10 stories checked pairwise and against existing intake behavior across the five conflict
types (contradiction, behavioral overlap, state conflict, resource contention, sequencing). The
two surfaces share two mutable stores (`ledger.json`, `inbox/*.json`), so resource-contention and
state-conflict were the primary focus.

## Findings

### Resource contention — guard vs sweep on the shared stores (examined, not a conflict)

- **TR-2** (guard forgets+drops the *closed candidate it just claimed*) vs **TR-7** (sweep touches
  **only `pending`** entries, explicitly preserves `claimed`/`routed`/`done`). These are
  **complementary, not contended**: the guard acts on the single entry it is actively claiming;
  the sweep deliberately excludes exactly the in-flight statuses the guard operates through. No
  story asserts the sweep touching a `claimed` entry — TR-7's negative path asserts the opposite
  (a `claimed` closed entry is preserved). Confidence 95%.
- Both surfaces use the same terminal action (`ledger.forget`, `queue.ack`) which the ADR
  establishes as **idempotent + convergent**. TR-2 and TR-6 both tolerate an already-absent entry
  / already-deleted inbox file (ENOENT benign). A concurrent double-forget of the same key is a
  no-op on both sides — no story requires an entry to still exist after another actor could have
  forgotten it. No state-conflict. Confidence 92%.

### State conflict — disposition vs existing re-eligibility (examined, not a conflict)

- **TR-10** (forget → reopened issue re-ingests via `--state open` poll, `ledger.known` false) vs
  existing **`maybeReopen`** re-eligibility: `maybeReopen` keys off **PR** state
  (`gh pr view`), TR-10 and the whole feature key off **issue** state (`gh issue view`). Disjoint
  triggers on disjoint external objects — no contradiction. TR-10's negative path explicitly
  leaves `engineer:handled` label semantics unchanged. Confidence 93%.
- No story introduces a new `LedgerStatus`, so no state-machine ambiguity is added to the ledger's
  existing status set.

### Contradiction — fail-safe consistency across surfaces (examined, not a conflict)

- **TR-3** (guard: `null`/throw → deliver, never drop) and **TR-8** (sweep: `null`/`open` → leave
  untouched; total `null` outage forgets nothing) state the **same fail-safe rule** on both
  surfaces. Only explicit `'closed'` triggers a drop in every story. No story lets `null`/unknown
  cause a drop — consistent, not contradictory. Confidence 96%.

### Behavioral overlap — sourceRef parse shared by both surfaces (examined, not a conflict)

- **TR-5** requires the `owner/repo#n` → `(repo, issue)` parse to be **shared/consistent** between
  guard and sweep, and both TR-4 and TR-8 route an un-parseable ref to the same fail-safe
  (skip probe / leave untouched — never drop). One rule, two call sites — reinforcing, not
  overlapping-incompatibly. Confidence 94%.

### Sequencing — no ordering assumptions between stories (examined, not a conflict)

- The guard (claim-time) and sweep (tick-time) run in independent loops; neither story asserts it
  must run before the other, and correctness of each does not depend on the other having run
  (the ADR frames them as complementary safety net + janitor). No circular or first-writer
  assumption. Confidence 95%.

### Against existing behavior — poll `--state open` (examined, not a conflict)

- The feature relies on the existing `--state open` ingestion filter for TR-10 re-ingestion and
  does not modify it. No story changes poll behavior. Confidence 96%.

## Resolutions

None required — clean pass.

## Notes

- The residual concurrency property (un-locked ledger last-writer-wins) is **not** a story-level
  conflict; it is a design property already documented and accepted as Risk R1 in the
  architecture review, mitigated by `pending`-scoping + idempotent forget. It does not gate this
  check.
