# ADR: Deriving a Spec's Merge Time for the Grandfather Cutover

**Date:** 2026-06-30
**Status:** APPROVED
**Deciders:** James Stoup (operator)

## Context

Un-owned specs (no owner stamp) are gated by a **grandfather cutover** (PRD FR-8/FR-9): merged
**before** the configured cutover → build (trusted as the operator's, since before this feature
there was only one operator); merged **on/after** → skip (strict). The daemon must determine a
spec's "merge/activation time" from **committed state only** — a legacy spec has no owner stamp and,
by definition, no new authoring metadata, so the time cannot come from the spec's own content.

## Options Considered

### Option A: git history — first appearance of the spec's plan file on the base branch (chosen)
- **Pros:** available with no new authoring step (essential — legacy specs can't be re-authored);
  well-defined even under squash/rebase (the first commit that introduces the plan file onto the
  base branch); the daemon already reads the base-branch tree via git.
- **Cons:** depends on git history being present in the daemon's checkout (it is); a history rewrite
  would move the timestamp.

### Option B: a recorded timestamp in the spec/marker
- **Pros:** explicit.
- **Cons:** **not present on legacy specs** — which are exactly the ones the grandfather clause
  exists for. Useless for the case that motivates the feature.

### Option C: filesystem mtime of the plan file
- **Pros:** trivial.
- **Cons:** **rejected** — not in git, not reproducible across checkouts/clones, meaningless in a
  fresh EKS checkout.

## Decision

Derive activation time from **git history: the commit timestamp at which the spec's plan file first
appeared on the base branch.** Compare to the configured cutover with a deterministic boundary —
**on/after the cutover = post (skip); strictly before = grandfathered (build).**

**Indeterminate history** (the introduction commit cannot be resolved) resolves to **post-cutover
(skip), logged distinctly** — consistent with the strict-gate philosophy ("can't prove it's
grandfathered → treat as not yours") and stable run-to-run (same input → same decision, no flip;
stories FR-9 negative path).

This applies **only to un-owned specs.** A spec with a matching owner stamp builds regardless of
merge time (stories FR-5 negative path) — the cutover is never consulted for stamped specs.

## Consequences

### Positive
- No backfill and no re-authoring of legacy specs — the whole point of grandfathering is preserved.
- Deterministic and reproducible from git in any checkout, including a fresh EKS clone.
- Boundary and indeterminate cases are defined, not ambiguous.

### Negative
- Ties the cutover to git history availability and stability; a base-branch history rewrite shifts
  first-appearance times. Acceptable — history rewrites of `main` are already out-of-bounds here.
- Indeterminate → skip can withhold a legacy spec whose history is unreadable; mitigated by the
  distinct log line so the operator can re-stamp it explicitly if wanted.

### Follow-up Actions
- [ ] Resolve first-appearance commit time of the plan file on the base branch.
- [ ] Compare with on/after = skip, strictly-before = build; cover the exact-boundary case.
- [ ] Indeterminate history → skip + distinct log line; assert no run-to-run flip.
- [ ] Never consult the cutover for a stamped-and-matching spec.
