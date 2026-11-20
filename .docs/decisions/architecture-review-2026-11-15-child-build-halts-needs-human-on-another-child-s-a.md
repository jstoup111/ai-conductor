# Architecture Review: Child BUILD halts needs-human on another child's already-resolved build-review case

**Date:** 2026-11-15
**Inputs reviewed:**
- Intake jstoup111/ai-conductor#3658 and the explore outcome in
  `.docs/track/child-build-halts-needs-human-on-another-child-s-a.md` (technical track).
- The operator-approved diagram
  `.docs/architecture/child-build-halts-needs-human-on-another-child-s-a.md`.

**Mode:** lightweight (Medium). Feasibility and alignment only.
**Verdict:** APPROVED

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new package, service or infrastructure. Every change is inside existing engine modules and two shipped skills. |
| Prerequisites | None. The per-child path seam (`pipelinePathFor`) and per-child case store already exist. |
| Integration surface | Three artifact stores (work order, case judgement, typed gap plan), the stall-question evidence writer, the case-store settlement path, both BUILD stall seams in the conductor, and the event union. One subsystem: `build_review` remediation and stall routing. |
| Data implications | Three `.pipeline/` files change location for stacked features only. Schemas are unchanged. Features in flight are covered by a one-time adoption (ADR decision 4); a feature with no children is unaffected in layout. `.pipeline/` is per-worktree and gitignored, so no migration reaches a consumer. |
| Performance risk | The stall seam reads each child's case store once per stall. A stack has single-digit children. Negligible. |
| Worktree isolation | All state stays under the feature worktree's `.pipeline/`. No shared resource is added. |

Technical-intent items and their feasibility:

1. **Region-scope the artifacts.** Feasible. The work-order, plan-store and judgement readers each
   build their path from a module constant and a project root; each gains the child argument the
   case store already takes. The conductor already holds the active child at every call site.
2. **Engine-side relocation of the judgement.** Feasible. The engine parses the judgement in one
   place, the judge callback that follows the remediate dispatch, and the freshness check runs
   before the parse, so the move happens after both.
3. **Retirement.** Feasible. Every resolved transition passes through the case-store outbox, which
   is the single point at which "this region has no open case" can become true. A missing work
   order already reads as absent, with empty attempt evidence, at every engine reader.
4. **One-time adoption.** Feasible. The work order records its effect ids, and each region's case
   store records the effect ids of its cases, so ownership is decided from durable state.
5. **Stale-citation check.** Feasible. The engine holds the stall question as text at the seam
   before it clears the marker. Case ids are engine-generated UUIDs, so membership in a store is an
   exact test and needs no parsing of the session's prose.
6. **Bounded re-dispatch.** Feasible. The routing-stall recorder already counts consecutive
   identical occurrences from the feature event log and returns a `mechanical` class under a bound.

## Alignment

**Governing ADRs, reused.**
- `adr-2026-10-03-stacked-child-plans-identity-and-state` decision 8 and
  `adr-2026-10-07-per-child-build-region` decision 4 define region state and its path seam. Neither
  names the four artifacts in its region list or its whole-feature list, so scoping them to the
  region contradicts neither and needs no amendment. The new ADR extends the region stores.
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D3.1 and D5.10 keep the
  work order as BUILD's durable input and take attempts from the case store. Both hold: the order
  is still published and read by effect id, in the owning region.
- `adr-2026-07-10-daemon-stall-remediation` is amended at decisions 1 and 2. Decision 1 names the
  feature-level stall-question path, which becomes the active child's region in a stacked feature.
  Decision 2 routes every `halt_marker` stall through `/remediate`; a stale citation is now decided
  before that dispatch. Both carry an amendment note. Decisions 3 to 7 hold: the question is still
  captured before the marker is cleared and is carried verbatim into any HALT, and a stale
  citation leaves the shared round budget of decision 6 untouched.
- `adr-2026-07-28-total-halt-classification-legacy-boundary`: only existing classes are written
  (`mechanical`, `needs-human`).
- `adr-2026-10-20-operator-acceptance-is-durable-case-state`: `resolve-case` is unchanged. It
  still refuses a resolved case; the spec removes the situation in which an operator needed it.

**New structural decision.** Where remediation BUILD inputs live and when they stop existing is
state architecture that no APPROVED ADR governs. The code comment that a settled order stays on
disk as evidence has no ADR behind it. One new ADR records it.

**Pattern basis.**
- *Region paths.* Precedent: the per-child case store and kickback ledger. Traits to preserve: one
  path seam, a whole copy of the existing schema per child, no composite keys, no fallback read of
  the flat path. Rediscovery hints: `pipelinePathFor` in the child-context module; the case store's
  state-path helper.
- *Bounded stop.* Precedent: the routing-stall recorder. Traits to preserve: the attempt count is
  derived from the feature event log, resets on progress, and a failure to persist the occurrence
  yields a needs-human halt. Allowed variation: this spec re-dispatches in the run for the first
  two attempts before any HALT, which the operator approved on 2026-11-15. Rediscovery hint:
  `recordRoundStall` in the routing round-admission module.

**Event spine.** The stale citation is an occurrence in time, so it is a new `ConductorEvent`
variant and its bound is counted from the feature event log. No sidecar counter is added.
Retirement and adoption add no channel; the existing case-reconciled events already record
settlement.

**Scope.** Engine and shipped-skill change with no repo-only signal: consumer-facing and
provider-agnostic. The incident occurred in a consumer repository.

**State management.** A cited case resolves to exactly one of: open and owned, resolved, open in
another child, or unknown. Each has one defined route (ADR decision 5).

**Diagram accuracy.** The approved diagram matches the ADR. It names three artifacts; the ADR adds
the stall-question evidence file to the same lifecycle, which the diagram's retirement node covers.

## Wiring Surface

| New production surface | Called from |
|---|---|
| Child argument on the work-order path, publish, read and attempt-stamp functions | The existing callers in the conductor's durable BUILD retry context and clean-PASS settlement, and in the build-review adjudication coordinator and case-effects module, each of which already holds the active child |
| Child argument on the typed gap plan's persist and read | The remediate step runner's gap-plan branch and the conductor's `planRemediation` |
| Judgement relocation into the region | The conductor's judge callback, immediately after the judgement is parsed |
| Region-scoped stall-question evidence | The conductor's two BUILD stall seams and the remediation projection that cites the evidence file |
| Artifact retirement | The case-store settlement path after an outbox drain that leaves a region with no open case; the conductor when a BUILD that a gap plan routed to passes its gate; the stall seams after a stall is routed or halted |
| One-time flat-artifact adoption | The conductor, before it builds the BUILD retry context for a child |
| Stale-citation check and bounded recorder | The conductor's two BUILD stall seams, between reading the stall question and clearing the marker |
| Stale-citation `ConductorEvent` variant | Emitted by the recorder; persisted by the existing event persister; read back by the recorder's own count |
| Judgement and gap-plan paths named in the BUILD prompt | The conductor's work-order context rendering and stall-route hint, consumed by the BUILD skills |

**Early overlap scan (advisory).** Seven unmerged spec branches also touch
`src/conductor/src/engine/conductor.ts` and one touches `skills/pipeline/SKILL.md`. The closest is
`spec/clean-build-review-pass-halts-on-a-deferral-reserv`, which works in the clean-PASS settlement
area where retirement hooks in. None touches the three stores or the stall seam's question
handling.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Retirement removes a work order whose attempt evidence a later settlement still needs | Data | Low | Medium | Retire only when the region's store has no open case, and after settlement has read the evidence (ADR decision 3, assumption A4) |
| A feature in flight when the engine updates holds a flat order with an open case | Data | Medium | Medium | One-time adoption moves the order to its owning region before the BUILD retry context is built (ADR decision 4) |
| A genuine question that happens to cite a settled case is re-dispatched instead of answered | Technical | Low | Low | Bounded: the feature stops after two re-dispatches and reaches a human at the fourth attempt |
| Merge conflict with unmerged specs editing the conductor | Integration | Medium | Low | Changes are confined to the stall seams, the retry context and the settlement call sites |

## ADRs Created

- `adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement`

## ADRs Amended

- `adr-2026-07-10-daemon-stall-remediation` decisions 1 and 2, by amendment note.

## Conditions

None.
