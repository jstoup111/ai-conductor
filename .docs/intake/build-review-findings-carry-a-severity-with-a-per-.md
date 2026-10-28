# Intake origin: build-review-findings-carry-a-severity-with-a-per-

Source-Ref: jstoup111/ai-conductor#3298
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3298 digest=31afc0aa69fe9ad7ec2d5302a40fc5b82786ccfbeaf1e8455edabe3bdeddd6f1 >>>
## Desired outcome

- Every build_review finding states its severity, from a small closed scale.
- Each rubric has a configurable severity threshold. Findings below it are recorded as advisory: visible to the operator and the PR, but not kicking back and not charging the lap budget.
- Findings at or above the threshold still kick back exactly as today.
- Severity and confidence are independent. A high-confidence minor finding can be advisory, and a low-confidence severe one can still be suppressed by the confidence floor.
- An undeclared threshold keeps today's behaviour, where every finding kicks back, so existing consumer configs are unchanged.
<<< END INBOUND >>>
