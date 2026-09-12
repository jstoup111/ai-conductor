**Status:** Accepted

# Stories: Support multiple test suites in BUILD

Source: jstoup111/ai-conductor#2358

Approved by James Stoup in composer chat, 2026-09-11.

Scope boundary: All approved #2358 functional outcomes, suite agnostic. The accepted product and architecture contracts govern these behaviors. #658's integrity-suite adoption remains separate; no parallel scheduling, per-suite result cache, or runner-specific adapter is introduced.

## Story 1: Declare an unambiguous ordered collection

**Requirement:** FR-1, FR-12

As a project maintainer, I want to declare the suites that constitute aggregate verification so the harness runs my complete verification policy.

### Acceptance Criteria

#### Happy Path
- Given a non-empty ordered collection of project-owned commands, when project configuration is loaded, then the collection is accepted in the declared order without requiring a runner type or a suite name.
- Given one aggregate declaration and an existing scoped command, when configuration is loaded, then both are accepted for their respective execution routes.

#### Negative Paths
- Given an empty collection, a non-object entry, a missing or blank command, or an unknown entry setting, when configuration is loaded, then it rejects the declaration with the offending setting and entry index where applicable, before any command runs.
- Given both the scalar and collection aggregate forms are present, including after ordinary configuration merging, when configuration is validated, then it rejects the ambiguity instead of choosing or concatenating the forms.

### Done When
- [ ] Configuration-load results preserve valid entry order and distinguish both supported aggregate forms.
- [ ] Refusals identify invalid declarations and a runner-call observation confirms no execution for any rejected configuration.

## Story 2: Run each suite in its intended context

**Requirement:** FR-2, FR-3, FR-12

As a maintainer, I want each suite to use its own directory and time allowance so a mixed project does not force all suites into one execution context.

### Acceptance Criteria

#### Happy Path
- Given entries with explicit directories and timeouts, when aggregate verification runs, then each command receives its own values and every relative directory is resolved from the project root.
- Given an entry omits its directory or timeout, when it runs, then it inherits the corresponding shared setting or, when that setting is absent, the project root and existing default timeout respectively.

#### Negative Paths
- Given any entry has an absolute directory, a parent traversal or symbolic-link escape outside the project, or a directory unavailable at preflight, when verification is requested, then it names that entry and refuses before executing the collection.
- Given any entry has a zero, negative, non-finite, or nonnumeric timeout, when configuration is loaded, then it names that entry's timeout and refuses the declaration rather than substituting a default.
- Given entry overrides coexist with a scoped command, when a selected scoped run executes, then it still uses the shared scoped execution context rather than borrowing an aggregate entry's overrides.

### Done When
- [ ] Observed command-runner invocations show project-relative resolution, independent overrides, and inherited defaults for different entries.
- [ ] Invalid-context cases produce indexed refusals with zero aggregate process launches; scoped execution retains its shared context.

## Story 3: Stop at the first failure and require complete success

**Requirement:** FR-4, FR-5

As an operator, I want ordered verification to stop at its first blocker so the aggregate result cannot conceal unfinished suites.

### Acceptance Criteria

#### Happy Path
- Given several successful suites, when aggregate verification runs, then each begins only after the preceding suite has completed and cleaned up, and aggregate success follows the final successful suite.
- Given a previously failed collection is retried, when verification executes again under the existing retry policy, then it starts at the first suite rather than treating earlier partial successes as cached passes.

#### Negative Paths
- Given a middle suite exits nonzero, when its result is observed, then the aggregate result fails with that suite identified and no later suite starts.
- Given a middle suite times out, is terminated by a signal, cannot launch, or encounters a process-cleanup failure, when verification settles, then later suites do not run, aggregate success is withheld, and the original failure class is retained.
- Given execution ends before every suite has produced a successful result, when completion is evaluated, then it cannot return or persist an aggregate pass for the collection.

### Done When
- [ ] An ordered runner-call history proves serial execution and first-failure stopping for completed failures and infrastructure failures.
- [ ] Failed-run retry and interrupted-collection observations prove that partial successes never become aggregate completion.

## Story 4: Accept any runner's exit contract

**Requirement:** FR-6

As a maintainer of a mixed-language project, I want verification to work with my existing commands so no framework integration is required.

### Acceptance Criteria

#### Happy Path
- Given commands with different syntaxes and unfamiliar output, when all complete with exit status zero, then the collection succeeds without an output-format or runner-recognition requirement.
- Given a command completes successfully with no output, when its result is evaluated, then it counts as a successful suite and execution may continue.

#### Negative Paths
- Given a command prints a success message but exits nonzero, when verification evaluates it, then the suite and aggregate result fail.
- Given a command cannot launch, when it produces no recognizable test output, then the result identifies a launch failure rather than interpreting silence as success or requiring a runner-specific parser.

### Done When
- [ ] Results from empty, arbitrary, and misleading output are decided by process completion and exit status rather than diagnostic wording.
- [ ] Mixed command syntax reaches the existing command-execution boundary unchanged.

## Story 5: Preserve complete and trustworthy execution evidence

**Requirement:** FR-5, FR-7

As an operator, I want durable evidence of what actually ran so an incomplete collection cannot pass verification later.

### Acceptance Criteria

#### Happy Path
- Given all suites complete successfully, when evidence is persisted and read back, then it identifies every attempted suite in order with its execution directory, duration, and successful exit result, plus the collection's total duration.
- Given a suite fails after earlier successes, when evidence is read, then it identifies the failed suite with its available exit status or termination reason and distinguishes the unexecuted remainder from the attempted prefix.

#### Negative Paths
- Given a purported collection pass omits an entry, duplicates or reorders result indices, contradicts its declared count, contains invalid timing or termination values, or includes a failed result, when verification reads it, then it refuses to treat the record as passing proof.
- Given evidence is corrupt, unsupported, partially written, cannot be written, or cannot be read back after execution, when verification settles, then it does not report a reusable aggregate pass.
- Given commands, paths, or outputs contain declared secrets or oversized diagnostics, when results are persisted or exposed, then secrets are redacted and diagnostic output is bounded while the failed suite's identity and result remain available.

### Done When
- [ ] Evidence round trips preserve all attempted results and the declared collection size without inventing results for unexecuted entries.
- [ ] Invalid proof and persistence-failure observations remain blocking; bounded redacted evidence still identifies the failing suite.

## Story 6: Deliver the failing suite to operators and repair

**Requirement:** FR-8

As an operator or repair agent, I want the specific failing suite and its diagnostics so I can address the blocker without reconstructing an opaque combined command.

### Acceptance Criteria

#### Happy Path
- Given a middle suite fails, when the standalone verification command reports it or BUILD prepares its repair context, then both identify the suite's ordinal, command, directory, duration, exit status or reason, unexecuted remainder, and bounded diagnostics.
- Given a collection executes, when existing daemon or inline reporting and persisted events are inspected, then they expose attributable attempted-suite outcomes and durations from that execution.

#### Negative Paths
- Given the failing command has empty output, when CLI and repair feedback are produced, then the failed-suite identity and termination reason remain present instead of collapsing to generic guidance alone.
- Given a suite produces very large output or declared secrets, when CLI, repair, or event output is produced, then the actionable failing-suite context survives truncation and no declared secret is exposed.
- Given current proof is reused without execution, when outcome reporting runs, then it reports reuse without emitting fresh suite-execution outcomes.
- Given a suite times out or cannot launch, when BUILD routes the result, then it preserves the existing infrastructure-failure handling rather than consuming the semantic code-repair budget as though tests had failed normally.

### Done When
- [ ] Captured CLI text and the actual BUILD repair input contain the same actionable failed-suite context, including an empty-output case.
- [ ] Existing event persistence and renderers expose executed collection outcomes and distinguish them from reuse and infrastructure failures.

## Story 7: Preserve existing verification modes and single-suite projects

**Requirement:** FR-9, FR-13

As an existing harness consumer, I want multi-suite support without changing my current single-suite or scoped verification behavior.

### Acceptance Criteria

#### Happy Path
- Given an unchanged scalar aggregate configuration and valid current legacy proof, when verification runs after this feature ships, then it reuses the proof without configuration edits or an upgrade-only execution.
- Given scoped mode selects tests while the aggregate fallback is a collection, when verification executes, then it runs the existing scoped operation with its original selector/context behavior and records scoped proof.
- Given scoped mode selects no tests and the aggregate declaration is a collection, when verification executes, then it runs the complete collection and records the aggregate fallback basis.

#### Negative Paths
- Given only a legacy scalar aggregate pass exists for a collection declaration, including a one-entry collection, when verification inspects it, then the legacy pass cannot satisfy that collection.
- Given selected-scoped proof exists, when the gate requires aggregate verification or the aggregate fallback, then that scoped proof cannot stand in for complete aggregate proof.
- Given only a scoped command is configured without any aggregate form, when aggregate verification is requested, then it remains blocked with an error naming the supported aggregate declaration alternatives.

### Done When
- [ ] Scalar proof reuse and unchanged scalar execution are observable through the production verifier.
- [ ] Selected-scoped execution, empty-selection fallback, and incompatible-proof cases preserve their distinct outcomes with collection configuration.

## Story 8: Invalidate proof for changes anywhere in the declared verification

**Requirement:** FR-10

As a maintainer, I want proof to cover the whole verification declaration so changing a suite cannot silently reuse an unrelated pass.

### Acceptance Criteria

#### Happy Path
- Given complete collection proof, when an entry is added, removed, reordered, or its command, directory, or timeout changes, then inspection reports stale project-configuration proof and verification requires execution of the current collection.
- Given suites in different directories, when relevant tracked, dirty, non-ignored untracked, explicitly declared ignored input, or declared environment content changes, then all relevant inputs participate in the existing freshness policy regardless of which suite directory contains them.

#### Negative Paths
- Given an entry declaration changes while permissive source/test drift budgets are configured, when freshness is evaluated, then the declaration change remains unbudgetable and the old proof is not preserved.
- Given a relevant input cannot be enumerated or read, or an entry directory cannot be resolved within the project, when freshness is evaluated, then inspection fails closed rather than reusing the old proof.
- Given a shared default changes an entry's effective execution context, when freshness is evaluated, then proof becomes stale just as it does for an explicit entry override change.

### Done When
- [ ] A declaration-mutation matrix demonstrates that collection membership, order, command, effective directory, and timeout each participate in proof identity.
- [ ] Cross-directory input and environment cases preserve existing freshness policy and reject indeterminate or unbudgetable reuse.

## Story 9: Reuse one complete proof consistently across callers

**Requirement:** FR-11, FR-13

As an operator, I want every verification consumer to agree on complete current proof so an unchanged collection does not run repeatedly or pass inconsistently.

### Acceptance Criteria

#### Happy Path
- Given a complete current collection pass, when another verifier instance, the verification CLI, or an existing gate inspection consumes it without relevant input changes, then it reports current or reused proof without launching the collection again.
- Given only irrelevant documentation or commit-identity changes, or input drift explicitly tolerated by the existing policy, when collection proof is inspected, then reuse and existing drift-preservation recording retain their established semantics.

#### Negative Paths
- Given stale, incomplete, incompatible, or failed collection proof, when either an execution-owning caller or an inspection-only caller evaluates it, then neither reports a satisfied gate; inspection-only callers do not launch commands to manufacture proof.
- Given another live verifier owns the existing execution lock, when a second execution-owning caller requests the same collection, then it cannot run the collection concurrently or publish a competing partial pass; it observes the existing lock outcome.
- Given freshness or drift measurement is indeterminate, when any caller evaluates reuse, then it does not treat evidence existence or an earlier partial success as sufficient.

### Done When
- [ ] Production verifier and CLI/gate-boundary observations agree on current, stale, failed, and incompatible collection proof without duplicate execution.
- [ ] Lock-contention and inspection-only cases retain one execution owner and never advance from indeterminate proof.

## Negative-Path Coverage Assessment

Invalid input is covered by Stories 1, 2, 5, 7, and 8. Filesystem permission and dependency unavailability are covered by preflight, process-launch, and evidence I/O failures in Stories 2, 3, 5, and 8; no new authentication or network-service boundary exists. Timeouts and termination are covered by Stories 3 and 6. Concurrent access is covered by Story 9's existing lock. Resource exhaustion is covered by bounded diagnostics and failed evidence writes in Stories 5 and 6. Partial execution is covered by Stories 3 and 5; the feature does not roll back arbitrary project-command side effects. Data integrity and exception classification are covered by Stories 3, 5, and 7. Reuse identity is covered by Stories 7 through 9. Alternate failure/reporting paths are covered by Stories 5 and 6. Cascade deletion and model immutability do not apply because this feature introduces neither entity deletion nor an editable business-data model.

## Verification Basis

The functional PRD and architecture contract were approved by James Stoup on 2026-09-11. Each scenario derives from those contracts. Existing scalar/scoped, locking, cleanup, and evidence cases were inspected in the verifier, executor, evidence, and CLI test sources to identify preserved behavior; existing tests do not by themselves prove collection behavior. No unconfirmed product assumption is embedded in these criteria. Verify-claims verdict: CLEAR for operator review.
