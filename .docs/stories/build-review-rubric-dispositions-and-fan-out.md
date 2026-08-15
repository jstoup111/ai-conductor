# Stories: Build-review rubric dispositions and independent evaluation

**Status:** Accepted

**Source:** jstoup111/ai-conductor#1542 · approved PRD and architecture decisions dated 2026-08-13

## Story 1: Attribute every rubric judgement separately

**Requirement:** FR-1

As a feature operator, I want each build-review concern reported as its own rubric result so that I
can see which kind of review passed or failed without losing the authoritative outer gate.

### Acceptance Criteria

#### Happy Path

- Given `build_review` is enabled with all default rubrics, when one review lap completes, then the
  result contains separately attributable Tautology, Scope, Root Cause, and Completeness
  outcomes plus one authoritative outer verdict.

#### Negative Paths

- Given an enabled rubric produces no valid attributable result, when the lap is joined, then the
  missing rubric is represented as an infrastructure failure and is not silently omitted or folded
  into another rubric.

### Done When

- [ ] A four-rubric fixture produces four named outcomes and one outer verdict.
- [ ] A missing-rubric fixture remains blocking and identifies the absent rubric.

## Story 2: Bound concurrent rubric evaluation

**Requirement:** FR-2

As a maintainer, I want rubric evaluations to use a configurable concurrency ceiling so that review
latency can improve without exceeding the project's parallel-session budget.

### Acceptance Criteria

#### Happy Path

- Given four eligible rubrics and no explicit concurrency setting, when a lap runs, then up to four
  rubric evaluations may be active concurrently; given a lower positive ceiling, active evaluations
  never exceed that ceiling and the joined result is unchanged.

#### Negative Paths

- Given more eligible evaluations than the configured ceiling, when earlier evaluations are still
  active, then later evaluations wait for capacity and are neither dropped nor double-dispatched.
- Given a configured concurrency value outside the supported positive range, when configuration is
  validated, then execution is refused with an actionable configuration error rather than running
  unbounded or treating the value as zero successful work.

### Done When

- [ ] A controlled scheduler fixture observes peak concurrency four by default and the configured
  lower peak when overridden.
- [ ] Invalid ceilings fail validation before provider dispatch.

## Story 3: Disable one rubric without calling it a pass

**Requirement:** FR-3

As a maintainer, I want to disable an individual rubric while retaining explicit coverage evidence
so that an intentional omission is never mistaken for successful judgement.

### Acceptance Criteria

#### Happy Path

- Given one rubric is disabled and the other four are enabled, when a review lap completes, then the
  disabled rubric is reported as skipped and the four enabled rubrics are judged normally.

#### Negative Paths

- Given a rubric is disabled, when the lap runs, then no provider session is dispatched for it and
  its skipped outcome cannot increment either the pass or failure count.

> **Amended 2026-08-13 by #1542 conflict resolution, re-amended 2026-08-14 by PR #1577:** skip
> reasons are closed and explicit. `disabled` — the only skip reason — applies to any rubric
> selected off by the operator. It never dispatches, passes, fails, or enters judged-rate
> denominators.

### Done When

- [ ] Every rubric defaults to enabled and can be disabled independently.
- [ ] A disabled-rubric fixture proves zero provider calls and an explicit skipped outcome.

## Story 4: Refuse an enabled gate with no review coverage

**Requirement:** FR-4

As a feature operator, I want configuration to reject an enabled but empty build review so that no
feature can appear reviewed when every rubric was disabled.

### Acceptance Criteria

#### Happy Path

- Given the outer gate and at least one rubric are enabled, when configuration is resolved, then the
  review is accepted with the enabled subset and explicit skips for the remainder.

#### Negative Paths

- Given the outer gate is enabled and all four rubrics are disabled, when configuration is resolved,
  then startup is refused with an explanation that names the empty rubric set and the separate
  whole-gate disable choice.
- Given the entire gate is disabled and all rubrics retain their defaults, when configuration is
  resolved, then the configuration is accepted without requiring a rubric to be disabled.

### Done When

- [ ] The all-disabled/enabled-gate fixture fails configuration validation before dispatch.
- [ ] Whole-gate disablement remains a distinct valid configuration.

## Story 5: Select execution policy per rubric

**Requirement:** FR-5

As a maintainer, I want each rubric to select its own provider, model, reasoning effort, fallback
order, retry budget, and escalation behavior so that judgement cost and strength match the concern.

### Acceptance Criteria

#### Happy Path

- Given two enabled rubrics with different complete or partial execution policies, when they run in
  one lap, then each attempt and fallback uses only its resolved rubric policy and is attributed to
  the actual rubric and provider.

#### Negative Paths

- Given one rubric has an invalid policy value, when configuration is validated, then the invalid
  rubric is named and no rubric is dispatched.
- Given one rubric exhausts its availability or retry ladder, when another rubric still has budget,
  then the exhausted rubric becomes an infrastructure failure without consuming or rewriting the
  sibling's policy.

### Done When

- [ ] Configuration fixtures exercise every independent policy field and inheritance from the outer
  gate.
- [ ] Mixed-policy execution evidence identifies the selected rubric, provider, model, effort, and
  recovery attempt.

## Story 6: Judge one immutable lap snapshot

**Requirement:** FR-6

As a feature operator, I want all rubrics in a lap to judge the same change and approved plan so
that concurrent results cannot disagree merely because their inputs were captured at different times.

### Acceptance Criteria

#### Happy Path

- Given a review lap starts, when enabled rubrics receive their inputs, then every input carries the
  same feature identity, lap identity, snapshot digest, diff, plan context, and accepted engine
  context even if the working tree changes afterward.

#### Negative Paths

- Given a branch result repeats a different lap identity or snapshot digest, when results are joined,
  then that branch is rejected as an infrastructure failure and cannot contribute a pass or finding.
- Given a rubric attempts to rely on maker narrative, prior grader prose, or accepted dispositions,
  when its input is assembled, then those sources are absent from the snapshot.

### Done When

- [ ] All branch invocation fixtures receive byte-equivalent immutable review context.
- [ ] Identity/digest mismatch fixtures block the outer gate.

## Story 7: Derive one effective outer verdict

**Requirement:** FR-7

As a feature operator, I want the outer gate to pass only after every enabled rubric has no unresolved
finding so that skips and accepted risks have precise, non-overlapping meanings.

### Acceptance Criteria

#### Happy Path

- Given every enabled rubric has either no raw finding or only an exactly matching accepted finding,
  when dispositions are applied, then the authoritative effective outer verdict passes while raw
  judgements remain unchanged.

#### Negative Paths

- Given any enabled rubric has an unresolved finding or infrastructure failure, when the outer
  verdict is derived, then it fails even if every other rubric passes.
- Given some rubrics are skipped and no enabled rubric has produced a valid judgement, when a result
  is considered, then skips alone cannot produce a passing verdict.

### Done When

- [ ] A truth-table test covers judged, skipped, accepted, unresolved, and infrastructure outcomes.
- [ ] Raw and effective verdict fields remain independently inspectable.

## Story 8: Keep infrastructure failure distinct from a finding

**Requirement:** FR-8

As an operator, I want failed grader execution distinguished from content criticism so that I do not
mistake provider trouble for an accept-or-fix decision.

### Acceptance Criteria

#### Happy Path

- Given a valid rubric response containing findings, when the branch completes, then it is reported
  as judged with content findings and not as an infrastructure failure.

#### Negative Paths

- Given a provider error, exhausted retry/fallback policy, missing artifact, malformed artifact, or
  stale artifact, when the branch settles, then it is an attributable infrastructure failure that
  blocks the gate and exposes no accept-able finding.
- Given the operator inspects an infrastructure failure, when available findings are listed, then no
  disposition identifier is fabricated for that failure.

### Done When

- [ ] Each enumerated execution/artifact failure maps to the infrastructure-failure variant.
- [ ] The disposition command cannot target an infrastructure-failure result.

## Story 9: Report complete, stable, anchored findings

**Requirement:** FR-9

As a feature operator, I want every independent finding to have a stable identity and useful evidence
so that I can evaluate and disposition exactly one concern.

### Acceptance Criteria

#### Happy Path

- Given a rubric observes several independent concerns, when its valid result is joined, then every
  concern is retained with a stable identifier, rubric, actionable summary, and rubric-specific
  evidence anchors.

#### Negative Paths

- Given a finding lacks required typed anchors, uses an unsupported contract version, or contains an
  anchor that fails available referential validation, when it is validated, then the branch fails
  closed rather than publishing a weakly identified finding.
- Given two findings in one lap canonicalize to the same identity, when the branch is joined, then the
  result is a blocking malformed-result failure and neither finding can inherit a disposition.

### Done When

- [ ] Each rubric contract has valid multi-finding and invalid-anchor fixtures.
- [ ] Duplicate identity and full-payload/hash mismatch fixtures fail closed.

## Story 10: Inspect current findings before disposition

**Requirement:** FR-10

As a feature operator, I want a local read-only command to inspect the current lap so that I can make
an informed disposition against an exact finding.

### Acceptance Criteria

#### Happy Path

- Given a named feature has a current build-review lap, when the operator requests its findings, then
  the command prints the exact lap plus raw findings, accepted matches, unresolved findings, skipped
  rubrics, and infrastructure failures without changing state.

#### Negative Paths

- Given the feature has no current supported review lap or has unreadable legacy evidence, when the
  operator requests findings, then the command reports that no disposition-ready lap is available,
  exits unsuccessfully, and changes neither review nor disposition state.

### Done When

- [ ] Structured command fixtures cover every displayed outcome category and exact lap identity.
- [ ] Before/after state bytes prove the inspection command is read-only on failure and success.

## Story 11: Accept one current finding during an active loop

**Requirement:** FR-11

As a feature operator, I want to accept one current finding with a rationale while review is cycling
so that the next recomputation can proceed without parking the feature or waiting for the cap.

### Acceptance Criteria

#### Happy Path

- Given a current unresolved finding, exact inspected lap, interactive verified operator, and
  non-empty rationale, when the local accept command runs, then exactly that finding is durably
  accepted and the next deterministic gate recomputation excludes only its blocking effect.

#### Negative Paths

- Given several unresolved findings in the lap, when one is accepted, then every untargeted finding
  remains unresolved and blocking.
- Given the feature is actively cycling, when acceptance succeeds, then the command neither parks the
  feature nor waits for the cumulative kickback bound, and it does not independently clear a HALT.

### Done When

- [ ] A multi-finding scenario proves one-record mutation and unchanged sibling findings.
- [ ] An active-loop integration fixture observes the accepted record on the next recomputation.

## Story 12: Match an accepted concern across wording changes

**Requirement:** FR-12

As a feature operator, I want an accepted concern to remain accepted across later review wording so
that stylistic grader variation cannot restart the same dispute.

### Acceptance Criteria

#### Happy Path

- Given an accepted finding and a later lap reports the same rubric contract, concern kind, and
  logical anchors with different prose or line numbers, when dispositions are applied, then the
  later finding matches the acceptance and is non-blocking.

#### Negative Paths

- Given the rubric identity contract version changes, when a later finding otherwise resembles an
  accepted one, then the old disposition does not match silently and the finding remains blocking.

### Done When

- [ ] Wording and line-number drift preserve a finding identity in cross-lap fixtures.
- [ ] Contract-version drift invalidates the old match without deleting its audit record.

## Story 13: Keep new or materially different concerns blocking

**Requirement:** FR-13

As a feature operator, I want narrow disposition matching so that accepting one risk never suppresses
a new defect under the same rubric.

### Acceptance Criteria

#### Happy Path

- Given one finding is accepted and another finding has a different concern kind or logical anchor,
  when the same or a later lap is evaluated, then only the exact accepted identity is non-blocking.

#### Negative Paths

- Given a proposed match shares only a rubric, file, summary fragment, or hash without the same full
  canonical identity payload, when dispositions are applied, then it remains unresolved and blocks.

### Done When

- [ ] Same-rubric fixtures cover different paths, obligations, concern kinds, and canonical payloads.
- [ ] No rubric-wide, path-wide, feature-wide, or future-finding wildcard is accepted.

## Story 14: Refuse invalid disposition requests atomically

**Requirement:** FR-14

As a feature operator, I want invalid acceptance attempts to be refused without side effects so that
mistakes and stale commands cannot weaken the gate.

### Acceptance Criteria

#### Happy Path

- Given a request names the current feature, exact current lap, one unresolved finding, and a
  non-empty rationale, when it is authorized, then one disposition record is written atomically.

#### Negative Paths

- Given the rationale is empty, when acceptance is attempted, then it is refused and the disposition
  store remains byte-for-byte unchanged.
- Given the finding is unknown, already accepted, skipped, or infrastructure-shaped, when acceptance
  is attempted, then it is refused and the store remains unchanged.
- Given the lap is stale or the feature identity mismatches, when acceptance is attempted, then it is
  refused and no current or foreign record is modified.
- Given the state store is unreadable or the state lock cannot be acquired within its bound, when
  acceptance is attempted, then it fails closed without replacing either the aggregate or store.

### Done When

- [ ] A refusal matrix covers every named reason and verifies unchanged state bytes.
- [ ] Successful writes use a same-directory atomic replacement under the shared state lock.

## Story 15: Reserve acceptance for a verified human operator

**Requirement:** FR-15

As a reviewer, I want every disposition attributable to a verified local human so that autonomous
maker or grader activity cannot assert acceptance.

### Acceptance Criteria

#### Happy Path

- Given an interactive local terminal and a resolvable machine-scoped operator identity, when a valid
  acceptance succeeds, then the durable record and emitted event carry that verified identity.

#### Negative Paths

- Given piped input, a non-interactive provider session, or unresolved operator identity, when
  acceptance is attempted, then it is refused before mutation.
- Given maker, remediation, grader, or daemon-spawned agent activity can execute ordinary provider
  commands, when it lacks the interactive operator boundary, then it cannot create or assert a
  disposition.

### Done When

- [ ] TTY and identity fixtures cover allowed, piped, unresolved, and provider-session callers.
- [ ] No CLI argument can override the resolved operator identity.

## Story 16: Persist dispositions within one feature only

**Requirement:** FR-16

As a feature operator, I want accepted risk to survive later laps and re-dispatch while remaining
feature-local so that restarts neither forget the decision nor leak it elsewhere.

### Acceptance Criteria

#### Happy Path

- Given a finding is accepted for a canonical feature, when that feature starts a later lap or is
  daemon-dispatched again, then its valid matching disposition remains available.

#### Negative Paths

- Given another feature reports an otherwise identical finding payload, when its verdict is derived,
  then the first feature's disposition does not match or alter the second feature's state.
- Given a stale aggregate verdict is replaced during recovery, when the feature reviews again, then
  the separate valid disposition store survives and remains scoped to its canonical feature.

### Done When

- [ ] Re-dispatch and later-lap fixtures preserve accepted records.
- [ ] Cross-feature and aggregate-replacement fixtures prove isolation.

## Story 17: Refuse a disposition raced by a new lap

**Requirement:** FR-17

As a feature operator, I want acceptance bound to the lap I inspected so that concurrent review
cannot attach my decision to replacement evidence.

### Acceptance Criteria

#### Happy Path

- Given the inspected lap remains current while the shared state transaction is held, when the
  operator accepts a finding, then the record binds to that exact lap and identity.

#### Negative Paths

- Given a replacement lap becomes current before the acceptance transaction validates, when the
  command compares the requested lap under lock, then it refuses the stale action without mutation.
- Given the coordinator and CLI contend for the state lock, when either reaches the bounded timeout,
  then the timed-out operation fails closed and neither publishes a partially joined state.

### Done When

- [ ] A deterministic race fixture proves stale-lap refusal.
- [ ] Lock-contention and interrupted-write fixtures prove no partial or misbound record.

## Story 18: Emit review and disposition occurrences on the event spine

**Requirement:** FR-18

As an operator, I want rubric and disposition activity on the existing event stream so that normal
observability explains review progress and the effective result.

### Acceptance Criteria

#### Happy Path

- Given a review lap and operator actions occur, when events are consumed through the standard
  feature reader, then rubric starts, passes, failures, skips, disposition acceptances/refusals, and
  the effective outer verdict are visible as the existing event union.

#### Negative Paths

- Given the standalone CLI writes while no conductor process is active, when standard readers later
  inspect the feature, then the occurrence is present through the existing external-process ledger
  and is not reconstructed from disposition timestamps.
- Given external and engine writers operate concurrently, when records are read, then serialized
  writes and timestamp merging preserve complete records without duplicating re-emitted events into
  the engine ledger.

### Done When

- [ ] Event-union exhaustiveness and sink fixtures cover every new occurrence.
- [ ] Concurrent writer and merged-reader fixtures prove one schema, complete lines, and no duplicate
  persistence.

## Story 19: Publish every accepted risk

**Requirement:** FR-19

As a reviewer or shipped-record reader, I want accepted risks presented in authoritative publication
artifacts so that shipping evidence includes the operator's explicit decisions.

### Acceptance Criteria

#### Happy Path

- Given one or more valid accepted dispositions, when finish updates the retained implementation PR
  and writes the final shipped record, then both contain every finding identifier, rubric, rationale,
  operator, and acceptance time from one deterministic rendering contract.

#### Negative Paths

- Given a known accepted record is malformed, unreadable, or cannot be rendered into either required
  destination, when publication is attempted, then finish blocks rather than silently omitting or
  fabricating accepted risk.
- Given publication is retried, when the accepted-risk section already exists, then it is updated
  idempotently rather than duplicated.

### Done When

- [ ] PR and shipped-record golden fixtures contain identical accepted-risk fields.
- [ ] Omission, malformed-state, and repeat-upsert fixtures fail closed or remain idempotent as
  specified.

## Story 20: Report laps-to-pass and per-rubric failure rates

**Requirement:** FR-20

As a maintainer, I want standard reports to calculate review convergence and rubric failure rates so
that I can distinguish recurring maker problems from grading-policy friction.

### Acceptance Criteria

#### Happy Path

- Given normal feature event records across several review laps, when standard reporting runs, then
  it reports build-review laps-to-pass and a separately attributable failure rate for every rubric
  without direct worktree-ledger inspection.

#### Negative Paths

- Given a feature never reaches an effective pass or contains an infrastructure failure, when metrics
  are computed, then reporting represents that state explicitly and does not invent a successful lap
  or classify infrastructure as a content failure.

### Done When

- [ ] Multi-lap report fixtures produce a deterministic laps-to-pass value and rubric rates.
- [ ] No-pass and infrastructure fixtures remain distinguishable in standard output.

## Story 21: Exclude skips from failure-rate denominators

**Requirement:** FR-21

As a maintainer, I want rubric rates based only on actual judgements while retaining skip coverage so
that intentional omissions cannot improve or worsen the reported failure rate.

### Acceptance Criteria

#### Happy Path

- Given a rubric has passes, failures, and skips across laps, when its failure rate is calculated,
  then only enabled judged passes and content failures form the denominator and skips are reported as
  separate coverage.

#### Negative Paths

- Given a rubric is always skipped, when reporting runs, then it has zero judged denominator and
  explicit skipped coverage rather than a zero-percent or one-hundred-percent failure rate.
- Given infrastructure failures occur, when the content failure rate is calculated, then they remain
  separately counted and do not silently enter the judged denominator.

### Done When

- [ ] Rate fixtures cover mixed, all-skipped, and infrastructure-only histories.
- [ ] Numerators, denominators, skip counts, and infrastructure counts are independently inspectable.

## Story 22: Preserve defaults for projects without rubric settings

**Requirement:** FR-22

As an existing project operator, I want the enabled outer gate to retain full four-rubric coverage
without new configuration so that adopting the extension does not silently narrow review.

### Acceptance Criteria

#### Happy Path

- Given `build_review` is enabled and has no rubric-specific settings, when configuration resolves,
  then all four surviving rubrics are enabled, inherit the outer execution policy, and use a maximum of four
  concurrent sessions.

#### Negative Paths

- Given a project specifies only one rubric override or only `maxParallel`, when configuration
  resolves, then every unspecified rubric and sibling setting retains its documented default rather
  than becoming disabled, empty, or overwritten.

### Done When

- [ ] Absent and partially specified rubric configuration fixtures resolve all four closed entries.
- [ ] The resolved default maximum is exactly four.

## Story 23: Disable the whole gate without a false review success

**Requirement:** FR-23

As a feature operator, I want whole-gate disablement to dispatch no review work and remain visibly
distinct from passing so that opting out does not manufacture evidence.

### Acceptance Criteria

#### Happy Path

- Given the entire `build_review` gate is disabled, when the lifecycle reaches its position, then no
  rubric session runs and the gate follows the existing disabled-step behavior.

#### Negative Paths

- Given stale branch or aggregate artifacts exist from an earlier enabled run, when the gate is
  disabled, then those artifacts are ignored and no empty or stale result is presented as a current
  successful review.

### Done When

- [ ] A disabled-gate integration fixture observes zero rubric provider calls.
- [ ] Stale-evidence fixtures prove the disabled path emits no current passing review verdict.

## Story 24: Reuse green proof and measure Tautology's RED counterfactual

**Requirement:** FR-24

As a feature operator, I want review to reuse the successful `test_suite` evidence and run only the
missing mutation-sensitivity experiment so that Tautology is grounded without paying for the same
green test run twice.

### Acceptance Criteria

#### Happy Path

- Given the immediately preceding `test_suite` result is code-valid and passing, and changed tests
  fail when changed production code is replaced by its merge-base form in an isolated checkout,
  when `build_review` starts, then it reuses the green proof, records the RED preflight evidence for
  Tautology, and does not run the scoped tests against HEAD again.
- Given the merge base, changed-test selectors/content, reverted-production patch, scoped command,
  and current green proof are unchanged, when review is re-dispatched, then it reuses completed
  preflight evidence without creating another checkout or running another test command.

#### Negative Paths

- Given the changed tests remain green against merge-base production code and no approved exception
  applies, when Tautology judges the typed preflight evidence, then the concern remains blocking.
- Given the isolated checkout cannot be created, the scoped command cannot execute, or cleanup
  cannot be verified, when preflight completes, then Tautology records an infrastructure failure
  rather than inventing RED evidence or mutating either live checkout.
- Given the preceding `test_suite` evidence is missing, failed, or not valid for current HEAD, when
  review reaches preflight, then review refuses to dispatch rubrics instead of using stale green
  proof.
- Given any preflight key input changes or the prior outcome was infrastructure failure, when the
  preflight is requested, then the old evidence is not reused.

### Done When

- [ ] Tests prove one upstream green execution and one isolated reverted-production RED execution,
  with no second HEAD-green execution.
- [ ] Tests prove live feature and root checkout bytes remain unchanged across success and every
  failure/cleanup path.
- [ ] Preflight-cache tests prove exact-input hits make zero checkout/runner calls and every key
  change or infrastructure outcome misses closed.

## Story 25: Short-circuit unchanged rubric judgements

**Requirement:** FR-25

As a feature operator, I want each rubric to reuse an unchanged prior judgement so that daemon
re-dispatches and disposition-only laps do not repeatedly spend tokens.

### Acceptance Criteria

#### Happy Path

- Given a rubric has a valid prior judged result and its contract version, versioned allowed-input
  projection, and resolved execution-policy fingerprint are unchanged, when a new lap evaluates
  that rubric, then the engine makes no provider call, emits a cache-hit event, and materializes a
  current-lap rubric result before the normal join.
- Given an operator accepts one finding without changing code or rubric policy, when the gate is
  rejoined, then unchanged raw rubric results are reused and the disposition changes only the
  effective verdict.

#### Negative Paths

- Given any permitted rubric input, contract or projection version, or resolved execution policy
  changes, when that rubric evaluates, then its cache entry is a miss and a fresh provider session
  runs.
- Given the prior outcome is an infrastructure failure, malformed, unsupported, or identity-invalid,
  when the rubric evaluates, then the entry is ignored fail-closed and is never promoted to a
  current judgement.
- Given a cache hit exists, when completion is checked, then the engine still requires freshly
  materialized current-lap branch and aggregate artifacts; an old aggregate verdict cannot satisfy
  freshness.
- Given a rubric is disabled, when the branch is classified, then the deterministic skip
  short-circuits before cache lookup and consumes no model session.

### Done When

- [ ] Provider-spy tests prove cache hits and skips make zero rubric provider calls.
- [ ] Projection, policy, contract-version, corrupt-entry, infrastructure-failure, and stale-verdict
  fixtures prove conservative invalidation and current-lap rematerialization.
