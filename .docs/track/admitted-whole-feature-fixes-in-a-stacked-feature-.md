# Track: Admitted whole-feature fixes in a stacked feature are placed in the owning child

Track: technical

Scope boundary: Self-contained spec B of `adr-2026-10-12-routed-whole-feature-repair` (jstoup111/ai-conductor#3210): decisions 1–4 and 7, plus the route-record writers of decisions 6 and 16 — mechanical owner derivation, the validated residue routing call, cannot-host selection, marker-first admission, round reconciliation, the preflight automatic-restack skip, base-refresh deferral and the routing event constructors. Excluded and moved to jstoup111/ai-conductor#3211: draft Tasks 33, 37–39 and 45–47 (or their criteria) that need host region entry, the frozen-block append, the `Round:` stamp, `Child:`-line membership, receipt settlement, taskless admission charging or the reroute transaction. Re-validation, the routed exit and the leaf return stay in jstoup111/ai-conductor#3212. Routing stays behind the default-off `stacked_prs.route_whole_feature_fixes` setting. The four open contradiction findings carried from the split are resolved in this DECIDE.

Internal engine remediation machinery with no user-facing product surface; acceptance criteria live in stories.
