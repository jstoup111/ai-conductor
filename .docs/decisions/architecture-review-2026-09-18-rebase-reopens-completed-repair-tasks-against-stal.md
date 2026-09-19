# Architecture Review: Rebase reopens completed repair tasks against stale boundaries
**Date:** 2026-09-18
**Mode:** lightweight (Medium tier, technical track), pre-stories
**Source:** jstoup111/ai-conductor#2462
**Scope boundary (binding, from `.docs/track/`):** Balanced. Translate persisted repair-obligation
baselines at engine rebase time, direct and residue shapes; keep the #2544 read-path fallback;
manual rebases with no rewrite map stay fail-closed. Tree-content re-baselining is out of scope.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding | Confidence |
|---|---|---|
| Stack | Pure TypeScript inside `src/conductor/src/engine/`; no new dependency. | 100% verified |
| Prerequisites | `translateAfterRebase` already receives `onto`, `origHead`, `head`, and a `GitRunner`; `createRepairObligationStore` already exposes the atomic `EngineStateStore.update` seam. Nothing new must exist first. | 95% verified by reading `rebase-translate.ts` and `repair-obligations.ts` |
| Integration surface | Two modules change: `rebase-translate.ts` (new store rewrite + successor walk) and `repair-obligations.ts` (a `rewriteBaselines` store method). `events.ts` / `event-sinks.ts` gain one event type. `autoheal.ts` is unchanged. | 90% inferred |
| Data | Mutates `engine-state.json` `repairObligations.records[*].baseline.head` only. No schema change; the field keeps its type. | 95% verified |
| Performance | One `rev-list --first-parent onto..origHead` per rebase (already computed by `buildRewriteMap`) plus one store update. Negligible. | 95% |
| Worktree isolation | All paths are per-worktree `.pipeline/`. No shared resource. | 100% |

**Already-shipped prior art (verified).** PR #2544 (merged 2026-09-14) added `translateRepairBoundary`
in `autoheal.ts`, which follows `.pipeline/rebase-rewrites.json` at read time. It resolves the direct
map-hit shape from the issue's first reproduction. It cannot resolve the residue shape because the map
has no entry for a dropped or absorbed commit. A recurrence on `restore-per-member-tele…` was logged
2026-09-17, after #2544 merged; whether that was the residue shape or a stale daemon dist could not be
confirmed (worktree since removed), confidence 50%.

## Alignment

**Governing ADRs (all APPROVED, reused, one amended):**

- `adr-2026-07-12-rebase-evidence-stamp-translation` — owns the rewrite map and the store rewrite
  pass. Decision 2 (rewrite file-backed stores) omitted the repair-obligation section, which is the
  structural gap this feature closes. Decision 5 (no-laundering) forbids substituting any sha that is
  not a map key; the successor rule is a bounded extension of it. **Amended this review** with D6–D9
  (see below). No new ADR: the structural decision (which stores the rebase translates, and what a
  substitute may be) already lives here, so amendment is the correct shape per repository convention.
- `adr-2026-09-06-reopened-task-resolution` — D1 (baseline is durable control state in
  `engine-state.json`), D3 (single atomic serialized writer seam), D5 (range must never widen; no
  merge-base fallback). The successor rule satisfies D5 by construction: the new boundary is always
  later than the old one. Translation MUST go through the store's `update` seam per D3, never a raw
  file write.
- `adr-2026-09-11-selective-post-rebase-verification` D1 names "#2462 repair-boundary recovery" as a
  separate owner. This feature stays inside `translateAfterRebase` and does not touch the selective
  verification decision or the rebase driver.

**Pattern basis (focused, rediscoverable).** The precedent is `applyMapToStores` in
`rebase-translate.ts`: it reads a file-backed store, resolves every cited sha through
`resolveThroughMap`, and writes atomically, leaving unknown shas unchanged. Preserve those traits.
The allowed variation is that the obligation store is written through `EngineStateStore.update`
rather than temp+rename on its own file, because adr-2026-09-06 D3 requires the shared seam. BUILD
resolves the symbol on its own HEAD.

**Domain boundaries.** `rebase-translate.ts` gains a dependency on `repair-obligations.ts` (a store
method). That is the same direction `task-progress.ts` already depends on it. No cycle:
`repair-obligations.ts` must not import from `rebase-translate.ts`; the successor walk therefore
lives in `rebase-translate.ts` and hands the store a plain `Map<obligationId, newHead>`.

**State management.** The rule is total and exhaustive: direct hit → mapped; residue with survivor →
successor; residue without survivor or outside `onto..origHead` → unchanged. No boolean flag is added
to the obligation; the applied rule travels on the event, not the store.

**Event spine.** One new `ConductorEvent` type, `repair_boundary_translated`, with an `EVENT_SINKS`
row (persist on, render off). The existing `rebase_citation_residue` residue entries gain
`citingObligationIds`. No sidecar, log line, or marker file. Checked against
`.agents/skills/event-spine/SKILL.md`: this is telemetry about a state transition the spine already
carries the sibling of, so it extends the union rather than opening a channel.

**Diagram.** `.docs/architecture/rebase-reopens-completed-repair-tasks-against-stal.md` matches this
design (map hit / residue walk / unchanged, fallback retained). Accurate as of this review.

## Wiring Surface

| New surface | Called from in production |
|---|---|
| `RepairObligationStore.rewriteBaselines(translations)` | `translateAfterRebase` in `rebase-translate.ts`, immediately after `applyMapToStores`, on every engine-performed rebase that moved HEAD (both normal finish and mandatory re-kick paths already reach `translateAfterRebase`). |
| successor-walk helper (module-private in `rebase-translate.ts`) | `translateAfterRebase` only. |
| `repair_boundary_translated` event | Emitted by `translateAfterRebase` through the injected `ConductorEventEmitter`; consumed by `EventPersister` via its `EVENT_SINKS` row. |
| `citingObligationIds` on residue entries | Populated by the existing `writeResidue` path in `rebase-translate.ts`. |

Early overlap scan: see `## Overlap` below.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Successor walk picks a commit that predates the repair (widening the range) | Data | Low | High | Walk only commits strictly after the boundary in `onto..origHead`; RED test with a residue boundary and a pre-boundary survivor proves the predecessor is never chosen. |
| `rev-list` ordering assumption (first-parent, newest-first) differs on a branch with merge commits | Technical | Medium | Medium | Use `--first-parent --reverse` explicitly; RED test with a merge commit on the pre-image branch. |
| Store rewrite races another engine-state writer | Data | Low | High | Mandatory use of `EngineStateStore.update` (adr-2026-09-06 D3); a raw write is a review failure. |
| Obligation admitted before this change keeps a stale head | Integration | Medium | Low | #2544 fallback retained (D9); no migration needed. |
| Recurrence on 2026-09-17 was actually a stale daemon dist, so the residue hypothesis is only partly evidenced | Knowledge | Medium | Low | Stories require a fixture reproducing the residue shape directly (squash of the boundary commit); the fix is justified by code reading regardless of that log line. |

## ADRs Created

None. `adr-2026-07-12-rebase-evidence-stamp-translation` amended with D6–D9 (repair-obligation
baselines as a translated store; successor rule; spine event; fallback retained).

## Conditions

1. Translation writes go through `EngineStateStore.update`; no direct write to `engine-state.json`.
2. The successor walk never selects a commit at or before the old boundary; a RED test proves it.
3. `autoheal.ts` gains no successor logic (D9); the residue shape is resolved only at rebase time.
4. No manual-rebase recovery is attempted: with no `rebase-rewrites.json` both paths refuse.

## Overlap

`ai-conductor overlap-scan` over the five wiring-surface paths on 2026-09-18: **no overlap detected; no open blockers.** (Renames or name-only diffs may not be detected.)
