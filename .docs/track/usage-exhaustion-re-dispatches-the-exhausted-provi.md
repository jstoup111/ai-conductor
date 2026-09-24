# Track: Usage exhaustion re-dispatches the exhausted provider every step, and provider substitution cannot be disallowed

Track: technical

Scope boundary: Both operator asks are in scope — (1) a provider-substitution policy configurable
globally and per step, under which a pinned step is observably honored and never executes on another
provider; and (2) suppression of a provider observed usage-exhausted, so later steps and later feature
dispatches inside the same window do not re-dispatch it. Suppression must be self-expiring (the parsed
reset deadline, else a bounded interval) and must survive the process/dispatch boundary by carrying its
state on the event spine rather than a sidecar file or a runtime-object cache. Suppression and policy
refusal are enforced at a single per-candidate admission seam and recorded through the existing
`provider_attempt { invoked: false }` telemetry. With neither setting configured, behavior is unchanged.

Explicitly excluded: making usage exhaustion a provider-fallback trigger. Today exhaustion makes the run
wait, and it continues to — suppression removes the wasted subprocess dispatch without changing the run's
outcome. Substituting a healthy provider for an exhausted one is a separate decision, deferred until the
pin is provably honored.

> **Amended 2026-09-23 by #1492 (coherence-check):** the boundary above ends "With neither setting
> configured, behavior is unchanged", carried from the intake, which presumes two configurable
> settings. The approved design ships one — the substitution policy — and makes suppression
> unconditional. The operator confirmed that clause binds the substitution setting only: because
> exhaustion still ends in the same wait, an unconfigured repository sees unchanged run outcomes,
> while the number of subprocesses spawned to rediscover a known limit and two optional telemetry
> fields do change unconditionally. The original boundary text is preserved above.

Technical: internal provider-selection, availability-caching and telemetry behavior with no user-facing
product capability; acceptance criteria belong directly in stories, so no PRD.
