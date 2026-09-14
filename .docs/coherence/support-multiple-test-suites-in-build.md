# Coherence Check: Support multiple test suites in BUILD

Date: 2026-09-11
Source: jstoup111/ai-conductor#2358
Tier: M; product track; session-default model.
Verdict: PASS — all required layers covered, no waiver required.

Operator approval: James Stoup approved this final report and spec publication in composer chat on 2026-09-11.

## Inputs and Judgment

This review compares the five sanitized staged issue outcomes, 13 functional
requirements, nine accepted stories, 19 approved plan tasks, and the one modified
ADR. Its 10 citable decisions are adjudicated individually below. All 45 exact
happy/negative criteria have task completion evidence. The outcome quotes come
from `.pipeline/intake-outcomes.md`, including its source-bound digest; they are
not reconstructed from memory or rewritten from the issue.

Coverage, consistency, and achievability were checked separately. Verdict
confidence is 98%, grounded in the cited artifact text and verified production
boundaries. This is a review of what the plan requires, not a claim that the
implementation or tests have already passed. No unconfirmed product or external
environment assumption is needed to execute the plan.

The plan's secondary story citations now use separate parseable headers. Its
BUILD completion check explicitly retains the existing prerequisite: an
unsuccessful list prevents build_review dispatch until valid suite proof exists.
Both changes make already-approved behavior explicit; neither expands scope.
These unmerged artifacts were edited directly as requested by the operator.

## Outcome Mapping

Outcome 1's “one-entry case” promises scalar compatibility, not a mandatory
conversion of old evidence to v5. Stories 1, 2, and 7 preserve the scalar path
while adding the list. Outcome 4 preserves direct scoped invocation and
counterfactual preflight; it does not forbid the existing verifier's explicitly
recorded empty-selection aggregate fallback from executing the list.

Outcome 5 combines functional validation with ordinary documentation upkeep.
Stories 1 and 2 deliver the functional refusal. The approved PRD's Documentation
Upkeep section and architecture wiring surface retain the accompanying guide
updates; the stories/plan documentation boundary deliberately does not manufacture
a documentation-only story or task. The full original outcome remains quoted.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-7 | covered | - Project config can declare an ordered list of test-suite commands, each with its own working directory and timeout, and the existing single `command` keeps working unchanged as the one-entry case. |
| outcome | outcome-2 | story-3, story-5, story-6 | covered | - BUILD's test_suite runs the entries in order and stops at the first failure; the step's evidence and the remediation prompt name which entry failed, with its exit code and duration. |
| outcome | outcome-3 | story-5, story-8, story-9 | covered | - The content-addressed full-suite proof accounts for every entry, so adding, removing, reordering, or editing any entry invalidates a prior PASS. |
| outcome | outcome-4 | story-2, story-7 | covered | - `scoped_command` and the build_review counterfactual preflight are unchanged. |
| outcome | outcome-5 | story-1, story-2 | covered | - Configuration and step documentation describe the list form; an invalid entry (empty command, working directory outside the project root) is refused by name at config load like the existing keys. |

## Requirement Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Ordered opaque collection admission without a naming or runner registry. |
| fr | fr-2 | story-2 | covered | Independent project-contained entry directories with defaults and containment refusal. |
| fr | fr-3 | story-2 | covered | Independent positive entry timeouts, inherited only when absent. |
| fr | fr-4 | story-3 | covered | Serial command completion/cleanup and first-failure stop with no later launch. |
| fr | fr-5 | story-3, story-5 | covered | Complete success only; interrupted execution, partial records, and invalid proof cannot attest to the collection. |
| fr | fr-6 | story-4 | covered | Exit completion controls success across silent, unfamiliar, and misleading output. |
| fr | fr-7 | story-5 | covered | Attempted-prefix evidence carries context, timing, exit or termination, and unexecuted count. |
| fr | fr-8 | story-6 | covered | The same actionable bounded failure reaches CLI and BUILD repair; events identify attempted outcomes. |
| fr | fr-9 | story-7 | covered | Scalar configuration, fingerprint, execution, and v4 proof reuse remain usable without edits. |
| fr | fr-10 | story-8 | covered | Ordered declaration and effective-context changes invalidate project_config; all relevant project inputs remain observed. |
| fr | fr-11 | story-9 | covered | Current proof reuse and side-effect-free inspection avoid duplicate execution under existing drift policy. |
| fr | fr-12 | story-1, story-2 | covered | Invalid entries, ambiguous forms, timeout errors, and escaped/unavailable contexts are refused before any command runs. |
| fr | fr-13 | story-7, story-9 | covered | One verifier authority enforces compatible complete proof across execution and inspection entry points. |

## Story Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2, task-16 | covered | Loader validation and verifier preflight jointly admit only unambiguous executable declarations. |
| story | story-2 | task-3, task-4, task-5, task-15, task-16 | covered | Resolver and loader permutations reach the real runner through verifier integration; scoped context remains independent. |
| story | story-3 | task-6, task-7, task-8, task-16, task-18 | covered | Ordered execution stops correctly and complete proof governs the BUILD prerequisite. |
| story | story-4 | task-6, task-7, task-8 | covered | Opaque commands and typed process results make framework/output recognition unnecessary. |
| story | story-5 | task-9, task-10, task-11, task-12, task-16 | covered | Versioned evidence, integrity validation, persistence faults, and redaction preserve trustworthy attempted results. |
| story | story-6 | task-12, task-17, task-18, task-19 | covered | CLI, actual BUILD repair input, and registered event consumers receive the same attributable result. |
| story | story-7 | task-15 | covered | Scalar v4 reuse and distinct selected-scoped/aggregate-fallback routes preserve compatibility. |
| story | story-8 | task-4, task-13, task-14, task-16 | covered | Whole-project observation and ordered unbudgetable configuration identity cover changed or indeterminate inputs. |
| story | story-9 | task-14, task-16, task-17 | covered | Verifier, CLI, and inspection-only assembly agree on complete proof; existing lock and caller-owned drift recording remain authoritative. |

## Task Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-1 | covered | loadConfig preserves a valid commands array in order, accepts either aggregate form with scoped_command, and requires neither suite names nor runner identifiers, as asserted by the configuration fixtures. |
| task | task-2 | story-1 | covered | validateTestSuiteBlock rejects each malformed-list fixture and names test_suite.commands plus the offending entry index and setting when applicable. |
| task | task-3 | story-2 | covered | The effective-entry resolver returns each opaque command unchanged with its project-root-relative directory and timeout using entry override, shared value, then root/1800-second default precedence. |
| task | task-4 | story-2, story-8 | covered | Configuration validation rejects absolute, parent-escape, and outward-symlink entry directories with indexed working_directory errors. |
| task | task-5 | story-2 | covered | validateTestSuiteBlock rejects every zero, negative, non-finite, and nonnumeric entry timeout with the indexed timeout_seconds key rather than substituting the shared/default value. |
| task | task-6 | story-3, story-4 | covered | executeFullSuite forwards each list command unchanged to FullSuiteCommandRunner in order, awaits the prior operation and cleanup before starting the next, and returns success only after the final successful attempt. |
| task | task-7 | story-3, story-4 | covered | executeFullSuite returns nonzero_exit with the failing index and attempted prefix for first, middle, and final failures, and its runner history contains no later entry. |
| task | task-8 | story-3, story-4 | covered | executeFullSuite retains timeout, signal, unlaunchable, and internal/cleanup failure classifications with available termination metadata, returns the failing prefix, and never starts a later entry in those fixtures. |
| task | task-9 | story-5 | covered | The v5 evidence writer/reader round trip preserves declared count, contiguous attempted indices, effective directories, per-entry and aggregate durations, exit/termination results, and failed-entry index without inventing unexecuted results. |
| task | task-10 | story-5 | covered | readFullSuiteEvidence rejects omitted, duplicated, reordered, count-inconsistent, invalid-timing, invalid-termination, and failure-containing v5 PASS records before they can be used as proof. |
| task | task-11 | story-5 | covered | writeFullSuiteEvidence retains atomic temporary-file replacement for v5, and its injected write/rename failures never expose a partially written successful record as valid proof. |
| task | task-12 | story-5, story-6 | covered | The verifier's list failure description retains ordinal/index, sanitized command/directory, duration, reason or exit, and unexecuted count for both silent and oversized failures. |
| task | task-13 | story-8 | covered | fingerprintFullSuiteInputs changes project_config identity for entry addition, removal, order, command, directory, timeout, declaration-form, and shared-default changes using the same effective-entry resolver as execution. |
| task | task-14 | story-8, story-9 | covered | fingerprintFullSuiteInputs observes tracked, dirty, non-ignored untracked, explicit ignored, and declared environment changes across both suite directories and relevant root inputs using the existing whole-project collector. |
| task | task-15 | story-2, story-7 | covered | FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis. |
| task | task-16 | story-1, story-2, story-3, story-5, story-8, story-9 | covered | FullSuiteVerifier.ensure reaches the real loader/resolver/executor chain, forwards each effective context to the fake runner, and refuses invalid declarations or any bad later entry with zero launches before execution. |
| task | task-17 | story-6, story-9 | covered | dispatchTestSuiteCommand prints failed ordinal, sanitized command/directory, duration, reason or exit, unexecuted count, and bounded diagnostics from the real verifier for middle, silent, oversized, and secret-bearing failures while returning the existing failure exit outcome. |
| task | task-18 | story-6, story-3 | covered | The targeted BUILD test_suite dispatch delivers the verifier's failed ordinal, sanitized command/directory, duration, termination, unexecuted count, and bounded diagnostic context into the actual repair input, including silent and oversized/secret-bearing failures. |
| task | task-19 | story-6 | covered | The existing emitter/EventPersister path persists terminal list counts and attempt index/result/duration, and daemon plus inline renderer entry points display attributable successful and failed attempts from that same event. |

## Architecture Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-2026-07-25-content-addressed-full-suite-proof | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9 | covered | Decisions D1–D10 retain one verifier/gate and current-tree authority; approved D3/D6 amendments add ordered execution and complete v5 proof. The individual dispositions are judged below. |

## Criterion Mapping

The checks are read jointly where a criterion cites several tasks. Each quote is
verbatim from one cited Done-when block; the other cited tasks supply the named
input, policy, or delivery boundary. All scenarios use controlled local inputs.

| Row class | Exact criterion | Task id(s) | Verdict | Done when quote | Disposition |
|---|---|---|---|---|---|
| criterion | Story 1 happy: Given a non-empty ordered collection of project-owned commands, when project configuration is loaded, then the collection is accepted in the declared order without requiring a runner type or a suite name. | task-1 | covered | "loadConfig preserves a valid commands array in order, accepts either aggregate form with scoped_command, and requires neither suite names nor runner identifiers, as asserted by the configuration fixtures." | diff-local |
| criterion | Story 1 happy: Given one aggregate declaration and an existing scoped command, when configuration is loaded, then both are accepted for their respective execution routes. | task-1 | covered | "loadConfig preserves a valid commands array in order, accepts either aggregate form with scoped_command, and requires neither suite names nor runner identifiers, as asserted by the configuration fixtures." | diff-local |
| criterion | Story 1 negative: Given an empty collection, a non-object entry, a missing or blank command, or an unknown entry setting, when configuration is loaded, then it rejects the declaration with the offending setting and entry index where applicable, before any command runs. | task-2, task-16 | covered | "validateTestSuiteBlock rejects each malformed-list fixture and names test_suite.commands plus the offending entry index and setting when applicable." | diff-local |
| criterion | Story 1 negative: Given both the scalar and collection aggregate forms are present, including after ordinary configuration merging, when configuration is validated, then it rejects the ambiguity instead of choosing or concatenating the forms. | task-2 | covered | "loadMergedConfig rejects simultaneous scalar/list aggregate declarations after ordinary merging, while the array-replacement fixture retains declared order without concatenation." | diff-local |
| criterion | Story 2 happy: Given entries with explicit directories and timeouts, when aggregate verification runs, then each command receives its own values and every relative directory is resolved from the project root. | task-3, task-16 | covered | "FullSuiteVerifier.ensure reaches the real loader/resolver/executor chain, forwards each effective context to the fake runner, and refuses invalid declarations or any bad later entry with zero launches before execution." | diff-local |
| criterion | Story 2 happy: Given an entry omits its directory or timeout, when it runs, then it inherits the corresponding shared setting or, when that setting is absent, the project root and existing default timeout respectively. | task-3, task-16 | covered | "The effective-entry resolver returns each opaque command unchanged with its project-root-relative directory and timeout using entry override, shared value, then root/1800-second default precedence." | diff-local |
| criterion | Story 2 negative: Given any entry has an absolute directory, a parent traversal or symbolic-link escape outside the project, or a directory unavailable at preflight, when verification is requested, then it names that entry and refuses before executing the collection. | task-4, task-16 | covered | "FullSuiteVerifier.ensure reaches the real loader/resolver/executor chain, forwards each effective context to the fake runner, and refuses invalid declarations or any bad later entry with zero launches before execution." | diff-local |
| criterion | Story 2 negative: Given any entry has a zero, negative, non-finite, or nonnumeric timeout, when configuration is loaded, then it names that entry's timeout and refuses the declaration rather than substituting a default. | task-5 | covered | "validateTestSuiteBlock rejects every zero, negative, non-finite, and nonnumeric entry timeout with the indexed timeout_seconds key rather than substituting the shared/default value." | diff-local |
| criterion | Story 2 negative: Given entry overrides coexist with a scoped command, when a selected scoped run executes, then it still uses the shared scoped execution context rather than borrowing an aggregate entry's overrides. | task-15 | covered | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| criterion | Story 3 happy: Given several successful suites, when aggregate verification runs, then each begins only after the preceding suite has completed and cleaned up, and aggregate success follows the final successful suite. | task-6, task-16 | covered | "executeFullSuite forwards each list command unchanged to FullSuiteCommandRunner in order, awaits the prior operation and cleanup before starting the next, and returns success only after the final successful attempt." | diff-local |
| criterion | Story 3 happy: Given a previously failed collection is retried, when verification executes again under the existing retry policy, then it starts at the first suite rather than treating earlier partial successes as cached passes. | task-16 | covered | "ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock." | diff-local |
| criterion | Story 3 negative: Given a middle suite exits nonzero, when its result is observed, then the aggregate result fails with that suite identified and no later suite starts. | task-7, task-16 | covered | "executeFullSuite returns nonzero_exit with the failing index and attempted prefix for first, middle, and final failures, and its runner history contains no later entry." | diff-local |
| criterion | Story 3 negative: Given a middle suite times out, is terminated by a signal, cannot launch, or encounters a process-cleanup failure, when verification settles, then later suites do not run, aggregate success is withheld, and the original failure class is retained. | task-8, task-16 | covered | "executeFullSuite retains timeout, signal, unlaunchable, and internal/cleanup failure classifications with available termination metadata, returns the failing prefix, and never starts a later entry in those fixtures." | diff-local |
| criterion | Story 3 negative: Given execution ends before every suite has produced a successful result, when completion is evaluated, then it cannot return or persist an aggregate pass for the collection. | task-8, task-16 | covered | "ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock." | diff-local |
| criterion | Story 4 happy: Given commands with different syntaxes and unfamiliar output, when all complete with exit status zero, then the collection succeeds without an output-format or runner-recognition requirement. | task-6 | covered | "Injected-runner fixtures with mixed syntax, unfamiliar output, and silent exit-zero results all succeed solely from process completion and exit status; list and per-entry durations come from the injected clock." | diff-local |
| criterion | Story 4 happy: Given a command completes successfully with no output, when its result is evaluated, then it counts as a successful suite and execution may continue. | task-6 | covered | "Injected-runner fixtures with mixed syntax, unfamiliar output, and silent exit-zero results all succeed solely from process completion and exit status; list and per-entry durations come from the injected clock." | diff-local |
| criterion | Story 4 negative: Given a command prints a success message but exits nonzero, when verification evaluates it, then the suite and aggregate result fail. | task-7 | covered | "A success-looking stdout fixture with a nonzero process exit produces a failed aggregate result with the original exit code rather than a parsed-output pass." | diff-local |
| criterion | Story 4 negative: Given a command cannot launch, when it produces no recognizable test output, then the result identifies a launch failure rather than interpreting silence as success or requiring a runner-specific parser. | task-8 | covered | "An interrupted or rejected list operation cannot return a successful aggregate result; a launch failure with empty output remains unlaunchable rather than success." | diff-local |
| criterion | Story 5 happy: Given all suites complete successfully, when evidence is persisted and read back, then it identifies every attempted suite in order with its execution directory, duration, and successful exit result, plus the collection's total duration. | task-9, task-16 | covered | "The v5 evidence writer/reader round trip preserves declared count, contiguous attempted indices, effective directories, per-entry and aggregate durations, exit/termination results, and failed-entry index without inventing unexecuted results." | diff-local |
| criterion | Story 5 happy: Given a suite fails after earlier successes, when evidence is read, then it identifies the failed suite with its available exit status or termination reason and distinguishes the unexecuted remainder from the attempted prefix. | task-9, task-16 | covered | "The v5 evidence writer/reader round trip preserves declared count, contiguous attempted indices, effective directories, per-entry and aggregate durations, exit/termination results, and failed-entry index without inventing unexecuted results." | diff-local |
| criterion | Story 5 negative: Given a purported collection pass omits an entry, duplicates or reorders result indices, contradicts its declared count, contains invalid timing or termination values, or includes a failed result, when verification reads it, then it refuses to treat the record as passing proof. | task-10, task-16 | covered | "readFullSuiteEvidence rejects omitted, duplicated, reordered, count-inconsistent, invalid-timing, invalid-termination, and failure-containing v5 PASS records before they can be used as proof." | diff-local |
| criterion | Story 5 negative: Given evidence is corrupt, unsupported, partially written, cannot be written, or cannot be read back after execution, when verification settles, then it does not report a reusable aggregate pass. | task-10, task-11 | covered | "FullSuiteVerifier.ensure returns a blocking result after list execution if evidence cannot be written or its mandatory read-back is missing, unreadable, or corrupt; no reusable PASS is reported from the command exits alone." | diff-local |
| criterion | Story 5 negative: Given commands, paths, or outputs contain declared secrets or oversized diagnostics, when results are persisted or exposed, then secrets are redacted and diagnostic output is bounded while the failed suite's identity and result remain available. | task-12 | covered | "The evidence/result sanitization boundary redacts declared secrets in every exposed command, path, output, and message while enforcing per-field and shared 16,384-character diagnostic limits with failure-first allocation and explicit truncation; attempt metadata remains present." | diff-local |
| criterion | Story 6 happy: Given a middle suite fails, when the standalone verification command reports it or BUILD prepares its repair context, then both identify the suite's ordinal, command, directory, duration, exit status or reason, unexecuted remainder, and bounded diagnostics. | task-17, task-18 | covered | "dispatchTestSuiteCommand prints failed ordinal, sanitized command/directory, duration, reason or exit, unexecuted count, and bounded diagnostics from the real verifier for middle, silent, oversized, and secret-bearing failures while returning the existing failure exit outcome." | diff-local |
| criterion | Story 6 happy: Given a collection executes, when existing daemon or inline reporting and persisted events are inspected, then they expose attributable attempted-suite outcomes and durations from that execution. | task-18, task-19 | covered | "The existing emitter/EventPersister path persists terminal list counts and attempt index/result/duration, and daemon plus inline renderer entry points display attributable successful and failed attempts from that same event." | diff-local |
| criterion | Story 6 negative: Given the failing command has empty output, when CLI and repair feedback are produced, then the failed-suite identity and termination reason remain present instead of collapsing to generic guidance alone. | task-17, task-18 | covered | "The targeted BUILD test_suite dispatch delivers the verifier's failed ordinal, sanitized command/directory, duration, termination, unexecuted count, and bounded diagnostic context into the actual repair input, including silent and oversized/secret-bearing failures." | diff-local |
| criterion | Story 6 negative: Given a suite produces very large output or declared secrets, when CLI, repair, or event output is produced, then the actionable failing-suite context survives truncation and no declared secret is exposed. | task-12, task-17, task-18, task-19 | covered | "The evidence/result sanitization boundary redacts declared secrets in every exposed command, path, output, and message while enforcing per-field and shared 16,384-character diagnostic limits with failure-first allocation and explicit truncation; attempt metadata remains present." | diff-local |
| criterion | Story 6 negative: Given current proof is reused without execution, when outcome reporting runs, then it reports reuse without emitting fresh suite-execution outcomes. | task-18, task-19 | covered | "runTestSuiteStep emits one typed terminal list summary from each executed result with declared/attempted counts and attributable attempt outcomes/durations, including failed attempts; reuse and freshness-only outcomes emit no fresh execution summary and summaries contain no raw diagnostics or secrets." | diff-local |
| criterion | Story 6 negative: Given a suite times out or cannot launch, when BUILD routes the result, then it preserves the existing infrastructure-failure handling rather than consuming the semantic code-repair budget as though tests had failed normally. | task-18 | covered | "BUILD retains infrastructure retry handling for timeout/unlaunchable results without charging the semantic repair budget, while ordinary nonzero failures follow the existing semantic route." | diff-local |
| criterion | Story 7 happy: Given an unchanged scalar aggregate configuration and valid current legacy proof, when verification runs after this feature ships, then it reuses the proof without configuration edits or an upgrade-only execution. | task-13, task-15 | covered | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| criterion | Story 7 happy: Given scoped mode selects tests while the aggregate fallback is a collection, when verification executes, then it runs the existing scoped operation with its original selector/context behavior and records scoped proof. | task-15 | covered | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| criterion | Story 7 happy: Given scoped mode selects no tests and the aggregate declaration is a collection, when verification executes, then it runs the complete collection and records the aggregate fallback basis. | task-15 | covered | "FullSuiteVerifier reuses current v4 scalar proof without launching and preserves scalar execution/fingerprints; selected scoped execution with list fallback keeps its shared context and selector behavior, while empty-selection fallback executes the complete list and records v5 aggregate basis." | diff-local |
| criterion | Story 7 negative: Given only a legacy scalar aggregate pass exists for a collection declaration, including a one-entry collection, when verification inspects it, then the legacy pass cannot satisfy that collection. | task-15 | covered | "Verifier route checks refuse v4 aggregate proof for one-entry or larger lists and refuse scoped proof for required aggregate/fallback execution; a scoped-only aggregate request names both supported aggregate declaration alternatives and stays blocked." | diff-local |
| criterion | Story 7 negative: Given selected-scoped proof exists, when the gate requires aggregate verification or the aggregate fallback, then that scoped proof cannot stand in for complete aggregate proof. | task-15 | covered | "Verifier route checks refuse v4 aggregate proof for one-entry or larger lists and refuse scoped proof for required aggregate/fallback execution; a scoped-only aggregate request names both supported aggregate declaration alternatives and stays blocked." | diff-local |
| criterion | Story 7 negative: Given only a scoped command is configured without any aggregate form, when aggregate verification is requested, then it remains blocked with an error naming the supported aggregate declaration alternatives. | task-15 | covered | "Verifier route checks refuse v4 aggregate proof for one-entry or larger lists and refuse scoped proof for required aggregate/fallback execution; a scoped-only aggregate request names both supported aggregate declaration alternatives and stays blocked." | diff-local |
| criterion | Story 8 happy: Given complete collection proof, when an entry is added, removed, reordered, or its command, directory, or timeout changes, then inspection reports stale project-configuration proof and verification requires execution of the current collection. | task-13, task-16 | covered | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |
| criterion | Story 8 happy: Given suites in different directories, when relevant tracked, dirty, non-ignored untracked, explicitly declared ignored input, or declared environment content changes, then all relevant inputs participate in the existing freshness policy regardless of which suite directory contains them. | task-14, task-16 | covered | "fingerprintFullSuiteInputs observes tracked, dirty, non-ignored untracked, explicit ignored, and declared environment changes across both suite directories and relevant root inputs using the existing whole-project collector." | diff-local |
| criterion | Story 8 negative: Given an entry declaration changes while permissive source/test drift budgets are configured, when freshness is evaluated, then the declaration change remains unbudgetable and the old proof is not preserved. | task-13, task-16 | covered | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |
| criterion | Story 8 negative: Given a relevant input cannot be enumerated or read, or an entry directory cannot be resolved within the project, when freshness is evaluated, then inspection fails closed rather than reusing the old proof. | task-14, task-16 | covered | "Fingerprint fixtures reject enumeration/read failures and unresolved or escaped entry directories, while irrelevant documentation and commit-identity-only changes leave the content digest unchanged." | diff-local |
| criterion | Story 8 negative: Given a shared default changes an entry's effective execution context, when freshness is evaluated, then proof becomes stale just as it does for an explicit entry override change. | task-13, task-16 | covered | "fingerprintFullSuiteInputs changes project_config identity for entry addition, removal, order, command, directory, timeout, declaration-form, and shared-default changes using the same effective-entry resolver as execution." | diff-local |
| criterion | Story 9 happy: Given a complete current collection pass, when another verifier instance, the verification CLI, or an existing gate inspection consumes it without relevant input changes, then it reports current or reused proof without launching the collection again. | task-16, task-17 | covered | "Verifier inspection and build-review input assembly admit complete current list proof but refuse stale, failed, incomplete, or incompatible proof without launching commands; existing artifacts and daemon-rekick consumers continue to use that same typed inspection authority." | diff-local |
| criterion | Story 9 happy: Given only irrelevant documentation or commit-identity changes, or input drift explicitly tolerated by the existing policy, when collection proof is inspected, then reuse and existing drift-preservation recording retain their established semantics. | task-14, task-16 | covered | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |
| criterion | Story 9 negative: Given stale, incomplete, incompatible, or failed collection proof, when either an execution-owning caller or an inspection-only caller evaluates it, then neither reports a satisfied gate; inspection-only callers do not launch commands to manufacture proof. | task-16, task-17 | covered | "Verifier inspection and build-review input assembly admit complete current list proof but refuse stale, failed, incomplete, or incompatible proof without launching commands; existing artifacts and daemon-rekick consumers continue to use that same typed inspection authority." | diff-local |
| criterion | Story 9 negative: Given another live verifier owns the existing execution lock, when a second execution-owning caller requests the same collection, then it cannot run the collection concurrently or publish a competing partial pass; it observes the existing lock outcome. | task-16 | covered | "ensure writes and reads complete list PASS only after every successful attempt, retains failed prefixes without PASS, retries from entry zero, and another verifier reuses current proof; two live callers cannot execute or publish competing partial proof under the existing lock." | diff-local |
| criterion | Story 9 negative: Given freshness or drift measurement is indeterminate, when any caller evaluates reuse, then it does not treat evidence existence or an earlier partial success as sufficient. | task-16 | covered | "inspect reports list declaration/default changes as unbudgetable project_config staleness despite permissive source/test budgets, preserves established irrelevant-change and tolerated-drift semantics, and refuses indeterminate freshness or drift measurement." | diff-local |

## Decision-by-Decision Judgment

D1 is delivered by Task 18's explicit unsatisfied-suite/build_review prerequisite
check and retained typed repair/retry routing. The plan does not add a disable
switch or restore the superseded wiring-check topology. D2 is delivered through
Task 16's real verifier/inspection chain, Task 17's CLI adapter, and Task 18's
BUILD integration; no caller receives an independent list executor.

D3's approved list amendment is delivered jointly by config admission/refusal,
shared resolution, and zero-launch preflight at the real verifier boundary
(Tasks 1–5 and 16). Task 6 proves opaque serial execution. D4 combines Task 13's
ordered declaration identity with Task 14's whole-project and explicit input/
environment observation. D5 retains content rather than commit identity in
Task 14; the existing evidence envelope keeps the commit as provenance, not as
an execution-reuse key.

D6 is delivered jointly, not by an evidence-version label alone: Task 9 defines
real attempted records, Task 10 refuses contradictory proof, Task 11 requires
atomic persistence/read-back, Task 12 bounds and redacts diagnostics, and Task 16
admits only complete successful proof. Tasks 15 and 16 prevent old aggregate
proof or selected-scoped proof from being promoted to list aggregate proof.

D7 is delivered by Task 16's current inspection and indeterminate-input refusal,
Task 15's mode/version compatibility, and Task 17's CLI consumption. The existing
budget amendment remains in force, with declaration changes unbudgetable. D8's
existing disposition was verified in artifacts.ts's test_suite completion
predicate and daemon-rekick.ts's post-rebase pre-verification path: both consume the
same FullSuiteVerifier inspection, and preservation recording remains outside
the read-only predicate. List support changes that shared authority rather than
adding a second rebase policy.

D9 requires no new implementation: its historical host-skill surface was already
superseded; this plan retains the provider-neutral CLI without editing a host
catalog or legacy Bash conductor. D10 requires no new implementation: aggregate
ownership stays with the configured verifier, counterfactual preflight retains
its scoped path, and autoresolve plus independent CI keep their existing roles.
These are actual preserved boundaries, not exemptions from undecided work.

## Consistency and Achievability

The cross-layer sweep found no contradiction or oscillation. Every FR's cited
stories exercise its behavior, and every story cites only a declared FR. The
functional collection, contexts, ordered stopping, proof completeness, reporting,
compatibility, input identity, and reuse obligations all reach concrete owning
tasks. The issue's suite-agnostic requirement reaches the actual injected process
boundary; it is not satisfied merely by renaming a framework-specific command.

For preserved behavior, Tasks 9, 13, and 15 explicitly retain scalar v4 serialization,
fingerprints, and execution. Task 15 retains shared scoped context and the existing
selected-scoped route. Tasks 18 and 19 condition fresh terminal summaries on actual
list execution and keep freshness/reuse-only events quiet. Thus the reporting work
cannot turn a reuse into execution or impose new scalar/scoped evidence writes.
Tasks 14 and 16 preserve the difference between observing all inputs and applying
existing drift tolerance; declaration drift remains unbudgetable.

The result vocabulary can represent every required outcome: successful complete
list, failed attempted prefix, preflight refusal with zero attempts, typed process
failure, current/reused proof, permitted preservation, stale proof, and unusable or
indeterminate inspection. An unexecuted remainder is represented by declared count
minus attempted prefix, not fabricated successful entries. No requirement depends
on interpreting an exit message or assigning an invented state to silence.

Input-boundary delivery is explicit. Loader tests own actual YAML validation;
Task 16 proves those declarations and effective contexts reach the real executor
and evidence path. Tasks 13–14 exercise the actual project input collector, and
Task 16 applies freshness policy to that observation. CLI and BUILD tests consume
the same verifier result rather than constructing unrelated pretty messages.
Event-consumer tests exercise registered persistence and both renderers. Each
criterion was judged against the cited completion checks jointly with these named
boundaries; none is credited solely from Steps prose or a plausible task title.

All failure permutations are assigned to the lowest sufficient layer. Existing
direct-scoped and counterfactual tests cover unchanged internals; list route and
proof behavior have explicit new verifier coverage. The plan has no terminal
catch-all test task, outside-diff dependency, or unspecified repair promise.

## Validation

The production coherence parser accepts all 92 rows. Its ID cross-check and
validateCoherence pass against the real PRD, stories, plan, changed ADR pool, and
five verbatim staged outcomes. The architecture-obligation validator accepts all
10 decision rows with grounded completion quotes. The protected-target scan
reports no violations. No implementation tests or aggregate suite were run;
these results validate specification structure and traceability only.
