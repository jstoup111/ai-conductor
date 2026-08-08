# Track: ADR approval enforced before build (not at as-built review)

Track: technical

Engine gate machinery — a shared ADR status parser plus three deterministic enforcement rungs
(engineer `land`, daemon-backlog eligibility, as-built backstop). No user-facing product
capability and no product requirements to enumerate; the consumers are the harness's own gates,
so acceptance criteria live directly in the stories.
