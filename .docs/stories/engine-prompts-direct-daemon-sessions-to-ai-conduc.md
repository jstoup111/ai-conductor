**Status:** Accepted

# Stories: Daemon session command compatibility and visibility

Source-Ref: jstoup111/ai-conductor#2709
Track: technical
Governing architecture: adr-2026-10-01-daemon-session-command-contracts (APPROVED), with its cited FINISH, bootstrap, GitHub ownership, and event-spine authorities.

Scope: all approved source-audit and refusal-reporting outcomes; GitHub monitoring covers ordinary PATH-resolved gh calls and child scripts inheriting that environment. Absolute binary paths, replaced PATH, custom HTTP/SDK clients, and separate MCP transports are outside the operator-approved observation boundary. Monitoring introduces no new blocking policy or authorization exemption.

Operator accepted all seven stories in composer chat on 2026-10-02.

## Story 1: Reject instructions that the managed session cannot execute

**Requirement:** Intake outcomes 1 and 2; ADR D1.

As a maintainer, I want incompatible managed instructions rejected before merge so a prompt cannot direct a session into a predictable guard refusal.

### Acceptance Criteria

#### Happy Path
- Given a newly added managed engine prompt or shipped skill instruction names a blocked ai-conductor command, when repository validation runs, then it fails and identifies the instruction's file, line, and blocked subcommand without requiring registration of that individual occurrence.
- Given every managed command is admitted by the production session policy, when validation runs, then compatibility passes using that policy's current decisions.
- Given blocked commands appear only in explicitly operator-only instructions, non-executable prohibitions, or historical design material, when validation runs, then those appearances do not create managed-command violations.

#### Negative Paths
- Given a command-bearing managed instruction has missing, malformed, stale, or ambiguous context classification, when validation runs, then it fails at that source rather than silently treating it as interactive.
- Given a region is labeled operator-only but the production dispatch directs a marked session to execute it, when the instruction-context integration check runs, then the contradictory path fails.
- Given a retry or remediation prompt introduces a blocked command through supported string concatenation or templating, when validation runs, then it identifies the originating instruction and subcommand.
- Given command construction cannot be resolved sufficiently to evaluate a managed instruction, when validation runs, then it reports an unresolved-command finding instead of passing.
- Given a managed instruction changes to request a daemon-control, config, aggregate-verification, or operator build-review command, when validation runs, then the check fails and does not expand runtime permissions to accommodate the instruction.

### Done When
- [ ] The wired repository validation entry point fails for an introduced blocked instruction with actionable source coordinates.
- [ ] Compatible managed, legitimate operator-only, prohibition, retry, and ambiguous-source fixtures produce their specified verdicts.
- [ ] Guard policy changes affect both runtime permission and audit results through the same decision authority.

**Coverage disposition:** Focused audit-entry integration and instruction-fixture tests cover all criteria; production prompt/dispatch fixtures prove context boundaries. The audit itself is executable behavior, so tests assess its verdict and source mapping rather than matching incidental prose.

## Story 2: Recover FINISH recording through its existing engine owner

**Requirement:** Intake outcome 1, existing FINISH contradiction; ADR D2.

As an operator, I want a missing FINISH recording repaired by the engine so the provider is never instructed to run a blocked recording command.

### Acceptance Criteria

#### Happy Path
- Given publication evidence is coherent but the final outcome is unrecorded, when managed FINISH recovers, then the engine records and verifies the authorized outcome without assigning recording to a provider.
- Given a PR presentation repair is required, when the provider finishes the bounded prose task, then the engine owns subsequent completion recording and verification.

#### Negative Paths
- Given a FINISH entry path has no usable publication coordinator, when missing recording is encountered, then it reports the unsupported or refused path without a provider recording instruction or a fabricated completion marker.
- Given required publication evidence is missing, stale, or inconsistent, when recording recovery runs, then completion remains unrecorded and the existing typed FINISH disposition identifies the failed condition.
- Given earlier publication effects are already verified, when recording recovery retries after a failed write, then it does not replay those effects or dispatch BUILD solely for the recording failure.
- Given a provider directly invokes finish-record from a marked session, when the invocation reaches the guard, then it remains refused.

### Done When
- [ ] A FINISH recovery entry-point fixture records the engine recorder call and no provider-owned recording action.
- [ ] Missing-coordinator and invalid-evidence fixtures leave completion unwritten.
- [ ] A retry fixture proves prior verified publication effects are retained.

**Coverage disposition:** Narrow conductor/FINISH coordinator integration with injected recorder, provider, GitHub, and state dependencies; guard-policy tests cover the direct marked invocation. Reuse existing publication evidence/retry proofs where sufficient and identify them in the plan.

## Story 3: Keep configuration setup on the operator path

**Requirement:** Intake outcomes 1 and 2, managed bootstrap contradiction; ADR D2.

As an operator, I want managed refresh to distinguish initialized projects from projects needing setup so it never asks a marked session to execute forbidden configuration operations.

### Acceptance Criteria

#### Happy Path
- Given required project configuration is initialized, when managed prelude refresh runs, then supported refresh work can proceed without directing the provider to execute config reads, initialization, or writes.
- Given an unmarked operator invokes bootstrap on an uninitialized project, when setup succeeds, then existing operator-guided configuration initialization remains available.

#### Negative Paths
- Given required configuration is missing, when managed prelude runs, then it reports that operator bootstrap is required before launching the provider and writes no replacement configuration.
- Given configuration cannot be safely read or established as initialized, when managed prelude evaluates readiness, then it reports the setup problem and does not treat the project as ready.
- Given a marked session attempts config read, init, or set, when the command reaches the guard, then it is refused without changing project or machine configuration.
- Given an initialized configuration contains operator choices, when managed refresh or an operator re-run occurs, then those choices are not overwritten by defaults.

### Done When
- [ ] Prelude entry-point fixtures distinguish ready, missing, and unreadable configuration with the expected provider-dispatch counts.
- [ ] Before/after project and machine configuration remain equal on all refused paths.
- [ ] Existing unmarked bootstrap initialization and no-clobber behavior retain behavioral proof.

**Coverage disposition:** Prelude readiness/invocation integration plus existing configuration CLI tests; marked-call policy permutations stay at guard level.

## Story 4: Preserve attribution and protection across managed providers

**Requirement:** Intake outcomes 3 and 4 across supported providers; ADR D3 and D6.

As an operator, I want command observations attributed to the feature that launched the session regardless of provider, fallback, or working directory.

### Acceptance Criteria

#### Happy Path
- Given a managed feature invocation using any supported built-in provider, when the provider is launched, then its command guard and observation context identify the originating feature and dispatch.
- Given a provider fallback, changed child working directory, or nested subprocess inheriting the managed environment, when a covered command occurs, then its observation retains the originating feature attribution and the correct dispatch identity.
- Given a supported read-only review invocation, when its observation destination is prepared, then occurrences can be recorded while source, sealed artifacts, unrelated pipeline state, and operator configuration remain protected.

#### Negative Paths
- Given a daemon feature invocation lacks valid required attribution, when preparation runs, then the provider is not launched and the failure names the missing context.
- Given candidate-specific options attempt to replace the owning dispatch context, when invocation is prepared, then the engine-owned attribution remains authoritative.
- Given a producer destination escapes the feature's provisioned root through traversal or symlinks, when preparation or ingestion validates it, then no event is written or attributed outside that root.
- Given the selected provider cannot support the required protected observation destination, when preparation runs, then it refuses before launch with the provider and recovery action identified.
- Given project-scoped prelude work has no feature, when its context is created, then it is identified as project-scoped and no feature slug is invented.

### Done When
- [ ] Catalog-driven adapter fixtures verify launch context for Claude, Codex, and Pi through their real environment-building paths.
- [ ] Fallback and changed-cwd fixtures produce the expected feature/dispatch identities.
- [ ] Containment fixtures prove observation writes succeed only within the intended destination and protected writes remain refused.

**Coverage disposition:** Provider adapter launch integration with fake processes, context-validation units, and existing containment/admission fixtures extended for the narrow destination. No provider binary runs.

## Story 5: Make a refused command visible without executing it

**Requirement:** Intake outcome 3; ADR D4 and D9.

As a daemon operator, I want a blocked command to appear with its feature and subcommand in the event record and daemon log.

### Acceptance Criteria

#### Happy Path
- Given a managed feature invokes a blocked command and event storage is available, when the CLI refuses it, then the command returns nonzero, its handler is not invoked, and the feature event record and daemon log identify the feature and blocked subcommand.
- Given a permitted managed worker command, when it passes the entry guard, then ordinary command dispatch proceeds without a refusal event.

#### Negative Paths
- Given the refusal event cannot be written, when the CLI rejects the command, then the handler still is not invoked and a bounded diagnostic reports the telemetry failure without claiming successful recording.
- Given a command has malformed or unsafe identity text, when its refusal is reported, then the event uses a bounded unknown representation and exposes no raw arguments, credentials, or environment values.
- Given an event claims a feature different from its provisioned context, when it is ingested, then it is rejected with a bounded diagnostic and is not projected under either a guessed feature or the forged attribution.
- Given a blocked command occurs during FINISH, validation, repair, or an error path, when the occurrence is emitted, then available event storage and daemon rendering report it under the same contract as a BUILD refusal.

### Done When
- [ ] A real CLI-refusal-to-event-projection fixture captures the nonzero result, zero handler invocations, canonical record, and formatted daemon line.
- [ ] Allowed-command and event-write-failure fixtures distinguish normal dispatch from refused-but-unrecorded behavior.
- [ ] Captured event/log output excludes supplied secret-shaped arguments and raw error payloads.

**Coverage disposition:** Guard/CLI integration through real local event projection and captured daemon rendering, with injected storage failures and handler fakes. Reporting redaction and identity permutations stay at unit level.

## Story 6: Observe covered raw GitHub mutations honestly

**Requirement:** Intake outcome 4 with the operator-approved bounded coverage; ADR D7–D9.

As an operator, I want covered raw gh mutation attempts to be visible without confusing attempts, successful CLI returns, and verified remote effects.

### Acceptance Criteria

#### Happy Path
- Given a managed session or inheriting child script issues a recognized unguarded gh mutation through ordinary PATH resolution, when the command runs, then an attributable attempt observation is recorded before execution and a correlated terminal result is recorded if observed.
- Given a known read-only gh call or a call made through the guarded GitHub operation path, when it runs, then it is not falsely reported as an unguarded mutation.
- Given a covered gh invocation carries input, output, arguments, exit status, or termination signals, when it passes through observation, then its original transport behavior is preserved without a retry, rewrite, redirect, or new blocking policy.

#### Negative Paths
- Given a covered mutation fails, times out, or terminates without a result, when observations are evaluated, then it is reported as failed or unknown rather than as a successful remote write.
- Given REST fields imply a write or a GraphQL, alias, extension, or opaque-input call cannot safely be classified as read-only, when it runs through observation, then it produces a mutation or possible-bypass observation rather than silently passing as a known read.
- Given an invocation supplies its payload through stdin or a file, when it is classified, then monitoring does not consume that input or read and expose the payload to determine whether to report.
- Given observation storage fails for a covered raw invocation, when the command runs, then a bounded diagnostic reports degraded telemetry while the underlying command is forwarded once with its original behavior.
- Given the guarded operation path refuses authorization, when the caller receives the refusal, then it does not retry the mutation through the raw observer or label the whole session authorized.
- Given the wrapper resolves its underlying executable, when guarded and unguarded calls execute, then no recursive wrapper invocation or duplicate mutation occurs.
- Given secret values appear in arguments, payloads, or transport errors, when a bypass observation is persisted or rendered, then those values are not included.
- Given an invocation uses an absolute binary, replaced PATH, custom HTTP/SDK client, or separate MCP transport outside approved coverage, when observations are inspected, then absence of an event is not presented as proof that no GitHub write occurred.

### Done When
- [ ] A production wrapper entry-point fixture records one fake transport invocation plus correlated attempt/result events for a raw mutation.
- [ ] Read and guarded fixtures emit no false bypass; denied guarded fixtures record zero mutation fallback.
- [ ] Unknown/implicit-write forms and stream/status preservation have concrete behavioral tests.
- [ ] All mutation fixtures prove the real adapter reaches an injected fake before destructive arguments are exercised.

**Coverage disposition:** Wrapper/private transport integration with verified fake-process isolation, plus classification and redaction units. No real GitHub call is needed. The coverage-exclusion criterion is proven by truthful observation result semantics, not by adding tests that merely match documentation wording.

## Story 7: Deliver occurrences across concurrency, failure, and restart

**Requirement:** Intake outcomes 3 and 4; ADR D5, D6 and D9.

As an operator, I want command occurrences retained and delivered throughout a feature's lifetime so a fast FINISH exit or overlapping child process does not hide them.

### Acceptance Criteria

#### Happy Path
- Given concurrent producer processes emit distinct valid occurrences for one feature, when the event reader processes their records, then all occurrences reach the feature's canonical event record and daemon rendering with correct identities.
- Given valid command occurrences are emitted during BUILD, FINISH, validation, repair, failure, or cancellation, when the feature closes its event consumers, then completed available records are drained before those consumers detach.
- Given an engine interruption leaves producer records pending, when the feature resumes, then those records are projected with original attribution and each occurrence has one durable canonical record.

#### Negative Paths
- Given a producer record ends without a newline, when ordinary polling runs, then it is not consumed as complete; completion makes it eligible, while the settled producer boundary reports an incomplete record without inventing its contents.
- Given a completed record is malformed, oversized, or has invalid attribution, when the reader encounters it, then a bounded diagnostic is emitted and later valid records remain deliverable.
- Given polling overlaps or a subscriber is still handling an occurrence, when another poll starts, then one traversal owns progress and it does not advance the same input twice.
- Given canonical persistence fails after a producer record is read, when projection retries, then unread progress is retained and the eventual canonical result contains no duplicate occurrence.
- Given an earlier projection persisted but another subscriber failed or the process stopped, when recovery replays the producer record, then the durable record is not duplicated; a repeated log delivery retains the same event identity.
- Given two genuinely distinct invocations have the same subcommand or operation, when deduplication runs, then both remain distinct and an invocation's attempt and terminal result are not collapsed together.
- Given the producer source is temporarily unreadable or event sinks fail, when the failure is handled and the dependency later recovers, then no unhandled background rejection escapes and retained complete records can still be delivered.

### Done When
- [ ] Temporary-file integration proves concurrent producers, final drain, and restart projection through the real emitter/persister and captured daemon renderer.
- [ ] Canonical records are unique by occurrence identity after injected partial subscriber/persistence failures.
- [ ] Deferred-I/O and fake-time tests prove one active traversal, bounded-record handling, and recovery without real sleeps.
- [ ] Persisted output preserves occurrence identity and source attribution across replay.

**Coverage disposition:** Focused event-delivery integration with real fixture-owned producer files and internal event consumers. Failure permutations use injected/deferred I/O and fake clocks. This does not require completing a whole Conductor lifecycle.

## Negative-category evaluation

- Invalid input: instruction contexts, dynamic commands, invocation identity, event schema/size, and gh command classification.
- Authorization and permissions: blocked handlers, guarded GitHub refusal, protected destinations, provider capability failure, and no context-based authorization.
- Timeouts/dependency loss: gh terminal failure/unknown outcome, missing setup, observation storage failure, and event-reader/subscriber failure.
- Concurrent access: simultaneous producers, overlapping polls, and partial subscriber failure.
- Resource exhaustion: storage failure and bounded oversized records; no unbounded stress test is required.
- Partial failure: recorder failure, producer write degradation, lost terminal result, interruption before canonical projection, and failed consumers.
- Data integrity/idempotency: independent occurrence ids, correlated attempt/result, restart deduplication, and preserved configuration.
- Alternate branches: FINISH/validation/repair/cancellation, provider fallback, project-scoped prelude, and operator-only commands.
- Cascade deletion: not applicable; the feature adds no domain deletion or bulk spool cleanup.
- Model immutability: occurrence identity is preserved across replay and never acts as mutable completion authority.
- Exception handling: storage, subprocess, and subscriber failures remain distinct; a caught error cannot be converted into command permission or successful telemetry.

## Verify-claims ledger

Criteria derive from the approved architecture and scope, not an unconfirmed universal monitoring claim. Existing FINISH/coordinator and operator-bootstrap behavior is reused under the cited governing ADRs. Architectural failure modes have explicit negative criteria. Ordinary project documentation is intentionally absent from story criteria; implementation tasks own relevant documentation alongside changed behavior.

Verdict: CLEAR. Operator acceptance recorded on 2026-10-02.

