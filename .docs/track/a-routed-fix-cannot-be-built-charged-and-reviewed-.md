# Track: A routed fix cannot be built, charged and reviewed on the child that hosts it

Track: technical

Scope boundary: spec C of the four-spec split of #2944 (`adr-2026-10-12-routed-whole-feature-repair`
decision 18): decisions 5 and 9–12 for the routed-repair pass, implemented as approved and reconciled
to the code spec B (#3210, PR #3243) shipped. Included: host region entry, the frozen-block write and
the `repairing` transition (D9); `Round:` stamping and `Child:`-line membership; `closeChild`'s
`red/c<k>` ref and verify-green acceptance for a routed pass; the round receipt settled once at the
host's BUILD dispatch, taskless admission charging, the stored growth denominator and recreation
rebuild (D10); branch-bound, round-keyed repair obligations (D11); the pinned `routed-repair`
`build_review` base shared with testQuality and the per-round `routedRepairCredit` (D12); the verified
prerequisite reroute (D5), including `remediationReroutedEvent`; and the items spec B moved here
(draft Tasks 33, 37–39, 45–47, the standalone and FAIL-only `manual_test` routing, open findings O3
and O4). Excluded and moved to #3212: everything re-validation-specific (the `revalidate` restage
arm, verify-green acceptance in a revalidate pass, the `revalidation` and `revalidation-fix` review
bases of draft Task 73, a re-validation pass's credit), the selection and execution of the no-commit
exit (draft Task 84) that consumes this spec's host-baseline no-op evidence, marker deletion,
the D11 return path after the exit restack and queue, `selectNextHost` host progression, and
decision 9's restack replay merge of appended rem blocks (#3212's draft Tasks 89–90, whose first
producer is the exit restack). The routing flag stays default-off.

Engine-internal stacked-repair machinery behind a default-off flag, with no product-facing
requirements; it adds behaviour, so it is not a maintenance change.
