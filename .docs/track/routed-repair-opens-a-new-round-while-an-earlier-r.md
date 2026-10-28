# Track: Routed repair opens a new round while an earlier round is still open

Track: technical

Scope boundary: comprehensive (operator-confirmed 2026-10-26). In scope: every routed host exit
advances its own round before control leaves the routed region (the resume-path exit included);
round admission refuses while any other round for the feature is non-closed; reconciliation
self-heals a feature that already holds two open rounds by advancing the marker-owning round
first and then draining older rounds' unadmitted hosts; a state reconciliation cannot advance
ends the run with a `mechanical` HALT (daemon re-kicked) whose first line names every open round,
escalating to needs-human only on the 3rd consecutive identical stop. Out of scope: a new durable round-lock ref or any route-record format change; writing the
preflight stop itself (owned by #3446, which this spec depends on); recovering the items the
operator dropped from `build-review-re-raises-already-decided-findings-ev`'s r3.

Internal routing-engine invariant fix with no user-facing capability; acceptance criteria live in
stories. Source: intake jstoup111/ai-conductor#3445.
