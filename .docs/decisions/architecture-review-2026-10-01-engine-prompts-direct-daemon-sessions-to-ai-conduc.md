# Architecture Review: Daemon session command compatibility and visibility

**Date:** 2026-10-01
**Source:** jstoup111/ai-conductor#2709
**Track:** technical
**Tier:** M — lightweight feasibility and alignment review
**Input:** Operator-approved Approach A, all three requested outcome groups, and component/sequence boundaries.
**Stories reviewed:** None; this is the required pre-stories review.
**Verdict:** APPROVED — operator approved the complete structural decision in chat on 2026-10-01.
**Reviewed source revision:** b5e2032fbd91fbd81ea8477b1043d8b23a33c4a1

## Feasibility

The instruction audit and guard-refusal reporting are feasible with the current TypeScript runtime, parser dependency, guard, and event infrastructure. The selected approach need not generate command prose from a central catalog.

GitHub bypass visibility needs a coverage decision. A managed-session PATH wrapper around gh offers a provider-neutral process seam and sees child scripts that resolve gh through the inherited PATH. It cannot see an explicit absolute gh binary, a script that replaces PATH, direct HTTP clients, or an independently supplied SDK/MCP transport. No proposal below represents that coverage as universal.

The existing provider-stream callbacks do not solve this gap: Claude and Codex currently expose token/activity observations through ProviderStreamObservation; Pi has its own result parser. These callbacks do not constitute an authoritative cross-provider record of every process or GitHub write. Transcript parsing would add provider-specific coverage limits without establishing complete observation.

No package installation, external service, database migration, or real GitHub mutation is needed to develop or validate the bounded design. Real third-party execution remains confined to opt-in smoke tests.

## Approved design

### 1. Audit existing instruction sources against the production policy

Create a focused command-contract audit beside engine/github-invocation-audit.ts, reusing the TypeScript parser/source-location pattern rather than inserting daemon-policy logic into the GitHub ownership classifier.

Discover command-bearing instructions from shipped skills, engine prompt source, and prompt-producing source files. Include inline commands, fenced examples intended for execution, concatenated strings, templates, retry/remediation prompts, and the command's argv prefix. Historical .docs and .memory material is not executable instruction input.

Each relevant source region has an explicit, bounded execution-context classification: managed, operator-only, or non-executable example/prohibition. Mixed skills require section/region scope rather than an exemption for the whole file. Missing context, malformed scopes, stale annotations, ambiguous command construction, and contradictory managed use fail validation with a source location. An operator-only classification must agree with the actual dispatch path; changing a label cannot make a managed instruction safe.

The audit calls the same policy evaluator used by guardDaemonSessionInvocation with the managed-session marker. It never copies SESSION_SANCTIONED_SUBCOMMANDS into a test or derives authorization from what a prompt requests. A finding names file, line, subcommand, and reason. A newly introduced command-bearing source must enter discovery without editing a hand-curated list of known command occurrences.

Wire the check into the repository's existing integrity/CI validation path. Its behavioral tests feed real instruction fixtures to the audit and policy, including a newly added blocked instruction, a compatible command, a legitimate operator-only instruction, a prohibition, malformed classification, a retry prompt, and ambiguous dynamic construction. These test an executable checker, not incidental skill wording. Add production prompt/context integration proof at the narrowest sufficient entry point.

### 2. Correct known contradictions without opening the allowlist

- **FINISH recording:** adr-2026-08-01-engine-owned-resumable-finish-publication D3/D4 already assigns recording to the coordinator and confines provider judgment to prose. Keep finish-record blocked in managed sessions. Replace the missing-recording retry's provider instruction with coordinator-owned observe/record/verify progression; a missing coordinator cannot fall back to telling the agent to write the marker. Keep publication failures local to FINISH under the existing typed dispositions. The presentation retry must also stop asking the provider to re-record.
- **Bootstrap:** adr-2026-08-28-test-suite-drift-budget-and-verification-mode D8.1–D8.3 makes the guided interview and config reads/writes operator-only. Do not admit config. Its pre-existing auto-mode config-init instruction remains a real audit baseline contradiction, not an interactive exemption. Recommended resolution: managed prelude does only supported refresh work on an already initialized project; missing required setup returns an explicit operator-setup requirement before provider dispatch. The unmarked operator bootstrap retains configuration initialization. This new resolution for the previously excluded managed auto-mode path needs an additive architectural decision before approval.
- **Aggregate verification and operator verbs:** test-suite and build-review operator verbs stay blocked. Their legitimate operator-only instructions remain valid. Engine-owned verification is never delegated merely to clear the audit.

The initial check must pass because contradictory reachable instructions have been corrected, not because they were grandfathered, suppressed by file, or reclassified contrary to their runtime context.

### 3. Attribute managed execution consistently

Pass a typed managed-session context from the engine through InvokeOptions and every supported provider adapter. It supplies the absolute feature-worktree root, canonical feature slug, logical dispatch identity, and provider identity. Candidate overlays cannot clear or replace that ownership context.

Claude and Codex already stamp CONDUCT_DAEMON_SESSION=1. PiProvider.invoke currently supplies no corresponding env overlay; close that parity gap. Preserve existing authentication, tmux scrubbing, self-host containment, fresh-session rules, and supported interactive-mode behavior.

Feature context is engine-owned metadata, not inferred from the child process cwd or model-generated text. A changed cwd and nested ordinary subprocesses retain the original attribution. Project-scoped prelude has explicit project attribution; it must never invent a feature slug. Daemon feature dispatch without required attribution must fail preparation explicitly instead of silently running unobservable.

### 4. Report refusals from the refusal boundary

Keep guardDaemonSessionInvocation pure. Its denied result exposes the parsed subcommand as typed data. The early index.ts refusal branch records a closed ConductorEvent occurrence before returning its nonzero result, and still invokes no blocked command handler.

The event contains feature/dispatch attribution, a bounded subcommand, a stable event id, and timestamp. It contains no raw command line, flags, environment, provider output, request payload, or credentials. Unknown/malformed command identity has an explicit representation rather than an arbitrary diagnostic string.

Refusal remains refusal if telemetry cannot be written. Missing or invalid context and persistence failure produce a bounded diagnostic; they cannot enable the command, claim successful recording, or select a different feature from cwd.

### 5. Use the existing event schema and reader path across processes

The CLI and optional gh wrapper are separate processes without the engine emitter. Use the approved external-process event pattern, with one writer per producer ledger under the feature's .pipeline directory. Proposed layout: .pipeline/session-events/«dispatch-id»/«producer-id».jsonl. The engine provisions the root and identities; child text cannot choose a different project.

Each producer owns its file, avoiding concurrent append to either the engine ledger or the existing shared closeout ledger. A gh invocation can write its attempt and terminal observation to the same producer file. Events use the ConductorEvent union directly.

Extend the existing external-event tail/reader to ingest those files and project validated events onto the same feature emitter. It is a delivery extension of the spine, not a watcher that infers occurrences from changing artifacts. Existing canonical persister and daemon rendering consume the projected events.

The current CloseoutEventTail is started only during build. The new runtime occurrences need a feature-run owner covering FINISH, validation, repairs, failure, and cancellation too. Move/generalize the existing tail ownership instead of adding an unrelated polling loop. Feature event persistence in daemon-cli.ts is the natural lifetime owner; non-daemon managed callers must supply an explicit equivalent owner.

Use stable event identities for replay deduplication, retain pending producer records through engine interruption, read complete bounded records only, and await a final drain before closing the feature's persister/renderer. Canonical-ledger projection is the durable consumer view; the producer spool must not also enter rollups as a second copy of the same event. Malformed records produce bounded diagnostics and do not prevent later valid records from being projected.

Read-only provider policies must expose only the narrow engine-provisioned telemetry write destination required for these occurrences. Do not make all .pipeline data writable or weaken sealed-artifact/reviewer boundaries. This integration must be verified through the existing containment/admission seam.

### 6. Bounded GitHub observation — operator-selected Medium scope

Provision a gh executable wrapper only in managed provider environments. It resolves the real binary before adding itself to PATH, preserves stdin/stdout/stderr, arguments, exit status and signals, and records recognized unguarded mutations before forwarding. It does not retry, rewrite, redirect, or grant authorization to a mutation.

Distinguish attempted invocation from a returned success/failure; a missing terminal result is unknown, never success. A CLI exit status is not independent proof of remote state. Keep normal read-only commands quiet. Unclassifiable potentially mutating gh forms produce a possible-bypass diagnostic rather than a false read-only verdict.

At minimum classify standard PR/issue/repository/label mutations, REST methods including implicit writes caused by field parameters, and GraphQL mutation/unknown requests. Do not log payload values or consume stdin/file payloads merely to classify them. Unknown aliases/extensions or opaque input are observable as unknown, not silently clean.

The real transport inside makeProductionGh must avoid recursively entering this wrapper for guarded operations. Its private transport selection retains the existing authorization policy and operator/bot credential handling. A marker inherited by the whole provider session is not proof that a particular gh call was authorized; no public bypass flag or session-wide guarded status is introduced.

This is observation of existing session command execution, not an additional permission path for harness code. Harness-authored GitHub operations still enter the guarded boundary. The production invocation audit must identify the narrow wrapper transport explicitly, without a whole-file exemption.

**Operator-approved coverage limit:** this option covers normal PATH-resolved gh calls, including nested scripts that inherit that environment. Absolute binary paths, modified PATH, arbitrary HTTP/SDK clients, and separate MCP transports remain outside this observer. Documentation and event names must not claim otherwise. It adds visibility, not a general security sandbox and not a new automatic blocking policy. The operator accepted this boundary in chat on 2026-10-01.

### 7. Wider observation option

If the intended acceptance condition covers every way a provider can reach GitHub, do not approve the bounded wrapper as sufficient. Re-open complexity and the observation architecture for process/network containment, credential mediation, and all supported provider tool boundaries. This is a larger scope than the selected source-audit approach and cannot be promised by an allowlist, PATH wrapper, or transcript scanner.

No implementation plan may silently choose between these options.

## Architectural alignment and precedent

- **Authority:** adr-2026-09-11-github-operation-ownership D1/D6/D7 keeps mutation authorization in the guarded operation adapter, makes refusals first-class, and requires mechanical invocation auditing. Observation does not replace authorization.
- **FINISH:** adr-2026-08-01-engine-owned-resumable-finish-publication D3/D4 governs correction of the recording retry. No supersession is needed to restore that existing boundary.
- **Bootstrap:** D8.1–D8.3 of adr-2026-08-28-test-suite-drift-budget-and-verification-mode governs the guided interview. The proposed disposition of the previously excluded managed auto-mode path is an uncovered decision and is not yet authoritative.
- **External-process telemetry:** adr-2026-08-08-pipeline-owned-closeout-timestamps supplies the applicable semantic pattern: producers write canonical event records outside the engine-owned file, one writer per file, and the existing reader projects to the live bus. Allowed variation is a family of producer files because concurrent short-lived session commands cannot share one uncoordinated writer.
- **Sink registration:** adr-2026-07-26-event-sink-registry-exhaustiveness applies. New occurrences declare render and persist ownership; daemon-cli and terminal rendering explicitly format feature/command attribution.

Pattern rediscovery seeds: engine/github-invocation-audit.ts auditGithubInvocationSource; execution/daemon-session.ts guardDaemonSessionInvocation; engine/closeout-tail.ts CloseoutEventTail; engine/event-sinks.ts EVENT_SINKS; daemon-cli.ts feature event persistence and renderDaemonEvent. These identify roles and semantic traits, not fixed line snapshots or an exact-copy contract.

## Event-spine verdict

Channel? Yes — external session processes deliver runtime occurrences.
Concern: occurrence — a command was refused or an unguarded mutation was attempted/completed.
Verdict: extend the union and the existing reader with same-schema producer ledgers.
Exceptions: A and B — separate processes without emitter access, and one writer per file.
No bespoke telemetry schema, artifact timestamp reconstruction, unrelated watcher, or second operator log is proposed.

## Wiring Surface

These are approved design-time caller commitments, not claims of existing reachability.

| Surface | Production caller/consumer |
|---|---|
| Command-context audit | Repository integrity/CI check over shipped source and skills |
| Shared guard policy evaluation | Existing CLI guard plus instruction audit |
| Corrected FINISH retry progression | Conductor completion handling through existing finish coordinator |
| Managed bootstrap context/preflight | runProjectPrelude and its skill invocation preparation |
| Managed-session attribution and wrapper provisioning | Provider execution preparation and direct managed invoke callers; all three provider adapters |
| Refusal occurrence producer | index.ts early guard refusal, before command dispatch |
| gh observation wrapper, bounded option only | PATH overlay in managed provider child environments |
| Private guarded gh transport selection | makeProductionGh after the existing operation policy authorizes the call |
| Canonical producer-ledger writer | Refusal producer and bounded gh observer |
| External event ingestion and lifecycle | Extended existing tail under feature event persistence, with final drain |
| New ConductorEvent variants | EVENT_SINKS, EventPersister, daemon log renderer and terminal subscriber |
| Operator documentation | README, affected daemon/CLI guidance and repository validation reference |

Candidate paths: src/conductor/src/execution/{daemon-session,llm-provider,claude-provider,codex-provider,pi-provider}.ts; src/conductor/src/engine/{conductor,project-prelude,provider-execution,step-runners,tracker-client,closeout-tail,event-sinks}.ts; src/conductor/src/types/events.ts; src/conductor/src/index.ts; src/conductor/src/daemon-cli.ts; src/conductor/src/ui/{subscriber,terminal-renderer}.ts; skills/bootstrap/SKILL.md; skills/conduct/SKILL.md; test/test_harness_integrity.sh. New focused audit and producer/observer modules should keep responsibilities out of the conductor where possible.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Bounded gh monitoring is mistaken for complete GitHub visibility | Knowledge | High without scope decision | High | Operator chooses coverage; record explicit acceptance boundary before stories |
| Context annotations hide reachable blocked commands | Technical | Medium | High | Fail unclassified sources; integration proof binds context to real prompt/dispatch paths; no blanket grandfathering |
| Concurrent child writes corrupt telemetry | Data | Medium | High | Separate producer files, shared schema, validated projection and replay identity |
| FINISH or failure exits before telemetry is drained | Integration | Medium | High | Feature-lifetime tail and awaited close-boundary drain |
| New telemetry writes weaken read-only review containment | Security | Medium | High | Narrow producer destination only; preserve existing write-fence and seal authority |
| gh wrapper recursion, false bypass reports, or leaked payload | Integration | Medium | High | Private real transport, closed metadata, classification and stream-preservation fixtures |
| Pi silently lacks session policy/context | Integration | Verified current gap | High | Provider-catalog-driven adapter coverage including Pi |
| Central conductor overlaps other in-flight work | Integration | Medium | Medium | Minimal wiring, dedicated modules, refresh overlap evidence at plan gate |

## Early overlap scan

ai-conductor overlap-scan reported:
- origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts
- origin/spec/per-step-provider-routing-927: skills/conduct/SKILL.md
- origin/spec/self-host-phase6-wiring: src/conductor/src/engine/conductor.ts

The scan's network dependency read initially failed. A read-only retry against the originating issue's blocked_by endpoint returned an empty array. No GitHub dependency blocker is declared. Branch overlap is advisory and does not authorize changing another feature's artifacts. The scan warns that renames/name-only diffs may be missed.

## ADR reuse and creation decision

The refusal event shape, event sink registration, FINISH ownership, and guarded GitHub authorization reuse the approved ADRs above.

The managed-session observation integration, dispatch-to-producer attribution, and concrete transport/lifetime ownership establish a new integration boundary. They warrant one new ADR after the operator chooses bounded or comprehensive coverage. Include the managed bootstrap mismatch resolution in that decision and add an in-place note beside the existing D8.3 scope exclusion if it is approved. Do not author a second permanent channel or silently amend an approved decision.

The complete structural decision is APPROVED in .docs/decisions/adr-2026-10-01-daemon-session-command-contracts.md. The operator approved it after accepting bounded gh coverage. Its narrow clarifications to the governing bootstrap and GitHub ownership decisions are included in this same DECIDE change.

## Verification strategy

- Audit fixtures prove command/context classification and diagnostics through the real production policy.
- Narrow prompt/dispatch integration proves FINISH recording stays engine-owned and managed bootstrap cannot be instructed to execute blocked config operations.
- Provider adapter fixtures enumerate the built-in catalog and assert real invocation env/context wiring without running any provider.
- Refusal integration enters the CLI guard, records canonical evidence, and proves the blocked handler was never invoked.
- External-event integration uses temporary producer files, the real tail/emitter/persister, and captured daemon rendering. Cover concurrency, split records, interruption/replay, cancellation, and final drain without a full conductor lifecycle.
- Wrapper tests, if selected, prove the production transport hits the injected fake before any mutating arguments are exercised. Cover reads, known writes, unknown forms, guarded transport, changed cwd, nested environment inheritance, binary recursion, and stream/exit preservation. No real gh/network execution.
- Containment tests prove the event destination is writable while protected repository/provider state remains protected.
- This DECIDE pass runs no implementation or aggregate test suite. It consumes source evidence; future BUILD tasks own scoped behavior tests and the configured test_suite gate owns aggregate proof.

## Verify-claims ledger

- [verified] Guard source admits github-operation and omits finish-record/config — execution/daemon-session.ts.
- [verified] buildRetryHint's missing-recording branch emits finish-record, and the presentation branch asks for re-recording — engine/conductor.ts.
- [verified] Engine publication already has a recordFinish adapter — engine/finish-publication-production.ts.
- [verified] The approved FINISH decision assigns final recording to the coordinator — D3/D4 of adr-2026-08-01-engine-owned-resumable-finish-publication.
- [verified] D8.1–D8.3 protects operator-only bootstrap while explicitly leaving the old managed auto-init path outside that prior feature — adr-2026-08-28-test-suite-drift-budget-and-verification-mode.
- [verified] PiProvider.invoke does not currently pass a daemon-session marker overlay; Claude/Codex do — execution provider sources.
- [verified] CloseoutEventTail currently starts only for build and stop() does not perform an awaited final poll — engine/conductor.ts and engine/closeout-tail.ts.
- [verified] makeProductionGh resolves the literal gh program at process execution — engine/tracker-client.ts.
- [verified] gh api --help documents GET by default and implicit POST with field parameters; a classifier considering only explicit --method would miss writes.
- [verified] Daemon feature persistence already subscribes to renderedEventTypes — daemon-cli.ts.
- [confirmed] Normal PATH-resolved gh coverage is the accepted bypass-observation boundary.
  - Authority: operator's “fine” response to the explicit bounded-versus-all-paths question on 2026-10-01.
  - The exclusion is recorded additively in the approved track marker; it is not an inferred narrowing.
  - Status: APPROVED scope input.

Verdict: CLEAR. Scope and structural decisions are operator-approved; existing-code claims are grounded above.

## Approval and next gate

The operator selected normal managed gh execution with its stated exclusions and subsequently approved the complete architecture. No blocking design question remains. Acceptance stories are the next operator gate. The high-impact risks above remain explicit implementation verification obligations, not unresolved architectural assumptions.
