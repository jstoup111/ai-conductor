# ADR: Deterministic halt-issue closure sweep (ledger + Halt-Slug stamp + close-on-ship)

**Date:** 2026-07-08
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session

## Context

The operator-local halt-monitor (`~/.ai-conductor/halt-monitor/monitor.sh`, out of
repo — productization owned by #355) files GitHub issues for daemon halts via an LLM
triage (`claude -p` + `gh issue create`). The resulting issue number is recorded only
as free text (`HALT <slug> -> filed #N`) inside multi-paragraph RESULT lines in
`monitor.log`. Nothing ever closes these issues when the halt is resolved: 11 filed
to date, 7 closed by hand, 4 stale-open (#297, #358, #415, #416). Source:
jstoup111/ai-conductor#390.

Constraints and verified facts (confidence per verify-claims):

- Verdicts are embedded in free text, possibly several per RESULT line — parser must
  scan for every `HALT <slug> -> filed #N` occurrence (verified, 100% — real log).
- Daemon halt lines carry ISO timestamps (verified — `seen.txt` entries).
- Ship evidence exists deterministically: `.daemon/processed/<slug>` JSON
  (`{status:'shipped', prUrl}`, `daemon-deps.ts:99-109`) and `.docs/shipped/<slug>.md`
  (`shipped-record.ts`) (verified — source + Explore report).
- The tested DI gh seam (`pr-labels.ts`: `makeProductionGh`, `upsertIssueComment`,
  REST label helpers) is reusable for all writes (verified — source).
- Operator quota history forbids tight GitHub polling (operator directive: ≥5 min
  cadence; the monitor loop runs every 180 s).

## Options Considered

### Option A: All-bash sweep inside the migrated monitor
- **Pros:** one place; no TS surface.
- **Cons:** untestable closure logic; duplicates `pr-labels.ts`; migration is #355's
  scope anyway.

### Option B: Daemon ship-time closure (search open issues for Halt-Slug, inject Closes)
- **Pros:** rides the tested ship path.
- **Cons:** misses non-ship resolutions and "covered by #N" cases; a GitHub search on
  every ship; cannot retroactively clear the existing backlog; couples the daemon to
  monitor-owned artifacts.

### Option C (chosen): Deterministic `conduct-ts halt-issues sweep`
Invoked by the monitor per cycle and manually for backfill; owns ledger, stamping,
and closure.

## Decision

Adopt Option C with these binding semantics:

1. **Ledger** — `~/.ai-conductor/halt-issues/ledger.json` (operator-local, beside the
   monitor's state, following the intake-ledger precedent of
   `~/.ai-conductor/engineer/ledger.json`). One entry per filed issue:
   `{ issue, repo, slug, haltAt, verdictLine, status: open|closed, stampedAt?,
   closedAt?, closedBy?, lastError? }`. The ledger is a cache: fully rebuildable from
   `monitor.log` + GitHub; writes are atomic (tmp + rename). `haltAt` is the newest
   monitor-log NEW-HALT timestamp for that slug at parse time.
2. **Stamping** — the sweep deterministically appends a `Halt-Slug: <slug>` line to
   the issue body via `gh` if absent (idempotent). The LLM prompt is NOT trusted to
   do this. Stamping makes the linkage durable even if the ledger is lost.
3. **Closure criterion (close-on-ship with recurrence guard)** — an open ledgered
   issue is closed when ALL hold:
   - ship evidence for its slug exists: `.daemon/processed/<slug>` with
     `status: shipped` and a non-null `prUrl`, or a `.docs/shipped/<slug>.md` record
     with a `pr` value;
   - the ship evidence is **newer than the newest halt event for that slug** (marker
     mtime / shipped-record date vs daemon-log halt timestamps) — the recurrence
     guard against closing an issue whose halt fired again after the ship;
   - the issue is currently open and does NOT carry the `halt-sweep:keep-open` label
     (operator escape hatch for issues that describe a *class-level engine gap*
     transcending the one slug).
   On closure: marker-tagged `upsertIssueComment` "Auto-closed by halt-issues sweep:
   `<slug>` shipped in <prUrl>. Reopen (or label `halt-sweep:keep-open`) if this
   issue tracks a broader gap." then close via `gh`. Halts that clear WITHOUT ship
   evidence are never auto-closed — reported as unresolved instead (conservative;
   false-open over false-close).
4. **Quota discipline** — local-first: filesystem/state checks decide everything;
   GitHub is touched only on a state transition (new unstamped entry, or an entry
   that just became closable) plus at most one issue-state read before each write.
   A steady-state sweep performs **zero** GitHub calls. Failures are per-entry,
   non-fatal, recorded in `lastError`, retried next cycle. `--dry-run` prints
   intended actions without writing.
5. **Out of scope** — monitor migration/productization, sidecar lifecycle, credential
   isolation (#355/#351); changing the monitor's filing/triage behavior; the daemon's
   ship path (untouched). The monitor gains exactly one hook line invoking the sweep.

## Consequences

### Positive
- Stale monitor-filed issues close themselves with evidence links; the 4 current
  stale-open issues are cleared by one backfill run.
- Linkage becomes deterministic (ledger + body marker), consumable later by #355's
  sidecar and by intake dedup (#279 class).
- All outward-facing writes flow through the tested `pr-labels.ts` seam; the sweep
  is fully unit-testable with a fake gh runner and injected paths.

### Negative
- A monitor-filed issue that documents a class-level engine gap will be auto-closed
  when its exemplar slug ships, even if the gap persists — mitigated (not
  eliminated) by the recurrence guard, the reopen-inviting comment, and the
  `halt-sweep:keep-open` label.
- New operator-local state file (small, rebuildable) and one more moving part in the
  monitor cycle.
- "covered by #N" verdicts are intentionally not tracked (no issue was filed).

### Follow-up Actions
- [ ] #355's sidecar adopts the sweep as its closure primitive.
- [ ] Consider a monitor-prompt nudge to reopen closed issues it would cite as
      "covered by #N" (separate, monitor-side change).
