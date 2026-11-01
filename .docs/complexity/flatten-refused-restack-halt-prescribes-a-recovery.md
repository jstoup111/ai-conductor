# Complexity: Stacked restacks recover merge-bearing conflicts automatically

Tier: M

Rationale: The work extends seams that already exist, with no new module layer:

- `restack-resolver.ts` builds its hand-off todo from flattened commits, using the first-parent classification `restack-replay.ts` already applies through `classifyReplayMerge`, and translates the rewritten list back to the original commits.
- `restack-executor.ts` and `restack-recovery.ts` stop refusing merge-bearing conflicts, so those conflicts take the shipped decision delivery, resolver, and conflict-record path.
- The conflict halt gains a flattened starting tip for its `--tip` recipe, pinned alongside the existing conflict refs.

There is no CLI, schema, or migration change. It is above Small because it changes resolver behavior across both restack entry points and amends three on-main ADRs: `adr-2026-10-10-stacked-restack-journaled-replay`, `adr-2026-10-25-operator-recorded-restack-conflict-resolution`, and `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`. It is below Large because it adds no subsystem or cross-feature coordination. Delivery is a single PR.
