# Intake origin: restack-cascade-cap-halts-l-tier-stacked-features-

Source-Ref: jstoup111/ai-conductor#3472
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3472 digest=c2c8465626556d3069889e412a3777c8716f1bc234ebd70e55755e835a8c6d0c >>>
## Desired outcome

- A typical L-tier stacked remediation cycle (about 6–8 repair restacks) completes without a cascade-cap halt.
- A child whose repairs keep re-cascading without converging still halts at a bound, and the halt names the originating child.
- An operator can see the effective cascade limit for a feature before it is exhausted (for example in `daemon status` or `kickback-budget inspect`).
- S/M features keep a bound at least as tight as today's.
<<< END INBOUND >>>
