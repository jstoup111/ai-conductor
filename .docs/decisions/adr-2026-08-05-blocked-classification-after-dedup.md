# ADR: Blocked classification runs after dedup, and the gauntlet is reordered to allow it

**Date:** 2026-08-05
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #1330

## Context

`discoverBacklog`'s per-plan gauntlet currently runs in this order:

1. read the plan from the base-branch tree (absent → skip)
2. `resolveStoriesRef` → **silent `continue`** on null
3. `isProcessed(slug)` → skip
4. resolve tier marker
5. content vetting (stories approved, dependency tree, coherence) → `warnOnce` + skip
6. shipped-record dedup (by stem, then by spec content hash)
7. owner gate, dependency gate, eligible

Turning step 2's `continue` into a blocked entry in place would report every legacy plan whose
reference does not resolve — 82 of them in this repository — because step 2 precedes the
processed and shipped checks. Every one of those is finished work; none is actionable.

Making the resolver permissive (`adr-2026-08-05-token-first-stories-reference-normalization`)
does not by itself solve this: it moves those plans from "silently dropped at step 2" to
"caught by dedup at steps 3/6", which is correct here but relies on dedup running at all.

The content-hash half of the shipped dedup (step 6) requires the stories content, so it
cannot run on a plan whose stories reference does not resolve. Only stem-match dedup and
processed markers are available on that path.

## Options Considered

### Option A: Reorder — dedup before content classification (chosen)
Move `isProcessed` and shipped-by-stem ahead of stories resolution; keep content-hash shipped
dedup where it is, after stories content is available. Blocked classification then only ever
sees specs that are neither processed nor shipped-by-stem, and parked slugs are filtered when
the blocked set is rendered, matching how `GATED` already filters parked slugs.

- **Pros:** legacy plans are excluded structurally rather than by a suppression list;
  the reorder is verdict-preserving because both branches already `continue`; blocked entries
  are, by construction, actionable.
- **Cons:** the two shipped-dedup halves now sit at different points in the gauntlet, which
  must be documented in the code so a later reader does not "tidy" them back together.

### Option B: Keep the order, suppress blocked entries for processed/shipped slugs at render
- **Pros:** no reorder, so no risk to the eligible set.
- **Cons:** the same predicate is then evaluated in two places, and the discovery result
  itself carries entries that are not real — every consumer (dashboard, snapshot, status)
  must remember to filter. That is the shape of the next silent bug.

### Option C: Only classify specs merged after a cutover date
- **Pros:** bounds the legacy flood in any repository, not just ones with processed markers.
- **Cons:** needs per-spec merge-time derivation (the owner gate's `unowned-indeterminate`
  case shows this is unreliable), introduces a config knob, and would hide genuinely blocked
  old specs. Rejected.

## Decision

Option A, with these rules pinned:

- Dedup order in the gauntlet: `isProcessed` → shipped-by-stem → stories resolution →
  content vetting → shipped-by-content → owner gate → dependency gate.
- A spec that is processed, shipped by stem, shipped by content, or operator-parked is never
  emitted as blocked (PRD FR-7).
- `resolveStoriesRef` stops collapsing two failures into one `null`: it distinguishes
  "reference does not resolve" from "reference resolves but the target is absent on the
  default branch", because the remedies differ (fix the plan's line vs. land the stories
  artifact).
- Blocked classification is visibility-only. The eligible `items` set produced by a pass must
  be identical to the pre-change set except for plans made newly resolvable by the resolver
  change — this is asserted by a test that runs discovery over one fixture under both
  behaviours (PRD FR-8).

## Consequences

- In a repository without `.daemon/processed/` markers and without shipped records, old
  annotated plans can become eligible after this change. That is the pre-existing
  shipped-record dedup contract, not a new exposure introduced here, and it is the same
  exposure any resolver fix would create. Operators of such repositories are told, in the
  runbook note, that the first pass after upgrading may dispatch previously-invisible specs.
- The existing `warnOnce` skip lines are kept exactly as they are and are emitted alongside
  blocked entries, never instead of them — the same "alongside, never in place of" rule the
  gated channel already follows.
- Two new warn-once log lines are added for the two stories reasons, so the log remains a
  complete record of skips even for an operator who never runs `daemon status`.
