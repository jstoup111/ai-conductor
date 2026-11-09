# Complexity: Restack accepts resolutions that adapt the new parent's files

Tier: M

Rationale: The work extends seams that already exist, with no new module layer:

- `restack-ownership.ts` gains a resolved-tip acceptance rule. Paths in the new parent's delta that the tip changes become adapted paths, and an adapted path that restores its old-parent content is refused as a revert. The clean-replay rule is unchanged.
- Every path-ownership caller for a resolved tip uses that rule: the resolver result and recorded `--tip` consumption in `restack-executor.ts`, the same two in `restack-recovery.ts`, and the operator check in `stack-restack-resolve-cli.ts`.
- Adapted paths are carried on the existing `restack_applied` event and feed the restacked child's gate invalidation.
- A refused resolution writes the shipped conflict record and halt, plus one more pinned ref in the existing conflict ref family for the refused tip, so the `--tip` recipe can name it.

There is no CLI flag, settings schema, or migration change. It is above Small because it changes acceptance across both restack entry points and the operator command, and amends on-main ADRs: `adr-2026-10-10-stacked-restack-journaled-replay` and `adr-2026-10-25-operator-recorded-restack-conflict-resolution`. It is below Large because it adds no subsystem or cross-feature coordination. It is sequenced after #3438, which changes the same resolver hand-off.
