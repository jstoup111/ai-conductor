# Conflict Report: Stack containment guard (#3676) vs the stacked-child lifecycle and guard stories

**Date:** 2026-11-15
**New stories:** `.docs/stories/repair-host-merged-a-higher-child-into-its-branch-.md` (Stories 1–4)
**Result:** passed. All blocking conflicts were resolved with operator approval, and one degrading conflict (C6) was accepted.

## ADRs examined

- `adr-2026-09-23-engine-git-guard-on-agent-path`
- `adr-2026-10-03-fail-closed-git-option-normalization`
- `adr-2026-10-03-stacked-child-plans-identity-and-state`
- `adr-2026-10-07-per-child-build-region`
- `adr-2026-10-10-stacked-restack-journaled-replay`
- `adr-2026-10-12-routed-whole-feature-repair`
- `adr-2026-10-24-operator-route-round-for-closed-stacked-children`
- `adr-2026-10-25-operator-recorded-restack-conflict-resolution`
- `adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref`
- `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish`
- `adr-2026-11-15-stack-children-never-gain-higher-child-commits`

**Narrowed out:** every ADR not about git guards, stacked children, routing or restack. Their subjects do not touch child-branch ref moves or child-region gates.

## Conflict C1: Child-branch creation refused by the hook

**Stories involved:** Story 2 and Story 3 (new) vs `build-loop-cannot-complete-a-feature-child-by-chil.md` Story 1
**Type:** contradiction
**Severity:** blocking (resolved)

**Description:** A creation line has an all-zero old value. Under the first definition, which counted every commit reachable from a higher branch, creating `feat/c1` at the leaf tip `H` or `feat/c2` at `closed/c1` would gain foreign commits and be aborted.

**Resolution:** ADR decision 1 was revised. A higher child counts only once it is **entered**, meaning its predecessor position has closed, and then only for its own range, `feat/c«j» ^closed/c«p» ^origin/«default»`. Story 3 now has a creation criterion.

## Conflict C2: Every first-pass child gate would halt

**Stories involved:** Story 4 (new) vs `build-loop-cannot-complete-a-feature-child-by-chil.md` Story 1 and `a-change-to-one-stacked-child-cannot-be-carried-in.md`
**Type:** state-conflict
**Severity:** blocking (resolved)

**Description:** The leaf branch exists before any child closes. The rule "missing closure while a higher branch exists means halt" therefore fired on every ordinary stacked build.

**Resolution:** with the entered/own-range definition, the predicate is vacuous until a higher child is entered. The `unavailable` halt fires only when an entered higher child's predecessor position is above `k` and `closed/c«k»` is missing. Story 4 now has a first-pass criterion.

## Conflict C3: Leaf-executed audit hosts would halt

**Stories involved:** Story 4 (new) vs `late-gate-fixes-restack-the-whole-stack-every-repa.md` Story 1
**Type:** overlap
**Severity:** blocking (resolved)

**Description:** Story 4 keyed on "child 2's region". A leaf-executed host region runs with the leaf checked out, and the leaf reaches every higher child's work.

**Resolution:** ADR decision 5 keys on the checked-out branch being `feat/c«k»/«slug»` and never on the region. Story 4 now has a leaf-executed host criterion.

## Conflict C4: The fail-closed option ADR's guarded-subcommand list

**Stories involved:** Story 1 (new) vs `adr-2026-10-03-fail-closed-git-option-normalization` decisions 1–2
**Type:** contradiction
**Severity:** degrading (resolved)
**ADR filename stem:** adr-2026-10-03-fail-closed-git-option-normalization
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "Subcommands that are not guarded pass through unchanged, as today."
**Story opposing sentence (verbatim):** "Given the test stack with child 2 checked out, when a containment-class command carries an option the shared git option spec cannot resolve, then the wrapper refuses it with stderr naming the unresolved option, and child 2's tip is unchanged."

**Resolution:** the ADR is amended after decision 2. `merge`, `cherry-pick` and `rebase` grammars are added, and they are guarded only on stacked child branches.

## Conflict C5: Guard stories assert that reset, rebase and ref updates pass everywhere

**Stories involved:** Stories 1–2 (new) vs:
- `destructive-git-prevention-is-absent-in-self-host.md`
- `ref-moving-destructive-git-that-bypasses-the-build.md`
- `destructive-git-guard-parser-misses-valid-git-and-.md`

**Type:** overlap
**Severity:** degrading (resolved)

**Resolution:** the affected assertions are qualified in place with the stacked-child exception.

## Conflict C6: Patch mode cannot tell which way a copy went

**Stories involved:** Story 4 (new) vs `a-change-to-one-stacked-child-cannot-be-carried-in.md` Story 1 and `manual-reviewer-edits-cannot-be-landed-safely-in-t.md`
**Type:** state-conflict
**Severity:** degrading (accepted by operator 2026-11-15)

**Description:** An operator may copy a lower child's fix up into a higher child and then land it with `stack land … --carry`. That trips the lower host's patch mode.

**Resolution:** accepted and recorded in the ADR's Consequences. The HALT names both commits, and restacking the higher children clears it.

## Re-check findings

These came from the re-check after the first resolutions.

**N1, default-branch merges (blocking, resolved).** A higher child's own range included default-branch commits it had merged, so a lower child's base refresh would have been aborted. The fix is to subtract `origin/«default»`, as the leaf-move rule of `adr-2026-10-07-per-child-build-region` decision 3 does. Story 3 now has a criterion for this.

**N2, gapped positions (degrading, resolved).** "Entered" and the missing-closure rule assumed consecutive positions, and positions may have gaps. Both now use the predecessor position from `refs/conductor/«slug»/positions`. Story 4 now has a gapped-position criterion.

## Clean pairs

**Engine moves:**
- restack replay (closures and branches move together);
- fold re-placement;
- verified reroute;
- exit restack and revalidate queue.

**Operator flows:**
- `stack land` (except C6);
- hand-moved closures (caught earlier by the `hand-moved-closure` preflight).

**Leaf-side records:**
- halt-record commits on the leaf;
- base refresh into the leaf.

**Other:**
- publication and pushes;
- rewind stories.

No existing story requires a builder or operator to merge, cherry-pick, reset or rebase a lower child toward an entered higher child's own work.
