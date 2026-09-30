**Status:** Accepted
**Approved by:** Operator in composer chat, 2026-09-30

# Stories: Configurable harness log export

**Source:** [#1935](https://github.com/jstoup111/ai-conductor/issues/1935)
**Product authority:** [Approved PRD](../specs/harness-logs-have-no-export-path-daemon-log-is-a-f.md), FR-1–FR-11.
**Architecture authority:** [ADR-014](../decisions/adr-014-otel-observability-exporter.md), operator-approved D18–D21; [full review](../decisions/architecture-review-2026-09-30-configurable-harness-log-export.md).
**Build prerequisite:** [#2870](https://github.com/jstoup111/ai-conductor/issues/2870) completes the already-specified durable transport. These stories extend that delivery behavior to logs, without assigning its implementation to this feature.

## Story 1: Explicitly consent to log sending across both execution modes

**Requirement:** FR-1

As a harness operator, I want a separate default-off log control so that enabling existing telemetry never sends logs without my consent.

### Acceptance Criteria

#### Happy Path
- Given a valid canonical project configuration with `otel.logs.enabled: true` and an HTTP log destination, when a daemon or interactive configured run emits operational logs, then those logs can be sent to that destination using the same project policy.
- Given a user-level log policy and a project-level override, when either mode starts from the main checkout or a linked worktree, then project values override user values and every checkout uses the canonical main project's resulting log policy.
- Given enabled logs were previously retained, when a later invocation has the same enabled destination policy, then those retained logs are eligible for delivery.

#### Negative Paths
- Given trace/metric telemetry is enabled and `otel.logs.enabled` is absent or false, when either mode runs or finds retained logs, then it sends zero log requests and leaves retained log batches unsent.
- Given a running sender and retained batches, when the canonical log policy changes to false, becomes unreadable, or becomes invalid before the next send, then no new log request starts under that policy; already-issued requests are not claimed to be retractable.
- Given a differing worktree-local log policy, when a run starts from that worktree, then it cannot override main-project consent or destination and one local warning names the canonical configuration path.
- Given logs were disabled when events occurred, when logs are enabled and the run is restarted, then only newly captured events and previously authorized retained batches are eligible; disabled-time output and historical local files are not replayed.

### Done When
- [ ] Captured network-boundary evidence shows zero log requests for both entry modes with omitted/false enablement, including a nonempty retained backlog.
- [ ] A linked-worktree fixture demonstrates canonical project precedence and no send after consent revocation.
- [ ] A restarted enabled fixture distinguishes authorized retained records from output created while disabled.

## Story 2: Receive equivalent operational coverage from daemon and interactive runs

**Requirement:** FR-2

As a harness operator, I want lifecycle messages and diagnostics from both modes so that either mode explains what happened during a run.

### Acceptance Criteria

#### Happy Path
- Given enabled log sending, when a configured daemon or interactive run starts, completes a step, and finishes, then the destination receives corresponding lifecycle records with consistent field meanings.
- Given harness info, warning and error diagnostics during either run, when they are delivered, then the messages retain their source severity and operational content.
- Given daemon-wide scheduling/recovery activity and feature-owned recovery/provider execution, when each reports an operational diagnostic, then the destination receives the daemon-wide record as project-scoped and the feature-owned record with that feature's identity.

#### Negative Paths
- Given a configured run fails during startup or shutdown, when the harness reports the failure locally, then its diagnostic is eligible for the same bounded delivery attempt as other operational records without replacing the run's original result.
- Given provider transcript chunks, raw application output, or unrelated administrative command output, when those bytes are produced, then they are not added to remote operational logs by this capability.
- Given an already-exported lifecycle occurrence also appears in terminal or daemon display output, when that display is rendered, then it does not produce a second logical log record.

### Done When
- [ ] A representative path through each production entry point yields lifecycle, warning and error records at the destination boundary.
- [ ] Daemon recovery and project-wide output are present in the received sample with their distinct scopes.
- [ ] Transcript/application sentinel content and duplicate rendered lifecycle records are absent from the received sample.

## Story 3: Deliver to the four destination families through configuration

**Requirement:** FR-3

As an observability administrator, I want standard network log delivery so that I can use Loki, Elasticsearch, Sumo Logic, or Datadog without changing harness code or exposing project files.

### Acceptance Criteria

#### Happy Path
- Given a valid OTLP HTTP configuration for each of Loki, an OTLP-capable Elasticsearch deployment or compatible network collector, Sumo Logic, and Datadog, when a sample log batch is sent, then its destination receives a protobuf log request at the configured base path plus exactly one `/v1/logs` suffix with the configured authentication headers.
- Given a destination requires a network intermediary or attribute mapping, when the intermediary receives the harness request, then the decoded record contains separately available project and complete feature identity without any file scraping or checkout access.

#### Negative Paths
- Given a destination rejects authentication with 401 or 403, when delivery is attempted, then the log batch is retained under the enabled retention policy, the build continues, and the warning exposes no credential value.
- Given an incorrect base path producing 404 or an unavailable intermediary, when delivery fails, then the batch is not redirected to another destination and the error is reported locally without failing the run.
- Given a configured endpoint already ending in `/v1/logs`, when its request is constructed, then that suffix is not appended a second time.

### Done When
- [ ] A destination-contract matrix captures and decodes requests for all four configurations through the same production delivery path.
- [ ] Captured URL paths, protobuf content type and header values match each fixture's configured contract.
- [ ] The matrix uses isolated fake network boundaries and no project-filesystem mount; results are identified as protocol-contract proof rather than live vendor-account proof.

## Story 4: Query complete, correctly timed and attributed log records

**Requirement:** FR-4

As an operator, I want structured timestamps, severity, message and ownership so that I can search logs without parsing display text.

### Acceptance Criteria

#### Happy Path
- Given a feature-owned occurrence with a slug longer than the local display limit, when its log record is received, then timestamp, severity, body, project, worker, event name, feature scope and the complete slug are independently available; its timestamp remains the occurrence time even if forwarding or delivery is delayed.
- Given a project-wide occurrence and validated custom attributes, when its record is received, then it has project scope, stable project/worker resource identity and those custom attributes, and has no feature identity.

#### Negative Paths
- Given a message contains ANSI formatting or text resembling a different feature's prefix, when it is exported, then structured ownership still identifies its actual source and no identity is parsed from that text.
- Given a custom attribute collides with a conductor-owned identity field, when a record is constructed, then it cannot replace the conductor-owned value.
- Given a message exceeds the 32 KiB UTF-8 remote body limit or a required identity cannot fit the 64 KiB record limit, when it is handled, then the body is truncated with a visible truncation attribute in the first case, or the whole record is dropped and counted in the second; full identity is never truncated and local output remains complete.

### Done When
- [ ] Decoded log samples expose all required fields without message parsing and preserve an injected occurrence timestamp across delayed forwarding.
- [ ] Boundary-size samples prove marked UTF-8-safe remote truncation, complete identity, and counted rejection for an oversized required identity.
- [ ] Project-wide samples contain no fabricated feature and custom attributes cannot overwrite ownership.

## Story 5: Keep concurrent feature logs distinct without suppressing real repetitions

**Requirement:** FR-5

As an operator, I want concurrent records to retain their true owner so that interleaved work cannot be confused.

### Acceptance Criteria

#### Happy Path
- Given two concurrent daemon features with different complete slugs but identical truncated display prefixes, when their ordinary and deferred warning/error messages interleave, then every received record retains its originating complete slug.
- Given one occurrence passes through feature handling and daemon handling, when it is exported, then exactly one logical record is produced before any transport retry.

#### Negative Paths
- Given a project-wide message occurs while feature execution is active, when it is delivered, then it does not inherit the active or most recently completed feature's identity.
- Given two legitimate occurrences have identical message text, when both occur, then both are delivered as separate logical records; text matching does not suppress either.
- Given feature A finishes while feature B continues and A has already scheduled a deferred diagnostic, when that diagnostic and B's next message arrive, then each retains its original owner rather than a mutable current-feature value.

### Done When
- [ ] An interleaving fixture at the production diagnostic/forwarding boundary records the correct complete identity for ordinary, delayed and repository-wide messages.
- [ ] Received counts distinguish one forwarded occurrence from two separate occurrences with identical text.
- [ ] No claim of exactly-once network delivery is inferred from logical duplicate suppression.

## Story 6: Preserve local daemon logs and terminal output

**Requirement:** FR-6

As an operator, I want local diagnostics to remain available regardless of remote logging state so that local troubleshooting still works.

### Acceptance Criteria

#### Happy Path
- Given the same operational occurrence sequence, when it runs with logs off or on, then existing terminal output and daemon log content retain their local prefixes, complete message content, timestamps and transition suppression.
- Given daemon logs are produced during an enabled run, when the operator reads or follows them, then current log reading, following and rotation behavior continues to expose the expected local records.

#### Negative Paths
- Given invalid log-only configuration or a remote failure, when a run reports diagnostics, then local terminal and file output remain available and preserve the build's own messages.
- Given remote record truncation, queue overflow or retention eviction, when a local message is written, then no remote limit truncates or suppresses its local version.

### Done When
- [ ] Local sink captures for the same occurrence sequence match with remote logs off/on, aside from intentional additional delivery-health diagnostics.
- [ ] Targeted existing read/follow/rotation behavior is exercised with remote logging enabled.
- [ ] A long local message remains complete while its remote form is shortened or discarded.

## Story 7: Keep trace and metric behavior independent

**Requirement:** FR-7

As an operator, I want log choices and failures isolated so that working traces and metrics continue unchanged.

### Acceptance Criteria

#### Happy Path
- Given a valid trace/metric configuration, when only `otel.logs.enabled` changes, then trace and metric destination, identity, payload semantics and enablement remain unchanged.
- Given traces/metrics use gRPC, file output, or are not enabled, when logs are explicitly enabled with their own HTTP endpoint, then logs can be sent over HTTP without changing those existing signal settings.

#### Negative Paths
- Given a valid existing telemetry configuration and malformed log-only configuration, when either entry mode starts, then traces and metrics continue under their original settings while logs remain disabled with a named error.
- Given an unavailable log destination, when trace and metric batches are ready for healthy destinations, then their delivery progresses without waiting for log recovery.
- Given log retention reaches its cap, when old log batches are evicted, then trace and metric retained batches are neither removed nor charged against that log cap.

### Done When
- [ ] A configuration/delivery matrix captures unchanged trace/metric behavior across off, enabled, invalid and failing log states.
- [ ] Independent HTTP logs are observed alongside gRPC/file/disabled parent-signal configurations.
- [ ] A log overflow fixture leaves trace/metric backlog intact.

## Story 8: Bound active delivery without delaying a build

**Requirement:** FR-8

As an operator, I want bounded asynchronous log delivery so that a slow destination cannot consume unlimited memory or hold up execution.

### Acceptance Criteria

#### Happy Path
- Given enabled logs below the admission limits, when operational events arrive, then build progress proceeds without waiting for network or disk completion while logs are batched for delivery.
- Given steady admitted traffic, when batches are formed, then each contains at most 128 records and 1 MiB of serialized request data, with a flush scheduled within one second unless an earlier delivery is still boundedly settling.
- Given a stalled delivery operation, when its two-second total budget expires, then that operation is cancelled or abandoned without starting a late request, and execution continues.

#### Negative Paths
- Given 1,024 records or 8 MiB of admitted normalized payload including in-flight records, when another record would exceed either limit, then the newest record is discarded and counted while admitted payload remains within both limits.
- Given many large records, when a request would exceed 1 MiB, then records are split into bounded requests; no oversized request is sent and the split work does not wait on the build's event delivery.
- Given a record has more than 64 attributes or exceeds the normalized record limit, when it is admitted, then a delivered record has at most 64 attributes and retains complete mandatory identity; if those required fields cannot fit, the whole record is discarded and counted.
- Given serialization, policy reading or credential resolution fails or never settles, when delivery handles the failure, then it cannot throw into the build, exceed the two-second delivery budget, or initiate a request after that attempt has ended.

### Done When
- [ ] A stalled destination fixture observes continued step progress before remote completion.
- [ ] Deterministic clock and payload fixtures measure record, byte, batch and operation ceilings, including in-flight accounting.
- [ ] Loss counts match rejected admission, and late-resolving work cannot send after timeout.

## Story 9: Retain and replay logs only under the matching current policy

**Requirement:** FR-8, FR-1, FR-7

As an operator, I want bounded retained delivery so that temporary outages do not silently lose already-retained logs or send them somewhere I did not authorize.

### Acceptance Criteria

#### Happy Path
- Given enabled default log retention and an unavailable destination, when a log batch is acknowledged as retained, then its complete durable payload exists before any send; a later invocation with matching consent can deliver it.
- Given retained batches for a currently enabled destination, when that destination recovers, then batches for that destination are attempted oldest-first and removed after full acceptance; no local age limit silently skips an otherwise eligible batch.
- Given the credential value changes under the same configured reference, when a retained batch is sent, then it uses the current value and neither retained payload metadata nor health output contains that value.

#### Negative Paths
- Given a destination changes after records are admitted or retained, when delivery continues, then old records are never rerouted to the new destination; already-retained records remain unsent within the log cap, while unretained mismatching records are discarded and counted.
- Given a full log backlog, when new retained batches exceed the configured log byte cap (64 MiB by default), then old log batches are evicted and counted within that cap, including batches for inactive destinations; other signals remain intact.
- Given a write fails because log storage is full or inaccessible, when direct fallback is attempted, then it still requires current matching consent, obeys the operation budget, reports the failure, and cannot fail the build.
- Given 400, 413 or OTLP partial rejection, when a retained batch is processed, then the batch is removed and its rejection counted; given 401, 403, 404, 408, 429, 5xx or network failure, then it is retained with bounded retries and applicable Retry-After.
- Given two processes contend for delivery or one loses ownership, when they attempt retained sends, then only the authorized current transport owner sends; a trace/metric owner with logs disabled sends no retained logs.
- Given log retention is explicitly disabled with old batches present, when new logs are delivered directly, then old batches remain untouched and one bounded local notice reports their presence.

### Done When
- [ ] Durable log payloads survive owner replacement and deliver under matching consent using the prerequisite transport runtime.
- [ ] A destination-change/credential-rotation fixture proves no rerouting, no stored secret values, and successful later delivery when the original destination policy is restored.
- [ ] Response, disk-failure, lease-contention and cap fixtures show the specified retained/deleted/counted outcomes for logs.

## Story 10: Report delivery trouble without recursive logs or warning floods

**Requirement:** FR-9

As an operator, I want bounded actionable delivery warnings so that an outage is visible without burying build diagnostics.

### Acceptance Criteria

#### Happy Path
- Given healthy log delivery enters a failure state, when that failure is first observed, then local output identifies logs, a sanitized destination and the actionable failure class promptly.
- Given continuing failure and discarded records, when summary time advances, then warnings aggregate failure/drop counts at most once per 60 seconds per owner, and recovery is reported at most once per 60 seconds.

#### Negative Paths
- Given thousands of failed or discarded records and changing failure classes within a minute, when health is reported, then the owner does not emit one warning per record or bypass the aggregate rate limit by changing class.
- Given delivery-health warnings are rendered and persisted, when operational logging continues, then those warnings produce no remote log records and no recursive delivery attempts.
- Given an exception or backend response contains an API key, authorization header or sensitive URL path, when a warning is produced, then none of that raw material appears in local health text or retained health metadata.

### Done When
- [ ] Captured local warnings show actionable sanitized failure and loss counts within the specified clock-controlled rate limits.
- [ ] A failure episode followed by recovery yields bounded notices and zero exported health records.
- [ ] Secret sentinels in mocked errors/responses are absent from health captures.

## Story 11: Reject malformed log settings without implicit consent

**Requirement:** FR-10

As an operator, I want named configuration errors so that I can fix log setup without disabling working local output or other signals.

### Acceptance Criteria

#### Happy Path
- Given explicit true enablement and a valid existing HTTP OTLP destination, when log configuration is resolved, then logs inherit its endpoint and headers unless overridden.
- Given an explicit HTTP logs endpoint and an explicit header map, when configuration is resolved, then that map replaces inherited headers, and an empty map intentionally supplies none.
- Given valid log retention settings, when logs start, then the selected retention mode and positive byte limit are honored independently of other signal retention settings.

#### Negative Paths
- Given a nonboolean enabled value, an unknown log option/vendor selector, malformed header reference, or invalid retention field, when either mode starts, then a local error names the invalid log setting, logs remain disabled, and valid existing signals/local output continue.
- Given a file/gRPC/no parent destination and no explicit HTTP log endpoint, when log sending is requested, then the error names `otel.logs.endpoint` and no log request is sent.
- Given an endpoint with userinfo, query parameters, fragments, or a non-HTTP(S) scheme, when it is configured, then logs are rejected before any send and the diagnostic does not echo sensitive endpoint content.
- Given the canonical root cannot be established or its log policy cannot be read, when logs would start or send, then logs remain unsent with a bounded local diagnostic and do not guess another project's configuration.

### Done When
- [ ] A settings matrix produces key-specific errors and zero log sends for every invalid family.
- [ ] Captured requests prove endpoint/header inheritance, replacement and explicitly empty headers.
- [ ] Root-resolution/read failures leave builds and otherwise valid signals functioning, without modifying configuration files.

## Story 12: Finish and restart without stalled shutdown or stale ownership

**Requirement:** FR-11

As an operator, I want bounded shutdown and correct shared lifetime so that one feature's completion cannot stop logging for other work.

### Acceptance Criteria

#### Happy Path
- Given a normally completing configured run, when it emits its final lifecycle diagnostic and stops, then that final diagnostic participates in a log flush/preservation attempt within one total two-second log shutdown budget.
- Given multiple active daemon features, when one finishes, then the daemon and remaining features continue delivering logs with their own attribution.
- Given a prior run has stopped, when a later run starts in the same process, then each new occurrence is delivered once without subscriptions or identity retained from the previous run.

#### Negative Paths
- Given pending records and a destination or storage operation that never completes, when stop occurs, then log shutdown returns within two seconds, no log-owned timer keeps the process alive, and no late request starts after shutdown.
- Given an enabled run fails after partial initialization, when cleanup executes, then acquired logging resources and any diagnostic bridge are released exactly once while local error output and the original result are preserved.
- Given a feature ends while a different process owns shared retained delivery, when its local provider stops, then it cannot terminate the other owner's delivery or release its ownership.
- Given the process dies after a batch was durably retained but before acknowledgment/removal, when a later authorized owner starts, then that batch remains eligible for delivery; transport replay may duplicate delivery and no exactly-once guarantee is asserted.

### Done When
- [ ] Production-entry lifecycle fixtures include final output and cover normal, partial-startup-failure and stalled-stop paths within the single budget.
- [ ] Two-feature and repeated-run fixtures show surviving delivery, correct ownership and unchanged listener counts after teardown.
- [ ] Retained batches remain recoverable after owner replacement without treating unretained in-memory records as crash-safe.

## Behavioral coverage disposition

These are design-time coverage assignments, not claims of passing tests. BUILD's writing-system-tests step resolves them into concrete proof references before implementation. Lower-layer cases retain every failure permutation; no whole Conductor run is needed to test a parser, record projection, or response classifier. Entry fixtures stop at the observed boundary, use real internal wiring and fake third-party/process adapters, and await cleanup.

| Story | Happy + negative criteria | Lowest sufficient proof |
| --- | --- | --- |
| 1 | 3 + 4 | Entry-point integration for consent in both modes and linked worktree; sender-policy integration for revocation/retained replay; configuration unit cases for precedence. |
| 2 | 3 + 3 | Minimal daemon/interactive entry integration producing lifecycle and diagnostics, including recovery and failing startup/shutdown; projection unit cases for excluded source types. |
| 3 | 2 + 3 | Production sender/serializer integration with decoded protobuf and fake HTTP destination contracts; response failures reuse the shared delivery cases. |
| 4 | 2 + 3 | Projection and record-boundary unit tests; forwarding integration for timestamp preservation. |
| 5 | 2 + 3 | Logger/context and feature-to-root integration with controlled async interleaving and exact occurrence counts. |
| 6 | 2 + 2 | Local logger and existing read/follow/rotation boundary integration with remote delivery enabled; no new whole-run acceptance flow. |
| 7 | 2 + 3 | Entry configuration/wiring matrix plus per-signal delivery/backlog integration; existing trace/metric fixtures extended only where behavior crosses the new boundary. |
| 8 | 3 + 4 | Processor/sender unit and integration tests with injected clocks and stalled fake adapters; one entry-path progress assertion. |
| 9 | 3 + 6 | Logs extension of prerequisite durable-store/drainer integration using isolated temporary storage and fake HTTP/process adapters; no retest of unchanged lease internals. |
| 10 | 2 + 3 | Health-state/rate unit tests plus persisted/rendered health integration proving no remote recapture. |
| 11 | 3 + 4 | Pure settings matrix plus startup/send boundary checks for logs-only error isolation and read-only root policy. |
| 12 | 3 + 4 | Entry lifecycle integration with controlled timers, provider completion and partial initialization; durable owner replacement at transport boundary. |

No distinct full-workflow acceptance/system test is required beyond these focused production-entry integrations. The implementation plan must assign exactly one integration-proof owner for each changed boundary and may reuse one fixture across closely related criteria.

## Negative-category audit

| Category | Evaluation |
| --- | --- |
| Invalid input | Story 11 settings; Stories 4/8 record bounds. |
| Authentication/permission failure | Stories 3/9 response auth; Stories 1/11 policy access; Story 9 disk access. |
| Timeouts/network and dependency unavailability | Stories 3/8/9/12, including a policy/credential read that never settles. |
| Concurrent access | Stories 1/5/9/12 for policy, source attribution, shared delivery and lifetime. |
| Resource exhaustion | Stories 4/8/9/10 for record, memory, storage and warnings. |
| Partial failure/rollback | Stories 7/9/12 for signal isolation, partial responses and partial initialization. |
| Data integrity and immutability | Stories 4/5/9: timestamp/full identity, fixed destination binding and immutable retained payloads. |
| Cascade deletion | No business entity deletion; Story 12 covers owner termination without releasing another owner's resources. |
| Exception hierarchy | Story 8 covers thrown/rejected boundary operations; assertions use actual adapter errors rather than assuming an SDK superclass. |
| Dedup/idempotency | Story 5 distinguishes forwarding duplicates from legitimate identical messages; Stories 9/12 explicitly allow transport replay. |
| Invariant side-effects on alternate paths | Stories 6/7/9/12 retain local output, working signals, consent on fallback, and cleanup on failure. |

## Verify-Claims Ledger

**Verdict: CLEAR for story authoring.** The PRD, scope, diagrams and ADR D18–D21 are operator-approved inputs (verified against the artifacts and chat). These criteria describe intended behavior, not already-implemented capabilities. The existing OTel, durable-export and daemon-feature-tag stories were read to preserve their ownership and local display contracts. No new load-bearing product choice is introduced here.

Durable transport completion is explicitly conditional on #2870. Destination tests establish the emitted protocol contract using faithful fakes; live vendor-account compatibility is not claimed. No implementation or behavioral test has been executed in this composer step.

