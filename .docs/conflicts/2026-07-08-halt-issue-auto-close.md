# Conflict Check: halt-monitor issue auto-close (deterministic closure sweep)

**Date:** 2026-07-08
**New stories:** .docs/stories/halt-monitor-filed-issues-never-auto-close-no-link.md
**Corpus:** 85 story files scanned (grep sweep over `.docs/stories/` + `.docs/specs/`),
plus open spec PRs on origin.
**Result:** CLEAN — zero blocking, zero degrading conflicts.

## Examined pairs (reasoned, not assumed)

### 1. vs `intake-issue-pr-link-autoclose.md` (closest overlap — verified compatible, 95%)
That feature closes **intake sourceRef** issues via `Closes owner/repo#N` injection on
the daemon implementation PR (Story 4). The sweep closes **monitor-filed** issues
directly (comment + close). The populations can intersect (a monitor-filed issue later
claimed as intake — the #302 pattern). Interaction reasoned through: if the impl-PR
merge closes it first, the sweep's "already closed → `closedBy: external`, zero
writes" branch (Story: close-on-ship, negative path 5) makes the race benign; if the
sweep closes first, `Closes` on a closed issue is a no-op. No contradictory assertion
about the same resource.

### 2. vs #355 productization scope (boundary, not conflict)
No stories exist yet for #355 (open issue only). This spec's track marker, ADR §D5,
and stories explicitly exclude monitor migration/lifecycle; the sweep is a primitive
#355 later adopts. Documented boundary, no overlapping artifact.

### 3. Label/resource contention (verified clean)
New label `halt-sweep:keep-open` collides with nothing — `engineer:handled`
(intake write-back) is the only other harness-owned label in stories. New state file
`~/.ai-conductor/halt-issues/ledger.json`: no other story references that path
(grep: only this feature's file). monitor.log is read-only input; only one other
story file mentions the halt-monitor at all (`prd-audit-kickback-preserves-task-status.md:460`,
descriptive prose, no ownership).

### 4. vs daemon ship-path stories (no write overlap)
The sweep only READS `.daemon/processed/` and `.docs/shipped/` (written by daemon /
finish). No story grants another component write access to the sweep's ledger, and the
sweep writes nothing in the repo. Open spec PR #421 (ship→CI watch loop) also reads
ship state but owns different behavior (CI kickback) — no contradiction.

### 5. Sequencing (verified clean)
The sweep is a pure downstream consumer of markers that already exist; no story
assumes the sweep runs before/after any other feature. Overlapping sweep invocations
are addressed in-story (atomic ledger, last-writer-wins, single-operator tool).

## Accepted degradations

None.
