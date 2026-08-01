# Architecture: park-reconciliation refusal observability

Feature: park-reconciliation-refusal-observability-1114
Refs: jstoup111/ai-conductor#1114
Date: 2026-08-01

## Scope of change

No new components. The change is confined to one module's return vocabulary and one log line:

- `src/conductor/src/engine/park-reconciliation.ts` — refusal taxonomy + sweep counters
- `src/conductor/src/engine/daemon-park-cli.ts` — operator-verb output of the new reasons
- `src/conductor/src/daemon-cli.ts` — dashboard annotation map (unchanged shape, new inputs)
- `.docs/decisions/` — ADR amendment recording the second and third deletion proofs
- `docs/reference/cli.md`, `docs/guides/running-the-daemon.md` — refusal table + narrative

## C4 — Component view (unchanged topology)

```mermaid
flowchart TB
  subgraph daemon["conduct daemon"]
    sweep["reconcileParkedFeatures<br/>park-reconciliation.ts<br/><i>classifies every parked slug each idle tick,<br/>emits the summary line</i>"]
    helper["reconcileMergedPark<br/>park-reconciliation.ts<br/><i>the single guarded deletion helper,<br/>re-derives evidence then refuses or deletes</i>"]
    evidence["gatherMergeEvidence<br/>park-reconciliation.ts<br/><i>shipped record on main, local branches,<br/>proven-merged subset</i>"]
    verb["daemon reconcile-parked<br/>daemon-park-cli.ts<br/><i>operator call site, second entry<br/>to the same helper</i>"]
    dash["dashboard annotations<br/>daemon-cli.ts<br/><i>merged-ready and orphan labels,<br/>autoCleanup forced false</i>"]
  end

  git[["git<br/>merge-base, for-each-ref, ls-tree,<br/>rev-parse, log, branch -D, worktree remove"]]
  gh[["gh<br/>pr list --state merged --json headRefOid"]]

  sweep -->|"once per pass, prefetched"| evidence
  sweep -->|"per merged slug when auto-cleanup on"| helper
  verb -->|"per explicit slug"| helper
  helper -->|"re-derives, never trusts cache"| evidence
  evidence --> git
  helper -->|"head-identity proof"| gh
  helper -->|"proofs and destructive steps"| git
  dash -->|"observational pass, autoCleanup false"| sweep
```

## The change, in one diagram

Today every unproven branch collapses to a single `not-ancestor` refusal, and refusals never reach
the summary counters at all — a refused merged slug simply falls through to `parked++`. That is why
a structurally unreachable cleanup arm reads as a healthy `reconciled=0`.

```mermaid
flowchart TD
  A[branch not contained in origin/main] --> B{merged PR for this branch?}
  B -- "no merged PR" --> C["refusal: no-merge-proof<br/>(nothing attests this branch shipped)"]
  B -- "yes" --> D{tip == PR headRefOid?}
  D -- yes --> E[proof holds → delete authorized]
  D -- no --> F{"git log headRefOid..ref"}
  F -- "non-empty" --> G["refusal: unmerged-commits<br/>names the commits that would be dropped"]
  F -- "empty (branch behind head)" --> H["refusal: branch-behind-merged-head<br/>drops nothing, but identity proof did not hold"]

  C --> S[counts.refused++ keyed by reason]
  G --> S
  H --> S
  S --> T["summary: reconciled=N deferred=N orphaned=N parked=N skipped=N refused=N<br/>+ per-reason breakdown"]
```

`ancestry-check-failed` (git could not answer) keeps its present fail-closed meaning and is
reported as its own refusal reason; it is never merged into the new ones.

## Contracts held invariant

1. **Deletion strength is unchanged.** Every branch that is deleted today is still deleted; every
   branch refused today is still refused. This change only *names* and *counts* refusals. No new
   deletion authority is introduced.
2. **Both call sites share the helper.** The sweep and the operator verb continue to funnel through
   `reconcileMergedPark`, so the taxonomy lands on both without duplication.
3. **Fail-closed is preserved.** An unreadable ref, an unavailable `gh`, or an indeterminate log
   range refuses — and now says which of those it was, rather than claiming "not ancestor".
4. **Single-writer park invariant** (`test/engine/park-marker-invariant.test.ts:83`) is untouched.

## Data shape

`ParkedSweepResult.counts` gains `refused: number`. A parallel
`refusedByReason: Record<RefusalReason, number>` carries the breakdown so the summary line can
distinguish causes without callers parsing prose. `sweepSummarySignatures` (the log de-duplication
WeakMap) must include the new fields in its signature string, or a change in refusal mix would be
silently suppressed — the exact invisibility bug this feature exists to remove.
