# Track: test_suite re-runs and re-passes the full suite ~10x per feature

Track: technical

Scope boundary: Full issue #2021 scope — category-keyed drift budget judged inside
FullSuiteVerifier.inspect (inspect-always, tolerate-within-budget), an explicit
aggregate-vs-scoped verification mode with its own evidence/event identity,
fail-at-load config validation, bootstrap recording explicit answers via
`conduct-ts config init`, and the required ADR amendments. Unset config keeps
today's behavior exactly.

Engine/config/bootstrap machinery consumed by harness operators; no end-user
product surface, so acceptance criteria live in stories.
