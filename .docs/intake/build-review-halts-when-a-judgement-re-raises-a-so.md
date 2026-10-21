# Intake origin: build-review-halts-when-a-judgement-re-raises-a-so

Source-Ref: jstoup111/ai-conductor#3292
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3292 digest=ae1a0d7ade530511511a2f324301a3d99e710c87160c586564de133a3e3d7c28 >>>
## Desired outcome

- A judgement that re-raises a source owned only by a resolved case, as a new act, escalate or merged case, does not halt the feature on a case-store invariant.
- The resolved case's history stays byte-identical after such a re-raise.
- Every rejected case-store transition halt names its invariant, case ids and source ids, including the decision-stop path.
- A source linked to two **open** cases is still refused.
<<< END INBOUND >>>
