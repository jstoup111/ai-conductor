# Track: Trace provenance — commit, base, PR, and originating issue on exported traces

Track: technical

Scope boundary: Balanced. Stamp head SHA, base SHA, PR URL with an explicit PR disposition (opened | none | unrecorded), and the originating tracker issue onto exported traces. The source issue rides the trace resource from run start; base SHA rides every rebase outcome event; head/base SHA and PR land on the root run span at close via the existing feature_complete / loop_halt events (ADR-014 D11 — no new event type, no I/O in projections). All values are trace-only, never metric labels (ADR-014 D10). A new `otel.provenance` config block carries `commit`, `pr`, `issue`, and `feature` booleans, every one defaulting to ON; turning `feature` off removes the feature name from trace attributes and service.instance.id but leaves metric labels unchanged. Excluded: per-step head SHA (step spans), task-level spans (#135), slicing dimensions (#1940), event-subscription gaps (#1490), and any change to metric label sets.

Internal engine telemetry with no user-facing product behavior; acceptance criteria live in stories.
