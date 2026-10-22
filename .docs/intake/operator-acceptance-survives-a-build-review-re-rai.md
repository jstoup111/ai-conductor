# Intake origin: operator-acceptance-survives-a-build-review-re-rai

Source-Ref: jstoup111/ai-conductor#3271
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3271 digest=de6f5a2d55358fd038008d1bec9ef62684951a100ac68c330314221110391366 >>>
## Desired outcome

- Once an operator accepts a finding, a later lap that raises the same substance, which the adjudicator binds to the same case, does not block. It does not halt as a regression or repeat, does not open a new decision stop, and does not fail with `conflicting-case-id`.
- The carried acceptance is visible: `build-review findings` and the PR body's accepted-risk section show the newly bound finding with the original operator, rationale and lap. The carry-over is observable on the event spine.
- The adjudicator can see which prior cases an operator accepted.
- A new finding the adjudicator does not bind to an accepted case still blocks exactly as today. Acceptance never spreads by automatic matching.
- An acceptance still covers only the feature it was made on.
<<< END INBOUND >>>
