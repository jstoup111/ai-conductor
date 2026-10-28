# Intake origin: no-repo-wide-diagnostic-for-plans-whose-stories-re

Source-Ref: jstoup111/ai-conductor#1442
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1442 digest=c1466ed6067b27f6fc4e1ca6f036d42444f0a3448fc777438ee7b9ad82c19e65 >>>
## Desired outcome

- A single read-only invocation reports every committed plan on the default branch whose stories reference does not resolve to an existing artifact, naming the plan, the raw reference text, and the path that was attempted.
- Each reported plan carries its lifecycle state — processed, shipped, parked, halted, or actionable — so a reader can tell noise from a genuinely stuck feature without further digging.
- The report is computed by the same resolution logic discovery and land use, so a report that says "clean" cannot disagree with what the daemon actually does.
- A repository with no broken references reports that explicitly, distinguishably from a report that failed to run.
- The invocation makes no network calls and mutates nothing.
<<< END INBOUND >>>
