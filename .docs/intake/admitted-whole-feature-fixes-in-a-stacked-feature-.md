# Intake origin: admitted-whole-feature-fixes-in-a-stacked-feature-

Source-Ref: jstoup111/ai-conductor#3210
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3210 digest=dcc60df0ec7fb672ba92d19d456778640aabb636341ddb6fef1343ffcc75d599 >>>
## Desired outcome

- **Classification first.** Leaf-gate findings are classified and admitted exactly as today. PLAN_GAP, DESIGN, OVER_SCOPE and malformed-evidence findings halt or refuse as they do now, whether or not an implementing child exists.
- **Admitted work goes to its owning child.** Work from a FIXABLE or REMEDIABLE finding is placed in the child that owns the cited task. Work that cites no task (an ADR decision only, refusal rework, a `manual_test` FAIL, a post-region custom-step kickback) is placed by one bounded, validated judgement.
- **Cannot host.** If the owner cannot host the fix because a file it needs exists only in a later child, the fix is placed in the earliest child that has it.
- **Recorded first.** The chosen child, the reason and any fallback are recorded durably, and announced on the event spine, before any change is made. A crash at any point recovers without duplicating or losing the round.
- **N=1 features** route and remediate exactly as today.
<<< END INBOUND >>>
