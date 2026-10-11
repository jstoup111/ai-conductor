# Intake origin: a-docs-only-spec-landing-silently-breaks-main-via-

Source-Ref: jstoup111/ai-conductor#3130
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3130 digest=e257aa0b55707f1cf9601b11b7426da03f40f2b7ea3660525a44b74123d1fcea >>>
## Desired outcome

- Landing a docs-only spec cannot leave main failing a test that the landing PR's own CI did not run.
- A new largest planning artifact does not require a hand-edited engine constant to keep main green, or, if a recorded bound must change, the change is caught on the PR that causes it.
- The PRD-audit projection limits still admit every normal input and still bound the total envelope.
<<< END INBOUND >>>
