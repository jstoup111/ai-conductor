**Status:** Accepted

# Stories: Vitest daemon fixtures leak into shared operational OTel metrics (#2471)

Track: technical

Tier: M

Scope boundary (from `.docs/track/vitest-daemon-fixtures-leak-into-shared-operationa.md`): balanced.
Ordinary test runs are isolated from the operator's user-level config, and an export-boundary backstop
refuses OTLP network export under the suite's test marker unless an explicit smoke opt-in is set.
Out of scope: redirecting HOME for the whole suite, auditing every `homedir()` read, and Grafana-side
filtering. Design: `.docs/decisions/architecture-review-2026-10-03-vitest-daemon-fixtures-leak-into-shared-operationa.md`
(APPROVED WITH CONDITIONS).

## Story 1: Ordinary test runs never read the operator's user config

As the operator, I want every ordinary Vitest run isolated from my `~/.ai-conductor/config.yml` so
that my OTel exporter, provider choice and owner identity never configure a test fixture.

### Acceptance Criteria

#### Happy Path

- Given an ordinary test run and a real home user config that declares an otlp `otel` block, when a fixture project with no `otel` block of its own loads its merged config, then the resolved OTel config is disabled.
- Given an ordinary test run, when a test reads or writes user config through the user-config commands without naming an explicit path, then the read and write use a run-scoped directory beneath the run's temp root and the real home user config is neither read nor modified.
- Given an ordinary test run that spawns a daemon or CLI child process inheriting the test environment, when that child loads merged config, then it reads the same run-scoped user-config location and not the real home user config.

#### Negative Paths

- Given an ordinary test run in which a test has deleted the `AI_CONDUCTOR_NO_REAL_EXEC` marker, when a fixture project loads its merged config, then the user config is still read from the run-scoped location and the real home user config is not read.
- Given the user-config location override names a directory that contains no config file, when merged config is loaded, then the user layer is treated as empty and the loader does not fall back to the real home user config.
- Given the user-config location override is set to an empty or whitespace-only value, when merged config is loaded, then the location resolves to the default home path exactly as when the override is unset.
- Given a test that needs specific user-config content, when it seeds that content, then it writes into the run-scoped location and the seeded values appear beneath the fixture's project config in merged order.

### Done When

- [ ] A test proves that with a planted home user config carrying an otlp block, a fixture's merged config resolves OTel disabled under the standard test setup.
- [ ] A test proves a child process spawned from a test inherits the run-scoped user-config location.
- [ ] A test proves an override directory without a config file yields an empty user layer and no home read.
- [ ] Test setup assigns the user-config location for the default, e2e and smoke Vitest configurations.

## Story 2: Production config resolution is unchanged

As the operator, I want the real daemon and CLI to keep reading my user config and exporting with my configured identities so that the fix does not degrade production telemetry.

### Acceptance Criteria

#### Happy Path

- Given neither the user-config location override nor the test marker is set, when merged config is loaded, then the user layer is read from `~/.ai-conductor/config.yml` and merged beneath project config exactly as before.
- Given a real daemon with an otlp `otel` block and configured `project_name` and `worker_name`, when it wires daemon metrics, then OTLP exporters are built and the exported resource carries the configured project and worker identities.

#### Negative Paths

- Given neither variable is set and the configured OTLP endpoint is unreachable, when the daemon exports, then behavior matches today's export-failure handling and the run is not failed.
- Given the smoke opt-in variable is set while the test marker is not set, when OTel exporters are built, then export behaves exactly as when the opt-in is unset.

### Done When

- [ ] A test with no override and no marker proves the user config path resolves to the home default and merge order is unchanged.
- [ ] A test proves OTLP exporters are built for an otlp config when the marker is absent, regardless of the opt-in variable.

## Story 3: OTLP network export is refused under the test marker

As the operator, I want any OTLP export attempted during an ordinary test run refused at the exporter boundary so that no config path, including the repository's own config, can reach a shared backend from a test.

### Acceptance Criteria

#### Happy Path

- Given the test marker is set and the smoke opt-in is not, when an otlp OTel config reaches daemon metrics wiring, interactive metrics wiring or the trace visualizer, then no OTLP network exporter is constructed and no network connection is attempted.
- Given the test marker is set and an OTLP export is refused, when the wiring completes, then exactly one `renderer_error` event from the `otel` renderer is emitted per refused wiring, naming the `AI_CONDUCTOR_NO_REAL_EXEC` marker and the `AI_CONDUCTOR_OTEL_SMOKE` opt-in, and the run continues.
- Given the test marker is set and the OTel config uses the file exporter, when telemetry is emitted, then it is written to the configured file as today.

#### Negative Paths

- Given the test marker is set and a test loads config from the live repository root whose project config declares an otlp exporter, when OTel is wired, then the export is refused and no network connection is attempted.
- Given the test marker is set and the otlp config selects the grpc protocol, when exporters are built, then the grpc export is refused the same way as http/protobuf.
- Given the test marker is set and a downstream layer such as batching or a durable spool wraps the exporter, when telemetry is flushed, then no OTLP request leaves the process.
- Given a planted home user config whose otlp endpoint points at a local fake collector, when an ordinary daemon fixture runs end to end under the standard test setup, then the fake collector receives zero requests.

### Done When

- [ ] Tests prove refusal for each of the three wiring entry points with http/protobuf and grpc configs.
- [ ] A test asserts exactly one `renderer_error` naming both variables per refused wiring, and that the run does not fail.
- [ ] A test proves the file exporter still writes under the marker.
- [ ] An integration test with a local fake OTLP receiver proves a daemon fixture sends it zero requests.

## Story 4: Shared-backend export from tests is explicit, smoke-only opt-in

As the operator, I want a test that intentionally exports to a real collector to say so explicitly and stay out of default verification so that smoke coverage of export remains possible without leaking from ordinary runs.

### Acceptance Criteria

#### Happy Path

- Given the test marker and `AI_CONDUCTOR_OTEL_SMOKE=1` are both set, when an otlp config is wired, then OTLP exporters are constructed and export proceeds as in production.
- Given the default, e2e and acceptance Vitest tiers, when they run, then none of them sets the smoke opt-in.
- Given an ordinary test that supplies exporter construction with an explicit environment lacking the test marker and points an otlp config at a loopback receiver the test itself started, when it exports, then the receiver gets the request with the configured headers and the test process environment is left unchanged.

#### Negative Paths

- Given a test file outside the smoke tier references the smoke opt-in variable, when the default test suite runs, then a guard test fails naming that file.
- Given the smoke opt-in is set to any value other than `1`, when exporters are built under the test marker, then the export is refused as if the opt-in were unset.
- Given exporter construction is called with an explicit environment that still carries the test marker and no opt-in, when exporters are built, then the export is refused exactly as with the process environment.
- Given exporter construction is called without an explicit environment, when exporters are built, then the refusal decision reads the process environment.

### Done When

- [ ] A test proves exporters are constructed under the marker only when the opt-in equals `1`.
- [ ] A mechanical check fails when a non-smoke test file references `AI_CONDUCTOR_OTEL_SMOKE`, and passes on the current tree.
- [ ] The existing authenticated-export loopback integration test and the transport construction tests pass under the standard test setup by supplying an explicit environment, without deleting the process-level test marker.
