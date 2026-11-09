# Track: Refused over-scope rework can't start while a routing round is open

Track: technical

Scope boundary: Balanced — (1) a stacked child whose build_review settles through adjudication runs the same child-region closure as a clean PASS (one shared closure helper): a routed host takes its routed exit and an ordinary non-leaf child closes and advances (non-routed children added by operator 2026-11-07); (2) whole-feature gates on a stacked feature never run while a routing round or repair marker is open, and instead reconcile back to the open round or stop with the bounded mechanical stall; (3) refusal rework preserves the round-admission fence's mechanical halt class, and the fence detail names the blocking round, its open host and host state, and an executable recovery. Excluded: any mechanism that folds or supersedes audit/refusal work into an open round (filer hypothesis), changes to features with no open round, and hand-repair of the parked path-policy-still-decides-feature-ownership-by-fol feature.

Engine correctness fix restoring adr-2026-10-12-routed-whole-feature-repair D7 (#3445 amendment), D13 and D15 — no new user-facing capability; acceptance criteria live in stories. Operator confirmed 2026-11-07. Source: jstoup111/ai-conductor#3597.
