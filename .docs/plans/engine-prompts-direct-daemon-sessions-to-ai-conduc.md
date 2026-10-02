# Plan: Daemon session command compatibility and visibility

**Date:** 2026-10-02
**Source:** jstoup111/ai-conductor#2709
**Stories:** .docs/stories/engine-prompts-direct-daemon-sessions-to-ai-conduc.md
**Complexity:** M
**Status:** Ready for operator review

## Technical Approach

Audit existing engine/skill instructions against the production daemon-session policy, retaining explicit managed/operator/non-executable contexts. Correct FINISH and bootstrap directions at their existing owners. Thread typed engine-owned identity through the existing provider invocation seam, observe ordinary PATH-resolved gh calls in managed child environments, and deliver bounded ConductorEvent records from separate producer files through the existing tail, emitter, canonical EventPersister and daemon/terminal subscribers. Event ids identify occurrences; they confer no authorization, completion or independently verified remote effect.

Scope remains the accepted Approach A and bounded observation contract. Absolute binaries, replaced PATH, custom HTTP/SDK clients and separate MCP transports remain outside monitoring coverage. Native read-only reviewer policies remain mandatory; preparation must prove both protected writes are denied and the narrow producer destination is usable, otherwise refuse before launch with named recovery. Do not assume all current provider policies already support that combination.

Focused local patterns: discover source with github-invocation-audit's recursive/AST coordinates, but keep command compatibility distinct from GitHub authorization; reuse guardDaemonSessionInvocation as permission authority. Reuse FINISH observe/advance/re-observe and recordFinish, not provider-directed mechanical recovery. Extend CloseoutEventTail's caught single-inFlight reader and preserve synchronous stop; add explicit awaited drain and acknowledged projection because current best-effort emit is not persistence proof. Reuse EventPersister as sole canonical writer and EVENT_SINKS as subscription authority. Reuse provider-execution candidate preparation and catalog enumeration, applying context after candidate overlays. Search by these symbols, not line numbers. A new parser, wrapper asset or focused reader may isolate behavior without introducing a second policy, bus, dispatch API or canonical log.

Scope-check: repository-only audit integration remains in this repository's validation gate; installed runtime and skill behavior remain on shared shipped surfaces. No new skill or configuration key. Provider contracts are shared, with native Claude/Codex/Pi adapter implementations and explicit unsupported capability. The affected mechanisms and test seams were read during DECIDE (verified); support for any protected observation policy is a runtime proof obligation, not an assumed platform fact.

## Prerequisites and execution

Accepted stories, approved architecture and operator-confirmed conflict corrections are present on this spec branch before BUILD. Existing adapters, coordinator, event spine and integrity route are the integration substrate. Each task is one focused TDD change with an estimated 2–5 minute implementation unit; each owns its named lowest-sufficient unit or integration checks. Use fixture-owned files, injected/deferred I/O and fake clocks. Prove process-fake reachability with benign arguments before mutating fixtures; no ordinary test calls a real provider, GitHub or another third party. Each task runs only its affected tests through ai-conductor scoped-run; the test_suite gate owns aggregate evidence. No whole-workflow acceptance test is required merely because several internal files are touched.

## Tasks

### Task 1: Expose structured refusal from the existing command policy

**Story:** 1
**Story:** 2
**Story:** 3
**Type:** negative-path
**Files:** `src/conductor/src/execution/daemon-session.ts`, `src/conductor/test/execution/daemon-session-enforcement.test.ts`
**Dependencies:** none

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Extend the existing pure guard result with a closed, bounded subcommand identity and expose the production policy evaluator to the audit without exporting a second permission list. Preserve marker precedence and the existing test-only valve; never enable it in production. Reuse guardDaemonSessionInvocation and its table-driven fixture pattern.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Table-driven guard tests and the audit-policy adapter call the same production evaluator: every currently admitted managed command passes, while daemon-control, config, test-suite and operator build-review requests fail; changing a fixture policy decision changes both evaluations without adding a permission exemption.
- Marked finish-record returns refusal at the guard and invokes no recorder; marked config read, init and set return refusal before dispatch and before any project or machine configuration mutation, as asserted with handler spies and byte snapshots.
- Pure guard fixtures return the bounded subcommand on refusal, retain unmarked command admission and existing marker precedence, and introduce no production config or environment switch that grants authority.

### Task 2: Discover and classify command-bearing instruction regions

**Story:** 1
**Type:** negative-path
**Files:** `src/conductor/src/engine/session-command-audit.ts`, `src/conductor/src/engine/session-command-contexts.ts`, `src/conductor/test/engine/session-command-audit.test.ts`
**Dependencies:** Task 1

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Add the focused source-audit module adjacent to github-invocation-audit. Reuse recursive source discovery, TypeScript AST source positions and bounded skill-region parsing; allow only managed, operator-only and non-executable region contexts. Discover new instruction sources without an occurrence inventory; ignore historical .docs material. Keep source context declarations separate from command permission in a bounded source-context registry; explicit managed source families cover new discovered sites, while operator-only and prohibition regions have checked boundaries so no per-command occurrence registration is needed.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Audit discovery fixtures add a new engine source and a new shipped skill containing blocked managed instructions without registering either occurrence; evaluating them returns their file, line and blocked subcommand.
- Context-parser fixtures classify explicitly operator-only instructions and non-executable prohibitions without managed violations, and exclude historical design material from executable instruction discovery.
- Command-bearing fixtures with missing, malformed, stale or ambiguous region classification fail at the originating source instead of receiving an interactive default; declaration endpoints and discovered regions must agree.

### Task 3: Reject unresolved and constructed blocked instructions

**Story:** 1
**Type:** negative-path
**Files:** `src/conductor/src/engine/session-command-audit.ts`, `src/conductor/test/engine/session-command-audit.test.ts`
**Dependencies:** Task 2

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Extend bounded AST constant/string evaluation using the existing invocation audit as a search precedent, preserving origin coordinates across supported concatenations and templates. Cover retry and remediation construction explicitly; unsupported dynamic command construction returns an unresolved finding instead of a guessed argv.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Retry/remediation fixtures with a blocked command assembled through supported concatenation or template interpolation produce a finding naming the originating instruction and blocked subcommand.
- Dynamic construction fixtures that cannot be resolved sufficiently for managed policy evaluation fail with an unresolved-command finding at the source, without a compatibility pass or permission change.

### Task 4: Wire instruction validation and real dispatch context declarations

**Story:** 1
**Type:** happy-path
**Files:** `src/conductor/src/engine/session-command-audit.ts`, `src/conductor/src/engine/session-command-contexts.ts`, `src/conductor/src/engine/github-invocation-audit.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/conductor.ts`, `skills/bootstrap/SKILL.md`, `skills/conduct/SKILL.md`, `skills/finish/SKILL.md`, `skills/pr/SKILL.md`, `src/conductor/src/engine/github-invocation-audit-cli.ts`, `test/check_github_invocation_boundary.sh`, `src/conductor/test/engine/session-command-audit-integration.test.ts`, `src/conductor/test/engine/github-ownership/24-boundary-audit-cli.test.ts`, `src/conductor/test/bootstrap-skill-config-questions.test.ts`
**Dependencies:** Task 3, Task 5, Task 6

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Integrate compatibility findings into the existing github-boundary-audit validation route used by check_github_invocation_boundary.sh, avoiding a new public CLI verb. Classify actual shipped command-bearing regions discovered by the audit, including retry/remediation instructions; correct any remaining blocked managed direction using the approved owner, never by expanding permission. Reuse the StepRunner buildSystemPrompt path and managed prelude fixtures to demonstrate which regions a marked dispatch can execute. This task owns audit-to-repository-validation integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- The production validation entry point, exercised with injected repository inputs, returns nonzero for a newly introduced blocked engine or skill instruction and identifies its file, line and subcommand without manual occurrence registration; the shell gate invokes that entry point and propagates its failure.
- Production prompt/dispatch fixtures intentionally label an executed marked-session region operator-only and assert the instruction-context integration check fails that contradictory path; correctly excluded unmarked operator instructions remain compatible.
- The shipped instruction discovery set evaluates clean after owner-correcting blocked directions; checks use execution-context and audit verdicts rather than matching incidental prose, and the runtime sanctioned set is unchanged.

### Task 5: Route FINISH recording repair through its coordinator

**Story:** 2
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/finish-publication.ts`, `src/conductor/src/engine/finish-publication-production.ts`, `src/conductor/test/engine/conductor-finish-publication.test.ts`, `src/conductor/test/engine/finish-publication-production.test.ts`
**Dependencies:** none

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. At missing-recording and PR-presentation retry branches, reuse the existing observe/advance/re-observe publication coordinator and recordFinish adapter. Replace provider recording assignments with typed coordinator progression; maintain authorized intent and existing publication allowance. Reuse focused FINISH fixtures and injected recorder/provider/GitHub seams; stop at the FINISH transition rather than completing Conductor.run. This task owns FINISH integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- FINISH entry fixtures with coherent evidence and an unrecorded authorized outcome observe the engine recorder followed by verification, with no provider recording action or instruction.
- Presentation-repair fixtures finish the bounded provider prose task and then assert the engine performs subsequent completion recording and verification.
- A missing or unusable coordinator produces an explicit unsupported/refused FINISH result, no provider recording instruction, and no fabricated completion marker.
- Missing, stale and inconsistent publication-evidence fixtures leave completion unrecorded and return the existing typed FINISH disposition naming the failed condition.
- A failed recorder write followed by recovery observes prior effects before acting, replays no already verified publication effect, dispatches no BUILD solely for recording failure, and remains within existing publication retry/exhaustion accounting.

### Task 6: Gate managed bootstrap refresh on initialized configuration

**Story:** 3
**Type:** negative-path
**Files:** `src/conductor/src/engine/project-prelude.ts`, `skills/bootstrap/SKILL.md`, `src/conductor/test/engine/project-prelude.test.ts`, `src/conductor/test/engine/registry-cli.test.ts`, `src/conductor/test/bootstrap-skill-config-questions.test.ts`
**Dependencies:** Task 1

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Add readiness before invokePreludeSkill using the existing project configuration reader/validation seam; return a typed setup-required failure rather than writing defaults. Supply a managed-refresh instruction branch that consumes engine-established readiness and skips operator configuration/registration commands. Keep unmarked bootstrap initialization and refuse-to-clobber behavior. Reuse runProjectPrelude and runConfigInit fixtures with fixture-owned config files. This task owns prelude readiness-to-launch integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Initialized-project runProjectPrelude fixtures reach supported refresh with no provider direction to execute config reads, initialization or writes; the managed refresh branch never runs the operator configuration interview.
- An unmarked operator bootstrap fixture reaches the existing runConfigInit writer on an uninitialized project and retains successful guided initialization through the same validated CLI options.
- Missing required configuration makes runProjectPrelude report operator bootstrap required before launching any provider and writes no replacement project or machine configuration.
- Unreadable or invalid required configuration produces a named setup problem, zero provider launches and no ready result; before/after project and machine configuration snapshots remain unchanged.
- Initialized configuration with non-default operator choices remains byte-identical after managed refresh and after an unmarked operator re-run; existing runConfigInit no-clobber fixtures retain their behavior.

### Task 7: Validate authoritative session identity and producer roots

**Story:** 4
**Type:** negative-path
**Files:** `src/conductor/src/execution/managed-session-context.ts`, `src/conductor/src/execution/llm-provider.ts`, `src/conductor/test/execution/managed-session-context.test.ts`
**Dependencies:** none

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Add a typed engine-owned context with project/worktree identity, feature-or-project scope, dispatch id, provider and provisioned producer root. Validate context before serializing it into the child environment; candidate overrides cannot replace ownership. Derive canonical path containment without cwd attribution and reject symlink/traversal escapes. Reuse execution-identity semantics, with explicit project scope instead of invented feature data.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Managed-context preparation fixtures missing required daemon-feature attribution fail naming the missing context before the launch callback is invoked.
- Context composition fixtures attempt candidate-specific ownership overrides and assert the engine-owned feature, dispatch and project attribution remains authoritative.
- Preparation and ingestion path-validation fixtures using traversal or symlink escapes write no event and attribute no event outside the feature provisioned root.
- Project-prelude context fixtures without a feature produce explicit project scope and no invented feature slug; child cwd is never used to recover missing feature identity.

### Task 8: Carry managed context through every provider and fallback

**Story:** 4
**Type:** happy-path
**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/project-prelude.ts`, `src/conductor/src/execution/claude-provider.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/engine/provider-execution.test.ts`, `src/conductor/test/execution/managed-session-adapters.test.ts`
**Dependencies:** Task 7, Task 10

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Thread owning context through invokeProviderCandidate/executeProviderCandidates and direct invoke call sites; apply authoritative context and marker after any environment overlay in every built-in adapter; Pi passes no env today, so its adapter gains an explicit env carrying the context and marker. Enumerate providers from the existing catalog and preserve provider-native auth, tmux scrubbing, cancellation and fresh-session options. Fake the real subprocess boundary and assert launch env there. This task owns engine-context-to-provider-launch integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Catalog-driven real-adapter launch fixtures for Claude, Codex and Pi assert the daemon-session guard marker plus originating feature and dispatch in the environment delivered to the fake process; an overlay cannot unset the marker.
- Candidate-fallback, changed-child-cwd and nested inheriting-subprocess fixtures assert a covered command observation retains the original feature attribution and correct engine-issued dispatch identity.
- Adapter fixtures assert managed context is added without changing native auth selection, tmux masking, cancellation handling or fresh-session arguments, and the engine process environment is not mutated.

### Task 9: Prove narrow observation access under the selected review policy

**Story:** 4
**Type:** negative-path
**Files:** `src/conductor/src/execution/managed-session-preparation.ts`, `src/conductor/src/engine/build-review-read-only-capability.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/self-host/write-fence.ts`, `src/conductor/test/engine/managed-session-preparation.test.ts`
**Dependencies:** Task 7, Task 10

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Add observation-destination preparation to the existing candidate setup path. Compose with the selected native read-only policy and existing self-host fence; do not replace native review flags or widen protected roots. Extend the existing capability/probe seam with faithful process fakes demonstrating allowed producer writes and denied protected writes. Unsupported or unprovable combinations return existing setup-unavailable attribution before launch. This task owns protected-destination admission integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- A supported read-only invocation fixture through candidate preparation records an occurrence only inside its provisioned per-dispatch destination while writes to source, sealed artifacts, unrelated pipeline state and operator configuration remain refused.
- An unsupported or unprovable selected-provider policy fixture launches zero provider processes and reports the provider, observation capability and concrete recovery action; native read-only availability alone cannot satisfy observation readiness.
- The preparation/fence diff preserves the exact existing native review profiles and live-checkout exclusion policy; no broad workspace-write fallback, general shell-write permission, copied credential store or new protection bypass is introduced.

### Task 10: Write bounded typed occurrences into producer-owned files

**Story:** 5
**Story:** 6
**Type:** infrastructure
**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/execution/session-event-producer.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/test/execution/session-event-producer.test.ts`
**Dependencies:** Task 7

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Define closed observation variants in ConductorEvent and their sink declarations. Implement the local producer over its validated context: one producer id/file, stable occurrence id and source time, distinct correlated attempt/result ids. Serialize only allowlisted fields with a byte bound; construct diagnostics from closed codes, not raw errors. Reuse bounded diagnostic precedent from boundCiRepairDiagnostic, without copying unrelated payload fields.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Producer fixtures for malformed or unsafe command identity emit a bounded unknown representation and contain no raw argv, credential, environment, request body, payload-file content or transport-error text.
- Bypass occurrence persistence and renderer fixtures with secret-shaped arguments, payloads and transport errors assert none of those values appears in serialized or rendered output.
- Concurrent producer fixtures allocate separate dispatch/producer JSONL files in .pipeline/session-events, each with one writer; every record validates as ConductorEvent with stable event id and original source time, and neither events.jsonl nor pipeline-events.jsonl is directly appended by the producer.
- Schema fixtures give one invocation distinct correlated attempt/result ids and separate invocations separate ids; all new variants declare persist/render ownership in EVENT_SINKS and carry observations rather than authorization or completion evidence.

### Task 11: Extend the existing tail with bounded incremental producer reads

**Story:** 7
**Type:** negative-path
**Files:** `src/conductor/src/engine/closeout-tail.ts`, `src/conductor/src/engine/session-event-reader.ts`, `src/conductor/test/closeout-tail.test.ts`, `src/conductor/test/engine/session-event-reader.test.ts`
**Dependencies:** Task 10

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Extend CloseoutEventTail with producer input support through a focused reader, retaining one existing consumer path. Track per-file byte offsets and pending records; cap incremental reads and record bytes before JSON parsing. Reuse the inFlight traversal lock and caught timer promises. A settled-producer drain can diagnose unfinished data; ordinary polling cannot. Preserve the synchronous stop API and legacy ledger behavior.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Partial-record reader fixtures consume and diagnose nothing during ordinary polling before a newline, deliver the record once complete, and report an incomplete record at the settled producer boundary without inventing contents.
- Malformed JSON, oversized and invalid-attribution complete records generate bounded diagnostics while later valid records remain deliverable; byte-offset fixtures preserve UTF-8 boundaries and path validation.
- Deferred-read/subscriber and fake-time fixtures assert one traversal owns progress during overlapping polls, no input advances twice, and stop remains synchronous with no new background polls after stop.
- Temporarily unreadable sources and failing sinks produce caught bounded failures with no unhandled background rejection; after recovery retained complete records are deliverable, and failed delivery has not discarded pending input.

### Task 12: Acknowledge canonical persistence and deduplicate replay

**Story:** 7
**Type:** negative-path
**Files:** `src/conductor/src/engine/event-persister.ts`, `src/conductor/src/engine/closeout-tail.ts`, `src/conductor/src/engine/session-event-reader.ts`, `src/conductor/test/engine/event-persister.test.ts`, `src/conductor/test/engine/session-event-replay.test.ts`
**Dependencies:** Task 11

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Build the observation-id dedup index once when canonical persistence starts and update it after successful append. Use a persistence-acknowledged emission path instead of treating best-effort emit as proof; emitOrThrow is the local precedent, but scope its use to external observation projection. Advance producer progress only after successful persistence; retry partial subscriber failure with the same id and preserve ordinary event append semantics. This task owns producer-to-canonical replay integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Restart integration with real fixture producer files, emitter and EventPersister projects pending prior-dispatch records with original attribution and exactly one durable canonical record per occurrence id.
- Injected canonical append failure after a record is read retains unread/pending progress; after retry succeeds the canonical result has no duplicate occurrence.
- Partial-subscriber-failure and process-interruption recovery fixtures replay an already persisted occurrence without duplicating its durable record; any repeated daemon-log delivery retains the same event id.
- Dedup fixtures retain both distinct invocations with equal subcommand/operation and retain both correlated attempt and terminal-result records; ordinary events retain their prior append behavior.
- I/O-count fixtures show canonical ids are indexed once per persistence owner and updated on append rather than rescanning the full canonical ledger per poll; observation producer files are not separately counted by canonical rollups.

### Task 13: Own event tails for the full feature and await final drain

**Story:** 7
**Type:** happy-path
**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/event-persister.ts`, `src/conductor/src/engine/project-prelude.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/session-event-lifecycle.test.ts`
**Dependencies:** Task 12, Task 19

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Move external-tail ownership from the BUILD-only conductor block to the feature-event persistence scope, with an equivalent explicit owner for managed non-daemon/prelude calls. Start before invocation; await in-flight processing and bounded final drain after producer settlement, before subscriptions detach on every exit. Reuse feature persistence cleanup ownership rather than adding a separate daemon watcher or speculative file cleanup. This task owns lifecycle-to-drain integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Feature-event-owner integration with concurrent producer files and real internal emitter/persister plus captured daemon rendering delivers every distinct valid occurrence to the canonical record and log with its correct feature/dispatch/event identities.
- Lifecycle fixtures for BUILD, FINISH, validation, repair, failure and cancellation assert tail start precedes provider execution and completed available records drain before consumers detach; shutdown also awaits the owned drain.
- Managed non-daemon and project-prelude fixtures supply an explicit persistence/tail owner with project-scoped attribution where appropriate; no full Conductor lifecycle or third-party binary is needed to prove ownership.
- The lifecycle diff introduces no parallel observer/poller and no bulk producer-file cleanup; pending files survive interruption under ordinary worktree retention, while synchronous legacy stop remains callable unchanged.

### Task 14: Emit CLI refusals before command dispatch

**Story:** 5
**Type:** negative-path
**Files:** `src/conductor/src/index.ts`, `src/conductor/src/execution/daemon-session.ts`, `src/conductor/src/execution/session-event-producer.ts`, `src/conductor/test/execution/session-command-refusal.test.ts`
**Dependencies:** Task 1, Task 10, Task 12, Task 19

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Wire structured refusal immediately after the existing entry guard and before handler parsing/dispatch. Append the safe occurrence via provisioned context, then preserve the refusal exit; a write error yields bounded stderr without authorizing or claiming persistence. Test the real CLI entry/refusal collaboration with handler/process seams replaced before any mutating arguments. This task owns CLI-refusal-to-projection integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- CLI refusal integration with available storage asserts nonzero exit, zero blocked-handler calls, a canonical feature event and daemon log naming the feature and blocked subcommand; FINISH, validation, repair and error-path contexts satisfy the same contract as BUILD.
- Allowed managed worker-command fixtures reach ordinary handler dispatch with no refusal event.
- Injected refusal-event write failure still invokes no handler and returns refusal, with a bounded telemetry-failure diagnostic that makes no successful-recording claim.
- Ingestion fixtures claiming another feature are rejected with a bounded diagnostic and projected under neither guessed nor forged attribution.
- The entry fixture proves the production process/handler adapters reach injected fakes using benign arguments before any destructive/refused argv is exercised; removing the guard cannot reach a real third party.

### Task 15: Classify gh mutations without reading caller payloads

**Story:** 6
**Type:** negative-path
**Files:** `src/conductor/src/execution/gh-observation-classifier.ts`, `src/conductor/test/execution/gh-observation-classifier.test.ts`
**Dependencies:** none

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Implement a closed safe operation classifier for standard gh command families and API semantics. GET/HEAD and explicitly known reads are quiet; explicit mutating REST methods or implicit field writes are mutation attempts. GraphQL, aliases/extensions and opaque input that cannot be proven read-only become possible-bypass. Do not parse stdin or payload files and never emit their text. Keep this runtime classification separate from static ownership authorization.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Classifier fixtures assert recognized reads are quiet, standard mutation families and REST field-implied writes are mutations, and GraphQL, aliases, extensions or opaque calls not safely known read-only yield possible-bypass rather than a read verdict.
- Stdin and file-payload fixtures prove the classifier performs no input reads or payload-file opens, leaves bytes available unchanged for the command, and exposes no payload content in its bounded classification.

### Task 16: Forward observed gh commands exactly once

**Story:** 6
**Type:** happy-path
**Files:** `src/conductor/src/execution/gh-observer.ts`, `src/conductor/src/execution/gh-observer-assets.ts`, `src/conductor/test/execution/gh-observer.test.ts`
**Dependencies:** Task 10, Task 15

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Implement the managed wrapper entry and engine-packaged executable asset. Accept only provisioned context and a previously resolved real executable; call the classifier, attempt producer write, forward via injected subprocess seam once, then write a correlated terminal result if observed. Preserve streams, exit status and signal propagation; observation failure is diagnostic-only. The core.hooksPath hook installation in git-hook-assets.ts is the packaging precedent, not authorization to change the git guard. This task owns wrapper-to-process integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Production-wrapper fixtures for ordinary PATH-resolved raw mutations from a managed session and an inheriting child script record an attributable attempt before the single fake process call and a correlated terminal result when observed; executing REST field-implied writes produces mutation observations, and executing GraphQL, alias, extension or opaque-input calls not safely classifiable as read-only produces possible-bypass observations.
- Transport fixtures assert byte-identical argv and stdin/stdout/stderr forwarding, original exit status and termination-signal behavior, exactly one underlying call and no recursion, retry, rewrite, redirect or new command-blocking policy.
- Failure, timeout and lost-terminal-result fixtures report failed or unknown observations instead of successful remote writes; exit zero is only observed CLI success and never verified remote state.
- Injected observation-storage failure emits a bounded degraded-telemetry diagnostic while the underlying invocation is forwarded exactly once with original transport behavior.
- Before mutating argv tests run, a benign production-wrapper invocation proves the real transport adapter reaches the injected fake; the same isolation holds if classification or guard logic is absent.

### Task 17: Keep guarded GitHub transport private and separately audited

**Story:** 6
**Type:** negative-path
**Files:** `src/conductor/src/engine/tracker-client.ts`, `src/conductor/src/engine/github-invocation-audit.ts`, `src/conductor/src/execution/gh-observer.ts`, `src/conductor/test/engine/tracker-client.test.ts`, `src/conductor/test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts`, `src/conductor/test/engine/gh-observer-guarded-transport.test.ts`
**Dependencies:** Task 16

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Route makeProductionGh through the private real executable resolution so guarded operations never recurse into the observer. Preserve per-operation ownership checks and operator/bot credentials. Extend the static audit with precisely the wrapper passthrough call identity; adjacent raw calls and arbitrary harness writes must still fail. Do not add a public/session-wide guarded env flag. Reuse tracker-client dependency injection and existing audit fixtures. This task owns guarded-runner-to-private-transport integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Known read-only raw gh calls and authorized guarded-path calls complete through their expected transport with zero unguarded-mutation observations, while raw mutation fixtures still produce observations.
- A refused guarded operation produces zero raw-observer fallback calls and zero mutation calls; no whole-session authorization or public skip-observation flag is introduced.
- Guarded and unguarded executable-resolution fixtures invoke the resolved real transport once without recursive wrapper entry or duplicate mutation, and guarded calls retain existing authorization actor and operator/bot credential selection.
- Static-audit fixtures admit only the identified private observation passthrough; adding a neighboring raw call in the same file, a skill-directed raw write or an unregistered harness caller still fails validation.

### Task 18: Provision the gh wrapper only for managed child environments

**Story:** 6
**Type:** happy-path
**Files:** `src/conductor/src/execution/managed-session-preparation.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/execution/claude-provider.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/managed-gh-provisioning.test.ts`
**Dependencies:** Task 8, Task 9, Task 16, Task 17

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Resolve the underlying gh executable before prepending the per-invocation wrapper directory and wire the resulting environment through existing prepared invocation ownership. No engine code currently modifies PATH; prepend only the wrapper directory and preserve the operator environment and the core.hooksPath git guard. Expose monitoring coverage as bounded/unknown-completeness in the typed observation semantics; no empty event set proves no remote mutation. This task owns preparation-to-managed-PATH integration.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Prepared-invocation adapter fixtures resolve real gh before the wrapper PATH overlay, install observation only in managed child environments and inheriting scripts, preserve the core.hooksPath git guard and leave operator shells and unrelated engine commands unchanged.
- Coverage-result fixtures for absolute binaries, replaced PATH, custom HTTP/SDK clients and separate MCP transports outside the approved boundary assert that no event is represented as unknown monitoring completeness, never proof that no GitHub write occurred.
- Missing executable, invalid context or unprovable protected destination is reported through existing candidate setup failure before provider launch; no unobserved fallback launch or alternate public bypass is added.

### Task 19: Render bounded occurrences through existing subscribers

**Story:** 5
**Story:** 6
**Story:** 7
**Type:** happy-path
**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/src/ui/subscriber.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/test/engine/session-event-rendering.test.ts`, `src/conductor/test/ui/terminal-renderer.test.ts`
**Dependencies:** Task 10

**Steps:**
1. Add the focused failing fixtures for the observable assertions below at the listed test seams; run their affected selectors through ai-conductor scoped-run and establish RED.
2. Add closed refusal, attempt/result, possible-bypass and delivery-diagnostic rendering to existing daemon and terminal subscribers; derive subscriptions from EVENT_SINKS. Reuse the github_operation_refused formatting route and bounded diagnostic pattern. Do not create a side log or interpret these records as remote proof. This task owns event-to-subscriber presentation integration; Tasks 13/14 own their distinct producer/lifecycle boundaries.
3. Run the same scoped selectors to GREEN, verify the affected TypeScript checks include tests, and commit this behavior with its task attribution.

**Done when:**
- Real daemon and terminal subscriber fixtures format the same declared occurrence with feature slug where present, bounded subcommand/operation and refusal/attempt/result/possible-bypass status; project-scoped events show project attribution without inventing a slug.
- Persist/render registry fixtures cover every new occurrence variant and captured output excludes supplied credentials, raw arguments, payloads and transport-error text; storage-degraded and missing-terminal-result states never render as successful delivery or verified remote mutation.
- Repeated delivery of one event preserves its id in log output, while distinct event ids and correlated attempt/result records remain distinguishable to existing subscribers.

## Task Dependency Graph

Independent starts: 1, 5, 7, 15. Audit chain: 1 → 2 → 3 → 4, with 5 and 6 before 4. Runtime chain: 7 → 10 → 11 → 12; 10 → 19; 12 + 19 → 13; 1 + 10 + 12 + 19 → 14. Provider context: 7 + 10 → 8; protected preparation: 7 + 10 → 9. Transport: 10 + 15 → 16 → 17; 8 + 9 + 16 + 17 → 18. Task 6 follows 1. Overlapping Files sets serialize even when the dependency graph admits concurrency.

## Integration ownership

| Changed boundary | Sole owner | Observable result |
|---|---|---|
| Source audit → repository validation | 4 | Nonzero and source coordinates for incompatible instructions |
| FINISH recovery → recorder | 5 | Engine recording and verification without provider recording |
| Prelude readiness → provider launch | 6 | Ready refresh or setup-required refusal |
| Owning context → provider subprocess | 8 | Catalog-wide authoritative launch attribution |
| Selected policy → observation destination | 9 | Proven narrow access or pre-launch refusal |
| Producer replay → canonical persistence | 12 | One durable occurrence after failures/restart |
| Feature lifecycle → tail cleanup | 13 | Awaited drain before sink detach |
| CLI guard → occurrence projection | 14 | Refused handler, canonical event and daemon log |
| gh wrapper → subprocess | 16 | One unchanged invocation plus honest observations |
| Guarded runner → private gh transport | 17 | Authorization retained, no false bypass or fallback |
| Managed preparation → PATH environment | 18 | Bounded wrapper inherited only by managed children |
| Typed occurrence → daemon/terminal subscribers | 19 | Bounded consistent rendered identity/status |

## Coverage Check

Each row names a diff-local behavior and a concrete check in the changed behavior-owning task. Supplied fixture identities and injected external results make these claims independent of unrelated repository commits or live service state. There are no outside-diff waivers.

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a newly added managed engine prompt or shipped skill instruction names a blocked ai-conductor command, when repository validation runs, then it fails and identifies the instruction's file, line, and blocked subcommand without requiring registration of that individual occurrence. | 4 | The production validation entry point, exercised with injected repository inputs, returns nonzero for a newly introduced blocked engine or skill instruction and identifies its file, line and subcommand without manual occurrence registration; the shell gate invokes that entry point and propagates its failure. | diff-local |
| Story 1 happy: Given every managed command is admitted by the production session policy, when validation runs, then compatibility passes using that policy's current decisions. | 1 | Table-driven guard tests and the audit-policy adapter call the same production evaluator: every currently admitted managed command passes, while daemon-control, config, test-suite and operator build-review requests fail; changing a fixture policy decision changes both evaluations without adding a permission exemption. | diff-local |
| Story 1 happy: Given blocked commands appear only in explicitly operator-only instructions, non-executable prohibitions, or historical design material, when validation runs, then those appearances do not create managed-command violations. | 2 | Context-parser fixtures classify explicitly operator-only instructions and non-executable prohibitions without managed violations, and exclude historical design material from executable instruction discovery. | diff-local |
| Story 1 negative: Given a command-bearing managed instruction has missing, malformed, stale, or ambiguous context classification, when validation runs, then it fails at that source rather than silently treating it as interactive. | 2 | Command-bearing fixtures with missing, malformed, stale or ambiguous region classification fail at the originating source instead of receiving an interactive default; declaration endpoints and discovered regions must agree. | diff-local |
| Story 1 negative: Given a region is labeled operator-only but the production dispatch directs a marked session to execute it, when the instruction-context integration check runs, then the contradictory path fails. | 4 | Production prompt/dispatch fixtures intentionally label an executed marked-session region operator-only and assert the instruction-context integration check fails that contradictory path; correctly excluded unmarked operator instructions remain compatible. | diff-local |
| Story 1 negative: Given a retry or remediation prompt introduces a blocked command through supported string concatenation or templating, when validation runs, then it identifies the originating instruction and subcommand. | 3 | Retry/remediation fixtures with a blocked command assembled through supported concatenation or template interpolation produce a finding naming the originating instruction and blocked subcommand. | diff-local |
| Story 1 negative: Given command construction cannot be resolved sufficiently to evaluate a managed instruction, when validation runs, then it reports an unresolved-command finding instead of passing. | 3 | Dynamic construction fixtures that cannot be resolved sufficiently for managed policy evaluation fail with an unresolved-command finding at the source, without a compatibility pass or permission change. | diff-local |
| Story 1 negative: Given a managed instruction changes to request a daemon-control, config, aggregate-verification, or operator build-review command, when validation runs, then the check fails and does not expand runtime permissions to accommodate the instruction. | 1 | Table-driven guard tests and the audit-policy adapter call the same production evaluator: every currently admitted managed command passes, while daemon-control, config, test-suite and operator build-review requests fail; changing a fixture policy decision changes both evaluations without adding a permission exemption. | diff-local |
| Story 2 happy: Given publication evidence is coherent but the final outcome is unrecorded, when managed FINISH recovers, then the engine records and verifies the authorized outcome without assigning recording to a provider. | 5 | FINISH entry fixtures with coherent evidence and an unrecorded authorized outcome observe the engine recorder followed by verification, with no provider recording action or instruction. | diff-local |
| Story 2 happy: Given a PR presentation repair is required, when the provider finishes the bounded prose task, then the engine owns subsequent completion recording and verification. | 5 | Presentation-repair fixtures finish the bounded provider prose task and then assert the engine performs subsequent completion recording and verification. | diff-local |
| Story 2 negative: Given a FINISH entry path has no usable publication coordinator, when missing recording is encountered, then it reports the unsupported or refused path without a provider recording instruction or a fabricated completion marker. | 5 | A missing or unusable coordinator produces an explicit unsupported/refused FINISH result, no provider recording instruction, and no fabricated completion marker. | diff-local |
| Story 2 negative: Given required publication evidence is missing, stale, or inconsistent, when recording recovery runs, then completion remains unrecorded and the existing typed FINISH disposition identifies the failed condition. | 5 | Missing, stale and inconsistent publication-evidence fixtures leave completion unrecorded and return the existing typed FINISH disposition naming the failed condition. | diff-local |
| Story 2 negative: Given earlier publication effects are already verified, when recording recovery retries after a failed write, then it does not replay those effects or dispatch BUILD solely for the recording failure. | 5 | A failed recorder write followed by recovery observes prior effects before acting, replays no already verified publication effect, dispatches no BUILD solely for recording failure, and remains within existing publication retry/exhaustion accounting. | diff-local |
| Story 2 negative: Given a provider directly invokes finish-record from a marked session, when the invocation reaches the guard, then it remains refused. | 1 | Marked finish-record returns refusal at the guard and invokes no recorder; marked config read, init and set return refusal before dispatch and before any project or machine configuration mutation, as asserted with handler spies and byte snapshots. | diff-local |
| Story 3 happy: Given required project configuration is initialized, when managed prelude refresh runs, then supported refresh work can proceed without directing the provider to execute config reads, initialization, or writes. | 6 | Initialized-project runProjectPrelude fixtures reach supported refresh with no provider direction to execute config reads, initialization or writes; the managed refresh branch never runs the operator configuration interview. | diff-local |
| Story 3 happy: Given an unmarked operator invokes bootstrap on an uninitialized project, when setup succeeds, then existing operator-guided configuration initialization remains available. | 6 | An unmarked operator bootstrap fixture reaches the existing runConfigInit writer on an uninitialized project and retains successful guided initialization through the same validated CLI options. | diff-local |
| Story 3 negative: Given required configuration is missing, when managed prelude runs, then it reports that operator bootstrap is required before launching the provider and writes no replacement configuration. | 6 | Missing required configuration makes runProjectPrelude report operator bootstrap required before launching any provider and writes no replacement project or machine configuration. | diff-local |
| Story 3 negative: Given configuration cannot be safely read or established as initialized, when managed prelude evaluates readiness, then it reports the setup problem and does not treat the project as ready. | 6 | Unreadable or invalid required configuration produces a named setup problem, zero provider launches and no ready result; before/after project and machine configuration snapshots remain unchanged. | diff-local |
| Story 3 negative: Given a marked session attempts config read, init, or set, when the command reaches the guard, then it is refused without changing project or machine configuration. | 1 | Marked finish-record returns refusal at the guard and invokes no recorder; marked config read, init and set return refusal before dispatch and before any project or machine configuration mutation, as asserted with handler spies and byte snapshots. | diff-local |
| Story 3 negative: Given an initialized configuration contains operator choices, when managed refresh or an operator re-run occurs, then those choices are not overwritten by defaults. | 6 | Initialized configuration with non-default operator choices remains byte-identical after managed refresh and after an unmarked operator re-run; existing runConfigInit no-clobber fixtures retain their behavior. | diff-local |
| Story 4 happy: Given a managed feature invocation using any supported built-in provider, when the provider is launched, then its command guard and observation context identify the originating feature and dispatch. | 8 | Catalog-driven real-adapter launch fixtures for Claude, Codex and Pi assert the daemon-session guard marker plus originating feature and dispatch in the environment delivered to the fake process; an overlay cannot unset the marker. | diff-local |
| Story 4 happy: Given a provider fallback, changed child working directory, or nested subprocess inheriting the managed environment, when a covered command occurs, then its observation retains the originating feature attribution and the correct dispatch identity. | 8 | Candidate-fallback, changed-child-cwd and nested inheriting-subprocess fixtures assert a covered command observation retains the original feature attribution and correct engine-issued dispatch identity. | diff-local |
| Story 4 happy: Given a supported read-only review invocation, when its observation destination is prepared, then occurrences can be recorded while source, sealed artifacts, unrelated pipeline state, and operator configuration remain protected. | 9 | A supported read-only invocation fixture through candidate preparation records an occurrence only inside its provisioned per-dispatch destination while writes to source, sealed artifacts, unrelated pipeline state and operator configuration remain refused. | diff-local |
| Story 4 negative: Given a daemon feature invocation lacks valid required attribution, when preparation runs, then the provider is not launched and the failure names the missing context. | 7 | Managed-context preparation fixtures missing required daemon-feature attribution fail naming the missing context before the launch callback is invoked. | diff-local |
| Story 4 negative: Given candidate-specific options attempt to replace the owning dispatch context, when invocation is prepared, then the engine-owned attribution remains authoritative. | 7 | Context composition fixtures attempt candidate-specific ownership overrides and assert the engine-owned feature, dispatch and project attribution remains authoritative. | diff-local |
| Story 4 negative: Given a producer destination escapes the feature's provisioned root through traversal or symlinks, when preparation or ingestion validates it, then no event is written or attributed outside that root. | 7 | Preparation and ingestion path-validation fixtures using traversal or symlink escapes write no event and attribute no event outside the feature provisioned root. | diff-local |
| Story 4 negative: Given the selected provider cannot support the required protected observation destination, when preparation runs, then it refuses before launch with the provider and recovery action identified. | 9 | An unsupported or unprovable selected-provider policy fixture launches zero provider processes and reports the provider, observation capability and concrete recovery action; native read-only availability alone cannot satisfy observation readiness. | diff-local |
| Story 4 negative: Given project-scoped prelude work has no feature, when its context is created, then it is identified as project-scoped and no feature slug is invented. | 7 | Project-prelude context fixtures without a feature produce explicit project scope and no invented feature slug; child cwd is never used to recover missing feature identity. | diff-local |
| Story 5 happy: Given a managed feature invokes a blocked command and event storage is available, when the CLI refuses it, then the command returns nonzero, its handler is not invoked, and the feature event record and daemon log identify the feature and blocked subcommand. | 14 | CLI refusal integration with available storage asserts nonzero exit, zero blocked-handler calls, a canonical feature event and daemon log naming the feature and blocked subcommand; FINISH, validation, repair and error-path contexts satisfy the same contract as BUILD. | diff-local |
| Story 5 happy: Given a permitted managed worker command, when it passes the entry guard, then ordinary command dispatch proceeds without a refusal event. | 14 | Allowed managed worker-command fixtures reach ordinary handler dispatch with no refusal event. | diff-local |
| Story 5 negative: Given the refusal event cannot be written, when the CLI rejects the command, then the handler still is not invoked and a bounded diagnostic reports the telemetry failure without claiming successful recording. | 14 | Injected refusal-event write failure still invokes no handler and returns refusal, with a bounded telemetry-failure diagnostic that makes no successful-recording claim. | diff-local |
| Story 5 negative: Given a command has malformed or unsafe identity text, when its refusal is reported, then the event uses a bounded unknown representation and exposes no raw arguments, credentials, or environment values. | 10 | Producer fixtures for malformed or unsafe command identity emit a bounded unknown representation and contain no raw argv, credential, environment, request body, payload-file content or transport-error text. | diff-local |
| Story 5 negative: Given an event claims a feature different from its provisioned context, when it is ingested, then it is rejected with a bounded diagnostic and is not projected under either a guessed feature or the forged attribution. | 14 | Ingestion fixtures claiming another feature are rejected with a bounded diagnostic and projected under neither guessed nor forged attribution. | diff-local |
| Story 5 negative: Given a blocked command occurs during FINISH, validation, repair, or an error path, when the occurrence is emitted, then available event storage and daemon rendering report it under the same contract as a BUILD refusal. | 14 | CLI refusal integration with available storage asserts nonzero exit, zero blocked-handler calls, a canonical feature event and daemon log naming the feature and blocked subcommand; FINISH, validation, repair and error-path contexts satisfy the same contract as BUILD. | diff-local |
| Story 6 happy: Given a managed session or inheriting child script issues a recognized unguarded gh mutation through ordinary PATH resolution, when the command runs, then an attributable attempt observation is recorded before execution and a correlated terminal result is recorded if observed. | 16 | Production-wrapper fixtures for ordinary PATH-resolved raw mutations from a managed session and an inheriting child script record an attributable attempt before the single fake process call and a correlated terminal result when observed; executing REST field-implied writes produces mutation observations, and executing GraphQL, alias, extension or opaque-input calls not safely classifiable as read-only produces possible-bypass observations. | diff-local |
| Story 6 happy: Given a known read-only gh call or a call made through the guarded GitHub operation path, when it runs, then it is not falsely reported as an unguarded mutation. | 17 | Known read-only raw gh calls and authorized guarded-path calls complete through their expected transport with zero unguarded-mutation observations, while raw mutation fixtures still produce observations. | diff-local |
| Story 6 happy: Given a covered gh invocation carries input, output, arguments, exit status, or termination signals, when it passes through observation, then its original transport behavior is preserved without a retry, rewrite, redirect, or new blocking policy. | 16 | Transport fixtures assert byte-identical argv and stdin/stdout/stderr forwarding, original exit status and termination-signal behavior, exactly one underlying call and no recursion, retry, rewrite, redirect or new command-blocking policy. | diff-local |
| Story 6 negative: Given a covered mutation fails, times out, or terminates without a result, when observations are evaluated, then it is reported as failed or unknown rather than as a successful remote write. | 16 | Failure, timeout and lost-terminal-result fixtures report failed or unknown observations instead of successful remote writes; exit zero is only observed CLI success and never verified remote state. | diff-local |
| Story 6 negative: Given REST fields imply a write or a GraphQL, alias, extension, or opaque-input call cannot safely be classified as read-only, when it runs through observation, then it produces a mutation or possible-bypass observation rather than silently passing as a known read. | 16 | Production-wrapper fixtures for ordinary PATH-resolved raw mutations from a managed session and an inheriting child script record an attributable attempt before the single fake process call and a correlated terminal result when observed; executing REST field-implied writes produces mutation observations, and executing GraphQL, alias, extension or opaque-input calls not safely classifiable as read-only produces possible-bypass observations. | diff-local |
| Story 6 negative: Given an invocation supplies its payload through stdin or a file, when it is classified, then monitoring does not consume that input or read and expose the payload to determine whether to report. | 15 | Stdin and file-payload fixtures prove the classifier performs no input reads or payload-file opens, leaves bytes available unchanged for the command, and exposes no payload content in its bounded classification. | diff-local |
| Story 6 negative: Given observation storage fails for a covered raw invocation, when the command runs, then a bounded diagnostic reports degraded telemetry while the underlying command is forwarded once with its original behavior. | 16 | Injected observation-storage failure emits a bounded degraded-telemetry diagnostic while the underlying invocation is forwarded exactly once with original transport behavior. | diff-local |
| Story 6 negative: Given the guarded operation path refuses authorization, when the caller receives the refusal, then it does not retry the mutation through the raw observer or label the whole session authorized. | 17 | A refused guarded operation produces zero raw-observer fallback calls and zero mutation calls; no whole-session authorization or public skip-observation flag is introduced. | diff-local |
| Story 6 negative: Given the wrapper resolves its underlying executable, when guarded and unguarded calls execute, then no recursive wrapper invocation or duplicate mutation occurs. | 17 | Guarded and unguarded executable-resolution fixtures invoke the resolved real transport once without recursive wrapper entry or duplicate mutation, and guarded calls retain existing authorization actor and operator/bot credential selection. | diff-local |
| Story 6 negative: Given secret values appear in arguments, payloads, or transport errors, when a bypass observation is persisted or rendered, then those values are not included. | 10 | Bypass occurrence persistence and renderer fixtures with secret-shaped arguments, payloads and transport errors assert none of those values appears in serialized or rendered output. | diff-local |
| Story 6 negative: Given an invocation uses an absolute binary, replaced PATH, custom HTTP/SDK client, or separate MCP transport outside approved coverage, when observations are inspected, then absence of an event is not presented as proof that no GitHub write occurred. | 18 | Coverage-result fixtures for absolute binaries, replaced PATH, custom HTTP/SDK clients and separate MCP transports outside the approved boundary assert that no event is represented as unknown monitoring completeness, never proof that no GitHub write occurred. | diff-local |
| Story 7 happy: Given concurrent producer processes emit distinct valid occurrences for one feature, when the event reader processes their records, then all occurrences reach the feature's canonical event record and daemon rendering with correct identities. | 13 | Feature-event-owner integration with concurrent producer files and real internal emitter/persister plus captured daemon rendering delivers every distinct valid occurrence to the canonical record and log with its correct feature/dispatch/event identities. | diff-local |
| Story 7 happy: Given valid command occurrences are emitted during BUILD, FINISH, validation, repair, failure, or cancellation, when the feature closes its event consumers, then completed available records are drained before those consumers detach. | 13 | Lifecycle fixtures for BUILD, FINISH, validation, repair, failure and cancellation assert tail start precedes provider execution and completed available records drain before consumers detach; shutdown also awaits the owned drain. | diff-local |
| Story 7 happy: Given an engine interruption leaves producer records pending, when the feature resumes, then those records are projected with original attribution and each occurrence has one durable canonical record. | 12 | Restart integration with real fixture producer files, emitter and EventPersister projects pending prior-dispatch records with original attribution and exactly one durable canonical record per occurrence id. | diff-local |
| Story 7 negative: Given a producer record ends without a newline, when ordinary polling runs, then it is not consumed as complete; completion makes it eligible, while the settled producer boundary reports an incomplete record without inventing its contents. | 11 | Partial-record reader fixtures consume and diagnose nothing during ordinary polling before a newline, deliver the record once complete, and report an incomplete record at the settled producer boundary without inventing contents. | diff-local |
| Story 7 negative: Given a completed record is malformed, oversized, or has invalid attribution, when the reader encounters it, then a bounded diagnostic is emitted and later valid records remain deliverable. | 11 | Malformed JSON, oversized and invalid-attribution complete records generate bounded diagnostics while later valid records remain deliverable; byte-offset fixtures preserve UTF-8 boundaries and path validation. | diff-local |
| Story 7 negative: Given polling overlaps or a subscriber is still handling an occurrence, when another poll starts, then one traversal owns progress and it does not advance the same input twice. | 11 | Deferred-read/subscriber and fake-time fixtures assert one traversal owns progress during overlapping polls, no input advances twice, and stop remains synchronous with no new background polls after stop. | diff-local |
| Story 7 negative: Given canonical persistence fails after a producer record is read, when projection retries, then unread progress is retained and the eventual canonical result contains no duplicate occurrence. | 12 | Injected canonical append failure after a record is read retains unread/pending progress; after retry succeeds the canonical result has no duplicate occurrence. | diff-local |
| Story 7 negative: Given an earlier projection persisted but another subscriber failed or the process stopped, when recovery replays the producer record, then the durable record is not duplicated; a repeated log delivery retains the same event identity. | 12 | Partial-subscriber-failure and process-interruption recovery fixtures replay an already persisted occurrence without duplicating its durable record; any repeated daemon-log delivery retains the same event id. | diff-local |
| Story 7 negative: Given two genuinely distinct invocations have the same subcommand or operation, when deduplication runs, then both remain distinct and an invocation's attempt and terminal result are not collapsed together. | 12 | Dedup fixtures retain both distinct invocations with equal subcommand/operation and retain both correlated attempt and terminal-result records; ordinary events retain their prior append behavior. | diff-local |
| Story 7 negative: Given the producer source is temporarily unreadable or event sinks fail, when the failure is handled and the dependency later recovers, then no unhandled background rejection escapes and retained complete records can still be delivered. | 11 | Temporarily unreadable sources and failing sinks produce caught bounded failures with no unhandled background rejection; after recovery retained complete records are deliverable, and failed delivery has not discarded pending input. | diff-local |

## Architecture Obligation Coverage

Citable decisions below use the engine parser’s top-level decision ids; numbered subclauses remain obligations of their parent. All 29 decisions from the three changed approved ADRs are dispositioned. Existing obligations name concrete code; no-change rows identify constraints whose mechanism remains outside this implementation. Task evidence quotes are exact Done-when fragments.

| Decision | Disposition | Task(s) | Evidence |
|---|---|---|---|
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D1 | no-change | none | No category vocabulary changes: full-suite-fingerprint.ts FULL_SUITE_FINGERPRINT_CATEGORIES and config validation retain the closed eight-category set. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D2 | no-change | none | No verification config changes: config.ts and the config-consumer registry retain optional test_suite.verification defaults and existing consumers. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D3 | no-change | none | No drift-budget policy changes: full-suite-verifier.ts retains budgetable-category checks and fail-closed unbudgetable drift handling. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D4 | no-change | none | No verifier/preservation changes: FullSuiteVerifier.resolveInspection and its separate preservation-recording seam retain cumulative provenance-based inspection and recording ownership. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D5 | no-change | none | No scoped verification changes: full-suite-verifier.ts retains scoped selector derivation, aggregate fallback for empty selection and mode-bound evidence identity. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D6 | no-change | none | No test-suite evidence changes: full-suite-evidence.ts retains mode, selectors and driftLedger; new observation ids do not alter this evidence schema. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D7 | no-change | none | No verification outcome changes: existing test_suite_verification, build_member_evidence_reused and rebase_gate_preserved remain on their existing emitter and EVENT_SINKS routes. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D8 | task | task-1, task-6 | Missing required configuration makes runProjectPrelude report operator bootstrap required before launching any provider and writes no replacement project or machine configuration. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D9 | no-change | none | Operator flag validation and parsed-default identity remain in registry-cli.ts runConfigInit/resolveVerificationSelection/renderVerificationBlock and templates/project-config.yml.template; managed refresh invokes no config writer and introduces no new flag or config key. |
| adr-2026-09-11-github-operation-ownership#D1 | no-change | none | github-operations.ts and tracker-client.ts createGuardedGithubOperationRunner retain typed operation/target authorization, fresh per-operation policy and injectable private transports; the observer itself confers no authorization. |
| adr-2026-09-11-github-operation-ownership#D2 | no-change | none | github-operations.ts retains committed feature ownership and canonical exact-target checks; session observation context is not consulted to grant ownership. |
| adr-2026-09-11-github-operation-ownership#D3 | no-change | none | Existing intake/create authorization remains in github-operations.ts and tracker-client.ts: assignee evidence and transaction-scoped creation permission are unchanged; no reassignment or new intake write is added. |
| adr-2026-09-11-github-operation-ownership#D4 | no-change | none | Shared resource writes still require explicit operation/target authorization through github-operations.ts; the daemon gains no force/ignore-ownership option. |
| adr-2026-09-11-github-operation-ownership#D5 | no-change | none | remote-git-operations.ts retains destination/ref authorization, force/lease constraints and refusal before mutating transport; the gh observer does not alter local Git or the existing git guard. |
| adr-2026-09-11-github-operation-ownership#D6 | no-change | none | Existing ownership refusal results and github_operation_refused events remain in github-operations.ts/tracker-client.ts and existing subscribers; the new session-command refusal is a different occurrence and grants no fallback. |
| adr-2026-09-11-github-operation-ownership#D7 | task | task-4, task-17 | Static-audit fixtures admit only the identified private observation passthrough; adding a neighboring raw call in the same file, a skill-directed raw write or an unregistered harness caller still fails validation. |
| adr-2026-09-11-github-operation-ownership#D8 | no-change | none | Existing gated-announcement authorization, local GATED visibility and marker-edit behavior are unchanged; this feature adds no remote announcement or source-issue write. |
| adr-2026-09-11-github-operation-ownership#D9 | no-change | none | tracker-client.ts makeProductionGh retains credential-scoped GH_TOKEN injection and redaction; createGuardedGithubOperationRunner retains typed GithubBotAuthRefusalError fallback for authorized operations only, using github-bot-credential.ts and github-bot-auth-refusal.ts. No observer path reinterprets an ownership denial as credential fallback. |
| adr-2026-09-11-github-operation-ownership#D10 | no-change | none | bot-co-author.ts retains configured bot identity lookup and commit co-authorship; this feature changes no commit-message assembly, actor, git author or identity cache. |
| adr-2026-10-01-daemon-session-command-contracts#D1 | task | task-1, task-2, task-3, task-4 | The production validation entry point, exercised with injected repository inputs, returns nonzero for a newly introduced blocked engine or skill instruction and identifies its file, line and subcommand without manual occurrence registration; the shell gate invokes that entry point and propagates its failure. |
| adr-2026-10-01-daemon-session-command-contracts#D2 | task | task-1, task-5, task-6 | FINISH entry fixtures with coherent evidence and an unrecorded authorized outcome observe the engine recorder followed by verification, with no provider recording action or instruction. |
| adr-2026-10-01-daemon-session-command-contracts#D3 | task | task-7, task-8, task-18 | Catalog-driven real-adapter launch fixtures for Claude, Codex and Pi assert the daemon-session guard marker plus originating feature and dispatch in the environment delivered to the fake process; an overlay cannot unset the marker. |
| adr-2026-10-01-daemon-session-command-contracts#D4 | task | task-1, task-10, task-14 | CLI refusal integration with available storage asserts nonzero exit, zero blocked-handler calls, a canonical feature event and daemon log naming the feature and blocked subcommand; FINISH, validation, repair and error-path contexts satisfy the same contract as BUILD. |
| adr-2026-10-01-daemon-session-command-contracts#D5 | task | task-7, task-10, task-11, task-12, task-13 | Injected canonical append failure after a record is read retains unread/pending progress; after retry succeeds the canonical result has no duplicate occurrence. |
| adr-2026-10-01-daemon-session-command-contracts#D6 | task | task-9, task-10, task-11, task-16 | A supported read-only invocation fixture through candidate preparation records an occurrence only inside its provisioned per-dispatch destination while writes to source, sealed artifacts, unrelated pipeline state and operator configuration remain refused. |
| adr-2026-10-01-daemon-session-command-contracts#D7 | task | task-15, task-16, task-18 | Transport fixtures assert byte-identical argv and stdin/stdout/stderr forwarding, original exit status and termination-signal behavior, exactly one underlying call and no recursion, retry, rewrite, redirect or new command-blocking policy. |
| adr-2026-10-01-daemon-session-command-contracts#D8 | task | task-17 | Static-audit fixtures admit only the identified private observation passthrough; adding a neighboring raw call in the same file, a skill-directed raw write or an unregistered harness caller still fails validation. |
| adr-2026-10-01-daemon-session-command-contracts#D9 | task | task-10, task-12, task-19 | Real daemon and terminal subscriber fixtures format the same declared occurrence with feature slug where present, bounded subcommand/operation and refusal/attempt/result/possible-bypass status; project-scoped events show project attribution without inventing a slug. |
| adr-2026-10-01-daemon-session-command-contracts#D10 | task | task-4, task-5, task-6, task-8, task-9, task-12, task-13, task-14, task-16, task-17, task-19 | The entry fixture proves the production process/handler adapters reach injected fakes using benign arguments before any destructive/refused argv is exercised; removing the guard cannot reach a real third party. |

## Authoring verification

The production criterion parser extracted exactly 55 criteria and each Coverage Check cell matches its text. The task parser recognized all 19 task headers, file sets and 2–5 single-line Done-when checks per task. The independent judge accepted 53 rows initially; two checks were tightened to require explicit marked finish-record refusal and actual observations for implicit/opaque gh forms. A fresh second judge accepted both revised rows. No criterion was changed to accommodate a check.

The contradiction pass preserves the closed guard, unmarked setup, coordinator recording, native reviewer protection, single canonical writer, exact command forwarding, redaction and honest incomplete coverage. Observer storage failure forwards a raw command once; command refusal storage failure never executes its handler. These different outcomes follow the approved distinction between observation and authorization.

Scope: 19 tasks, no oversized-plan exception, no terminal catch-all validation task and no BUILD mutation of another feature's DECIDE artifacts. Architecture diagrams are updated in place to show producer files, canonical projection and lifecycle drain. The protected-target check passed with no violations. All four updated Mermaid blocks rendered successfully. The advisory overlap report follows; aggregate verification was not run during DECIDE.

## Advisory overlap scan

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts
Overlap with origin/spec/per-step-provider-routing-927: skills/conduct/SKILL.md
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/daemon-cli.ts, src/conductor/src/engine/conductor.ts
Note: renames or name-only diffs may not be detected by this scan.
```
