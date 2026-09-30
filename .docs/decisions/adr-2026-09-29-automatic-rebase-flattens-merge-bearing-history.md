# ADR: Automatic rebase flattens merge-bearing feature history along the first parent

**Date:** 2026-09-29
**Status:** APPROVED
**Feature:** automatic-rebase-preserves-merges-carrying-unique- (jstoup111/ai-conductor#2498)
**Deciders:** James Stoup (operator — Balanced scope, Approach B, flattening mechanics selected in-session), engineer session
**Related (all APPROVED):** adr-2026-06-29-rebase-conflict-resolution-dispatch (amended here, D2);
adr-2026-07-12-rebase-evidence-stamp-translation (amended here, D10);
adr-2026-09-11-selective-post-rebase-verification; adr-2026-07-26-event-sink-registry-exhaustiveness;
adr-2026-08-11-halt-events-ride-the-persisted-spine; adr-2026-07-03-post-rebase-force-with-lease;
adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep; adr-2026-07-04-resolution-worktree-lifecycle.

<!-- Filename convention: adr-{{DATE}}-<kebab-slug>.md (no sequential numbers).
     The ADR's identifier is its filename stem — cite that when superseding or referencing. -->

## Context

`performRebase` (`src/conductor/src/engine/rebase.ts`) always runs a plain linear
`git rebase --autostash <base>`. No APPROVED ADR governs how that rebase replays feature history.
The original rebase ADR-001 was never landed as an `adr-*.md`, and the amending ADRs only describe
`git rebase --autostash` as context.

Feature branches do carry merges. The engine never creates them, but operator and agent recovery
sessions do, to keep repair and evidence boundaries reachable. A 2026-09-29 sweep found about 20
live feature branches with merges in `main..branch`. A linear rebase drops every merge and replays
the commits of both lineages:

- A merge whose result resolved a conflict loses that resolution.
- Commits duplicated across both lineages are replayed twice, which surfaces as add/add conflicts.

Observed on `feat/daemon-handle-runtime-values-as-literal-data-across-inter` (#2498): the daemon
re-kick halted twice with add/add conflicts, and the operator recovered by hand each time. Replaying
that branch's 85 non-merge commits linearly with `merge-tree`, even onto its own merge base,
conflicts after 2 commits at `6b52b5498` (verified 2026-09-29).

Git's own `--rebase-merges` re-creates each merge by re-merging its parents. Per the git
documentation, manual edits made in a merge result are not preserved (~85% confidence, from the
docs). It also stops at every conflicting merge, which would need a second continuation model in
`rebase.ts`.

## Options Considered

### Option A: `--rebase-merges` with merge-delta re-apply
- **Pros:** Keeps the operator's topology and ancestry.
- **Cons:** Drops manual merge-result edits unless they are re-applied, stops at every conflicting
  re-merge, still conflicts on duplicated lineage, and adds a second replay model to a 2,700-line
  module.

### Option B1: Remerge-delta commits plus a linear replay of every lineage (first draft)
- **Pros:** Linear, with content kept as explicit commits.
- **Cons:** Probe (2026-09-29) found it conflicts in place on 5 of 5 merge-bearing branches. Side
  commits whose conflicts the merge had resolved cannot replay linearly. Rejected on evidence.

### Option B2: First-parent flattening with an engine-written todo (chosen)
- **Pros:** Reproduces HEAD's tree in place by construction (probe: 5 of 5 tree-equal). The
  affected branch goes from 85 conflicting replays to 5 clean ones. It is one linear replay model
  that reuses the existing conflict, resolver, abort, and translation machinery, and it is
  deterministic and mechanically provable.
- **Cons:** Side-lineage commits lose their individual identity, so evidence and repair boundaries
  that cite them need an absorption rule (amendment D10 of adr-2026-07-12-rebase-evidence-stamp-translation).

### Option C: Detect and halt only
- **Pros:** Smallest change.
- **Cons:** The operator still intervenes on every such branch. Rejected by the operator's Balanced
  scope.

## Decision

1. **Flatten only when `base..HEAD` contains a merge, in every engine-started feature rebase.**
   A branch with no merge in that range takes today's `git rebase --autostash <base>` byte-for-byte.
   The engine starts feature rebases in two places:
   - `performRebase`, which serves the rebase `loopGate` in `conductor.ts` and the re-kick path in
     `daemon-rekick.ts`;
   - the open-PR autoresolve path in `autoresolve.ts`, which today issues its own
     `git rebase --autostash <baseRef>`.

   Both must reach the rebase command only through the shared primitive in D8. A second copy of
   the replay decision is exactly the drift this ADR exists to remove. In `performRebase` the
   primitive runs after the protected-artifact seal check and replay-identity capture. A branch
   that `performRebase` already classifies as current or mergeable-skip never reaches it. No new
   dispatch site is added.

2. **The replay list is the first-parent history, with each merge classified by tree identity.**
   Walk `rev-list --reverse --first-parent <mergeBase>..HEAD`:
   - A non-merge commit is picked as-is.
   - A merge whose tree equals its first parent's tree is **ancestry-only** and is dropped.
   - Any other merge is replaced by one **flattened merge commit**. It is created with
     `commit-tree`, its tree is the merge's tree, its single parent is the merge's first parent,
     and it carries the merge's subject, author, and a `Flattened-merge: <merge sha>` trailer.

   Side-lineage commits (reachable only through a second parent) are never replayed individually.
   Classification is by exact tree object id. It never uses subjects, paths, or heuristics.

3. **The replay list is proven before any mutation.** Using only `merge-tree --write-tree` and
   `commit-tree` through the injected `GitRunner`, which write objects and never a ref, the index,
   or the worktree:
   - (a) Replaying the list onto `mergeBase` must yield exactly HEAD's tree. Otherwise flattening
     refuses fail-closed, and nothing is lost because nothing moved.
   - (b) The list is then replayed onto the target. If the first conflict falls on a flattened
     merge commit, the rebase **halts before mutation**. If the dry run is clean, or its first
     conflict falls on an ordinary commit, the real replay proceeds, and ordinary conflicts go to
     the existing resolver path unchanged.

4. **The real replay is `git rebase -i --autostash <base>` with an engine-written todo.** The todo
   is written under the git directory (`rev-parse --git-path`), never the worktree, and installed
   with `-c sequence.editor=...`. The rebase state directory, `--continue`, `--abort`,
   `conflictedFiles`, `rebaseStateActive`, the gated resolver, the force-with-lease publication
   rule, and ORIG_HEAD capture all keep their current contracts.

5. **A pre-mutation refusal is its own outcome and names the merge and a deterministic recovery
   path.**
   - `performRebase` returns a distinct `RebaseOutcome` kind, `flatten_refused`, carrying the merge
     sha, both parents, the flattened sha, the conflicting paths (or the D3(a) mismatch), and the
     recipe. It is never `conflict_halt`.
   - Because the kind is distinct, the gated resolver is never dispatched against a worktree that
     has no rebase state, and the paused-conflict resume note ("resolve, then `--continue`") is
     never written for it. Exhaustive handling of `RebaseOutcome` forces every consumer to choose
     a behavior.
   - `runRebaseStep` and `resumeRebaseFirst` write the HALT with the recipe as its only recovery
     note and emit `rebase_conflict_halt` extended with an optional typed `mergeAudit` field
     (adr-2026-08-11-halt-events-ride-the-persisted-spine).
   - Autoresolve maps the same refusal to its existing escalation with the reason
     `merge-flatten-refused` and the recipe as its detail.
   - The recipe uses only commands the engine git guard permits: park, then
     `git -C <worktree> rebase -i --rebase-merges <base>`, then re-apply
     `git diff <first parent> <merge>` at the merge stop, then `git rebase --continue`, then clear
     the HALT. It never suggests `reset --hard` or `checkout -- <path>`.
   - A `flatten_refused` halt blocks finish like any other rebase halt
     (adr-2026-07-26-rebase-tail-current-branch-before-publication), and no push is issued.

6. **Flattening is observable only on the event spine.** A successful flatten emits one
   `rebase_merge_audit` `ConductorEvent` carrying the counts and shas of flattened merges,
   ancestry-only merges, and side-lineage commits, with an `EVENT_SINKS` row
   (adr-2026-07-26-event-sink-registry-exhaustiveness). No sidecar, log line, or marker file is
   added. The flatten pairs and absorption points the engine needs downstream are handed to
   translation in-process from the same `performRebase` call.

7. **Post-replay verification is unchanged.** adr-2026-09-11-selective-post-rebase-verification D2
   keeps P (the pre-rebase head, including its merges), B, and O as its immutable identities.
   Because D3(a) proves the list is tree-equal to P, its tree-identity proof applies as written.
   An unsupported git capability degrades to "no proof" there and to fail-closed refusal here.

8. **One shared primitive owns the replay decision.** A single exported function in `rebase.ts`
   takes the injected `GitRunner`, the base ref, and the merge base. It returns one of:
   - the plain command, for a range with no merge;
   - a started flattened replay, carrying the rebase command result, the replay list's expected
     FR-9 subjects, the flatten pairs and absorption points, and the audit summary;
   - a refusal, carrying D5's fields.

   `performRebase` and autoresolve both call it in place of their own `git rebase` invocation, and
   both take their FR-9 `subjectsBefore` from it. Tier-1 and tier-2 resolution, escalation,
   acceptance guards, and publication in autoresolve are unchanged. Autoresolve performs no
   evidence translation today and gains none. The flatten pairs are consumed only on the
   `performRebase` path.

## Consequences

### Positive
- Merge-bearing branches rebase automatically without losing merge-resolution content and without
  replaying duplicated lineage as add/add conflicts.
- Content preservation is proven mechanically (tree identity) before anything moves.
- Branches without merges are unaffected.

### Negative
- A rebased merge-bearing branch no longer shows its merges or side-lineage commits. Citations to
  them are recovered only through the absorption rule (amendment D10 of
  adr-2026-07-12-rebase-evidence-stamp-translation).
- A flattened merge commit that conflicts with the new base still needs an operator, now with the
  merge named and a recipe, rather than a blind add/add halt.

### Follow-up Actions
- [ ] Verify in BUILD that a rebase pick of a flattened merge commit does not trigger the
      commit-msg attribution hook (adr-2026-07-10-inline-work-attribution-enforcement), or satisfy
      it with the engine's trailer provision.
- [ ] Verify `-c sequence.editor=<copy command>` installs the todo under `--autostash` on the
      pinned git floor.
