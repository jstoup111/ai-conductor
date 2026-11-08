# Track: Newer-engine child events vanish from OTel when the supervisor predates them

Track: technical

Scope boundary: every OTel span and metric that a child executor's own engine declares is exported, whatever the child's engine pin is relative to the supervisor's, giving parity with the retired in-process executor. Event types that the child's engine declares child-local stay out of daemon-level telemetry. Excluded: the #3360 stale-supervisor rebuild deferral, and any change to when the supervisor restarts.

Daemon telemetry infrastructure with no product requirements, so acceptance criteria live in stories. Operator confirmed 2026-11-07. Chosen approach: OTel projection runs in the version-matched child. The child runs its pinned engine's span visualizer into the shared spool, and its MetricsListener records through a proxy OTel Meter onto the supervisor's single long-lived MeterProvider (ADR-014 D7). Source: jstoup111/ai-conductor#3646.
