# Intake origin: finish-pr-body-publish-fails-on-token-scope-and-ha

Source-Ref: jstoup111/ai-conductor#3376
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3376 digest=9d685f6024c15d6e2cbdf75fe55bb99e99fe1499bbd99f21b98287c65f4914aa >>>
## Desired outcome

- FINISH can publish an authored PR title and body using a token scoped only to `repo` (+ `workflow`).
- When a PR-body publish fails, the FINISH halt reason and the events on the spine carry the underlying failure, such as the missing-scope error text, not "left pr.prose unchanged at placeholder".
- A provider attempt whose guarded GitHub operation failed is not reported as an authoring success that the fixed-point guard then reads as "unchanged".
- Negative path: when the provider genuinely leaves placeholder prose with no publish failure, FINISH still halts with the existing "unchanged" reason.
<<< END INBOUND >>>
