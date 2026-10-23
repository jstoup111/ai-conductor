# Intake origin: done-when-closes-as-verified-citing-tests-that-don

Source-Ref: jstoup111/ai-conductor#3200
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3200 digest=7a6965a65eb1a13445c9e3573612ea08c497c680cef743063ad49db7802c38c5 >>>
## Desired outcome

- A `[test]` check cannot close as verified when the cited test does not assert that check.
- A test added or changed in the task's own commits that proves the check still closes with no extra cost or delay.
- An existing, untouched test that genuinely covers the check (refactors, behavior preservation) is still accepted as evidence.
- A wrong refusal has an operator override that unblocks the task, records the override as durable evidence, and doesn't halt the feature with no lever.
- A refused citation sends the task back to BUILD at close time, not several review laps later.
<<< END INBOUND >>>
