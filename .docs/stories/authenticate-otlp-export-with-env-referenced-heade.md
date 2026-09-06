**Status:** Accepted

# Stories: Authenticate OTLP export with env-referenced headers (#1939)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is one `otel.headers` key carrying environment-variable references, their resolution at config load, header attachment on the HTTP OTLP transport, named refusals for literal or malformed references, and the reference documentation. Additional secret sources, gRPC credential carriage, and authentication-specific classification of an unauthorized export response remain outside this slice.

## Story 1: Reach an authenticated OTLP endpoint from configuration alone

### Acceptance Criteria

#### Happy Path

- Given an otlp otel block with an endpoint and a header entry naming an environment variable that is set, when the config is resolved, then the result is enabled and carries that header name with the variable's value.
- Given a resolved otlp config carrying headers, when the HTTP exporters are built and a span is exported, then the request to the configured endpoint carries every configured header with its resolved value.
- Given an otel block with no header entries, when the config is resolved and the exporters are built, then the resolved fields and the constructed exporters are unchanged from the current behavior and no header is attached.

#### Negative Paths

- Given a header entry whose referenced environment variable is unset or empty, when the config is resolved, then otel is disabled with an error naming the header key and the variable name.

### Done When

- [ ] A unit case proves a set environment reference resolves to that header's value on the enabled otlp result.
- [ ] An integration case proves the constructed HTTP span exporter sends the configured header to a loopback OTLP endpoint.
- [ ] A unit case proves an otel block without header entries resolves and builds exactly as it does today.
- [ ] A unit case proves an unset or empty referenced variable disables otel with an error naming the header key and the variable.

## Story 2: Refuse a literal or malformed credential by name

### Acceptance Criteria

#### Happy Path

- Given a header mapping in which every value is a well-formed environment reference, when the config is resolved, then it is accepted with no error and no warning.

#### Negative Paths

- Given a header entry whose value is a literal string rather than a reference, when the config is resolved, then otel is disabled with an error naming the header key and stating that a literal credential in configuration is refused.
- Given a header entry whose reference object has an unknown key, no key, or a non-string variable name, when the config is resolved, then otel is disabled with an error naming the header key and the supported reference form.
- Given a header block that is not a mapping, or a header name that is empty or contains a control character, when the config is resolved, then otel is disabled with an error naming the offending key.
- Given header entries configured together with the grpc protocol or with the file exporter, when the config is resolved, then otel is disabled with an error naming that combination as unsupported.

### Done When

- [ ] Unit cases cover a literal value, an unknown reference key, an absent reference key, and a non-string variable name, each disabled with its own named error.
- [ ] Unit cases cover a non-mapping header block, an empty header name, and a header name containing a control character, each disabled by name.
- [ ] Unit cases prove header entries with the grpc protocol and with the file exporter are each refused with an error naming the unsupported combination.
- [ ] The test-side config consumer declaration covers the new key and its totality test passes.

## Story 3: Keep credential values out of configuration and diagnostics

### Acceptance Criteria

#### Happy Path

- Given a credential supplied through an environment reference, when its value changes in the environment, then the same unchanged configuration resolves to the new header value.
- Given the parsed otel block used to resolve the config, when it is inspected after resolution, then it contains the header name and the variable name and no credential value.
- Given an operator reads the otel reference documentation, when they look for how a credential is supplied, then the reference form, its one supported source, the refusals, and the excluded sources are stated alongside the other otel keys.

#### Negative Paths

- Given any header-related resolution error while the referenced variable holds a distinctive sentinel value, when the error text is inspected, then it names the header key and the variable and never contains the sentinel value.

### Done When

- [ ] A unit case proves the same configuration object resolves to a different header value after the environment variable changes.
- [ ] A unit case asserts the parsed otel block carries no credential value after resolution.
- [ ] A unit case asserts every header-related error string contains the variable name and never the value that variable holds.
- [ ] The reference documentation describes the reference form, the supported source, the refusals, and the excluded sources.

## Negative-category review

Input integrity is covered by the literal-value, unknown-reference-key, absent-key, non-string-name, non-mapping, empty-name, and control-character cases. Missing dependency is covered by the unset and empty environment variable cases. Unsupported configuration combination is covered by the grpc-protocol and file-exporter cases. Information disclosure is covered by the sentinel-value assertions on every error string and on the parsed block. No deletion, queue, datastore, upload, migration, concurrency, or transaction is introduced, so those categories are inapplicable. Transport-time failures keep the existing bounded export warning, whose coverage remains authoritative; classifying an unauthorized response specifically is excluded from this slice.
