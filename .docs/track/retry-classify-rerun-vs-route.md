# Track: Classify step-failures rerun-vs-route — route deterministic failures on first signal (#646)

Track: technical

## Rationale

Internal daemon/engine throughput fix. No user-facing product surface. The engine's in-loop retry
machinery re-dispatches a failing SHIP-tail verdict step verbatim when its failure cause cannot change
between attempts — the same code/artifacts are re-judged, the gate rejects on identical grounds, and
the per-step retry budget drains before the EXISTING kickback/remediation routing (which already knows
where the fix belongs) engages. Each foredoomed retry costs a full dispatch (5-15 min + tokens) and
converts recoverable situations into slower halts whose reason reads "retries exhausted" instead of
naming the resolving route.

Operator priority is **build throughput** ("I want it faster"): the win is eliminating the wasted
dispatches by deciding rerun-vs-route BEFORE burning a retry, using signals the engine already records
(the completion-check failure reason / remediation disposition, HEAD sha, artifact mtimes).

Deterministic-first: the classifier is plain engine code keyed off machine-readable facets, not a
prompt or an LLM call. Routing reuses the existing `planRemediation` → `earliestRemediationTarget`
path (which already carries #644's DECIDE-halt guard and #648's no-op/zero-progress escalation) rather
than adding a second routing mechanism.

## Live datum

2026-07-13, feature `2026-07-12-wiring-reachability-gate`: `architecture_review_as_built` returned
**BLOCKED** (shipped code violates an APPROVED ADR — deterministic given unchanged code). The engine
re-ran the identical review at try 2 and try 3, byte-identical verdict each time, then kicked back to
`build` with the resolving evidence (`adr-2026-07-12-wiring-check-gate→build`). The **try-1** verdict
already named the route ("Fix the code or supersede the ADR"); tries 2-3 were pure waste (~5 min + 2
dispatches). Operator: "Arch review failed 3x before going to remediate. Could have landed at remediate
sooner."
