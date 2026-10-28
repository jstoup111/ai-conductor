# Track: A routed fix is never carried up the stack or followed by re-validation of the children above

Track: technical

Scope boundary: spec D of the four-spec split of #2944 (`adr-2026-10-12-routed-whole-feature-repair`
decision 18): decisions 13–15 and decision 16's queue outbox, implemented as approved and re-derived
against the code specs A–C (#2944, #3210, #3211) and stack publication (#2945) shipped — the
2026-10-12 draft tasks (10, 75–99) are an input, not a plan, because the code drifted. Included: the
routed exit restack (D13), including the restack's own exemption from the route-record writer fence,
routed lines in one shared `applied` transaction used by the normal and recovery paths, marker
deletion, `built`/`done`/`restacked`/`closed` writers, co-origins, the cascade-cap halt keeping the
marker, the preflight's `built` arm, `hostNoOpEvidence` and the no-commit exit, `selectNextHost` host
progression and the record's return order; decision 9's rem-block union merge on replay; the
durable re-validation queue (D14) — production on every restack cause, gate-input-identity skip,
bottom-up consumption as a `revalidate` round, acknowledgement and its guards, failure through the
child's own exit restack — extending the shipped queue record, ref and `child_revalidated` event
rather than adding parallel types; the items spec C moved here (the `revalidate` restage arm,
verify-green acceptance in a revalidate pass, the `revalidation` and `revalidation-fix`
`build_review` bases, one routed-repair credit per re-validation pass); leaf parking, the recorded
return to the leaf and leaf-gate re-pend under existing caps (D15); the queue outbox and its drain
(D16); wiring the routed-exit restack to the shipped `publishedStackRefusal` (publication ADR D11);
the three runbook sections; and changing `stacked_prs.route_whole_feature_fixes`'s default to
`true`. Excluded: the PR comment on an already-published child and refreshing a published stack —
the shipped publication ADR freezes a published stack and assigns them to #3269 and #3268; the
issue's 2026-10-17 addendum is superseded by that decision (operator, 2026-10-23).

Engine-internal stacked-repair machinery with no product-facing requirements; it adds behaviour, so
it is not a maintenance change.
