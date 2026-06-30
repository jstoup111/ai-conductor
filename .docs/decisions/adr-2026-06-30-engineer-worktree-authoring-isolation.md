# ADR 2026-06-30: Engineer authors in a per-idea worktree (ADR-008 escalation, for same-repo concurrency)

**Date:** 2026-06-30
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Engineer Worktree Isolation (`.docs/specs/2026-06-30-engineer-worktree-isolation.md`)
**Amends:** ADR-008 (agent-hosted loop + in-chat authoring) — specifically its *cross-repo isolation*
decision surface. ADR-008 stays APPROVED; this ADR adopts the **Option B escalation ADR-008 itself
documented**, for a force ADR-008 did not weigh.

## Context

ADR-008 located engineer authoring at the target repo's **canonical path** (registry-resolved, no
cwd fallback), on a `spec/<slug>` branch, confined by a **path-prefix write guard**. It explicitly
considered — and **deferred** — authoring inside a dedicated worktree:

> *"B: Author inside a dedicated git worktree/checkout of the target repo. Considered, deferred as
> escalation — strongest confinement … Documented as the escalation if a leak is ever observed."*

ADR-008 weighed **one** isolation force: **cross-repo** leakage (authoring for A bleeding into
sibling B), which the path-prefix guard already prevents. It did **not** weigh **same-repo
concurrency**: the engineer authors in the target's **primary working tree**, and `landSpec` runs a
`git checkout -b spec/<slug> <default>` → commit → `git checkout <default>` **dance in that shared
tree** (refusing if it's dirty outside `.docs/`). When a **daemon is building in the same repo**, or
a **second engineer/operator session** shares that checkout, that branch-switch corrupts the other
actor's state, and `landSpec`'s sweep-all-untracked-`.docs/` can cross-contaminate two in-flight
ideas. The path-prefix guard does nothing for any of this — it bounds *where* writes land, not
*who else* is using the working tree.

So the documented escalation trigger ("if a leak is ever observed") generalizes: a **same-repo
concurrency conflict** is the observed failure that justifies invoking Option B now.

## Decision

**Adopt ADR-008's Option B for the engineer: author and land each idea inside a dedicated per-idea
git worktree of the target repo.** The primary working tree is never used for authoring and never
receives a `checkout`/`switch` from the engineer.

**Mechanism (locked):**
- **Worktree per idea.** Before DECIDE, create `git worktree add -b spec/<slug> <engineer-scoped
  path> <default-branch>` rooted at the target's canonical path; `<default-branch>` is derived
  (`git symbolic-ref refs/remotes/origin/HEAD`, never hardcoded). DECIDE runs with the worktree as
  cwd; all `.docs/` writes land there.
- **Reuse the daemon's worktree helper.** The leftover-reconciliation logic (branch exists / its
  worktree was removed / fresh) and `git worktree remove --force` teardown already live in
  `daemon-deps.ts:createWorktree`. Extract a shared helper so the engineer and daemon share one
  worktree story (this satisfies FR-11 with proven code, not a reimplementation).
- **`land` commits in-place.** Because the worktree is already on `spec/<slug>`, `landSpec` **drops
  the checkout-dance entirely** and commits the idea's `.docs/` from the worktree. Staging is scoped
  to the idea's artifacts (no `add -A` of foreign files) — FR-9.
- **`handoff` operates in the worktree.** `openSpecPr` pushes (when a remote exists) and runs
  `gh pr create --head spec/<slug>` with cwd = the worktree; the no-remote local-commit fallback and
  the authored-ledger / intake write-back / `ensureRunning` nudge are unchanged (FR-4). The ledger
  write must occur on the no-remote branch too (alternate-branch side-effect invariant).
- **Retained from ADR-008/ADR-004:** canonical-path resolution with **no cwd fallback**; the
  **path-prefix write guard** (now rooted at the worktree's `.docs/`); branch-name suffixing for an
  existing `spec/<slug>`; dirty-tree-not-clobbered; sibling repos byte-unchanged (FR-10).
- **Lifecycle:** **remove on success, keep on failure** (operator decision) — mirrors the daemon's
  "keep the worktree only on HALT." A retained worktree's path is reported.
- **Strict abort, no fallback** (operator decision): if a worktree cannot be created (incl. an
  unborn-HEAD repo with zero commits), the engineer **aborts the idea** and makes **zero** mutations
  to the primary tree. It does **not** seed a commit and does **not** author in the shared checkout.
- **Naming disjoint from the daemon:** the engineer's worktree dir is `engineer`-scoped so a
  concurrent daemon worktree in the same repo never collides (conflict-check Finding 2).

## Options Considered

- **A (chosen): per-idea worktree (ADR-008 Option B).** Strongest confinement; removes the
  shared-tree dance at the root; the primary tree is provably untouched, so a concurrent daemon /
  second session cannot be corrupted. *Cons:* adds worktree lifecycle to every idea — now justified
  by the concurrency force and cheap because the daemon helper already exists.
- **B: keep canonical-path authoring, add a per-repo lock serializing engineer vs. daemon.**
  *Rejected* — serialization is not isolation: it blocks the parallelism the flywheel wants, and a
  lost/stale lock reintroduces the corruption. Also doesn't fix the two-ideas sweep-bleed.
- **C: keep the shared checkout but stash/restore the primary tree around the dance.** *Rejected* —
  fragile, still mutates the primary tree, races a daemon mid-`git` operation, and can lose operator
  state on a failed restore.

## Consequences

### Positive
- Same-repo concurrency is safe by construction: the primary tree never changes branch, so engineer
  and daemon coexist (FR-2/FR-8). The two-ideas sweep-bleed is eliminated (FR-9). One worktree story
  across engineer + daemon (parity). The ADR-008 guard is retained, not weakened — confinement is
  now *both* a guard *and* a separate working tree.

### Negative
- Every idea pays a `git worktree add`/`remove`. Cheap and already the daemon's cost; bounded by the
  one-idea-per-session model.
- `landSpec`/`openSpecPr` gain a cwd parameter — a contract change to the deterministic primitives
  (covered by tests + a real-git smoke test, per the injected-runner-needs-real-binary lesson).

### Follow-up Actions
- [ ] Extract the shared worktree create/teardown helper from `daemon-deps.ts`; engineer + daemon use it.
- [ ] `landSpec(target, idea, { worktreePath })`: drop the checkout-dance; commit in the worktree; scope staging to the idea's `.docs/`.
- [ ] `openSpecPr`/`runHandoff`: cwd = worktree; push when remote; no-remote fallback still records the ledger key.
- [ ] Engineer skill: create worktree before DECIDE; strict-abort on failure; remove-on-success / keep-on-failure; report retained path.
- [ ] Tests: primary-tree branch+status unchanged across success/failure/abort; concurrent-actor non-corruption; remove-on-success/keep-on-failure; leftover-worktree retry; **real-git smoke test** of the worktree lifecycle.
- [ ] Add an "Amended by ADR 2026-06-30" note to ADR-008's isolation section (cross-reference, ADR-008 stays APPROVED).
