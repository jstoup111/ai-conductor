# Intake origin: destructive-git-prevention-is-absent-in-self-host

Source-Ref: jstoup111/ai-conductor#1354
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1354 digest=e9a6b57c079f19c146a1f2cc3cb67aa2b75cd514735ad0db227a54cf1f850e19 >>>
## Desired outcome

- A destructive git operation attempted during a build is blocked before it executes, in self-host and non-self-host runs, on every supported provider.
- Where no mechanical block is possible, the limitation is explicitly documented rather than silently absent, so nobody assumes coverage that does not exist.
- Explicitly-sanctioned safe forms, such as a lease-checked push, continue to work.
- Engine-driven git operations that legitimately rewrite history — rebase, quarantine, shipped-record and spec-landing bookkeeping — are unaffected.
- A blocked operation explains what was refused and what the safe alternative is.
- Text that merely *describes* a destructive command — documentation, an issue body, a test fixture — is not itself blocked.
- Coverage is proven by executable tests, including for a run where the operator's home configuration is absent.
<<< END INBOUND >>>
