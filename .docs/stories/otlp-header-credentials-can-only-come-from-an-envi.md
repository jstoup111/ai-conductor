**Status:** Accepted

# Stories: OTLP header credentials from a command via a shared credential-reference resolver

Track: technical

Tier: M

Governing decision: adr-2026-10-28-shared-credential-reference-resolver. Scope: a shared credential-reference resolver with `env` and `command` sources, consumed by `otel.headers` on both spooled and direct OTLP/HTTP export. Other credential consumers are not migrated.

## Story 1: Send an OTLP header whose value comes from a command

As an operator whose OTLP token lives in a plist or keychain, I want a header's value to come from a command's output so that I can export to an authenticated endpoint without copying the token into an environment variable.

### Acceptance Criteria

#### Happy Path

- Given an otlp otel block whose `authorization` header is `{ command: [<cmd>, <args>], prefix: "Bearer " }` and a command that prints `tok-123` followed by a newline, when a span is exported to a loopback OTLP/HTTP receiver, then the request carries `authorization: Bearer tok-123`.
- Given the same header with no `prefix`, when a span is exported, then the request carries the command's stdout with trailing whitespace removed and nothing prepended.
- Given a command argument that begins with `~/`, when the command runs, then that argument is passed with the leading `~` replaced by the value of `HOME`, and an argument containing `~` anywhere else is passed unchanged.
- Given a command argument containing shell syntax such as `$(id)`, a pipe character or a `;`, when the command runs, then the argument reaches the program as that literal text and no shell interprets it.
- Given the command header in the project config rather than the user config, when the config is resolved, then it is accepted exactly as from the user config.
- Given an otlp otel block with spooling enabled and a command header, when a spooled batch is delivered, then the POST carries the command-derived header value.
- Given an otel block whose headers are all `{ env: <name> }` references that are set, when the config is resolved and a span is exported, then the result and the request headers are the same as before this change.

#### Negative Paths

- Given a command header whose program does not exist, when a span is exported, then no request reaches the receiver and the export is reported as failed.
- Given an otlp otel block with a command header and an `env` header whose variable is unset, when the config is resolved, then otel is disabled with the existing error naming the `env` header and its variable, and the command is never run.
- Given a command header, when only the config is resolved and nothing is exported, then the command is never run.

### Done When

- [ ] A loopback-receiver test proves a spooled delivery and a direct export each carry `Bearer tok-123` from a stub command.
- [ ] A unit case proves trailing-whitespace trimming with and without `prefix`.
- [ ] A unit case proves leading-`~/` expansion and that a non-leading `~` and shell syntax arrive as literal argv text.
- [ ] A unit case proves a command header in project config resolves enabled.
- [ ] A unit case proves config resolution alone never invokes the command runner.

## Story 2: Refuse a malformed command reference by name

As an operator, I want a mistyped command reference refused at config load with an error that names it so that a typo does not show up later as a silent authentication failure.

### Acceptance Criteria

#### Happy Path

- Given a header `{ command: [<cmd>], prefix: "Bearer ", cache_seconds: 60 }`, when the config is resolved, then it is enabled with no error and no warning.

#### Negative Paths

- Given a header whose `command` is a string instead of a list, when the config is resolved, then otel is disabled with an error naming the header and stating that `command` must be a non-empty list of strings.
- Given a header whose `command` is an empty list or contains a non-string or empty-string element, when the config is resolved, then otel is disabled with an error naming the header and the same list-of-strings requirement.
- Given a header whose `prefix` is not a string, when the config is resolved, then otel is disabled with an error naming the header and the `prefix` key.
- Given a header whose `cache_seconds` is zero, negative, fractional or not a number, when the config is resolved, then otel is disabled with an error naming the header and stating that `cache_seconds` must be a positive integer.
- Given a header that has both `env` and `command`, or a `command` reference with any key other than `command`, `prefix` and `cache_seconds`, when the config is resolved, then otel is disabled with an error naming the header and listing the supported reference forms.
- Given a command header together with the grpc protocol or the file exporter, when the config is resolved, then otel is disabled with the existing unsupported-combination error naming that header.
- Given a header whose value is a literal string, when the config is resolved, then otel is disabled with the existing literal-credential refusal, and that error also names the `command` form as supported.

### Done When

- [ ] Unit cases cover a string `command`, an empty list, a non-string element and an empty-string element, each disabled with an error naming the header.
- [ ] Unit cases cover a non-string `prefix` and a zero, negative, fractional and non-numeric `cache_seconds`, each disabled by name.
- [ ] Unit cases cover a mixed `env`-and-`command` reference and an unknown key, each listing the supported forms.
- [ ] Unit cases prove a command header with grpc and with the file exporter is refused naming the header.
- [ ] The test-side config consumer declaration covers the new reference keys and its totality test passes.

## Story 3: Pick up a rotated credential without a restart

As an operator whose token rotates, I want a new value used soon after it changes so that export keeps working without restarting the daemon.

### Acceptance Criteria

#### Happy Path

- Given a command header with no `cache_seconds`, when two exports happen 299 seconds apart, then the command runs once and both requests carry the first value.
- Given a command header with no `cache_seconds` whose output changes from `tok-1` to `tok-2`, when an export happens 300 or more seconds after the first resolution, then the command runs again and that request carries `tok-2`.
- Given a command header with `cache_seconds: 60`, when exports happen 59 and then 61 seconds after the first resolution, then the first reuses the cached value and the second runs the command again.
- Given an `env` header whose variable changes value while the process runs, when the next spooled delivery happens, then it carries the new value.

#### Negative Paths

- Given an expired cached value and five exports that request headers at the same time, when the command takes one second to finish, then the command runs exactly once and all five requests carry its output.
- Given a command that fails once and then succeeds, when two consecutive exports happen inside the cache window, then the first is reported as failed and the second runs the command again and carries its output.

### Done When

- [ ] A unit case with an injected clock proves the 300-second default reuse and re-run boundary.
- [ ] A unit case with an injected clock proves a configured `cache_seconds: 60` boundary.
- [ ] A unit case proves five concurrent resolutions during one refresh invoke the command runner exactly once.
- [ ] A unit case proves a failed resolution is not cached and the next resolution runs the command again.
- [ ] A spool-drainer case proves a changed environment variable reaches the next POST.

## Story 4: A credential failure blocks the send and is reported once

As an operator, I want a broken credential command to stop unauthenticated sends and tell me which header and command failed so that I can fix it without losing telemetry.

### Acceptance Criteria

#### Happy Path

- Given a spooled otlp export whose command header starts failing, when delivery is attempted, then no POST is sent, the batch stays in the spool, and one `renderer_error` event with `rendererName: 'otel'` names the header and the command.
- Given that failing command recovers, when the next delivery attempt succeeds, then the spooled batch is delivered with the new value and the existing delivery-recovered `renderer_error` is emitted once.

#### Negative Paths

- Given a command that exits non-zero, when headers are requested, then the result is a failure naming the header, the command and the exit code, and no request is sent.
- Given a command that prints only whitespace, when headers are requested, then the result is a failure naming the header and the command and stating the output was empty, and no request is sent.
- Given a command that has not finished after 10 seconds, when headers are requested, then the command is stopped, the result is a failure naming the header, the command and the timeout, and no request is sent.
- Given a command that keeps failing across ten spooled delivery attempts, when the events are inspected, then exactly one credential `renderer_error` was emitted for that signal and the attempts follow the drainer's existing backoff.
- Given a drainer that has already emitted a network-class `renderer_error` for a signal, when that signal's command header then fails, then one new `renderer_error` names the header and the command, and the next `otel_spool_backlog` event's `lastFailureClass` is one of its existing values.
- Given direct export without spooling and a failing command header, when a span batch is exported, then the exporter's result is failed, no request reaches the receiver, and no unhandled promise rejection occurs.
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1`, when a command header is resolved, then the command is not executed and the result is a failure naming the header and the kill-switch.

### Done When

- [ ] A spool-drainer case with a failing stub command proves no POST, the batch retained, and a single `renderer_error` naming header and command.
- [ ] A spool-drainer case proves recovery delivers the retained batch and emits the delivery-recovered event once.
- [ ] A spool-drainer case proves a credential failure after a network-class warning emits its own `renderer_error` and leaves `lastFailureClass` within its existing values.
- [ ] Unit cases cover non-zero exit, whitespace-only output and a timeout, each a failure naming the header and command.
- [ ] A loopback-receiver test proves the direct exporter returns a failed result with zero received requests and no unhandled rejection.
- [ ] A unit case proves the command runner is never invoked under `AI_CONDUCTOR_NO_REAL_EXEC=1`.

## Story 5: Keep credential values out of every diagnostic and file

As an operator, I want the credential value and command output never to appear in errors, events or spool files so that a log or bug report cannot leak my token.

### Acceptance Criteria

#### Happy Path

- Given a command that prints a distinctive sentinel value and succeeds, when spans are exported and spooled, then no file in the spool directory and no emitted event contains the sentinel.
- Given the parsed otel block after resolution, when it is inspected, then it contains the header names, the command argv and the prefix, and no resolved value.

#### Negative Paths

- Given a command that prints the sentinel on stdout and a second sentinel on stderr, then exits non-zero, when the failure is reported, then neither sentinel appears in the failure reason or the `renderer_error` event.
- Given every header-related config error from Story 2 produced while a command would print a sentinel, when the error text is inspected, then it never contains the sentinel.

### Done When

- [ ] A test asserts the sentinel is absent from every spool file and every captured event after a successful spooled export.
- [ ] A unit case asserts the resolved config object carries no resolved value.
- [ ] A unit case asserts neither stdout nor stderr sentinels reach the failure reason or event.
- [ ] A unit case asserts no Story 2 error string contains the sentinel.

## Story 6: Resolve credential references through a shared module

As a harness maintainer, I want credential references parsed and resolved by one shared module so that other credential settings can adopt the same sources later without re-implementing execution, caching and redaction.

### Acceptance Criteria

#### Happy Path

- Given an `{ env: <name> }` reference and an `{ command: [...] }` reference, when a caller outside the otel module parses and resolves them through the shared credential module, then each returns its value without any otel configuration involved.
- Given a resolvable reference, when it is resolved, then the result is a value result; given an unresolvable one, then the result is an unavailable result carrying a value-free reason, and neither case throws.

#### Negative Paths

- Given a malformed reference of any Story 2 shape, when the shared parser is called directly, then it returns a named error and does not throw.
- Given an `env` reference whose variable is unset or empty, when it is resolved through the shared module, then the result is unavailable naming the variable.

### Done When

- [ ] Unit cases call the shared parser and resolver directly, with no otel import, for both source kinds.
- [ ] A unit case proves the parser returns a named error without throwing for each malformed shape.
- [ ] A unit case proves an unset `env` reference resolves to unavailable naming the variable.

## Negative-category review

Invalid input: Story 2 and Story 6 cover every malformed reference shape. Timeouts and dependency unavailability: Story 4 covers a missing program, non-zero exit, empty output and the 10-second timeout. Concurrent access: Story 3 covers concurrent resolution during one refresh. Partial failure: Story 1 covers a set command header beside an unset env header, and Story 4 covers no partial send when one header fails. Information disclosure: Story 5 covers sentinel values in files, events, errors and command output. Invariant side effects on alternate branches: Story 4 covers both the spooled and direct paths and the test kill-switch. Command injection: Story 1 covers shell syntax arriving as literal argv. Auth failures of the remote endpoint keep the existing export classification and are outside this slice. No deletion, datastore, migration, upload or transaction is introduced, so those categories do not apply.
