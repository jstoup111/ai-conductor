# Intake origin: build-review-halts-needs-human-when-the-judge-reje

Source-Ref: jstoup111/ai-conductor#3461
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3461 digest=c11d3f65b877b8e9242df35739c95988e711581db555d823d948319db6db99a2 >>>
## Desired outcome

- A judge verdict declaring a re-raised finding on an applied action case not actionable does not halt the feature needs-human.
- A disposition the reconciler cannot accept for an existing case is either impossible for the judge to emit or gets a bounded, mechanical retry before any halt.
- Transitions that really are illegal (for example, rejecting a case with no applied effect) still fail closed.
<<< END INBOUND >>>
