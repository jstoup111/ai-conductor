# Intake origin: authenticate-contained-claude-build-review-reviewe

Source-Ref: jstoup111/ai-conductor#2737
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2737 digest=ca4f0aa96a9acbb7a66cf2fa5cd5d1f9cfc5a2893b4e0193d1f926aec3967006 >>>
## Desired outcome

- On a non-self-host project where ordinary Claude steps authenticate, a contained Claude build_review reviewer also authenticates and produces a verdict, with no extra operator setup.
- The reviewer's containment guarantees are unchanged: it still cannot write protected paths or read host state beyond what authentication strictly requires.
- When no Claude credential is available at all, the failure is reported before any review attempt is spent, naming the missing credential, instead of consuming the fault allowance on `Not logged in`.
<<< END INBOUND >>>
