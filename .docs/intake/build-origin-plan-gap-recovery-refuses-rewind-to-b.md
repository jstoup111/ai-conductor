# Intake origin: build-origin-plan-gap-recovery-refuses-rewind-to-b

Source-Ref: jstoup111/ai-conductor#2990
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2990 digest=cf664f0a83b733a47a20e345a3c0f26ae7c9958a4377404b7f2eb21768b70dd1 >>>
## Desired outcome

- An operator can complete a documented, supported recovery for a plan-gap halt originating in a refused BUILD step after approving and resealing the amended plan.
- Resuming that recovery makes the amended work eligible for BUILD execution and requires appropriate downstream validation again.
- Completed implementation commits, task evidence, and unfinished source edits are preserved through recovery.
- A parked feature remains parked until the operator explicitly unparks it.
- Invalid recovery requests remain refused with actionable diagnostics and leave execution state and halt markers intact.
<<< END INBOUND >>>
