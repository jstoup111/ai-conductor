# Intake origin: whole-feature-audit-fixes-cannot-land-in-the-stack

Source-Ref: jstoup111/ai-conductor#2944
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2944 digest=f218bf4f526599b50b132894aab69c1a2791acf96d747ffef75dd051a7b2df56 >>>
## Desired outcome

- **Classification first.** Leaf-gate findings are classified and admitted exactly as today. PLAN_GAP, DESIGN, OVER_SCOPE and malformed-evidence findings halt or refuse as they do now, whether or not an implementing child exists.
- **Admitted work goes to its owning child.** Work from a FIXABLE or REMEDIABLE finding lands in the child that owns the cited story or decision.
- If that child cannot host the fix because a prerequisite lives in a later child, the fix lands in the earliest child that can.
- The chosen child, the reason and any fallback are recorded before the change is made, and are observable on the event spine.
- **Children above re-validate.** After a routed fix, every child above the fixed one is re-validated. The leaf gates then re-run under their existing lap caps.
- **Feature budgets stay feature-wide.** Repair budgets (prd_audit and as-built laps and growth) keep their per-feature meaning, and a pending repair settles exactly once at the target child's dispatch, including after a crash.
- **Routed remediation tasks** carry their child, and the plan stays valid after every routed append.
- **Landing skill.** A human or agent with a manual change, such as a reviewer-requested edit, can get it landed in the correct child. Its commits are refused if made on the wrong child.
- **N=1 features** route and remediate exactly as today.
<<< END INBOUND >>>
