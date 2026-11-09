# Track: Routed remediation skips re-run steps on stale child verdicts, then exits markerless

Track: technical

Scope boundary: Comprehensive, operator-confirmed 2026-10-28. In scope: (1) a routed host's region gates never count a child verdict produced outside the current routed round, including verdicts already on disk from earlier laps, so already-wedged features recover without operator verdict deletion; (2) a `parked` loop exit always writes a HALT naming the routed round, parking kind and reason, as a bounded `mechanical` HALT the daemon re-kicks for every parking kind (`queue`, `child`, `leaf-host`), escalating to `needs-human` on the third identical stall (operator-approved 2026-10-28, reusing #3445's bounded stall); (3) verdicts produced within the current round stay honored on resume; (4) a host whose region finished in the current round but whose routed exit was interrupted takes that exit on resume instead of parking (operator-included 2026-10-28; no existing spec covers it). Out of scope: new operator CLI for route inspection or recovery (#3459), round-admission ordering (#3445), restack compare-and-swap staleness (#3469), and non-routed (flat or N=1) verdict semantics.

Internal engine gating and halt classification with no user-facing product requirements; it changes observable engine behavior, so it is not a maintenance change.
