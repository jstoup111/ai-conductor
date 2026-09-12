# Implementation Plan: Support multiple test suites in BUILD

**Date:** 2026-09-11
**Design:** [approved PRD](../specs/2026-09-11-support-multiple-test-suites-in-build.md)
**Stories:** .docs/stories/support-multiple-test-suites-in-build.md
**Conflict check:** Clean and operator-approved 2026-09-11
**Architecture:** [approved contract and wiring surface](../decisions/architecture-review-2026-09-11-support-multiple-test-suites-in-build.md)
**Source:** jstoup111/ai-conductor#2358

**Operator approval:** James Stoup approved the implementation plan in composer chat on 2026-09-11.

## Summary

Nineteen focused tasks extend the existing aggregate verifier to ordered,
project-owned commands with independent contexts, complete proof, and attributable
failure reporting. All 45 happy and negative criteria have behavioral coverage;
the work remains suite agnostic across BUILD, CLI, and inspection consumers.

## Technical Approach

Add `test_suite.commands` as the optional, mutually exclusive alternative to
`command`. Each entry has `command`, optional `working_directory`, and optional
`timeout_seconds`. A focused `full-suite-commands.ts` resolver shares effective
entries between fingerprinting and execution. Preserve project-root-relative
directories, shared defaults, the existing 1800-second timeout, existing merge
rules, and unchanged scoped context. Validate the entire collection before any
command runs.

Extend the existing executor's injected `FullSuiteCommandRunner`, typed failure
classification, and cleanup contract. Run entries serially under the verifier's
one existing lock; stop on the first failure. Carry declared count and the
contiguous attempted prefix through the typed result. Retry from entry zero.
Do not detect frameworks, parse output for success, add partial caches, or add
BUILD steps.

Retain v4 scalar/scoped proof and scalar fingerprint serialization. Only aggregate
list execution writes v5, with `plannedEntryCount`, `entries`, and
`failedEntryIndex` as specified in the approved architecture. Reject incomplete,
contradictory, or incompatible proof. Keep atomic write/read-back and current
whole-project input observation. Include ordered declaration shape and effective
entries in the unbudgetable `project_config` identity.

Construct redacted, bounded failure context once in the verifier. Existing CLI
and BUILD routes consume it; existing `test_suite_verification` events gain
optional terminal list summaries. Persist through EventPersister and render
through the existing daemon/inline sinks. No raw outputs enter the event summary.

Local patterns are semantic reuse, not exact-copy replication: executor tests
inject runner and clock; evidence tests use temporary files and typed fixtures;
verifier tests use a controlled local Git project and a fake process boundary.
These traits isolate the real behavior under test. Adapt fixtures for lists,
but do not replace internal production wiring with a fake verifier in a test
claiming to prove list execution. Conductor tests use the targeted gate-loop
fixture, pre-resolve unrelated steps, stop at the named observation, and await
cleanup. No real provider, network, registry, or ambient tmux operation is needed.

## Prerequisites

- The accepted nine stories, clean conflict report, and approved architecture are the specification baseline.
- Use the repository's scoped-run interface for affected RED/GREEN tests; aggregate execution remains owned by test_suite and final validation by its existing gates.
- Test paths below exist unless explicitly marked new. Source claims were verified in the named modules and existing tests; confidence 99%. The new resolver, list shapes, and v5 format are approved design choices, not claims about existing code.
- Every fixture supplies controlled inputs. No criterion depends on an unrelated issue merging or a third-party service changing, so the coverage rows are diff-local.

## Tasks

### Task 1: Admit ordered declarations through configuration loading
**Story:** Story 1 happy paths
**Type:** happy-path
**Dependencies:** none
**Files:** src/conductor/src/types/config.ts; src/conductor/src/engine/config.ts; src/conductor/test/engine/config.test.ts; src/conductor/test/types/test-suite-config-type.test.ts; src/conductor/test/engine/config-consumer-registry.ts

**Steps:**
1. Add config-load and type fixtures for two opaque commands, a one-entry list, list plus scoped_command, and unchanged scalar/scoped-only forms. Follow existing loadConfig temporary-YAML tests; do not invoke commands to test schema admission.
2. Establish RED, then introduce the entry type and aggregate-form union, accepted root/nested keys, and resolvable consumer registry declarations. Preserve array replacement and source precedence.
3. Run affected scoped tests to GREEN and commit the schema admission change. Task 2 owns invalid-form rejection; Task 16 owns config-to-execution integration.

**Done when:**
- loadConfig preserves a valid commands array in order, accepts either aggregate form with scoped_command, and requires neither suite names nor runner identifiers, as asserted by the configuration fixtures.
- TestSuiteConfig and the existing consumer registry admit the new entry keys with declared production consumers while scalar and scoped-only configuration fixtures retain their existing accepted shapes.

### Task 2: Reject malformed and ambiguous declarations
**Story:** Story 1 negative paths
**Type:** negative-path
**Dependencies:** Task 1
**Files:** src/conductor/src/engine/config.ts; src/conductor/test/engine/config.test.ts

**Steps:**
1. Add a closed config-load matrix: empty list, non-array list, null/string/array entry, missing/blank/nonstring command, unknown entry key, and simultaneous command plus commands.
2. Establish RED and implement indexed validation. Exercise ordinary loadMergedConfig where merging creates both forms; report ambiguity rather than selecting one or concatenating arrays.
3. Verify GREEN and commit. Use the existing loader fixture pattern; no runner-output assertions or new merge mechanism.

**Done when:**
- validateTestSuiteBlock rejects each malformed-list fixture and names test_suite.commands plus the offending entry index and setting when applicable.
- loadMergedConfig rejects simultaneous scalar/list aggregate declarations after ordinary merging, while the array-replacement fixture retains declared order without concatenation.

### Task 3: Resolve effective entry contexts once
**Story:** Story 2 happy paths
**Type:** infrastructure
**Dependencies:** Task 1
**Files:** src/conductor/src/engine/full-suite-commands.ts; src/conductor/test/engine/full-suite-commands.test.ts

**Steps:**
1. Create the focused resolver module and its unit test file. Cover independent overrides, inherited shared fields, and absent shared fields; explicit entry directories resolve from project root, not the shared directory or preceding entry.
2. Establish RED and return ordered effective command/directory/timeout descriptors. Reuse the existing default timeout constant; retain a separate scalar normalization route.
3. Verify GREEN and commit. Task 13 owns fingerprint consumption and Task 16 owns observation of these values at the process boundary.

**Done when:**
- The effective-entry resolver returns each opaque command unchanged with its project-root-relative directory and timeout using entry override, shared value, then root/1800-second default precedence.
- Resolver fixtures distinguish an explicit entry directory from shared-directory nesting and show that resolving one entry cannot alter the next entry's context.

### Task 4: Refuse unsafe or unavailable entry directories before execution
**Story:** Story 2 directory negative path
**Story:** Story 8 unresolved-directory negative path
**Type:** negative-path
**Dependencies:** Task 3
**Files:** src/conductor/src/engine/config.ts; src/conductor/src/engine/full-suite-commands.ts; src/conductor/test/engine/config.test.ts; src/conductor/test/engine/full-suite-commands.test.ts

**Steps:**
1. Add temporary-directory fixtures for absolute paths, parent escape, outward symlink, missing directory, and an unusable directory using injected filesystem failure rather than host permission assumptions.
2. Establish RED and apply the existing containment/realpath rules to every entry. Load-time checks reject invalid declarations; execution preparation resolves and checks the complete collection before returning any executable descriptor set.
3. Verify GREEN and commit. Reuse existing path checks rather than a string-prefix approximation; Task 16 proves that a bad later entry prevents earlier process launches.

**Done when:**
- Configuration validation rejects absolute, parent-escape, and outward-symlink entry directories with indexed working_directory errors.
- Effective-entry preflight refuses missing, unusable, or no-longer-contained directories anywhere in the list with the offending entry identified before it returns an executable collection.

### Task 5: Reject invalid entry timeouts without default substitution
**Story:** Story 2 timeout negative path
**Type:** negative-path
**Dependencies:** Task 1
**Files:** src/conductor/src/engine/config.ts; src/conductor/test/engine/config.test.ts

**Steps:**
1. Add loader fixtures for zero, negative, NaN/infinite values supported by the YAML parser, string, and null entry timeouts, alongside an omitted value and a positive finite value.
2. Establish RED and validate supplied values with the existing finite-positive timeout rule. Absence alone enables inheritance; invalid presence is not absence.
3. Verify GREEN and commit the indexed timeout validation.

**Done when:**
- validateTestSuiteBlock rejects every zero, negative, non-finite, and nonnumeric entry timeout with the indexed timeout_seconds key rather than substituting the shared/default value.
- Config-load fixtures accept omitted or positive finite entry timeouts and leave their effective resolution to the shared resolver.

### Task 6: Execute successful entries serially using opaque commands
**Story:** Story 3 first happy path
**Story:** Story 4 happy paths
**Type:** happy-path
**Dependencies:** Task 3
**Files:** src/conductor/src/engine/full-suite-executor.ts; src/conductor/test/engine/full-suite-executor.test.ts

**Steps:**
1. Add injected-runner tests using deferred promises and a deterministic clock to prove exact command/context forwarding and that entry N+1 starts only after N settles through its existing cleanup contract.
2. Establish RED and add ordered composition around the existing command execution/classification path. Preserve scalar return behavior; list success carries declared count, ordered successful attempts, and aggregate timing.
3. Include mixed command syntaxes, arbitrary unfamiliar output, and empty output in the same focused matrix. Verify GREEN and commit; no installed runner or real process is required.

**Done when:**
- executeFullSuite forwards each list command unchanged to FullSuiteCommandRunner in order, awaits the prior operation and cleanup before starting the next, and returns success only after the final successful attempt.
- Injected-runner fixtures with mixed syntax, unfamiliar output, and silent exit-zero results all succeed solely from process completion and exit status; list and per-entry durations come from the injected clock.

### Task 7: Stop a collection on a semantic test failure
**Story:** Story 3 nonzero negative path
**Story:** Story 4 misleading-output negative path
**Type:** negative-path
**Dependencies:** Task 6
**Files:** src/conductor/src/engine/full-suite-executor.ts; src/conductor/test/engine/full-suite-executor.test.ts

**Steps:**
1. Add first/middle/final nonzero-exit fixtures, including a command that prints a convincing success message. Assert runner history as well as the returned result.
2. Establish RED and terminate composition with the failing index, attempted prefix, declared count, and existing nonzero_exit classification. Do not synthesize results for unexecuted entries.
3. Verify GREEN and commit. Reuse the injected runner and clock from Task 6; failure is determined by the typed completion, never text.

**Done when:**
- executeFullSuite returns nonzero_exit with the failing index and attempted prefix for first, middle, and final failures, and its runner history contains no later entry.
- A success-looking stdout fixture with a nonzero process exit produces a failed aggregate result with the original exit code rather than a parsed-output pass.

### Task 8: Preserve infrastructure failures and incomplete-execution blocking
**Story:** Story 3 infrastructure and incomplete negative paths
**Story:** Story 4 launch negative path
**Type:** negative-path
**Dependencies:** Task 6
**Files:** src/conductor/src/engine/full-suite-executor.ts; src/conductor/test/engine/full-suite-executor.test.ts

**Steps:**
1. Add closed runner-failure fixtures for timeout, signal, launch failure without output, and cleanup/internal failure. Use injected boundaries so restoring old guards cannot touch operator processes.
2. Establish RED and compose the existing failure classes without converting them to nonzero_exit. Await cleanup before settlement; no later command starts after an infrastructure failure.
3. Cover early termination before the complete list settles. Verify GREEN and commit; Task 16 owns proof refusal and retry-from-zero at the verifier boundary.

**Done when:**
- executeFullSuite retains timeout, signal, unlaunchable, and internal/cleanup failure classifications with available termination metadata, returns the failing prefix, and never starts a later entry in those fixtures.
- An interrupted or rejected list operation cannot return a successful aggregate result; a launch failure with empty output remains unlaunchable rather than success.

### Task 9: Add versioned list evidence with complete attempt records
**Story:** Story 5 happy paths
**Type:** happy-path
**Dependencies:** Task 6, Task 7, Task 8
**Files:** src/conductor/src/engine/full-suite-evidence.ts; src/conductor/test/engine/full-suite-evidence.test.ts

**Steps:**
1. Add typed v5 round-trip fixtures for complete success, a failed middle-entry prefix, and preflight failure with no attempts. Use the existing temporary-file writer/reader pattern.
2. Establish RED and add explicit v4/v5 reader and writer branches. V5 carries plannedEntryCount, entries, and failedEntryIndex; successful list top-level command/directory are null, failed execution names its failing entry, unresolved preflight count is null.
3. Retain v4 scalar/scoped writing rather than globally stamping v5. Verify GREEN and commit; Task 10 owns adversarial records and Task 16 owns verifier integration.

**Done when:**
- The v5 evidence writer/reader round trip preserves declared count, contiguous attempted indices, effective directories, per-entry and aggregate durations, exit/termination results, and failed-entry index without inventing unexecuted results.
- Evidence fixtures retain v4 scalar/scoped serialization and distinguish complete v5 success, a failed-prefix record, and an empty-attempt preflight failure with null failed index and unresolved count when appropriate.

### Task 10: Reject contradictory or unsupported evidence
**Story:** Story 5 invalid-proof negative paths
**Type:** negative-path
**Dependencies:** Task 9
**Files:** src/conductor/src/engine/full-suite-evidence.ts; src/conductor/test/engine/full-suite-evidence.test.ts

**Steps:**
1. Add a closed v5 mutation matrix: omitted attempts, duplicate/reordered indices, wrong declared count, negative/non-finite timing, invalid termination, embedded failure under PASS, inconsistent failed index, and a non-prefix failure record.
2. Establish RED and validate version-specific invariants before returning usable evidence. Also cover malformed JSON, partial JSON, missing required fields, v3, and an unknown future version.
3. Verify GREEN and commit. Do not upgrade an old record by changing its version field or match redacted strings as identity.

**Done when:**
- readFullSuiteEvidence rejects omitted, duplicated, reordered, count-inconsistent, invalid-timing, invalid-termination, and failure-containing v5 PASS records before they can be used as proof.
- The evidence reader rejects corrupt/partial JSON, incomplete required shapes, contradictory failure prefixes, v3, and unknown versions while valid v4 and v5 fixtures remain readable under their own contracts.

### Task 11: Retain blocking evidence write and read-back failures
**Story:** Story 5 persistence-failure negative path
**Type:** negative-path
**Dependencies:** Task 9, Task 15
**Files:** src/conductor/src/engine/full-suite-evidence.ts; src/conductor/src/engine/full-suite-verifier.ts; src/conductor/test/engine/full-suite-evidence.test.ts; src/conductor/test/engine/full-suite-verifier.test.ts

**Steps:**
1. Extend existing evidence fault-injection fixtures to v5: write failure, atomic replacement failure, unreadable result, and corrupt read-back after a successful command sequence.
2. Establish RED and thread list results through the established atomic write and mandatory read-back path; translate failed persistence into the existing blocking result rather than returning execution success.
3. Verify GREEN and commit. This task owns the persistence-fault boundary; Task 16 owns normal list admission/reuse and must not duplicate this fault matrix.

**Done when:**
- writeFullSuiteEvidence retains atomic temporary-file replacement for v5, and its injected write/rename failures never expose a partially written successful record as valid proof.
- FullSuiteVerifier.ensure returns a blocking result after list execution if evidence cannot be written or its mandatory read-back is missing, unreadable, or corrupt; no reusable PASS is reported from the command exits alone.

### Task 12: Bound and redact list diagnostics at the result boundary
**Story:** Story 5 redaction negative path
**Story:** Story 6 empty/large-output behavior
**Type:** negative-path
**Dependencies:** Task 9, Task 15
**Files:** src/conductor/src/engine/full-suite-evidence.ts; src/conductor/src/engine/full-suite-verifier.ts; src/conductor/test/engine/full-suite-evidence.test.ts; src/conductor/test/engine/full-suite-verifier.test.ts

**Steps:**
1. Add focused fixtures with declared secrets in command, path, stdout, stderr, and failure text; include silent failure and output larger than the approved bounds.
2. Establish RED and construct one failure description from typed attempt metadata. Preserve ordinal/index, command, directory, duration, reason/exit, and unexecuted count before diagnostics. Redact all exposed fields using the existing sanitizer.
3. Enforce existing 16,384-character per-field limits plus a shared 16,384-character entry stdout/stderr budget, allocating the failing attempt first and earlier attempts in order with explicit truncation. Verify GREEN and commit; Tasks 17–19 own delivery, not another formatter.

**Done when:**
- The verifier's list failure description retains ordinal/index, sanitized command/directory, duration, reason or exit, and unexecuted count for both silent and oversized failures.
- The evidence/result sanitization boundary redacts declared secrets in every exposed command, path, output, and message while enforcing per-field and shared 16,384-character diagnostic limits with failure-first allocation and explicit truncation; attempt metadata remains present.

### Task 13: Fingerprint the complete ordered declaration
**Story:** Story 8 declaration, budget, and effective-default criteria
**Type:** happy-path
**Dependencies:** Task 3, Task 4, Task 5
**Files:** src/conductor/src/engine/full-suite-fingerprint.ts; src/conductor/test/engine/full-suite-fingerprint.test.ts

**Steps:**
1. Add a local Git fixture matrix for add/remove/reorder, command/directory/timeout edits, shared-default edits, and scalar-to-one-entry-list shape changes. Use fingerprintFullSuiteInputs, not a separately reimplemented serializer.
2. Establish RED and consume the shared resolver for lists while retaining exact scalar normalization. Hash ordered effective entries and declaration shape/settings in project_config; do not sort commands or narrow inputs.
3. Verify scalar golden/fixture fingerprints remain unchanged and list mutations alter the configuration category. Verify GREEN and commit; Task 16 owns stale/unbudgetable decisions through real inspection.

**Done when:**
- fingerprintFullSuiteInputs changes project_config identity for entry addition, removal, order, command, directory, timeout, declaration-form, and shared-default changes using the same effective-entry resolver as execution.
- Unchanged scalar fixture serialization and digests remain identical, and list order is preserved in fingerprint identity rather than sorted away.

### Task 14: Retain whole-project observation and reject indeterminate inputs
**Story:** Story 8 cross-directory and indeterminate-input criteria
**Story:** Story 9 irrelevant-change behavior
**Type:** negative-path
**Dependencies:** Task 13
**Files:** src/conductor/src/engine/full-suite-fingerprint.ts; src/conductor/test/engine/full-suite-fingerprint.test.ts

**Steps:**
1. Extend the controlled local Git project across two suite directories and a relevant root-level file. Exercise tracked/dirty content, non-ignored untracked content, explicit ignored inputs, and declared environment changes using the existing input walker.
2. Establish RED where list declarations are not handled, then retain the existing categories and explicit input/environment semantics. Inject enumeration/read failures and test unresolved directories; never interpret missing input data as an empty successful observation.
3. Check irrelevant documentation and commit-only changes retain content identity. Verify GREEN and commit; do not create a second subtree walker or alter drift tolerances.

**Done when:**
- fingerprintFullSuiteInputs observes tracked, dirty, non-ignored untracked, explicit ignored, and declared environment changes across both suite directories and relevant root inputs using the existing whole-project collector.
- Fingerprint fixtures reject enumeration/read failures and unresolved or escaped entry directories, while irrelevant documentation and commit-identity-only changes leave the content digest unchanged.

### Task 15: Preserve scalar and scoped verification routes
**Story:** Story 2 scoped-context negative path
**Story:** Story 7 all criteria
**Type:** happy-path
**Dependencies:** Task 9, Task 10, Task 13
**Files:** src/conductor/src/engine/full-suite-verifier.ts; src/conductor/test/engine/full-suite-verifier.test.ts

**Steps:**
1. Add real-verifier route fixtures with injected runners: current v4 scalar reuse, scalar execution, selected scoped mode with a list fallback and entry overrides, and empty-selection list fallback. Reuse existing selector/basis fixtures.
2. Establish RED and select the aggregate form without changing scoped execution. Preserve v4 scalar/scoped evidence; selected scoped runs use shared context, and empty-selection list execution records its explicit aggregate fallback basis in v5.
3. Reject v4 aggregate proof for any list, scoped proof for an aggregate/fallback requirement, and an aggregate request with scoped-only configuration. Verify GREEN and commit; the direct scoped interface and counterfactual preflight remain untouched.

**Done when:**
- FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis.
- Verifier route checks refuse v4 aggregate proof for one-entry or larger lists and refuse scoped proof for required aggregate/fallback execution; a scoped-only aggregate request names both supported aggregate declaration alternatives and stays blocked.

### Task 16: Wire complete list proof, reuse, and locking through the verifier
**Story:** Story 1 execution boundary
**Story:** Story 2 execution contexts
**Story:** Story 3 complete execution
**Story:** Story 5 proof boundary
**Story:** Story 8 freshness policy
**Story:** Story 9 reuse and lock criteria
**Type:** happy-path
**Dependencies:** Task 2, Task 4, Task 5, Task 7, Task 8, Task 10, Task 11, Task 12, Task 14, Task 15
**Files:** src/conductor/src/engine/full-suite-verifier.ts; src/conductor/test/engine/full-suite-verifier.test.ts; src/conductor/test/engine/build-review-inputs.test.ts

**Steps:**
1. Add the behavior-owning integration through FullSuiteVerifier.ensure/inspect, using real config loading, resolution, fingerprinting, executor, evidence, and lock with a fake FullSuiteCommandRunner. Assert exact contexts, attempted prefix, durable proof, reuse, and process-call counts.
2. Establish RED and wire list execution/results into ensureLocked. Preflight every entry before the first command; require full successful execution and valid persisted read-back; retry failed collections from entry zero. Reject incomplete/incompatible/failed proof during inspection.
3. Use deterministic lock coordination between two verifier instances, not sleeps. The second obeys the existing live-lock outcome and cannot execute concurrently; after release, current proof is reused. Preserve inspect-only behavior and caller-owned drift recording.
4. Check each Task 13 mutation becomes stale project_config even under permissive source/test budgets, Task 14 failures block reuse, and tolerated drift still follows existing preservation rules. Exercise build-review input assembly with real verifier inspection and complete/incomplete proof, without launching providers or tests. Verify GREEN and commit.

**Done when:**
- FullSuiteVerifier.ensure reaches the real loader/resolver/executor chain, forwards each effective context to the fake runner, and refuses invalid declarations or any bad later entry with zero launches before execution.
- ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock.
- inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement.
- Verifier inspection and build-review input assembly admit complete current list proof but refuse stale, failed, incomplete, or incompatible proof without launching commands; existing artifacts and daemon-rekick consumers continue to use that same typed inspection authority.

### Task 17: Deliver failed-entry context through the verification CLI
**Story:** Story 6 CLI criteria
**Story:** Story 9 CLI reuse and refusal
**Type:** happy-path
**Dependencies:** Task 12, Task 16
**Files:** src/conductor/src/engine/test-suite-cli.ts; src/conductor/test/engine/test-suite-cli.test.ts

**Steps:**
1. Add CLI-dispatch fixtures backed by the real verifier in a controlled project and fake process boundary. Capture stdout/stderr for list success/reuse, middle failure, silent failure, oversized/secret output, and invalid/stale proof.
2. Establish RED and print the verifier's sanitized message with existing failure guidance. Carry the same inspection result into ensure/preservation; do not inspect twice to reconstruct metadata or invent a CLI-only result schema.
3. Verify exit behavior and no duplicate execution on reuse. Verify GREEN and commit; the existing CI-repair adapter uses this dispatch and does not need a separate executor.

**Done when:**
- dispatchTestSuiteCommand prints failed ordinal, sanitized command/directory, duration, reason or exit, unexecuted count, and bounded diagnostics from the real verifier for middle, silent, oversized, and secret-bearing failures while returning the existing failure exit outcome.
- CLI fixtures reuse complete current list proof with zero process calls, refuse invalid proof without reporting satisfied verification, and preserve caller-owned drift recording through the existing adapter.

### Task 18: Carry list outcomes into BUILD repair and existing events
**Story:** Story 6 BUILD, routing, events, and reuse criteria
**Story:** Story 3 aggregate completion at the BUILD gate
**Type:** happy-path
**Dependencies:** Task 12, Task 16
**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/types/events.ts; src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts

**Steps:**
1. Extend the targeted gate-loop fixture for list results. Exercise the actual test_suite dispatch and repair input, stop immediately at the expected repair/retry observation, pre-resolve unrelated steps, and await cleanup. Fake provider/process boundaries, not the message-carrying internal route.
2. Establish RED and carry sanitized verifier failure details through the existing retry hint and recordGateRepair path. Keep semantic nonzero failures and infrastructure failures on their existing budget lanes.
3. Add optional typed terminal summary to test_suite_verification: planned/attempted counts and per-attempt index, result, duration. Emit once from an executed list result, including failure; do not attach new execution outcomes to reuse/freshness-only results. No raw outputs or command/path strings enter this summary.
4. Verify GREEN and commit. This task owns conductor production wiring; Task 19 owns sink delivery and rendering, not a second occurrence source.

**Done when:**
- The targeted BUILD test_suite dispatch delivers the verifier's failed ordinal, sanitized command/directory, duration, termination, unexecuted count, and bounded diagnostic context into the actual repair input, including silent and oversized/secret-bearing failures.
- BUILD retains infrastructure retry handling for timeout/unlaunchable results without charging the semantic repair budget, while ordinary nonzero failures follow the existing semantic route.
- runTestSuiteStep emits one typed terminal list summary from each executed result with declared/attempted counts and attributable attempt outcomes/durations, including failed attempts; reuse and freshness-only outcomes emit no fresh execution summary and summaries contain no raw diagnostics or secrets.
- In the targeted conductor fixture, an unsuccessful list leaves test_suite unsatisfied and prevents build_review dispatch until the existing repair/retry route produces a valid suite PASS.

### Task 19: Persist and render terminal list summaries on existing sinks
**Story:** Story 6 attributable reporting and bounded-output criteria
**Type:** happy-path
**Dependencies:** Task 18
**Files:** src/conductor/src/engine/event-sinks.ts; src/conductor/src/daemon-cli.ts; src/conductor/src/ui/terminal-renderer.ts; src/conductor/test/engine/event-sinks.test.ts; src/conductor/test/engine/event-persister.test.ts; src/conductor/test/engine/daemon-render.test.ts; src/conductor/test/ui/terminal-renderer.test.ts

**Steps:**
1. Add small consumer tests delivering the Task 18 event shape through the real emitter/persister and renderer entry points. Assert success, failed-prefix, and freshness/reuse-without-summary behavior using captured output and a temporary events file.
2. Establish RED and enable rendering for test_suite_verification in the existing total sink registry. Render attributable count/index/result/duration summary in daemon and inline output; keep freshness-only events quiet and existing audit/OTel disabled declarations.
3. Verify persisted structured values match the emitted event and no raw output/secret-bearing payload is introduced. Verify GREEN and commit this named event-consumer integration; do not run a full conductor or a new watcher.

**Done when:**
- The existing emitter/EventPersister path persists terminal list counts and attempt index/result/duration, and daemon plus inline renderer entry points display attributable successful and failed attempts from that same event.
- Sink fixtures keep freshness-only and reused-without-execution events visually quiet, retain explicit disabled audit/OTel destinations, and expose no command/path/raw diagnostic payload or fabricated execution in list summaries.

## Task Dependency Graph

```text
1 -> 2, 3, 5
3 -> 4, 6
6 -> 7, 8
6 + 7 + 8 -> 9 -> 10
3 + 4 + 5 -> 13 -> 14
9 + 10 + 13 -> 15
9 + 15 -> 11, 12
2 + 4 + 5 + 7 + 8 + 10 + 11 + 12 + 14 + 15 -> 16
12 + 16 -> 17, 18
18 -> 19
```

Dependencies are behavioral prerequisites, not permission to edit unrelated
files. The scheduler also honors actual file overlap; a common source/test file
can serialize otherwise independent ready tasks.

## Integration Points

| Changed boundary behavior | Sole integration owner | Observation and lowest sufficient layer |
|---|---|---|
| Public config admission | Task 1 | Config loader and type/registry fixtures accept the list and preserve order. |
| Malformed/ambiguous config refusal | Task 2 | Actual project/merged loaders return indexed errors; Task 16 separately proves zero launches. |
| Timeout validation | Task 5 | Config loader rejects the closed invalid-value matrix. |
| Complete list config-to-process/proof path | Task 16 | Real verifier chain reaches the fake process adapter with effective contexts and validated complete evidence. Task 3–10 helper tests retain their detailed permutations. |
| Evidence I/O fault handling | Task 11 | Real verifier refuses successful completion after injected persistence/read-back faults. |
| Diagnostic sanitization and composition | Task 12 | Evidence/verifier result boundary preserves identity and bounds/redacts every exposed field. |
| Scalar/scoped route compatibility | Task 15 | Real verifier selects the correct route and rejects incompatible proof versions/bases. |
| Fingerprint and freshness policy | Task 16 | Real inspection classifies Task 13–14 input changes and indeterminacy; lower-layer tests own the detailed input matrix. |
| Inspection-only consumers | Task 16 | build-review input assembly consumes real list inspection without execution; shared predicate remains authoritative. |
| Standalone CLI delivery | Task 17 | CLI dispatch consumes the real verifier, with captured output and process calls. |
| BUILD repair/routing and occurrence emission | Task 18 | Targeted test_suite dispatch reaches actual repair input or retry observation and emits the typed summary. |
| Persisted and rendered occurrence delivery | Task 19 | Existing emitter/persister, daemon renderer, and inline renderer consume the same event. |

These are behavioral integration tests inside owning tasks. No new broad system
spec is needed to duplicate their failure permutations; BUILD entry's acceptance
author must retain these lowest-sufficient-layer dispositions. Existing direct
scoped-run and counterfactual-preflight tests remain sufficient for their unchanged
interfaces. Their selector/cleanup internals are not reimplemented by this plan.

## Architecture Obligation Coverage

The current change set amends decisions 3 and 6 of the existing
content-addressed-proof ADR. All ten citable decisions are accounted for below;
its existing supersession amendments remain authoritative.

| Decision | Disposition | Task(s) | Evidence |
|---|---|---|---|
| adr-2026-07-25-content-addressed-full-suite-proof#D1 | task | task-18 | In the targeted conductor fixture, an unsuccessful list leaves test_suite unsatisfied and prevents build_review dispatch until the existing repair/retry route produces a valid suite PASS. |
| adr-2026-07-25-content-addressed-full-suite-proof#D2 | task | task-16 | Verifier inspection and build-review input assembly admit complete current list proof but refuse stale, failed, incomplete, or incompatible proof without launching commands; existing artifacts and daemon-rekick consumers continue to use that same typed inspection authority. |
| adr-2026-07-25-content-addressed-full-suite-proof#D3 | task | task-1, task-3, task-16 | FullSuiteVerifier.ensure reaches the real loader/resolver/executor chain, forwards each effective context to the fake runner, and refuses invalid declarations or any bad later entry with zero launches before execution. |
| adr-2026-07-25-content-addressed-full-suite-proof#D4 | task | task-13, task-14 | fingerprintFullSuiteInputs observes tracked, dirty, non-ignored untracked, explicit ignored, and declared environment changes across both suite directories and relevant root inputs using the existing whole-project collector. |
| adr-2026-07-25-content-addressed-full-suite-proof#D5 | task | task-14 | Fingerprint fixtures reject enumeration/read failures and unresolved or escaped entry directories, while irrelevant documentation and commit-identity-only changes leave the content digest unchanged. |
| adr-2026-07-25-content-addressed-full-suite-proof#D6 | task | task-9, task-10, task-11, task-12, task-16 | ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock. |
| adr-2026-07-25-content-addressed-full-suite-proof#D7 | task | task-15, task-16, task-17 | inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement. |
| adr-2026-07-25-content-addressed-full-suite-proof#D8 | existing | none | artifacts.ts completion and daemon-rekick.ts pre-verification use the same verifier inspection; existing rebase/kickback routing is unchanged and gains list validity through that authority. |
| adr-2026-07-25-content-addressed-full-suite-proof#D9 | no-change | none | Its host-skill surface was superseded by the ADR's 2026-07-29 amendment. The existing provider-neutral test-suite CLI remains; no host skill or legacy Bash conductor is introduced or edited. |
| adr-2026-07-25-content-addressed-full-suite-proof#D10 | no-change | none | No new aggregate requirement is added to intermediate BUILD/SHIP skills or build_review. The separate autoresolve suite_command and independent CI authority remain outside this list implementation. |

## Coverage Check

Every row below quotes the owning task's completion check verbatim. Detailed
failure permutations live at the lower layer specified in that task; cross-boundary
checks use the sole integration owners above. All fixtures are controlled by this
change, not external rollout state.

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a non-empty ordered collection of project-owned commands, when project configuration is loaded, then the collection is accepted in the declared order without requiring a runner type or a suite name. | 1 | "loadConfig preserves a valid commands array in order, accepts either aggregate form with scoped_command, and requires neither suite names nor runner identifiers, as asserted by the configuration fixtures." | diff-local |
| Story 1 happy: Given one aggregate declaration and an existing scoped command, when configuration is loaded, then both are accepted for their respective execution routes. | 1 | "loadConfig preserves a valid commands array in order, accepts either aggregate form with scoped_command, and requires neither suite names nor runner identifiers, as asserted by the configuration fixtures." | diff-local |
| Story 1 negative: Given an empty collection, a non-object entry, a missing or blank command, or an unknown entry setting, when configuration is loaded, then it rejects the declaration with the offending setting and entry index where applicable, before any command runs. | 2, 16 | "validateTestSuiteBlock rejects each malformed-list fixture and names test_suite.commands plus the offending entry index and setting when applicable." | diff-local |
| Story 1 negative: Given both the scalar and collection aggregate forms are present, including after ordinary configuration merging, when configuration is validated, then it rejects the ambiguity instead of choosing or concatenating the forms. | 2 | "loadMergedConfig rejects simultaneous scalar/list aggregate declarations after ordinary merging, while the array-replacement fixture retains declared order without concatenation." | diff-local |
| Story 2 happy: Given entries with explicit directories and timeouts, when aggregate verification runs, then each command receives its own values and every relative directory is resolved from the project root. | 3, 16 | "FullSuiteVerifier.ensure reaches the real loader/resolver/executor chain, forwards each effective context to the fake runner, and refuses invalid declarations or any bad later entry with zero launches before execution." | diff-local |
| Story 2 happy: Given an entry omits its directory or timeout, when it runs, then it inherits the corresponding shared setting or, when that setting is absent, the project root and existing default timeout respectively. | 3, 16 | "The effective-entry resolver returns each opaque command unchanged with its project-root-relative directory and timeout using entry override, shared value, then root/1800-second default precedence." | diff-local |
| Story 2 negative: Given any entry has an absolute directory, a parent traversal or symbolic-link escape outside the project, or a directory unavailable at preflight, when verification is requested, then it names that entry and refuses before executing the collection. | 4, 16 | "FullSuiteVerifier.ensure reaches the real loader/resolver/executor chain, forwards each effective context to the fake runner, and refuses invalid declarations or any bad later entry with zero launches before execution." | diff-local |
| Story 2 negative: Given any entry has a zero, negative, non-finite, or nonnumeric timeout, when configuration is loaded, then it names that entry's timeout and refuses the declaration rather than substituting a default. | 5 | "validateTestSuiteBlock rejects every zero, negative, non-finite, and nonnumeric entry timeout with the indexed timeout_seconds key rather than substituting the shared/default value." | diff-local |
| Story 2 negative: Given entry overrides coexist with a scoped command, when a selected scoped run executes, then it still uses the shared scoped execution context rather than borrowing an aggregate entry's overrides. | 15 | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| Story 3 happy: Given several successful suites, when aggregate verification runs, then each begins only after the preceding suite has completed and cleaned up, and aggregate success follows the final successful suite. | 6, 16 | "executeFullSuite forwards each list command unchanged to FullSuiteCommandRunner in order, awaits the prior operation and cleanup before starting the next, and returns success only after the final successful attempt." | diff-local |
| Story 3 happy: Given a previously failed collection is retried, when verification executes again under the existing retry policy, then it starts at the first suite rather than treating earlier partial successes as cached passes. | 16 | "ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock." | diff-local |
| Story 3 negative: Given a middle suite exits nonzero, when its result is observed, then the aggregate result fails with that suite identified and no later suite starts. | 7, 16 | "executeFullSuite returns nonzero_exit with the failing index and attempted prefix for first, middle, and final failures, and its runner history contains no later entry." | diff-local |
| Story 3 negative: Given a middle suite times out, is terminated by a signal, cannot launch, or encounters a process-cleanup failure, when verification settles, then later suites do not run, aggregate success is withheld, and the original failure class is retained. | 8, 16 | "executeFullSuite retains timeout, signal, unlaunchable, and internal/cleanup failure classifications with available termination metadata, returns the failing prefix, and never starts a later entry in those fixtures." | diff-local |
| Story 3 negative: Given execution ends before every suite has produced a successful result, when completion is evaluated, then it cannot return or persist an aggregate pass for the collection. | 8, 16 | "ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock." | diff-local |
| Story 4 happy: Given commands with different syntaxes and unfamiliar output, when all complete with exit status zero, then the collection succeeds without an output-format or runner-recognition requirement. | 6 | "Injected-runner fixtures with mixed syntax, unfamiliar output, and silent exit-zero results all succeed solely from process completion and exit status; list and per-entry durations come from the injected clock." | diff-local |
| Story 4 happy: Given a command completes successfully with no output, when its result is evaluated, then it counts as a successful suite and execution may continue. | 6 | "Injected-runner fixtures with mixed syntax, unfamiliar output, and silent exit-zero results all succeed solely from process completion and exit status; list and per-entry durations come from the injected clock." | diff-local |
| Story 4 negative: Given a command prints a success message but exits nonzero, when verification evaluates it, then the suite and aggregate result fail. | 7 | "A success-looking stdout fixture with a nonzero process exit produces a failed aggregate result with the original exit code rather than a parsed-output pass." | diff-local |
| Story 4 negative: Given a command cannot launch, when it produces no recognizable test output, then the result identifies a launch failure rather than interpreting silence as success or requiring a runner-specific parser. | 8 | "An interrupted or rejected list operation cannot return a successful aggregate result; a launch failure with empty output remains unlaunchable rather than success." | diff-local |
| Story 5 happy: Given all suites complete successfully, when evidence is persisted and read back, then it identifies every attempted suite in order with its execution directory, duration, and successful exit result, plus the collection's total duration. | 9, 16 | "The v5 evidence writer/reader round trip preserves declared count, contiguous attempted indices, effective directories, per-entry and aggregate durations, exit/termination results, and failed-entry index without inventing unexecuted results." | diff-local |
| Story 5 happy: Given a suite fails after earlier successes, when evidence is read, then it identifies the failed suite with its available exit status or termination reason and distinguishes the unexecuted remainder from the attempted prefix. | 9, 16 | "The v5 evidence writer/reader round trip preserves declared count, contiguous attempted indices, effective directories, per-entry and aggregate durations, exit/termination results, and failed-entry index without inventing unexecuted results." | diff-local |
| Story 5 negative: Given a purported collection pass omits an entry, duplicates or reorders result indices, contradicts its declared count, contains invalid timing or termination values, or includes a failed result, when verification reads it, then it refuses to treat the record as passing proof. | 10, 16 | "readFullSuiteEvidence rejects omitted, duplicated, reordered, count-inconsistent, invalid-timing, invalid-termination, and failure-containing v5 PASS records before they can be used as proof." | diff-local |
| Story 5 negative: Given evidence is corrupt, unsupported, partially written, cannot be written, or cannot be read back after execution, when verification settles, then it does not report a reusable aggregate pass. | 10, 11 | "FullSuiteVerifier.ensure returns a blocking result after list execution if evidence cannot be written or its mandatory read-back is missing, unreadable, or corrupt; no reusable PASS is reported from the command exits alone." | diff-local |
| Story 5 negative: Given commands, paths, or outputs contain declared secrets or oversized diagnostics, when results are persisted or exposed, then secrets are redacted and diagnostic output is bounded while the failed suite's identity and result remain available. | 12 | "The evidence/result sanitization boundary redacts declared secrets in every exposed command, path, output, and message while enforcing per-field and shared 16,384-character diagnostic limits with failure-first allocation and explicit truncation; attempt metadata remains present." | diff-local |
| Story 6 happy: Given a middle suite fails, when the standalone verification command reports it or BUILD prepares its repair context, then both identify the suite's ordinal, command, directory, duration, exit status or reason, unexecuted remainder, and bounded diagnostics. | 17, 18 | "dispatchTestSuiteCommand prints failed ordinal, sanitized command/directory, duration, reason or exit, unexecuted count, and bounded diagnostics from the real verifier for middle, silent, oversized, and secret-bearing failures while returning the existing failure exit outcome." | diff-local |
| Story 6 happy: Given a collection executes, when existing daemon or inline reporting and persisted events are inspected, then they expose attributable attempted-suite outcomes and durations from that execution. | 18, 19 | "The existing emitter/EventPersister path persists terminal list counts and attempt index/result/duration, and daemon plus inline renderer entry points display attributable successful and failed attempts from that same event." | diff-local |
| Story 6 negative: Given the failing command has empty output, when CLI and repair feedback are produced, then the failed-suite identity and termination reason remain present instead of collapsing to generic guidance alone. | 17, 18 | "The targeted BUILD test_suite dispatch delivers the verifier's failed ordinal, sanitized command/directory, duration, termination, unexecuted count, and bounded diagnostic context into the actual repair input, including silent and oversized/secret-bearing failures." | diff-local |
| Story 6 negative: Given a suite produces very large output or declared secrets, when CLI, repair, or event output is produced, then the actionable failing-suite context survives truncation and no declared secret is exposed. | 12, 17, 18, 19 | "The evidence/result sanitization boundary redacts declared secrets in every exposed command, path, output, and message while enforcing per-field and shared 16,384-character diagnostic limits with failure-first allocation and explicit truncation; attempt metadata remains present." | diff-local |
| Story 6 negative: Given current proof is reused without execution, when outcome reporting runs, then it reports reuse without emitting fresh suite-execution outcomes. | 18, 19 | "runTestSuiteStep emits one typed terminal list summary from each executed result with declared/attempted counts and attributable attempt outcomes/durations, including failed attempts; reuse and freshness-only outcomes emit no fresh execution summary and summaries contain no raw diagnostics or secrets." | diff-local |
| Story 6 negative: Given a suite times out or cannot launch, when BUILD routes the result, then it preserves the existing infrastructure-failure handling rather than consuming the semantic code-repair budget as though tests had failed normally. | 18 | "BUILD retains infrastructure retry handling for timeout/unlaunchable results without charging the semantic repair budget, while ordinary nonzero failures follow the existing semantic route." | diff-local |
| Story 7 happy: Given an unchanged scalar aggregate configuration and valid current legacy proof, when verification runs after this feature ships, then it reuses the proof without configuration edits or an upgrade-only execution. | 13, 15 | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| Story 7 happy: Given scoped mode selects tests while the aggregate fallback is a collection, when verification executes, then it runs the existing scoped operation with its original selector/context behavior and records scoped proof. | 15 | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| Story 7 happy: Given scoped mode selects no tests and the aggregate declaration is a collection, when verification executes, then it runs the complete collection and records the aggregate fallback basis. | 15 | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| Story 7 negative: Given only a legacy scalar aggregate pass exists for a collection declaration, including a one-entry collection, when verification inspects it, then the legacy pass cannot satisfy that collection. | 15 | "Verifier route checks refuse v4 aggregate proof for one-entry or larger lists and refuse scoped proof for required aggregate/fallback execution; a scoped-only aggregate request names both supported aggregate declaration alternatives and stays blocked." | diff-local |
| Story 7 negative: Given selected-scoped proof exists, when the gate requires aggregate verification or the aggregate fallback, then that scoped proof cannot stand in for complete aggregate proof. | 15 | "Verifier route checks refuse v4 aggregate proof for one-entry or larger lists and refuse scoped proof for required aggregate/fallback execution; a scoped-only aggregate request names both supported aggregate declaration alternatives and stays blocked." | diff-local |
| Story 7 negative: Given only a scoped command is configured without any aggregate form, when aggregate verification is requested, then it remains blocked with an error naming the supported aggregate declaration alternatives. | 15 | "Verifier route checks refuse v4 aggregate proof for one-entry or larger lists and refuse scoped proof for required aggregate/fallback execution; a scoped-only aggregate request names both supported aggregate declaration alternatives and stays blocked." | diff-local |
| Story 8 happy: Given complete collection proof, when an entry is added, removed, reordered, or its command, directory, or timeout changes, then inspection reports stale project-configuration proof and verification requires execution of the current collection. | 13, 16 | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |
| Story 8 happy: Given suites in different directories, when relevant tracked, dirty, non-ignored untracked, explicitly declared ignored input, or declared environment content changes, then all relevant inputs participate in the existing freshness policy regardless of which suite directory contains them. | 14, 16 | "fingerprintFullSuiteInputs observes tracked, dirty, non-ignored untracked, explicit ignored, and declared environment changes across both suite directories and relevant root inputs using the existing whole-project collector." | diff-local |
| Story 8 negative: Given an entry declaration changes while permissive source/test drift budgets are configured, when freshness is evaluated, then the declaration change remains unbudgetable and the old proof is not preserved. | 13, 16 | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |
| Story 8 negative: Given a relevant input cannot be enumerated or read, or an entry directory cannot be resolved within the project, when freshness is evaluated, then inspection fails closed rather than reusing the old proof. | 14, 16 | "Fingerprint fixtures reject enumeration/read failures and unresolved or escaped entry directories, while irrelevant documentation and commit-identity-only changes leave the content digest unchanged." | diff-local |
| Story 8 negative: Given a shared default changes an entry's effective execution context, when freshness is evaluated, then proof becomes stale just as it does for an explicit entry override change. | 13, 16 | "fingerprintFullSuiteInputs changes project_config identity for entry addition, removal, order, command, directory, timeout, declaration-form, and shared-default changes using the same effective-entry resolver as execution." | diff-local |
| Story 9 happy: Given a complete current collection pass, when another verifier instance, the verification CLI, or an existing gate inspection consumes it without relevant input changes, then it reports current or reused proof without launching the collection again. | 16, 17 | "Verifier inspection and build-review input assembly admit complete current list proof but refuse stale, failed, incomplete, or incompatible proof without launching commands; existing artifacts and daemon-rekick consumers continue to use that same typed inspection authority." | diff-local |
| Story 9 happy: Given only irrelevant documentation or commit-identity changes, or input drift explicitly tolerated by the existing policy, when collection proof is inspected, then reuse and existing drift-preservation recording retain their established semantics. | 14, 16 | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |
| Story 9 negative: Given stale, incomplete, incompatible, or failed collection proof, when either an execution-owning caller or an inspection-only caller evaluates it, then neither reports a satisfied gate; inspection-only callers do not launch commands to manufacture proof. | 16, 17 | "Verifier inspection and build-review input assembly admit complete current list proof but refuse stale, failed, incomplete, or incompatible proof without launching commands; existing artifacts and daemon-rekick consumers continue to use that same typed inspection authority." | diff-local |
| Story 9 negative: Given another live verifier owns the existing execution lock, when a second execution-owning caller requests the same collection, then it cannot run the collection concurrently or publish a competing partial pass; it observes the existing lock outcome. | 16 | "ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock." | diff-local |
| Story 9 negative: Given freshness or drift measurement is indeterminate, when any caller evaluates reuse, then it does not treat evidence existence or an earlier partial success as sufficient. | 16 | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |

## Architecture Alignment

Plan-update review compared these tasks with the approved component and sequence
artifacts. Their existing shared resolution, verifier, executor, durable evidence,
and event-spine boundaries already represent this plan. No new service, external
integration, gate topology, or architectural dependency is introduced, so the
approved diagrams require no structural change under architecture-diagram's scope
rules. Their existing approval remains applicable.

## Advisory Overlap Scan

Read-only scan against the exact 28-path task union, with source ref #2358,
completed on 2026-09-11. Rendered report:

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/types/config.ts, src/conductor/src/engine/config.ts, src/conductor/test/engine/config.test.ts, src/conductor/src/engine/conductor.ts
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/engine/conductor.ts, src/conductor/src/daemon-cli.ts
Note: renames or name-only diffs may not be detected by this scan.
```

These overlaps require ordinary integration coordination if those branches land;
they neither add dependencies to unrelated features nor authorize changes there.

## Authoring Verification

- The engine's story extractor finds 45 criteria; the plan carrier has exactly 45 matching rows, each quoting a cited task's Done-when check.
- The engine's architecture-obligation validator finds all 10 required decisions, with no missing, invented, duplicated, or ungrounded rows.
- All 19 tasks declare files, dependencies, and 2–4 falsifiable completion checks. The dependency graph has no cycle or unknown task.
- The task-file inventory contains 28 paths; only the explicitly created resolver and its unit test are new files.
- The blocking plan-protected-targets command reports no violations. No task directs mutation of another feature's sealed DECIDE artifacts.
- Boundary integration owners and lower-layer failure matrices are explicit. There is no terminal whole-feature validation or speculative repair task.
- No implementation or aggregate test execution was performed during this specification step.
