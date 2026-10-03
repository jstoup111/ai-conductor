# Complexity: Vitest daemon fixtures leak into shared operational OTel metrics

Tier: M

Two bounded mechanisms on existing seams. The first makes the user-level config location
(`userConfigPath` in `src/engine/user-config.ts`) overridable through an environment variable, and
the global test setup (`test/setup.ts`) points it at an empty run-scoped directory. This follows the
existing `AI_CONDUCTOR_ENGINEER_DIR` isolation precedent, so no fixture inherits the operator's
`~/.ai-conductor/config.yml`. The second adds an export-boundary backstop in the OTel wiring: network
(OTLP) export is refused while the suite's test marker is set, unless an explicit opt-in smoke flag
is present. Tests that exercise telemetry keep the file exporter and fakes.

There is no new external service, credential or state machine. The change touches config
resolution and the OTel wiring, both of which carry approved ADRs, so a lightweight architecture
review is warranted. This matches the `size: M` label on issue #2471. The plan stem must remain
`vitest-daemon-fixtures-leak-into-shared-operationa`.
