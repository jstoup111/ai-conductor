# Complexity: Repair host merged a higher child into its branch; no guard refused it (#3676)

Tier: M

Rationale: this is a bounded engine change to stack integrity, made in four existing seams with no new history transformation:

1. **One shared stack-containment predicate.** It answers one question: does a proposed tip for child k reach a commit unique to a higher child, or carry a patch-id copy of one? It reads the existing durable child state and the `refs/conductor/<slug>/closed/c<k>` refs.
2. **The agent-path git wrapper** (`engine/git-guard.ts` `GIT_GUARD_SCRIPT`). It gains a pre-mutation refusal for `merge`, `cherry-pick` and `reset` onto a child branch when the predicate fails.
3. **The `reference-transaction` hook** (`engine/git-hook-assets.ts`). It gains a `prepared`-stage veto of child-branch advances that fail the predicate. This is the backstop for moves the wrapper cannot see, such as `update-ref` and hook-less paths. Engine-originated moves are exempt: the restack replay and the `#3653` fold.
4. **A routed host gate backstop** in `test_suite`, `build_review` and the routed exit. When the host's tree fails the predicate, it halts, and the halt names the higher child and the offending commits. The halt is emitted on the existing event spine.

There is no new module layer or persisted format beyond what the predicate reads. The change amends `adr-2026-09-23-engine-git-guard-on-agent-path` (refusal matrix) and the routed-repair guard decisions, so architecture-diagram, lightweight architecture-review, conflict-check, coherence-check and plan-review apply. There is no PRD, because this is the technical track.

Blocked by `#3653`, which rewrites the stack-commit guard for leaf-executed audit rounds.
