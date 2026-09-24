# Intake origin: post-plan-decide-amendments-never-reconcile-with-t

Source-Ref: jstoup111/ai-conductor#1700
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1700 digest=713211fec4cb8944d9b62c9159c99e8af3f7fe14852b70bd788060e3b884161e >>>
## Desired outcome

- When a sealed DECIDE artifact (ADR, architecture review) gains an amendment after the plan is approved, the divergence is surfaced at or before the next BUILD dispatch — not after subsequent build_review/remediate laps.
- The surfaced divergence names the amended artifact, the specific condition/obligation, and the plan's gap, so an operator (or an authorized authoring pass) can reconcile in one step.
- A plan that already satisfies the amendment (or an amendment that adds no plan-relevant obligation) does not block dispatch or demand ceremony.
<<< END INBOUND >>>
