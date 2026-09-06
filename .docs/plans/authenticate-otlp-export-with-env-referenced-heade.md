# Implementation Plan: Authenticate OTLP export with env-referenced headers

**Date:** 2026-09-06
**Stories:** .docs/stories/authenticate-otlp-export-with-env-referenced-heade.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing otel contract — one additive key, resolution inside the function that already owns every otel key, and the block's established disabled-with-a-named-error failure mode.

## Summary

Four bounded tasks deliver #1939 by letting the otel block carry a reference to a credential instead of the credential. A new `headers` key maps a header name to an environment-variable reference; resolution happens at config load in the function that already owns every otel key; the resolved values are attached to the two HTTP OTLP exporters. Additional secret sources, gRPC credential carriage, and authentication-specific classification of an unauthorized export response are outside this small slice.

## Technical Approach

Add `headers` to the otel config type as a mapping from header name to a reference object of the shape `{ env: <variable name> }`. Add the key to the engine's accepted otel key list and declare its consumer in the test-side config consumer registry, which is total over accepted keys and fails for an undeclared one.

Resolve inside `resolveOtelConfig`, which already owns every otel key and never throws. Absent or empty header mapping resolves exactly as today, with no `headers` field on the result, so existing behavior is byte-identical for every current configuration. A present mapping is validated key by key: the header name must be a non-empty string with no control character; the value must be a plain object whose only key is `env` and whose value is a non-empty string; the named variable must be present and non-empty in the process environment. Each failure returns the block's established disabled result with an error naming the offending header key, and the variable name where one was parsed, and never the value that variable holds. Because the header carriage under this slice is an HTTP-only option, a present mapping combined with the grpc protocol, or with the file exporter, is refused by name rather than silently ignored.

A string value under the mapping is the plaintext case and is refused with its own message: configuration carries a reference, never a literal. This is the mechanical form of the operator's stated requirement, and it makes the insecure path impossible rather than merely discouraged.

The enabled otlp result gains an optional `headers` record of resolved values. That record is the only place a credential exists in harness memory; it is built at load, handed to the exporter constructors, and never persisted — the visualizer keeps the constructed exporters rather than the resolved config, and nothing under the otel directory serializes it. The configuration file itself, which is what gets committed and echoed for diagnosis, holds only the header name and the variable name.

Attach the resolved record in `buildExporters`, which currently passes only a URL. Extract the per-signal HTTP option object into one small exported helper so the option shape is directly assertable at unit level, then pass that object to both HTTP constructors. The gRPC branch is untouched: at the installed exporter version the gRPC option type omits headers and models credentials as gRPC metadata, which is why that combination is refused at load instead of quietly dropped.

Prove wire delivery once, at integration level, with a loopback HTTP listener standing in for the collector: build the exporters through the production factory, export one real ended span produced by the SDK's own tracer, and assert the received request headers. This is a faithful fake at the third-party boundary, not a third-party call; no test reaches a real collector, LLM, or network host. The listener binds an ephemeral port and is closed in a finally path, and the export callback is awaited rather than waited on.

Documentation is part of the same change: the reference page's otel table and prose gain the new key, the reference form, its one supported source, every refusal, and the sources this slice deliberately excludes, so the mechanism is not an undocumented side channel.

## Preconditions and claim ledger

- Operator approved Small scope, the reference-only shape, the single environment source, technical track, and all three stories on 2026-09-06 (delegated).
- Verified: the enabled otlp result carries `endpoint`, `protocol`, and `projectName` only, with no credential field, and the resolver never throws — every invalid config becomes a disabled result plus a named error string.
- Verified: `buildExporters` passes only a URL to all four OTLP exporters and adds no header, token, or TLS option.
- Verified: at the installed exporter version the HTTP option type accepts a headers record or a headers factory, while the gRPC option type omits headers entirely and carries gRPC metadata instead.
- Verified: the engine's accepted otel key list enumerates exactly the five current keys, and the test-side consumer registry declares each of them individually with a totality test that throws for an accepted-but-undeclared key.
- Verified: the reference page's otel table lists exactly those five keys and records the block's silent-disable-with-an-error-string failure mode.
- Verified: the visualizer stores the constructed exporters and a project-name override rather than the resolved config object, and no file under the otel directory serializes that object.
- Verified: both production callers of the resolver test only the enabled flag and discard the error string, so error strings reach no operator surface today; that gap applies to every otel error, predates this change, and is excluded here.
- Verified: no test under the conductor test tree starts a loopback HTTP listener today, so the integration proof introduces that pattern deliberately and owns its teardown.
- Verified: the protocol key remains unvalidated, tracked separately as #1026; this slice adds a refusal only for the header-plus-grpc combination and does not change that.
- Scope check: A — consumer-facing shipped engine configuration; B — n/a, no new skill; C — provider-agnostic. Event-spine: no new event, metric, span, log line, or report; export failures keep the existing bounded renderer warning on the current spine.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; the one deferred product decision — which additional secret sources to support — is recorded as excluded rather than assumed.

## Tasks

### Task 1: Accept and resolve environment-referenced OTLP headers
**Story:** Story 1
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/types/config.ts, src/conductor/src/engine/config.ts, src/conductor/src/engine/otel/otel-config.ts, src/conductor/test/engine/otel/otel-config.test.ts, src/conductor/test/engine/config-consumer-registry.ts
**Dependencies:** none

**Steps:**
1. Write unit cases for a set reference resolving to its value, a second resolution after the variable changes, an unchanged result when no mapping is present, and a disabled result naming the header key and variable when the variable is unset or empty.
2. Establish RED, then add the header mapping and reference types to the otel config type and add the key to the engine's accepted otel key list.
3. Implement resolution inside the existing resolver: absent or empty mapping leaves the result exactly as today; a present mapping produces a record of resolved values on the enabled otlp result; every failure returns the established disabled result with a named error.
4. Declare the new key's consumer in the test-side registry so its totality test passes, and assert the parsed otel block still holds only the header name and the variable name after resolution.
5. Run the focused otel-config and consumer-registry tests through the project's narrowest invocation, then its typecheck target that includes tests, and commit.

**Done when:**
1. A set environment reference resolves to that header's value on the enabled otlp result, and the same configuration yields a different value after the variable changes.
2. An otel block with no header mapping resolves to exactly the fields it resolves to today, with no headers field present.
3. An unset or empty referenced variable disables otel with an error naming the header key and the variable name and containing no value.
4. The consumer registry declares the new key and its totality test passes unchanged otherwise.
5. The parsed otel block used for resolution carries the header name and variable name and no credential value.

### Task 2: Refuse a literal or malformed credential reference by name
**Story:** Story 2
**Story:** Story 3 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/otel/otel-config.ts, src/conductor/test/engine/otel/otel-config.test.ts
**Dependencies:** 1

**Steps:**
1. Write unit cases for a literal string value, a reference object with an unknown key, one with no key, one whose variable name is not a string, a mapping that is not an object, an empty header name, a header name containing a control character, a mapping with the grpc protocol, and a mapping with the file exporter.
2. Add a case that sets the referenced variable to a distinctive sentinel and asserts no produced error string contains that sentinel.
3. Establish RED, then implement the refusals in the resolver, each returning the established disabled result with an error naming the offending header key and, where parsed, the variable name.
4. Add the accepted counterpart case proving a well-formed mapping resolves with no error and no warning, so the refusals cannot pass by rejecting everything.
5. Run the focused otel-config tests and the typecheck target that includes tests, then commit.

**Done when:**
1. A literal string value is refused with an error naming the header key and stating that a literal credential in configuration is refused.
2. An unknown reference key, an absent reference key, a non-string variable name, a non-mapping header block, an empty header name, and a header name containing a control character are each refused with an error naming the offending header key.
3. A mapping combined with the grpc protocol and a mapping combined with the file exporter are each refused with an error naming the unsupported combination.
4. No error string produced for any of these cases contains the sentinel value held by the referenced variable.
5. A well-formed mapping resolves enabled with no error and no warning.

### Task 3: Attach resolved headers to the HTTP OTLP exporters
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/otel/transport.ts, src/conductor/test/engine/otel/transport.test.ts, src/conductor/test/integration/otel-authenticated-export.test.ts
**Dependencies:** 1

**Steps:**
1. Write unit cases against a new exported option helper in the transport module: the trace and metric option objects carry the resolved headers when present and carry no headers property when absent, with the existing URL suffixes unchanged.
2. Establish RED, then extract the per-signal HTTP option object into that helper and pass it to both HTTP exporter constructors. Leave the gRPC branch and the file branch untouched.
3. Add the new integration file named above, which starts a loopback HTTP listener on an ephemeral port, resolves a config whose endpoint points at it, builds exporters through the production factory, exports one real ended span produced by the SDK tracer, and asserts the received request headers.
4. Close the listener in a finally path and await the export callback rather than sleeping; assert the received header value matches the environment value and that the request reached the traces path.
5. Run the focused transport and integration tests and the typecheck target that includes tests, then commit.

**Done when:**
1. The trace and metric HTTP option objects carry every resolved header, and carry no headers property when the resolved config has none.
2. The existing URL suffixes, the gRPC branch, and the file branch are unchanged by this task's diff.
3. The loopback integration proves a request from the constructed HTTP span exporter arrives carrying the configured header with its resolved value.
4. The integration binds an ephemeral port, awaits the export result, and closes its listener in a finally path with no timer-based waiting.

### Task 4: Document the credential surface with the other otel keys
**Story:** Story 3
**Type:** happy-path
**Files:** docs/reference/configuration.md
**Dependencies:** 1, 2, 3

**Steps:**
1. Add the new key to the otel key table with its type, when it is allowed, and its default of absent.
2. Add prose stating the reference form, that the value is read from the process environment at config load, and that a literal credential in configuration is refused rather than accepted.
3. Enumerate the named refusals next to the block's existing unknown-exporter and missing-endpoint examples, in the same silent-disable-with-an-error-string shape.
4. State the exclusions plainly: one supported source in this slice, no gRPC credential carriage, and no authentication-specific classification of an unauthorized export response.
5. Run the repository's documentation navigation and integrity checks, then commit.

**Done when:**
1. The otel key table lists the new key with its type, requirement, allowed shape, and default.
2. The prose states the reference form, the environment source read at load, and the refusal of a literal credential.
3. The documented refusal list matches the errors the resolver actually returns.
4. The excluded sources and the excluded gRPC and unauthorized-response behaviors are stated so the mechanism is not read as broader than it is.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an otlp otel block with an endpoint and a header entry naming an environment variable that is set, when the config is resolved, then the result is enabled and carries that header name with the variable's value. | 1 | "A set environment reference resolves to that header's value on the enabled otlp result, and the same configuration yields a different value after the variable changes." | diff-local |
| Story 1 happy: Given a resolved otlp config carrying headers, when the HTTP exporters are built and a span is exported, then the request to the configured endpoint carries every configured header with its resolved value. | 3 | "The loopback integration proves a request from the constructed HTTP span exporter arrives carrying the configured header with its resolved value." | diff-local |
| Story 1 happy: Given an otel block with no header entries, when the config is resolved and the exporters are built, then the resolved fields and the constructed exporters are unchanged from the current behavior and no header is attached. | 1, 3 | "An otel block with no header mapping resolves to exactly the fields it resolves to today, with no headers field present." | diff-local |
| Story 1 negative: Given a header entry whose referenced environment variable is unset or empty, when the config is resolved, then otel is disabled with an error naming the header key and the variable name. | 1 | "An unset or empty referenced variable disables otel with an error naming the header key and the variable name and containing no value." | diff-local |
| Story 2 happy: Given a header mapping in which every value is a well-formed environment reference, when the config is resolved, then it is accepted with no error and no warning. | 2 | "A well-formed mapping resolves enabled with no error and no warning." | diff-local |
| Story 2 negative: Given a header entry whose value is a literal string rather than a reference, when the config is resolved, then otel is disabled with an error naming the header key and stating that a literal credential in configuration is refused. | 2 | "A literal string value is refused with an error naming the header key and stating that a literal credential in configuration is refused." | diff-local |
| Story 2 negative: Given a header entry whose reference object has an unknown key, no key, or a non-string variable name, when the config is resolved, then otel is disabled with an error naming the header key and the supported reference form. | 2 | "An unknown reference key, an absent reference key, a non-string variable name, a non-mapping header block, an empty header name, and a header name containing a control character are each refused with an error naming the offending header key." | diff-local |
| Story 2 negative: Given a header block that is not a mapping, or a header name that is empty or contains a control character, when the config is resolved, then otel is disabled with an error naming the offending key. | 2 | "An unknown reference key, an absent reference key, a non-string variable name, a non-mapping header block, an empty header name, and a header name containing a control character are each refused with an error naming the offending header key." | diff-local |
| Story 2 negative: Given header entries configured together with the grpc protocol or with the file exporter, when the config is resolved, then otel is disabled with an error naming that combination as unsupported. | 2 | "A mapping combined with the grpc protocol and a mapping combined with the file exporter are each refused with an error naming the unsupported combination." | diff-local |
| Story 3 happy: Given a credential supplied through an environment reference, when its value changes in the environment, then the same unchanged configuration resolves to the new header value. | 1 | "A set environment reference resolves to that header's value on the enabled otlp result, and the same configuration yields a different value after the variable changes." | diff-local |
| Story 3 happy: Given the parsed otel block used to resolve the config, when it is inspected after resolution, then it contains the header name and the variable name and no credential value. | 1 | "The parsed otel block used for resolution carries the header name and variable name and no credential value." | diff-local |
| Story 3 happy: Given an operator reads the otel reference documentation, when they look for how a credential is supplied, then the reference form, its one supported source, the refusals, and the excluded sources are stated alongside the other otel keys. | 4 | "The prose states the reference form, the environment source read at load, and the refusal of a literal credential." | diff-local |
| Story 3 negative: Given any header-related resolution error while the referenced variable holds a distinctive sentinel value, when the error text is inspected, then it names the header key and the variable and never contains the sentinel value. | 2 | "No error string produced for any of these cases contains the sentinel value held by the referenced variable." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures; no aggregate, external-service, or provider-backed test is required. Task 1 owns the resolution unit cases and the consumer-registry declaration. Task 2 owns every refusal unit case and the sentinel-redaction assertions. Task 3 owns the transport option unit cases and the single loopback integration that proves wire delivery; it is the only test in this change that opens a socket, it binds an ephemeral local port, and it closes it in a finally path. Task 4 owns the documentation and is verified by the repository's own documentation and integrity checks rather than by a new test. Existing otel transport, visualizer, and warning-wiring tests supply the unchanged behavior baseline; no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 2 -> Task 4
Task 3 -> Task 4
