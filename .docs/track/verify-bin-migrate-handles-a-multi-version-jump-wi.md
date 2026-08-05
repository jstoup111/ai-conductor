# Track: Safe multi-version harness migration

Track: product

The change alters consumer-visible update behavior — which migration commands run, how the
operator approves them, what happens when approval is declined or unavailable, and whether a
failed migration rolls the consumer's checkout back. Those are user-facing requirements rather
than an internal refactor, so the work warrants a PRD.
