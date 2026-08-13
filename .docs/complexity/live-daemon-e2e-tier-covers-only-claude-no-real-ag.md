# Complexity: Live daemon E2E tier covers only Claude — no real-agent Codex signal

Tier: M

## Signals

- **Models / data shapes:** additive, not new. The closed `SmokeCapability` union gains
  per-provider credentialed members and a provider descriptor type is introduced; no persisted
  schema, no migration, no event-union member.
- **Integrations:** two — a second real provider CLI (`codex`) driven headlessly, and a new
  GitHub Actions repository secret (`CODEX_API_KEY`) consumed by a release-gating workflow.
- **Auth:** yes, and it is the principal risk. Codex headless API-key authentication has no CI
  precedent in this repository; `CodexProvider.readiness` has cached-login, api-key, and
  probe-failed states that the Claude leg never exercises.
- **State machines:** none added. The daemon claim-to-finish path under test is unchanged; this
  work parameterizes the harness that drives it.
- **Blast radius:** touches `smoke-capability.ts`, `smoke-runner.ts` resolution, the live smoke
  file, the structural smoke manifest, and `live-daemon-e2e.yml` — which `release.yml` calls
  fail-closed. A defect here blocks releases rather than degrading a feature.
- **Story count (projected):** ~5-7 — shared parameterized run body, per-provider capability
  resolution, per-provider smoke files, matrix parameterization + per-provider credential check
  and step summary, provider-enumeration coverage guard, Codex auth readiness/diagnostics parity.

## Why M and not S

Small was rejected on blast radius and integration count: the change modifies a closed typed
capability set that the release gate reads, adds a real third-party credential path with no
in-repo precedent, and must preserve failure isolation between two legs. Conflict-check and
architecture artifacts are warranted — the capability-set change interacts with the existing
`assertGateCredentialedExecution` invariant and with the structural manifest, and those
interactions are exactly the kind a Small-tier skip would miss.

## Why M and not L

No new persistence, no new event types, no state-machine or protocol design, and no change to
production dispatch. The provider-neutral seams it depends on already exist
(`provisionProviderHome` maps `CODEX_HOME`; `CodexProvider` implements `prepareSelfHostAuth`,
`readiness`, and `resolveSelfHostExecutable`; the step-command preflight already takes a
`providerKey`). The work is parameterization plus a coverage guard, not new architecture.
