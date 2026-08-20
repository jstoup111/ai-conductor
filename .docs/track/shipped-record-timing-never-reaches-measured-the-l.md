# Track: Shipped-record timing never reaches `measured` (#1260)

Track: technical

Internal telemetry correctness in the conductor engine — every execution start must get a
terminal event carrying its `activeInterval`, and a genuine `partial` must record which route
produced it. No user-facing product surface, so acceptance criteria live directly in stories
and no PRD is authored.
