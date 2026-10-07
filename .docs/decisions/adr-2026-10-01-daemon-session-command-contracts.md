# ADR: Daemon session command contracts and bounded mutation observation

**Date:** 2026-10-01
**Status:** APPROVED
**Deciders:** Operator approval in composer chat, 2026-10-01; explicitly approved the complete architecture proposal after selecting bounded gh coverage.
**Source:** jstoup111/ai-conductor#2709

## Context

A managed FINISH prompt instructed an agent to execute a command rejected by the session guard. The documented github-operation omission has been repaired, but prompt/guard agreement has no mechanical pre-merge contract. Current source still directs provider-owned finish recording despite the approved engine-owned FINISH architecture. Runtime refusal is printed before normal CLI dispatch, and raw agent-issued gh writes can be visible only in transcripts.

The operator approved Approach A (audit existing instructions), technical track, Medium, the diagram boundaries, and bounded GitHub observation. Bounded means ordinary PATH-resolved gh calls, including scripts inheriting the managed environment. Absolute binaries, replaced PATH, arbitrary HTTP/SDK clients, and separate MCP transports are excluded. This is monitoring rather than an adversarial sandbox.

Applicable existing authorities are adr-2026-09-11-github-operation-ownership, adr-2026-08-01-engine-owned-resumable-finish-publication, adr-2026-08-28-test-suite-drift-budget-and-verification-mode D8.1–D8.3, adr-2026-08-08-pipeline-owned-closeout-timestamps, and adr-2026-07-26-event-sink-registry-exhaustiveness.

## Options Considered

### Audit existing instructions and observe managed gh execution — selected
- Preserves current prompt/skill authoring and command authorization.
- Adds explicit context classification and source diagnostics.
- Requires careful source discovery, cross-process event delivery, and a stated monitoring boundary.

### Generate every command instruction from a shared catalog — rejected
- Can enforce agreement during command rendering.
- Requires the broader prompt/skill migration the operator declined; does not itself expose runtime bypasses.

### Parse all provider transcripts — rejected as the observation authority
- Could reuse existing provider output streams.
- Provider stream formats differ, nested execution may be opaque, and command text does not prove execution. It cannot offer better completeness than its observed tool records.

### Complete process/network mediation — excluded by operator scope choice
- Could establish a stronger coverage boundary after a larger design.
- Exceeds the approved Medium monitoring scope and changes execution/security architecture.

## Decision

### D1 — One command policy, explicit instruction contexts

The existing daemon-session guard owns permission. The pre-merge audit evaluates candidate argv against that production policy; no second sanctioned-command list or prompt-derived permission is introduced.

Source discovery covers shipped skills and engine prompt-producing code, including retries and remediation. Context is attached to bounded regions: managed instructions, operator-only instructions, or non-executable examples/prohibitions. Unclassified, malformed, stale, or ambiguous command-bearing regions fail with file/line and subcommand or unresolved-command reason.

Discovery must find new instruction sites without manually adding each command occurrence. Dynamic construction that cannot be classified is an error at its source, not silently ignored. Region declarations are a reviewable contract, not proof of runtime reachability; production prompt/dispatch integration must show that interactive exclusions agree with the actual execution context.

Use a focused audit module and the existing repository validation path. Historical design documents are excluded. The mechanical check tests instruction compatibility; it does not grade arbitrary prose semantics.

### D2 — Correct contradictions under existing ownership

Keep finish-record, config, test-suite, and operator build-review verbs blocked in managed sessions.

FINISH's missing-recording and presentation retries preserve the engine-owned coordinator's observe/record/verify flow. Provider judgment remains PR prose only. A missing coordinator yields an explicit unsupported/refused path; it never delegates recording to the provider.

The guided bootstrap interview stays operator-only under D8.1–D8.3. Resolve its previously excluded managed auto-init contradiction by making managed prelude refresh operate on already initialized configuration. When required setup is missing or cannot be safely established, report the operator bootstrap requirement before dispatch rather than asking a marked provider to initialize config. No new managed config read/write exemption is created, and the unmarked bootstrap keeps its existing initialization behavior.

Before landing, add a clarification beside the existing bootstrap D8.3 scope exclusion explaining that this decision now owns that previously excluded path. Preserve the original text. This is a DECIDE amendment, never a BUILD task targeting another feature's artifact.

### D3 — Engine-owned context reaches every managed provider

A typed managed-session context carries canonical project/worktree identity, feature attribution when present, dispatch identity, provider identity, and the provisioned event destination. It crosses provider candidate/fallback boundaries without being overridden by candidate prompts or model output.

All managed Claude, Codex, and Pi invocations receive the same marker and context contract; Pi's currently absent marker is corrected. Authentication, self-host containment, tmux scrubbing, cancellation and fresh-session behavior are preserved.

Cwd is not the attribution authority. Nested subprocesses inherit the context. Project-scoped work is explicitly project-scoped, while a daemon feature dispatch missing required feature context fails preparation before launching an unobservable session.

### D4 — Refusal is recorded where it happens

The pure guard returns a structured subcommand with its refusal verdict. The early CLI refusal path produces a canonical occurrence and returns nonzero without invoking the blocked handler.

Define closed ConductorEvent variants for session-command refusal, bounded GitHub bypass observation, and observation-delivery diagnostics where needed. Event attribution includes source occurrence time and a stable event id. Subcommand/operation identity is bounded; malformed identity has a closed unknown representation.

Payloads contain no raw command line, body, request file contents, credentials, environment dumps, or unfiltered stderr. Failure to record a refusal never authorizes the command and is never represented as successful telemetry.

### D5 — Separate producers, one event schema and reader

The producer runs outside the engine emitter. It writes ConductorEvent records to its own append-only file under the engine-provisioned .pipeline/session-events/«dispatch-id»/«producer-id».jsonl location. One producer owns each file; children never append to the engine's events.jsonl or concurrently share the existing pipeline-events.jsonl writer.

Extend the existing external-event reader/tail to project these records through the feature's ConductorEventEmitter and EventPersister. This follows event-spine exceptions A/B; it changes a write location, not the schema or consumer path. There is no bespoke observer log.

Validate incoming record type, size, identity, and path containment. Reject traversal/symlink escape and forged cross-feature attribution rather than writing or projecting outside the provisioned root. Events are observations, never authorization or completion evidence.

The daemon's feature-event persistence lifetime owns the tail across BUILD, FINISH, validators and repair paths; equivalent managed non-daemon callers supply an explicit owner. Replace the existing build-only lifetime where necessary. Start before provider execution and await final drain on success, failure, cancellation, and shutdown before detaching event sinks.

Stable event ids support retry and restart deduplication. Pending producer records survive interruption. Advance projection progress only when persistence succeeds, and make canonical persistence idempotent for these event ids so retry after partial subscriber failure cannot duplicate durable occurrences. Duplicate log delivery after a crash is allowed and retains the same event identity; exactly-once console delivery is not promised.

Read complete bounded records incrementally. A malformed record does not suppress later valid records, and a partial trailing record is retained until completed or reported incomplete at the settled boundary. Recover pending records from prior dispatches with their original attribution. Avoid rescanning the entire canonical ledger on every poll; build the needed dedup index once per owner and extend it as events are persisted.

The new producer spool is delivery input, not a second rollup source. Existing consumers read the canonical projection without counting both copies. Ordinary feature worktree retention owns these files; this feature introduces no bulk cleanup operation.

### D6 — Narrow telemetry access preserves read-only boundaries

Provision only the per-dispatch telemetry destination needed by a session. A read-only reviewer may write these occurrence records without gaining write access to protected source, sealed artifacts, unrelated .pipeline state, or operator configuration.

> **Amended 2026-10-02 by #2709:** This telemetry requirement does not authorize replacing the native read-only review profiles, allowing general shell writes, or weakening the protected-input contract of adr-2026-09-10-portable-build-review-policy D5.2–D5.5 and the Pi catalog D17. A candidate must satisfy both its existing review policy and the narrow observation-destination requirement. If their combination cannot be demonstrated, preparation reports unsupported capability and launches no reviewer; native read-only capability alone does not prove telemetry readiness.

> **Amended 2026-10-06 by #3022:** "Needed by a session" is read literally. Observation records are written only by observed commands: the managed `gh` wrapper, and the conductor entry guard (`ai-conductor`, `conduct`, `conduct-ts`). A read-only review whose actual launch policy cannot invoke any observed command can produce no record. That session needs no destination. Preparation therefore neither demands the narrow-access proof nor provisions the managed `gh` wrapper, and the native read-only policy launches unchanged. The condition is mechanical and fails closed. The provider adapter derives it from the real launch argv, including self-host args, never from the provider name. For Claude, the argv must carry `--restricted` and `--strict-mcp-config`. Its explicit `--tools` set must be limited to Read, Grep, Glob and Bash. Its `--allowedTools` rules must be limited to those tools and the read-only `git` prefixes. Its `--disallowedTools` must deny every observed-command prefix, because deny rules override Claude's built-in auto-approved read-only commands, which include `gh pr view`. It may contain no other flag that confers tool, permission, settings or MCP authority. Any other argv, or an adapter that cannot answer, keeps the proof requirement. Codex and Pi are unchanged.

Preparation proves the destination is usable under the actual selected provider policy. An unsupported or unprovable setup reports the provider and recovery action before dispatch. Mid-run write/read failure yields bounded diagnostics and retained retryable data where available; it neither grants mutation authority nor fabricates a successfully delivered event.

### D7 — Observe ordinary gh calls without changing their operation

Only managed provider child environments receive the gh wrapper. Resolve the real executable before changing PATH and keep the resolution private to the managed execution adapter. Operator shells and the engine's unrelated commands retain their normal environment.

The wrapper preserves arguments, stdin/stdout/stderr, terminal status and signals. It records an unguarded mutation attempt before forwarding once, then records the returned result if observed. It does not retry, rewrite, redirect, authorize, or newly block an existing raw operation. A missing result remains unknown; zero exit status means reported CLI success, not independently verified remote state.

Known read-only calls produce no bypass event. Classify standard GitHub mutation families and API method semantics, including implicit REST writes from field parameters. GraphQL, aliases/extensions and opaque inputs that cannot be safely classified produce a possible-bypass observation instead of a false read-only result. Classification must not consume stdin or read payload files merely to decide whether to report.

If local observation persistence fails, issue a bounded stderr diagnostic and preserve the underlying invocation's original behavior. This is a documented telemetry degradation, not a successful observation. Initial setup is checked under D6; inability to guarantee reporting after an arbitrary storage failure is not concealed.

### D8 — Guarded calls stay distinct without a public bypass

The existing guarded GitHub runner continues to authorize each operation and choose its operator/bot credential. Its private makeProductionGh transport calls the resolved real binary without recursively entering the observation wrapper.

An inherited marker or environment flag available to the whole provider session must not certify arbitrary calls as guarded. No public skip-observation flag or session-wide authorization is added.

The wrapper is a narrow observational transport for an agent's already-issued raw command. Its passthrough is explicitly registered in the production invocation audit; the exemption applies only to that identified transport call, never a file or arbitrary harness call site. Harness-authored commands and skill-directed writes still use the guarded operation boundary. No refused guarded call may fall back through the wrapper.

Add a clarification alongside github-operation-ownership D7 to distinguish this observation passthrough from an authorized harness operation. The wrapper does not claim to enforce GitHub ownership, and the approved bounded coverage is not a security guarantee.

### D9 — Persist and render the same occurrence

New occurrence variants explicitly declare persist/render ownership in EVENT_SINKS. Existing daemon and terminal subscribers format feature slug, bounded command/operation identity, and refusal/attempt/result/possible-bypass status.

FINISH and error-path occurrences must be visible without transcript inspection while the spine is available. Repeated distinct invocations keep separate event identities; attempt and result of one gh call correlate without being deduplicated into one occurrence. Reads and already-guarded operations must not be falsely reported as bypasses.

### D10 — Verification is isolated and boundary-focused

The implementation proves the actual audit entry point, provider launch environments, CLI refusal path, external-event projection into persisted records and daemon rendering, and bounded gh wrapper/private guarded transport separation.

Use real internal collaborators and fixture-owned storage, with injected fake provider/GitHub/process boundaries. Prove the real adapter reaches the fake before exercising mutating arguments. No ordinary test calls GitHub or an LLM, even if the guard is removed in counterfactual review.

Include concurrency/restart/final-drain, malformed context/records, read-only containment, observation failure, unknown API inputs, and transport stream/status preservation. Tests stay at the lowest sufficient layer; configured aggregate verification remains owned by test_suite.

## Consequences

### Positive
- Instruction/guard contradictions fail before merge with actionable source locations.
- Known FINISH and bootstrap contradictions are repaired under explicit ownership.
- Refusals and covered gh bypasses become attributable events and daemon-log entries.
- All supported providers share the same outcome without provider-specific transcript inference.

### Negative
- Explicit context regions and instruction discovery require maintenance and behavioral coverage.
- Per-producer event files and restart-safe projection add bounded lifecycle code.
- Wrapping gh adds a process hop and requires careful stream/signal preservation.
- Bypass detection has the operator-approved coverage limits above.
- Storage failures can degrade telemetry; they are not hidden behind a claim of complete observation.
- The observer does not newly stop raw operations; the existing guarded-operation policy still defines what agents are authorized to do.

### Follow-up Actions
- The authoritative ADR and its narrow DECIDE clarifications to the governing bootstrap and GitHub ownership ADRs are included in this specification change.
- Author stories and plan tasks for the functional behaviors, with targeted integration ownership.
- Include operator documentation with implementation behavior tasks; do not create standalone documentation stories.
- Keep broader process/network mediation outside this feature.

## Verify-claims ledger

Verified source evidence and governing clauses are recorded in the companion architecture review. The operator explicitly approved bounded gh coverage; no universal observation guarantee is assumed. The operator approved D2 managed-prelude handling, D3–D8 integration choices, and their governing-ADR clarifications with the complete architecture proposal before stories. Verdict: CLEAR.

