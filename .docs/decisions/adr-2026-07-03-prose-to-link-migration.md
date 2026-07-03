# ADR: One-time prose→link migration — parse patterns and idempotency

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #229

## Context

PRD FR-10/11: existing open issues declare ordering in prose ("Gated on #217", "Depends on:
#189 / #190", umbrella phase task-lists in #228). These must become native blocked-by links
once, operator-reviewed, idempotently — the v1.0 program (#217–#229) must come out fully
linked. The operator's directive during explore: existing prose declarations MUST produce the
right links. Risk: over-eager parsing creates wrong graph edges that then *enforce* wrong
order.

## Options Considered

### Option A: High-confidence patterns auto-proposed; heuristics flagged manual; dry-run-first
Parse per open issue body, two confidence classes:
- **Auto-proposed** (deterministic, directional): `Gated on #N` / `Gated on: #N, #M`,
  `Depends on(:)? #N(/ #M…)`, `Blocked by(:)? #N` — each yields "this issue blocked_by N".
- **Manual-review list** (heuristic or ambiguous): umbrella phase task-lists (#228-style
  "Phase 2 gated on Phase 1" requires inferring member→member edges), reverse-direction prose
  (`Blocker for #N` implies the *other* issue is blocked), cross-repo refs (`owner/repo#N`),
  anything in checked-off/closed contexts.
The command prints the full proposal (existing links, to-create links, manual-review items),
does nothing until the operator confirms, then creates links with GET-before-POST.
- **Pros:** Deterministic edges automated; the graph-shaping judgment calls stay human;
  dry-run output doubles as the review artifact; matches "operator review" in FR-10 without
  making the operator hand-build every link.
- **Cons:** Umbrella phases (the #228 case) land in the manual list — the operator confirms
  those edges by hand once.

### Option B: Parse everything including task-list phases automatically
- **Pros:** Zero manual work for #228.
- **Cons:** Phase inference is heuristic (which items are members? do phases imply
  all-pairs edges or representative gates?); a wrong auto-edge silently *enforces* wrong
  order — the failure mode is the feature's own motivating bug, inverted.

### Option C: No parser — operator creates all links by hand in the GitHub UI
- **Pros:** Simplest code.
- **Cons:** Violates the explore directive (existing prose must produce links); ~13 program
  issues × several edges of error-prone manual UI work; no idempotent re-run artifact.

## Decision

**Option A.** Idempotency is GET-before-POST per edge (skip when the link already exists) plus
treating GitHub's "already exists" error class as success — safe to re-run any time, additive
only: the migration never deletes links, never closes/edits/relabels issues (FR-11). The
migration is a standalone operator-invoked command, not part of daemon or intake flow, and its
same-repo-only write scope comes from adr-2026-07-03-issue-dependencies-api-surface.

For the v1.0 program specifically: the auto-proposed patterns cover the explicit "Gated on"/
"Depends on" prose; #228's phase structure is confirmed by the operator from the manual-review
list in the same run — the acceptance bar (PRD: "#217–#229 fully linked") is met by the
combination, verified in the dry-run output before any write.

## Consequences

### Positive
- Wrong-edge risk is bounded to human-confirmed edges; deterministic edges are automated.
- Re-runnable at any time (idempotent, additive) — also usable after future prose slips in.
- Dry-run proposal is the operator's review surface (FR-10) with zero side effects.

### Negative
- The #228 umbrella ordering requires one manual confirmation pass (accepted trade: this is
  the highest-stakes graph in the repo).
- Prose that drifts from the recognized patterns after migration is ignored by design
  (PRD Non-Goal: native links are the only recognized form going forward).

### Follow-up Actions
- [ ] Parser with the two confidence classes + unit tests on real issue bodies (#217–#229)
- [ ] Dry-run proposal output; confirm gate; GET-before-POST writer
- [ ] Re-run produces zero new writes (idempotency test)
