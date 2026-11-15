Waives: outcome-2

Rationale: at explore on 2026-11-15, the operator confirmed this spec's scope: the stack-containment guard and the gate backstop. Routing changes and prerequisite-claim ergonomics were excluded. No part of outcome-2 is dropped; each part has a named home:

- **Never routed to a lower host.** For audit rounds, which carried the #3676 occurrence (an `architecture_review_as_built` repair), this is delivered by jstoup111/ai-conductor#3653. Its `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` decision 3 runs every audit host on the leaf branch, where every prerequisite exists. This spec is blocked by #3653.
- **A working "move up" path.** Prerequisite-claim ergonomics, including claims a builder cannot emit correctly, are owned by jstoup111/ai-conductor#3674.
- **The remaining operator and revalidate rounds.** Here this spec guarantees the failure mode can no longer corrupt the stack. A builder that cannot finish a task on a lower child is refused at the wrapper or the hook, and its attempt fails visibly (Stories 1 and 2), instead of merging a higher child.
