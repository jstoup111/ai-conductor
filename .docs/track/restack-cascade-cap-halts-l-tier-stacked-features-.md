# Track: Restack cascade cap is sized by the feature's complexity tier

Track: technical

Scope boundary: Balanced (operator-confirmed 2026-10-28). Approach A, tier-sized configurable cap,
following #2413. The per-originating-child restack cascade allowance resolves from the feature's
complexity tier with defaults Small 3 / Medium 3 / Large 8. A feature with no recorded tier is
treated as Medium (3). New config key `stacked_prs.max_restack_cascades` accepts a positive integer
(every tier) or an `{S, M, L}` map. It is never materialized by loading, and user and project maps
merge per tier. A per-child limit already written to `refs/conductor/<slug>/cascades` by an operator
raise keeps precedence over the tier default. Every enforcement and display site resolves the
allowance at use, from the main checkout's config and the feature's current tier: the restack executor's cap check (the stack
preflight's discarded duplicate check is removed), the restack raise/reset CLI, and the budget
renderer. The cascade-cap halt,
`kickback-budget inspect` and `daemon status` name the tier, the allowance and its source, and show
each originating child's consumed/limit before it is exhausted. Builds on the #3475 per-child limit
model, which must land first.
Excluded: counting only "no-progress" cascades (approach B) and removing the cap (approach C), both
rejected because the cap is the termination bound for routed re-validation; pinning the resolved
allowance at the first cascade; reference documentation edits, left to the maintain-documentation
gate.

Engine policy and configuration-semantics change to the harness's own stacked-restack budget;
acceptance criteria live in stories, and no product requirements warrant a PRD. Source: intake
jstoup111/ai-conductor#3472.
