# Architecture Review: finish-deadlocks-when-the-prose-judge-asks-for-rev
**Date:** 2026-08-28
**Stories reviewed:** none yet — pre-stories feasibility review (Medium tier, lightweight mode; input is explore output + technical intent for issue #2006)
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** pure TypeScript change inside the existing FINISH publication engine
  (`src/conductor/src/engine/finish-publication.ts`, `finish-publication-production.ts`). No new
  packages, services, or infrastructure. Verified by reading both modules.
- **Prerequisites:** none. The persisted verdict store (`.pipeline/prose-judgment.json`) already
  exists and already records `revision_required` verdicts keyed by revision digest
  (`finish-publication-production.ts:243-271`); the change adds a reader, not a store.
- **Integration surface:** one subsystem. Touched seams: the `prProse` classifier
  (`finish-publication-production.ts:165-191`), the `PublicationSnapshot` prose union
  (`finish-publication.ts:89,128`), the selector `nextFinishPublicationTransition`
  (`finish-publication.ts:388-431`), the authoring/judgment predicates and request types
  (`finish-publication.ts:999-1079`), halt-detail rendering
  (`renderHumanRequiredHaltReason`, `finish-publication.ts:666-678`), and the documented verdict
  contract in `skills/finish/SKILL.md` (load-bearing test input per
  `test/engine/finish-pr-prose-judgment.test.ts`).
- **Data implications:** none durable. The store's schema is unchanged; observation gains a read.
  Best-effort store degradation (unreadable store → no cached verdict → prose observes `stale`
  and is re-judged) preserves today's behavior — fail-open to a judgment session, never to a halt.
- **Performance risk:** negative cost. The deadlock currently burns a FINISH dispatch per re-kick;
  the fix routes to a bounded authoring pass. Author→judge laps are bounded by the existing
  publication-progress allowance (`adr-2026-08-06`), which needs no widening: the transition count
  is unchanged (no new transition — a new prose *state* routes to the existing `author_pr_prose`).
- **Worktree isolation:** unaffected. All state is per-worktree `.pipeline/`; no shared resources.

## Alignment

Full repo-wide ADR sweep performed (delegated, all `.docs/decisions/adr-*.md` scanned). Governing
decisions and how the design conforms:

- **`adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`**
  owns this exact structural question: the chosen design is its rejected Option C in narrowed form.
  Amended 2026-08-28 (additive note beside the Decision) to adopt the narrowed form on the new
  force production surfaced: the retry-path rule converts Cycle A into a deterministic
  `human_required` deadlock because the observation vocabulary cannot express "authored, judged,
  found deficient". The retry-path guard stays in force verbatim; it stops firing for this cycle by
  construction.
- **`adr-2026-08-01-engine-owned-resumable-finish-publication`** D4's escape clause ("unless a
  later ADR explicitly changes it") is exercised; amended with a pointer note. D1's
  observation-derived routing is preserved — the fix widens what observation can express and never
  honors a disposition's named transition (Option B stays rejected).
- **`adr-2026-08-13` halt-before-judgment rule / `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`:**
  classification precedence is explicit in the amendment — `halt` (via `hasHaltSignal`) strictly
  precedes `revision_required`; a `revision_required` verdict with reason `halt` keeps its
  `judgment_halt_prose` human-required routing. No provider spend on halted PRs.
- **`adr-2026-08-06-bounded-progress-allowance-for-finish-publication`:** allowance retained
  unchanged (2× transition count; transition count unchanged). Its "no provider dispatch except
  judgment" cheapness premise now also admits the authoring dispatch — recorded in the amendment.
- **`adr-2026-08-08-finish-human-required-halt-rendering`:** the "prose halts carry verdict detail"
  outcome lands inside this ADR's existing Condition 1 machinery (`detail` on `human_required`,
  exhaustive `HUMAN_REQUIRED_REASONS` map) and its own follow-up ("Carry a provider-supplied
  blocker sentence into `detail` for `refused` and `revision_required`"). No union widening of
  `HumanRequiredReason` is required by the design; if a story adds one, `isExactDisposition` and
  the guidance map must widen in the same diff (`adr-2026-08-06-publication-progress-is-its-own-disposition`).
- **`adr-2026-07-11-pipeline-state-durability` / `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` D1:**
  the store reader must be existence-guarded and tolerant (already is: seed is try/catch,
  best-effort); verdict `detail` is diagnostics for halts and authoring guidance — never a
  comparison key.
- **State management:** the new member makes a previously unrepresentable state explicit — the
  precedent of `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` — and removes the
  `placeholder`-overloading temptation that produced #1703.
- **Pattern consistency:** derived-at-observation classification follows
  `adr-2026-08-05-worktree-classification-evidence-derived-reasons`; the bounded
  judged-deficient→authoring lap mirrors `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`.

**Focused local pattern basis:** the cached-acceptance read at
`finish-publication-production.ts` (`judgmentByRevision.get(revisionDigest(revision))?.kind ===
'accepted'`, near the `prProse` call inside the observation function) is the precedent for the new
read. Traits to preserve: keyed by revision digest, read inside observation before classification,
tolerant of an absent/malformed store, in-memory map seeded once per coordinator from
`.pipeline/prose-judgment.json`. Allowed variation: the new read distinguishes verdict reasons
(`placeholder`/`structurally_incomplete` route to authoring; `halt` does not). Rediscovery seeds:
`seedJudgmentStore`, `revisionDigest`, `prProse` in `finish-publication-production.ts`.

## Domain Integrity

(Lightweight mode — one load-bearing note only.) The prose union is exhaustively matched at the
selector and predicates; adding `revision_required` must extend every match site, which TypeScript
enforces so long as no site carries a catch-all — the current sites use explicit comparisons, so
stories should require compile-time exhaustiveness rather than `else` fallthroughs.

## Wiring Surface

No new production surface is introduced — every change flows through already-wired seams:

- `PublicationSnapshot.pr.prose` union member `revision_required` — produced by the existing
  observation function in `finish-publication-production.ts` (called by the FINISH coordinator's
  `observe` on every dispatch); consumed by `nextFinishPublicationTransition` and the effect
  predicates in `finish-publication.ts`.
- Selector routing (`revision_required` → `author_pr_prose`) — invoked from the existing
  coordinator advance loop and from `reconcileSelectablePublicationRetry`.
- Authoring-request guidance field (judge objection `detail`) — carried on the existing
  `PrProseAuthoringRequest`, consumed by the existing authoring dispatcher in
  `finish-publication-production.ts` when it renders the provider task.
- Halt detail — flows through the existing `renderHumanRequiredHaltReason` → HALT body →
  committed halt record (`adr-2026-08-23-committed-halt-record`) path; no new channel.
- `skills/finish/SKILL.md` verdict-contract documentation — consumed by the existing judgment
  decoder tests.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Authoring pass returns a byte-identical revision → same verdict → lap repeats | Technical | Medium | Medium | Advance-path dimension guard already halts an authoring pass that does not move `pr.prose`; allowance is the backstop |
| Store/live-PR divergence: verdict cached for a revision the PR no longer shows | Data | Low | Low | Classification keys on the digest of the *currently observed* revision; a changed body misses the cache and observes `stale` |
| `revision_required` shadows `halt` classification, re-enabling provider spend on halted PRs | Technical | Low | High | Explicit precedence in the ADR amendment: `hasHaltSignal` first; reason `halt` never enters the lap; stories must encode this as an acceptance criterion |
| Verdict `detail` absent (as on PR #1946) → authoring pass lacks guidance | Knowledge | Medium | Low | Guidance field is optional; authoring falls back to the full rewrite it performs today; judge prompt contract updated to request detail |
| Missed match-site update leaves a code path treating `revision_required` as `stale` | Technical | Low | Medium | Compile-time union exhaustiveness; no catch-all branches (Domain Integrity note) |

## ADRs Created

None. Two APPROVED ADRs amended (additive notes, originals preserved):

- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` —
  narrowed Option C adopted 2026-08-28 by #2006.
- `adr-2026-08-01-engine-owned-resumable-finish-publication` — D4 escape-clause pointer note.
