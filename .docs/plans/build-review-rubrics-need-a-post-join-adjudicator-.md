# Implementation Plan: one post-join remediation judgement for build_review

**Date:** 2026-08-29
**Design:** [mixed-lap successor ADR](../decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md)
**Stories:** .docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md
**Conflict check:** Clean as of 2026-08-29 — `.docs/conflicts/2026-08-29-build-review-rubrics-need-a-post-join-adjudicator-.md`

## Summary

Twenty tasks add one schema-constrained `remediate` judgement after the raw build-review join,
persist feature-local case/effect history, apply BUILD and intake effects idempotently, and derive one
effective route without changing raw rubric evidence, plan ownership, or operator authority.

## Technical Approach

**Shared contract, domain-owned adapter.** Add shared `remediation-case-*` modules for the case-mode
artifact, versioned state store, reconciliation, and effect lifecycle. Every stored case carries
`domain: "build_review"`; the shared mechanics do not encode SHIP budgets or plan append rules.
`build-review-adjudication.ts` is the only build-review adapter. It projects current raw findings,
invokes the existing `remediate` step once, validates every source atomically, performs admitted
effects, and returns a closed transition for `conductor.ts` to apply.

**Two evidence layers.** `.pipeline/build-review.json` remains raw, source-preserving evidence.
`.pipeline/remediation-cases.json` is versioned control state containing engine-stamped cases,
append-only source links, disposition/resolution state, and reserved/applied/failed effects. Existing
operator records in `.pipeline/build-review-dispositions.json` remain separate and are resolved before
autonomous input and again at every route/HALT/PASS exit. `.pipeline/remediation.json` gains an
additive `mode: "case-v1"` artifact; absence of `mode` continues through the legacy parser unchanged.

**Closed provider boundary.** Case-mode output has exact top-level keys, one source row per current
finding, provider-local case references, closed outcomes (`acted | deferred | rejected | merged`),
closed dispositions (`act | defer | reject`), bounded priority/confidence/rationale, and exactly one
effect payload admitted by the disposition. The provider may bind an existing case id but cannot mint
durable case/effect ids. Unknown, mixed, stale, over-limit, incomplete, dangling, or contradictory
output is rejected before state mutation.

**All history or stop.** `build-review-adjudication-context.ts` canonicalizes every current
operator-unresolved finding and every feature-local prior case into one frozen JSON projection.
Per-field limits and one total serialized-byte ceiling are constants in that module. It returns the
complete projection or a typed overflow/invalid-state stop before `StepRunner.run('remediate', ...)`;
there is no truncation policy.

**Reserved effects and transition precedence.** Under the case-store lease, reconciliation stamps
case/effect ids and reserves effects before I/O. An `act` effect atomically publishes
`.pipeline/build-review-work-order.json`, charges the existing gate once by stable effect id, and
routes BUILD. A `defer` effect searches open and closed tracker issues for an exact hidden marker,
reuses a match, or files through `fileIntakeIssue`; missing issue reference blocks completion.
Reject/merge has no external write. A mixed lap gives a newly actionable content route precedence;
otherwise uncovered infrastructure follows its existing retry/exhaustion path. PASS also requires
healthy or exactly operator-covered infrastructure.

**Crash and repetition behavior.** The kickback ledger gains an optional-on-read, normalized
`chargedEffectIds` set for `build_review`; rebase lap credit never clears it. BUILD reads the durable
work order on every dispatch and records attempt evidence before provider work. A reserved or charged
effect resumes under the same id. A case already attempted and reported again, or a resolved case that
reappears, produces `needs-human` with both traces and no second charge/free route.

**Current catalog boundary.** The current registered catalog contains only `testQuality`; #2020 owns
adding members. Mixed-lap policy is implemented over a registry-neutral join projection rather than
minting an unregistered rubric in production. The adapter projects today's aggregate into that type,
and focused reducer tests use two generic members to prove future mixed behavior without changing
`BuildReviewRubricId` or enabling another rubric.

**Local patterns.** The case store follows `BuildReviewDispositionStore`: strict per-record parsers,
feature identity validation before mutation, one lease around read/modify/write, and atomic replace.
Allowed variation is a new versioned case schema and typed failure reasons; do not share its operator
authority. Find the comparable mechanics by searching `build-review-dispositions.ts` for
`withLease`, `readState`, and atomic rename. Ledger changes follow `kickback-ledger.ts`: persisted
fields are optional, normalized for legacy readers, pure mutation precedes thin I/O, and unknown
shapes retain the file's existing compatibility behavior. Tracker work extends `TrackerClient` and
`createGithubTrackerClient`; no caller shells out to `gh` directly.

**Test boundary.** Use pure unit tests for schemas/reducers, `mkdtemp` integration tests only where
atomic files and restart state are the subject, and a bounded `Conductor.run()` fixture only for the
actual BUILD navigation seam. Every LLM and GitHub boundary is an injected fake. Dispatch-observation
fixtures terminate at the named route and await cleanup; no test relies on a timeout to stop the
conductor.

## Prerequisites

- No external service or catalog expansion is required.
- The accepted stories, clean conflict report, successor ADR, and rendered architecture diagrams in
  this specification branch are authoritative.
- Companion spec PR #2066 carries the three required corrections to older feature-scoped artifacts;
  it must land on `main` before this plan is handed to BUILD because composer rejects those foreign
  stems on the #2033 spec branch.

## Tasks

### Task 1: Parse one strict additive remediation case artifact
**Story:** Story 3 (happy/negative paths)
**Story:** Story 11 (legacy and unknown-mode paths)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing unit tests for a valid `case-v1` result and for missing/duplicate exact keys,
   unknown mode/domain/outcome/disposition/confidence, mixed legacy fields, provider-supplied durable
   ids, taskless action, and unjustified deferral.
2. Verify the focused test fails (RED).
3. Implement bounded case-mode types and `readRemediationCaseJudgement`, reusing
   `fileIsFreshSinceSession`; keep `readRemediationPlan`'s no-mode legacy behavior unchanged.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(remediation): parse strict case-mode judgements".

**Done when:**
1. `remediation-case-artifact.test.ts` accepts the complete `case-v1` fixture and returns every source/case field without provider-authored durable ids.
2. The named malformed fixtures return their specific closed rejection and expose no partial rows.
3. Existing legacy remediation parser tests retain byte-equivalent parsed plans.

**Files:**
- `src/conductor/src/engine/remediation-case-artifact.ts` — additive schema, bounds, and fresh reader
- `src/conductor/src/engine/artifacts.ts` — export/reuse freshness without changing legacy parsing
- `src/conductor/test/engine/remediation-case-artifact.test.ts` — strict and compatibility fixtures
- `src/conductor/test/engine/artifacts.test.ts` — legacy parser regression

**Dependencies:** none

### Task 2: Persist versioned remediation cases under one lease
**Story:** Story 4 (all paths)
**Story:** Story 10 (atomic-state path)
**Type:** infrastructure, negative-path

**Steps:**
1. Write failing filesystem tests for missing state, valid round-trip, foreign feature/domain,
   unsupported version, malformed record/effect combinations, lock contention, and rename failure.
2. Verify the focused test fails (RED).
3. Implement `RemediationCaseStore` at `.pipeline/remediation-cases.json` using strict parsers,
   feature identity, a bounded lease, and temp-file atomic replace. Follow the disposition-store
   traits named in Technical Approach; vary only the case schema and failure vocabulary.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(remediation): add leased atomic case state".

**Done when:**
1. A second process reads the exact versioned case/source/effect state written by the first.
2. Foreign, unsupported, malformed, lock-timeout, and failed-replace fixtures return typed failures and leave the last complete JSON readable.
3. No write path touches `.pipeline/build-review-dispositions.json`.

**Files:**
- `src/conductor/src/engine/remediation-case-store.ts` — schema validation, lease, atomic I/O
- `src/conductor/test/engine/remediation-case-store.test.ts` — state and fault-injection tests

**Dependencies:** none

### Task 3: Assemble all current findings and all prior cases
**Story:** Story 1 (content selection)
**Story:** Story 2 (all criteria)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing pure tests for empty history, first/middle/oldest retained history, operator-resolved
   finding exclusion, mixed infrastructure exclusion, over-limit field, total-byte overflow, and
   unrepresentable prior state.
2. Verify the focused test fails (RED).
3. Implement a registry-neutral current-member projection plus
   `assembleBuildReviewAdjudicationContext`, with closed per-field bounds and one serialized-byte
   ceiling that returns all input or a typed stop before dispatch.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(build-review): assemble bounded complete adjudication context".

**Done when:**
1. Context tests retain every current unresolved content source and every feature-local case in one deterministic projection while excluding infrastructure and exact operator-resolved sources.
2. Empty history serializes as an empty collection without a synthetic case.
3. Each named overflow/invalid-state fixture returns no dispatchable context and identifies the offending bound/state.

**Files:**
- `src/conductor/src/engine/build-review-adjudication-context.ts` — current/history projection and bounds
- `src/conductor/src/engine/build-review-aggregate.ts` — expose raw source projection without changing aggregate shape
- `src/conductor/test/engine/build-review-adjudication-context.test.ts` — completeness and overflow tests

**Dependencies:** Task 2

### Task 4: Validate source completeness atomically
**Story:** Story 3 (all criteria)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing table tests for exact acted/deferred/rejected/merged coverage, several sources merged
   to one case, omission, duplication, dangling/unknown reference, contradictory case route,
   taskless work, deferral without exclusion rationale, and durable-id injection.
2. Verify the focused test fails (RED).
3. Implement a pure validator from current source ids plus parsed provider rows to a complete proposed
   case graph; return no graph when any row fails.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(remediation): validate complete source-to-case graphs".

**Done when:**
1. The valid merge fixture reconstructs every raw finding through exactly one source row and one canonical case.
2. Every named invalid fixture returns one closed validation result and zero admissible mutations.
3. Provider output containing a durable case/effect id is rejected before reconciliation.

**Files:**
- `src/conductor/src/engine/remediation-case-validator.ts` — atomic graph validation
- `src/conductor/test/engine/remediation-case-validator.test.ts` — complete invalid/valid table

**Dependencies:** Task 1

### Task 5: Reconcile cases with append-only source history
**Story:** Story 4 (persistence/separation)
**Story:** Story 7 (distinct/reused/resolved cases)
**Story:** Story 3 (engine-stamped identities)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests for engine-stamped new ids, valid existing-case binding, append-only source
   links, absent-open-case resolution with attempt evidence, foreign/unknown case binding, illegal
   disposition transition, and no deletion of historical traces.
2. Verify the focused test fails (RED).
3. Implement reconciliation under the store lease. Use injected id generation in tests; never infer a
   binding from summaries and never mutate operator disposition state.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(remediation): reconcile durable cases and source traces".

**Done when:**
1. New cases/effects receive engine ids and later bindings append the new raw source without rewriting earlier links.
2. Unknown/foreign binding and illegal transition fixtures leave the store byte-identical.
3. A case absent after recorded BUILD attempt evidence becomes resolved; history remains present.

**Files:**
- `src/conductor/src/engine/remediation-case-reconciler.ts` — legal transitions and stamping
- `src/conductor/src/engine/remediation-case-store.ts` — leased mutation entry point
- `src/conductor/test/engine/remediation-case-reconciler.test.ts` — transition tests

**Dependencies:** Task 2, Task 4

### Task 6: Teach the existing remediate skill its case mode
**Story:** Story 1 (one judge)
**Story:** Story 2 (supplied evidence)
**Story:** Story 3 (closed output)
**Story:** Story 11 (legacy mode)
**Type:** happy-path, negative-path

**Steps:**
1. Write a failing contract test that extracts the case-mode section and requires every input/output
   field, closed vocabulary, no re-audit instruction, no durable-id minting, all-history handling, and
   unchanged legacy gap-plan instructions.
2. Verify the focused test fails (RED).
3. Add an engine-context-selected `build_review case-v1` branch to the existing skill. It must judge
   only the supplied projection and write the additive artifact; do not create a skill or dispatch.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(remediate): add build-review case judgement mode".

**Done when:**
1. The contract test proves one existing `remediate` skill owns case mode and names all closed fields.
2. The skill forbids source omission, summary matching as identity, source-tree re-audit, provider ids, operator acceptance, direct effects, and plan append for build_review.
3. Legacy remediation instructions and fixture expectations remain present and unchanged in meaning.

**Files:**
- `skills/remediate/SKILL.md` — additive engine-selected case-mode contract
- `src/conductor/test/engine/remediate-skill-contract.test.ts` — structural prompt contract

**Dependencies:** Task 1, Task 3

### Task 7: Resolve and validate the default-on adjudication switch
**Story:** Story 11 (flag and invalid-config paths)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing type/resolver/config/template tests for absent/default-on, explicit false, explicit
   true, malformed block/value, and unknown nested key.
2. Verify the focused tests fail (RED).
3. Add `build_review.adjudication.enabled` to config types, consumer-key registry, strict nested
   validation, resolved defaults, and generated project config templates.
4. Verify the focused tests pass (GREEN).
5. Commit with message: "feat(config): add build-review adjudication rollout switch".

**Done when:**
1. Absent config resolves `adjudication.enabled: true`; explicit false remains false through typed and materialized config paths.
2. Wrong types and unknown nested keys are rejected with the exact `build_review.adjudication.*` path.
3. Both shipped config templates carry the valid default shape and consumer-registry tests report no unconsumed key.

**Files:**
- `src/conductor/src/types/config.ts` — authored config shape
- `src/conductor/src/engine/config.ts` — strict validation/materialization and consumer keys
- `src/conductor/src/engine/resolved-config.ts` — concrete default-on value
- `templates/ai-conductor-config.yml.template` — generated consumer config
- `templates/project-config.yml.template` — project template config
- `src/conductor/test/engine/config.test.ts` — validation cases
- `src/conductor/test/engine/resolved-config.test.ts` — resolution cases
- `src/conductor/test/engine/config-consumer-registry.test.ts` — consumer wiring
- `src/conductor/test/engine/config-template.test.ts` — template projection

**Dependencies:** none

### Task 8: Derive one effective transition for pure and mixed laps
**Story:** Story 1 (mechanical composition)
**Story:** Story 9 (all paths)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing pure table tests for content-complete PASS, new action BUILD route, incomplete/failed
   effect stop, pure below-cap mechanical retry, exhausted uncovered stop, mixed action precedence,
   mixed non-action mechanical route, and exact reduced-coverage PASS eligibility.
2. Verify the focused test fails (RED).
3. Implement a closed reducer over registry-neutral join members and finalized case/effect state. Raw
   results are inputs only; the reducer cannot mint PASS evidence or operator coverage.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(build-review): derive post-adjudication transitions".

**Done when:**
1. The transition table returns exactly `pass | build | mechanical-retry | halt` for the eight named states and never returns BUILD without a new applied action effect.
2. Mixed action consumes the content route while retaining infrastructure in the next blocker set; mixed non-action follows the mechanical state.
3. Missing, reserved, failed, contradictory, and unrenderable state never returns PASS or partial BUILD routing.

**Files:**
- `src/conductor/src/engine/build-review-adjudication.ts` — closed transition model/reducer
- `src/conductor/test/engine/build-review-adjudication.test.ts` — pure transition table

**Dependencies:** Task 5

### Task 9: Publish and consume a durable BUILD work order
**Story:** Story 6 (work-order and no-plan-growth paths)
**Story:** Story 10 (resumable work)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing filesystem tests for ordered multi-case write/read, stable effect identity, malformed
   or foreign order, atomic replace failure, BUILD context projection, and unchanged active plan/task
   growth files.
2. Verify the focused test fails (RED).
3. Implement `.pipeline/build-review-work-order.json` with strict version/domain/effect parsing and a
   reader that adds its ordered file-scoped work to BUILD retry context without plan mutation.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(build-review): persist durable remediation work orders".

**Done when:**
1. A later process reconstructs the same prioritized work from the stable effect id.
2. Malformed/foreign/partial orders return a typed stop and never become BUILD prompt text.
3. Work-order publication and read leave the active plan, task-status, and plan-growth record byte-identical.

**Files:**
- `src/conductor/src/engine/build-review-work-order.ts` — atomic artifact and BUILD projection
- `src/conductor/test/engine/build-review-work-order.test.ts` — persistence and no-append tests

**Dependencies:** Task 2

### Task 10: Charge a stable build-review effect exactly once
**Story:** Story 6 (one route/lap charge)
**Story:** Story 7 (no second charge)
**Story:** Story 10 (charge recovery)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing ledger tests for a new effect id, duplicate id after restart, two distinct ids,
   legacy entry normalization, malformed id collection, cumulative/per-tree counts, and rebase credit.
2. Verify the focused test fails (RED).
3. Add optional persisted `chargedEffectIds`, normalize legacy entries, and expose a pure idempotent
   charge result. Preserve effect ids across `creditKickbackGateLaps`; follow the current ledger's
   optional-on-read/pure-mutation traits.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(kickback): charge build-review effects idempotently".

**Done when:**
1. The first stable effect increments `count` and `cumulative` once; every replay reports already-charged with byte-equivalent counters.
2. A different effect consumes the next permitted route and existing cap outcomes are unchanged.
3. Legacy entries normalize to an empty charged set; malformed sets retain the ledger's documented compatibility classification; rebase credit preserves the set.

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts` — persisted ids and idempotent mutation
- `src/conductor/test/engine/kickback-ledger.test.ts` — pure/legacy cases
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts` — persisted accounting cases

**Dependencies:** none

### Task 11: Search tracker issues by exact effect marker
**Story:** Story 8 (open/closed match and distinct-key paths)
**Type:** infrastructure, negative-path

**Steps:**
1. Write failing tracker-client tests for open match, closed match, no match, similar-but-not-exact
   body, malformed result, and runner failure; assert the production argv uses `--state all`.
2. Verify the focused test fails (RED).
3. Extend `TrackerClient` and `createGithubTrackerClient` with exact hidden-marker lookup across open
   and closed issues. Parse through the shared runner; no intake caller invokes `gh` directly.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(tracker): find intake issues by remediation effect marker".

**Done when:**
1. Exact open and closed marker fixtures return their existing issue URL; similar prose with another marker returns no match.
2. Search uses the configured repository, state `all`, bounded JSON fields/results, and injected fake runner in ordinary tests.
3. Parse/runner failures propagate a typed error and do not call issue creation.

**Files:**
- `src/conductor/src/engine/tracker-client.ts` — marker lookup port and GitHub adapter
- `src/conductor/test/engine/tracker-client.test.ts` — argv/parser/error tests

**Dependencies:** none

### Task 12: Apply or resume one actionable work-order effect
**Story:** Story 6 (action/merged/order/failure paths)
**Story:** Story 10 (recovery state)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing injected-dependency tests for reserve→work-order→charge→applied, several actions in
   one order, already-charged resume, work-order write failure, cap exhaustion, and forbidden plan
   append.
2. Verify the focused test fails (RED).
3. Implement the `act` executor under the case lease: reserve first, publish/resume one order, charge
   by effect id, and record applied/failed evidence. It returns a transition; it never navigates or
   edits the plan itself.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(build-review): apply idempotent action effects".

**Done when:**
1. One or many new action cases produce one prioritized work order and one first-time charge.
2. Replay after reservation or charge reuses the same ids and counters; write/cap failures record the named state and admit no BUILD route.
3. Tests assert no call to plan append/growth functions and no plan-file write.

**Files:**
- `src/conductor/src/engine/remediation-case-effects.ts` — action effect state machine
- `src/conductor/src/engine/build-review-work-order.ts` — publish/resume seam
- `src/conductor/src/engine/kickback-ledger.ts` — charged-effect I/O wrapper
- `src/conductor/test/engine/remediation-case-effects.test.ts` — action transitions

**Dependencies:** Task 5, Task 9, Task 10

### Task 13: File each deferred case exactly once
**Story:** Story 8 (all criteria)
**Story:** Story 10 (deferred-effect recovery)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing effect tests for open/closed reuse, new sanitized filing with Observed/Impact/Desired
   Outcome/Hypotheses, two distinct markers with similar prose, timeout/auth/rate-limit, and crash
   after remote create before local reference.
2. Verify the focused test fails (RED).
3. Implement the `defer` executor: reserve the hidden marker, exact lookup, call `fileIntakeIssue`
   only on no match, and persist the issue reference before the effect can finalize.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(remediation): publish deferred cases exactly once".

**Done when:**
1. Open match, closed match, and post-create recovery all record one existing URL and make zero duplicate create calls.
2. A genuine no-match creates one sanitized issue through the injected intake adapter; distinct effect ids create distinct issues despite similar text.
3. The four named external failures leave reserved/failed state, no issue reference, and no admitted PASS or mixed BUILD route.

**Files:**
- `src/conductor/src/engine/remediation-case-effects.ts` — deferred effect state machine
- `src/conductor/src/engine/engineer/intake/file-issue.ts` — reusable result/reference boundary
- `src/conductor/test/engine/remediation-case-effects.test.ts` — deferral and crash cases
- `src/conductor/test/file-issue.test.ts` — sanitized adapter regression

**Dependencies:** Task 5, Task 11

### Task 14: Register case lifecycle occurrences on the event spine
**Story:** Story 11 (event path)
**Type:** infrastructure, negative-path

**Steps:**
1. Write failing compile/runtime tests for adjudication start/completion/failure, reconciliation,
   effect reserved/applied/failed, and semantic-repeat halt; require explicit sink declarations.
2. Verify the focused tests fail (RED).
3. Add closed `ConductorEvent` members with domain/lap/case/effect identity and register each in
   `EVENT_SINKS`; use the existing emitter and persister only.
4. Verify the focused tests pass (GREEN).
5. Commit with message: "feat(events): record remediation case lifecycle".

**Done when:**
1. Every named occurrence type is accepted by `ConductorEvent` and has an explicit render/persist/ audit/otel declaration.
2. Event-persister tests observe the declared persistent occurrences in `.pipeline/events.jsonl`.
3. The sink exhaustiveness test fails when a fixture omits any new type; no second event file or writer exists in the diff.

**Files:**
- `src/conductor/src/types/events.ts` — additive occurrence members
- `src/conductor/src/engine/event-sinks.ts` — exhaustive declarations
- `src/conductor/test/engine/event-sinks.test.ts` — sink contract
- `src/conductor/test/engine/event-persister.test.ts` — persisted occurrence path

**Dependencies:** none

### Task 15: Orchestrate one fresh post-join adjudication
**Story:** Story 1 (one-dispatch/all-settled paths)
**Story:** Story 2 (dispatch input)
**Story:** Story 9 (incomplete-state stop)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing coordinator tests with an injected `StepRunner`, stores, effects, and event sink for
   all-operator-resolved bypass, one valid dispatch, context overflow, dispatch throw/non-success,
   stale/missing/malformed artifact, and effect failure.
2. Verify the focused test fails (RED).
3. Implement `adjudicateBuildReviewFailure`: resolve operator state, assemble context, emit start,
   dispatch `remediate` once in a fresh step session, validate/reconcile/apply effects, derive the
   transition, and emit completion/failure. Do not navigate inside this module.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(build-review): orchestrate one remediation fan-in".

**Done when:**
1. A valid multi-source fixture makes exactly one `StepRunner.run('remediate', ...)` call containing all current sources/history and returns the reducer's closed transition.
2. Operator-resolved-only input returns PASS with zero provider/store/effect calls.
3. Overflow, dispatch, freshness, parsing, validation, reconciliation, and effect failures each return their named stop with no partial PASS/BUILD transition.

**Files:**
- `src/conductor/src/engine/build-review-adjudication.ts` — orchestration and injected dependencies
- `src/conductor/test/engine/build-review-adjudication.test.ts` — bounded coordinator fixtures

**Dependencies:** Task 3, Task 4, Task 5, Task 8, Task 12, Task 13, Task 14

### Task 16: Re-read operator authority at every adjudication exit
**Story:** Story 5 (all criteria)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing race-table tests that insert exact operator acceptance before dispatch and between
   validation and each of work-order reservation, intake reservation, BUILD route, HALT, and PASS;
   include foreign/stale/broader acceptance records and unreadable/malformed disposition state.
2. Verify the focused test fails (RED).
3. Add one injected authoritative resolver and call it at every exit boundary. Remove newly accepted
   sources/effects safely; never copy autonomous state into operator records.
4. Verify the focused test passes (GREEN).
5. Commit with message: "fix(build-review): re-read operator authority at adjudication exits".

**Done when:**
1. Each exact late-acceptance fixture suppresses obsolete work/effect/route/HALT for only its source.
2. Foreign, stale, reason-only, and broader records suppress nothing and remain outside case state; unreadable or malformed operator state returns a named fail-closed stop before autonomous PASS or BUILD.
3. The case store and operator disposition store tests show no cross-write in either direction.

**Files:**
- `src/conductor/src/engine/build-review-adjudication.ts` — exit-time authority checks
- `src/conductor/src/engine/build-review-effective.ts` — reusable exact resolver projection
- `src/conductor/test/engine/build-review-adjudication.test.ts` — race table
- `src/conductor/test/engine/build-review-disposition-race.test.ts` — authority separation regression

**Dependencies:** Task 15

### Task 17: Halt repeated attempted and regressed cases
**Story:** Story 7 (all criteria)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests for interrupted-unattempted resume, attempted equivalent case on unchanged and
   changed trees, deferred/rejected outcome reuse after current binding, resolved-case regression,
   and materially distinct new case.
2. Verify the focused test fails (RED).
3. Implement a case-status classifier using explicit case binding plus durable work-order attempt
   evidence. Return resume/reuse/new/halt; never compare summaries or tree movement for identity.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(build-review): halt semantic repeat and regression cases".

**Done when:**
1. Interrupted effects resume the same id without a second charge; already-attempted and regressed action cases return `needs-human` with both source traces and work-order evidence.
2. Unchanged and changed-tree repeats have identical no-charge/no-route outcomes.
3. A current explicit binding may reuse defer/reject, while a materially distinct judgement may stamp one new permitted case/effect.

**Files:**
- `src/conductor/src/engine/remediation-case-reconciler.ts` — repeat/regression classifier
- `src/conductor/src/engine/build-review-work-order.ts` — durable attempt evidence
- `src/conductor/src/engine/build-review-adjudication.ts` — halt/reuse transition
- `src/conductor/test/engine/remediation-case-reconciler.test.ts` — semantic status table

**Dependencies:** Task 5, Task 9, Task 10, Task 15

### Task 18: Wire adjudication transitions into the Conductor loop
**Story:** Story 1 (settlement route)
**Story:** Story 6 (BUILD navigation)
**Story:** Story 9 (effective transition)
**Type:** happy-path, negative-path

**Steps:**
1. Write a failing bounded conductor integration test whose first possible step is `build_review`,
   whose only provider calls are the fake rubric/remediate calls, and whose sentinel ends immediately
   after BUILD selection. Cover action route, non-action PASS, pure mechanical retry, mixed action,
   mixed non-action mechanical route, and typed adjudication stop.
2. Verify the focused test fails (RED).
3. Replace the daemon raw-FAIL direct branch with the injected adjudication coordinator when enabled.
   Apply its transition through existing kickback event, merged-PR guard, navigation/stale cascade,
   HALT writer, and completion-state seams. Mark durable work-order attempt evidence before BUILD
   provider dispatch and read that order after restart.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(conductor): route build-review failures through remediation cases".

**Done when:**
1. The bounded fixture observes exactly one adjudication dispatch, one first action charge/event, one BUILD navigation, and durable retry context, then terminates through its awaited sentinel.
2. Non-action completion performs no BUILD navigation; pure and mixed mechanical cases take the transition table's routes and never fabricate PASS.
3. Typed failure/HALT fixtures persist state and terminate without a provider, tracker, or navigation call beyond the failing boundary.
4. The production conductor call supplies the coordinator's deferred-intake dependencies, so marker lookup, issue filing, and deferral completion are reachable from a real dispatch and not only from an injected fixture.
5. A restart reads the durable order from `.pipeline/build-review-work-order.json` and recovers the accepted work order and BUILD navigation point; no clause is satisfied by an in-memory hint alone.
6. The conductor distinguishes an exactly-covered infrastructure branch from an uncovered one, so a covered branch is not pinned to `mechanical-retry`.
7. Every clause above is proven against the production call path; a bounded fixture observing the coordinator is necessary but never sufficient on its own.

**Files:**
- `src/conductor/src/engine/conductor.ts` — enabled raw-FAIL integration, transition application, and the production coordinator call's dependency set
- `src/conductor/src/engine/build-review-adjudication.ts` — conductor-facing result port
- `src/conductor/src/engine/build-review-work-order.ts` — BUILD attempt/context hook and durable restart read
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — bounded integration fixture

**Dependencies:** Task 7, Task 15, Task 16, Task 17

### Task 19: Prove restart safety at every reserved-effect boundary
**Story:** Story 10 (all criteria)
**Story:** Story 8 (post-create crash)
**Type:** negative-path, infrastructure

**Steps:**
1. Write a failing parameterized fault-injection matrix for process stop after validation,
   reservation, kickback charge, work-order persistence, BUILD navigation/attempt stamp, remote issue
   creation, local issue-reference persistence, and effect finalization; add a two-executor lease race.
2. Verify the focused integration test fails (RED).
3. Complete recovery transitions so a fresh coordinator derives the one legal next action from case,
   ledger, work-order, issue marker, and conductor state. Inject failures; use no timestamps or sleeps
   for ordering.
4. Verify the focused test passes alone and beside the conductor-adjudication test (GREEN).
5. Commit with message: "test(remediation): make case effects restart-safe".

**Done when:**
1. Every matrix row yields at most one kickback charge and one issue create, resumes admitted work at least once, and never returns PASS from a reserved/failed effect.
2. The two-executor race leaves one parsable case store, one applied effect, and one legal next transition.
3. The test awaits every executor/coordinator promise, cleans its exact `mkdtemp` directory, and uses injected fake tracker/runner boundaries only.

**Files:**
- `src/conductor/src/engine/remediation-case-store.ts` — recoverable state reads
- `src/conductor/src/engine/remediation-case-effects.ts` — resume transitions
- `src/conductor/src/engine/build-review-adjudication.ts` — restart derivation
- `src/conductor/src/engine/conductor.ts` — navigation/attempt recovery point
- `src/conductor/test/integration/remediation-case-recovery.integration.test.ts` — fault matrix/race

**Dependencies:** Task 12, Task 13, Task 16, Task 17, Task 18

### Task 20: Preserve flag-off and legacy callers while rejecting mixed modes
**Story:** Story 11 (all compatibility/config paths)
**Story:** Story 1 (raw-shape path)
**Story:** Story 9 (traceability)
**Type:** happy-path, negative-path

**Steps:**
1. Write failing integration regressions for `adjudication.enabled: false` direct routing/no case-store
   access, default-on routing, every legacy remediation source, unknown/missing/mixed case mode,
   unchanged raw aggregate serialization, and final source→case→effect route rendering.
2. Verify the focused tests fail (RED).
3. Add the compatibility selector at the conductor boundary and the trace renderer used by PASS,
   BUILD, and HALT reports. Keep flag-off on the exact pre-feature raw route; keep legacy artifact
   callers on `readRemediationPlan`.
4. Verify the focused tests pass (GREEN).
5. Commit with message: "feat(build-review): preserve legacy remediation and rollout fallback".

**Done when:**
1. Flag-off produces the old raw-reasons BUILD route/count/stale cascade and performs zero case context/store/effect reads; absent config takes the new path.
2. Legacy prd_audit, as-built, finish, and stall fixtures retain their parsed disposition and route; unknown/missing/mixed case-mode fixtures stop with deterministic diagnostics.
3. Raw per-rubric and aggregate fixtures remain byte-equivalent, while effective PASS/BUILD/HALT reports reconstruct every current source through operator/case/effect to the terminal route.

**Files:**
- `src/conductor/src/engine/conductor.ts` — compatibility selector and route reporting
- `src/conductor/src/engine/artifacts.ts` — legacy reader regression only
- `src/conductor/src/engine/build-review-aggregate.ts` — raw-shape regression only
- `src/conductor/src/engine/build-review-adjudication.ts` — trace renderer
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — flag/default integration
- `src/conductor/test/engine/artifacts.test.ts` — legacy caller matrix
- `src/conductor/test/engine/build-review-aggregate.test.ts` — raw byte-shape regression

**Dependencies:** Task 1, Task 6, Task 7, Task 8, Task 18, Task 19

### Task 21: Emit reconciliation, effect, and semantic-repeat occurrences from the coordinator
**Story:** Story 11 (event path)
**Type:** infrastructure

**Steps:**
1. Write failing coordinator tests with an injected event sink asserting that a case which reconciles, reserves and applies an effect, fails an effect, and halts on a semantic repeat emits `remediation_case_reconciled`, `remediation_effect_reserved`, `remediation_effect_applied`, `remediation_effect_failed`, and `remediation_semantic_repeat_halt` through the injected port (RED — the port's type does not admit them today).
2. Verify the focused tests fail (RED).
3. Widen the coordinator's optional `emit` port from the three adjudication members to the full set of remediation case-lifecycle members already declared in `ConductorEvent`, and emit each occurrence at the point the coordinator performs it — reconciliation, effect reserve, effect apply, effect failure, and semantic-repeat halt.
4. Verify the focused tests pass (GREEN), and confirm the existing adjudication start/completion/failure assertions from Task 15 still hold.
5. Commit with message: "feat(events): emit remediation case lifecycle occurrences".

**Done when:**

1. A coordinator run that reconciles a case emits `remediation_case_reconciled` through the injected port.
2. A coordinator run that reserves, applies, and fails an effect emits `remediation_effect_reserved`, `remediation_effect_applied`, and `remediation_effect_failed` at those points.
3. A coordinator run that halts on a semantic repeat emits `remediation_semantic_repeat_halt`.
4. The coordinator's `emit` port type admits every remediation case-lifecycle member of `ConductorEvent`, so a declared occurrence cannot be unreachable from the coordinator.
5. Task 15's existing start/completion/failure emission assertions remain green, and no second event file, writer, or channel appears in the diff.

**Files:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — widened emit port and occurrence emission
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — injected-sink occurrence assertions

**Dependencies:** Task 14, Task 15

## Task Dependency Graph

```text
1 -> 4
2 -> 3
2, 4 -> 5
1, 3 -> 6
5 -> 8
2 -> 9
5, 9, 10 -> 12
5, 11 -> 13
3, 4, 5, 8, 12, 13, 14 -> 15
15 -> 16
5, 9, 10, 15 -> 17
7, 15, 16, 17 -> 18
12, 13, 16, 17, 18 -> 19
1, 6, 7, 8, 18, 19 -> 20
14, 15 -> 21
```

All dependencies are acyclic. Tasks 1, 2, 7, 10, 11, and 14 may start independently.

Task 21 closes the Story 11 event path: Task 14 declares the occurrence types and their
sinks, and Task 21 is what actually emits them, so a declared occurrence cannot stay unreachable.

## Integration Points

- After Task 6: the existing provider capability can emit a strictly parseable case judgement from
  one complete engine projection; no effects are wired yet.
- After Task 13: both external effect kinds are independently durable and idempotent under injected
  boundaries.
- After Task 15: the complete post-join coordinator returns a closed transition without depending on
  conductor navigation.
- After Task 18: the production loop can apply PASS, BUILD, mechanical, and HALT transitions.
- After Task 20: default-on and compatibility paths are both reachable with legacy remediation intact.

## Coverage Check

| Story | Happy-path tasks | Negative-path tasks |
|---|---|---|
| 1 | 3, 8, 15, 18 | 3, 8, 18, 20 |
| 2 | 3, 6, 15 | 3, 15 |
| 3 | 1, 4, 5 | 1, 4 |
| 4 | 2, 5 | 2, 5, 16 |
| 5 | 16 | 16 |
| 6 | 9, 10, 12, 18 | 8, 9, 12, 18 |
| 7 | 5, 10, 17 | 17 |
| 8 | 11, 13 | 11, 13, 19 |
| 9 | 8, 15, 18, 20 | 8, 15, 18 |
| 10 | 2, 9, 10, 12, 13, 19 | 2, 19 |
| 11 | 1, 6, 7, 14, 20 | 1, 7, 14, 20 |

## Verification

- [x] All 11 stories' happy-path criteria map to at least one task.
- [x] All 11 stories' negative-path criteria map to explicit test-owning tasks.
- [x] The plan has 20 tasks and no terminal catch-all validation task.
- [x] Every task has 2–5 falsifiable `Done when:` checks and a concrete lowest-sufficient test layer.
- [x] Every external provider/tracker boundary is injected; ordinary tests make no real third-party call.
- [x] Every task declares dependencies; the graph is explicit and acyclic.

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/build-review-adjudication-coordinator.ts:212-217 — replace the `if (!proposed.case.existingCaseId) continue;` guard with one keyed on RECONCILED identity: resolve `caseIdsByRef.get(proposed.case.caseRef)` first and run `classifyRemediationCaseReuse(record, attempted)` whenever that id already exists in the pre-lap store (the coordinator's `priorCasesById` map is the in-scope witness), so a reconciler-converged binding from remediation-case-reconciler.ts:125-131 halts `halt-repeat`/`halt-regression` and emits `remediation_semantic_repeat_halt` exactly as an explicitly bound one does; keep the existing `existing case identity was not reconciled` fail-closed branch for a provider-supplied id that did not reconcile (do not fold it into the new path — it is the only detector of a dangling provider binding), and keep the resolved-case skip in `convergedCaseFor` (reconciler.ts:46) unchanged so S7.4's regression path is unaffected. Task 17 Done-when 1-2.
**Gate:** as-built
**Rationale:** Conforming implementation drift inside an approved design: build-review-adjudication-coordinator.ts:213 gates the attempted-repeat classifier on the provider-supplied `proposed.case.existingCaseId`, but remediation-case-reconciler.ts:125-131 also forms a binding itself (`convergedCaseFor`) for an unbound proposal whose disposition and complete source-link set match an open case, so that engine-formed binding never reaches `classifyRemediationCaseReuse` at :217; remediation-case-effects.ts:64-65 then returns `already-applied` with no charge and build-review-adjudication.ts:62-69 routes BUILD a second time for free. Plan Task 17 (`Halt repeated attempted and regressed cases`) already owns this behavior and already names remediation-case-reconciler.ts, build-review-work-order.ts and build-review-adjudication.ts, and the as-built Plan-Gap Check records `No PLAN_GAP exists`, so no plan or ADR change is needed and the approved architecture is preserved. Class sweep: the only two ways a reconciled case id can be a pre-existing case are the provider binding at reconciler.ts:159-168 and the converged binding at :125-131, and grep over src/conductor/src for `existingCaseId` confirms coordinator.ts:213 is the sole classifier guard, so keying the guard on reconciled identity closes the class rather than the cited instance. Found and deliberately excluded: reconciler.ts:185-198 also skips its unattempted-case auto-resolve sweep for converged ids because they land in `referencedExisting` — that is correct behavior for a case being re-referenced this lap and it is unreachable once the coordinator halts first, so it is recorded here and not changed. No existing assertion, guard or code is removed by this task.
**Governing clause:** Task 17
**Parent task:** 17
**Done when:**
- Task 17 is satisfied by this task.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/build-review-work-order.ts — add one exported predicate over the existing failure-reason unions that classifies a read result as ABSENT (`missing-work-order`; store missing-file empty state) versus INVALID (all other reasons), and derive both consumers from it so the vocabularies cannot diverge: (a) change `readBuildReviewWorkOrderAttemptedCaseIds` (:270-276) to return a typed result that surfaces INVALID instead of `[]`, and have build-review-adjudication-coordinator.ts:135 fail closed on it through the existing `fail(...)` path so reconciliation never runs on erased attempt evidence; (b) in src/conductor/src/engine/conductor.ts make `durableBuildReviewRetryContext` (:4495-4510) return a discriminated outcome instead of bare `undefined` — ABSENT keeps today's benign fall-through to the caller's hint at :7693-7696 (preserving the flag-off/legacy path of Task 20 and criterion S11.3), while INVALID (failed order read, failed `RemediationCaseStore.read`, or a non-ok `markBuildReviewWorkOrderAttempted` result at :4509, whose value is currently discarded) writes the existing `needs-human` halt marker naming the reason and blocks the BUILD dispatch. Task 19 Done-when 1 (`never returns PASS from a reserved/failed effect`) and Done-when 2.
**Gate:** as-built
**Rationale:** Conforming implementation drift under approved plan Task 19 (`Prove restart safety at every reserved-effect boundary`), which already names conductor.ts as the navigation/attempt recovery point; the as-built review records `No PLAN_GAP exists` and states the repair needs no ADR supersession. conductor.ts:4495-4504 collapses every typed failure of `readBuildReviewFeatureWorkOrder` and `RemediationCaseStore.read` to `undefined`, conductor.ts:4509 discards the `PublishBuildReviewWorkOrderResult` of `markBuildReviewWorkOrderAttempted`, and conductor.ts:7696 substitutes the stale in-memory hint on `undefined`, so a malformed, foreign, unreadable or unstamped durable order silently continues BUILD. Class sweep: the second consumer of the same invalid state is build-review-work-order.ts:270-276, where `readBuildReviewWorkOrderAttemptedCaseIds` maps every non-ok read to `[]` and thereby erases the very attempt evidence AB-1's classifier depends on; grep confirms these two are the complete set of durable-state consumers, so both are repaired in this one task. Matched pair: the absence-versus-invalid split must be derived once from the shared `BuildReviewWorkOrderFailureReason` / store-read reason vocabularies (`missing-work-order` and the store's missing-file empty-state at remediation-case-store.ts:272-274 are genuine ABSENCE; `unreadable-work-order`, `malformed-json`, `malformed-order`, `unknown-version`, `foreign-domain`, `foreign-feature`, `unreadable`, `malformed-state`, `atomic-replace-failed` are INVALID) rather than re-listed at each call site, so the two lists cannot drift. No coverage is removed: the benign-absence path that lets flag-off, legacy and never-adjudicated BUILD dispatches proceed (Task 20's flag-off contract, criterion S11.3) is preserved by construction.
**Governing clause:** Task 19
**Parent task:** 19
**Done when:**
- Task 19 is satisfied by this task.

### Task rem-prd-audit-rem-s73-1: Add the missing RED coverage for the unbound-convergence repeat: in src/conductor/test/engine/remediation-case-reconciler.test.ts extend the semantic status table with a row where the judgement proposes a case with NO `existingCaseId` whose disposition and full source-link set match an open, already-attempted `act` case (source id `rubric:contractVersion/concernKind/anchor` stable across laps per build-review-finding-identity.ts:27), and add the matching coordinator-level assertion covering build-review-adjudication-coordinator.ts:212-217 that the lap ends `needs-human` with `halt-repeat`, emits `remediation_semantic_repeat_halt`, takes no kickback charge and returns no `build` route — asserting BOTH the unbound-converged and the explicitly bound origin in the same table so the pair cannot drift. Must fail against current HEAD before the AB-1 fix (`rem-ab1-1`) lands, and pass after. Task 17 Steps 1-2, Done-when 1.
**Gate:** prd-audit
**Rationale:** Same defect as AB-1, reported from the criterion side: prd-audit grades S7.3 FIXABLE at 80% confidence and states explicitly that `no failing test exists for this path`, so the missing element here is the RED proof Task 17 Step 1 already requires, not a second implementation change — the code repair is tasked once under AB-1 and is deliberately NOT duplicated here. Evidence: build-review-adjudication-coordinator.ts:212-213 skips the classifier for every case without `existingCaseId`, remediation-case-reconciler.ts:126-131 converges such a proposal onto the attempted open case, and build-review-adjudication.ts:62-69 routes BUILD again with no charge. Task 17 Step 1 enumerates `attempted equivalent case on unchanged and changed trees` among its required failing tests and the existing table lives in src/conductor/test/engine/remediation-case-reconciler.test.ts, so the coverage is admitted by the approved plan. This task adds a case to the existing table and its coordinator-level counterpart; it removes, rewrites or relaxes no existing test or assertion, and the sibling row for the explicitly bound repeat (which already passes, per S7.4) is left intact so the pair covers both binding origins.
**Criterion:** S7.3
**Parent task:** 17
**Done when:**
- S7.3 is satisfied by this task.

### Task rem-as-built-rem-ab1-4: src/conductor/src/engine/build-review-adjudication-coordinator.ts:297-305 — after the exit-time `operatorResolvedFindingIds()` read and BEFORE `reduceBuildReviewAdjudication` at :305, neutralize durable state for sources accepted since dispatch: inside one `store.mutate` lease mark every case whose complete source-link set is now operator-accepted `resolution: 'resolved'` (keep its source links, effect record, and diagnostic intact — never delete a row, never write the operator disposition store), then republish the order from the surviving open action cases with `publishBuildReviewWorkOrder` so its primary effect id still names a live case, and when no open action case survives leave no BUILD-eligible order so `durableBuildReviewRetryContext` returns `absent`; a bare case-resolve without the republish is wrong because `readBuildReviewWorkOrder` at conductor.ts:4604 would then return `foreign-effect` and halt a still-valid sibling route. Leave conductor.ts:4595-4599's openness filter unchanged (named counterpart) and leave the pre-reservation drop at coordinator.ts:180-183 unchanged. RED first: extend build-review-adjudication-coordinator.test.ts beside the existing exit-race case at :321-333 (keep that assertion) with rows asserting PERSISTED state, not just the route scalar — partial acceptance leaves exactly the unaccepted case open and the republished order carrying only its tasks; all-accepted leaves no BUILD-eligible order — plus a conductor-level assertion that a fresh `durableBuildReviewRetryContext` after such a lap returns `absent`. Task 16 Done-when 1-3; criterion S5.2.
**Gate:** as-built
**Rationale:** Conforming implementation drift admitted by approved plan Task 16 (Done-when 1) with no ADR change required — the as-built report's own Resolution says 'Implement the existing approved obligations; no new ADR is required' and its plan-gap check found no plan gap; mirrors prd-audit criterion S5.2 (FIXABLE, plan task 16), which is closed by this same task and therefore gets no duplicate gap. Evidence: src/conductor/src/engine/build-review-adjudication-coordinator.ts:297-305 re-reads operator authority at the exit but feeds only exitSourceIds into reduceBuildReviewAdjudication, leaving the newly accepted source's case at resolution:'open' and its published work order on disk, so src/conductor/src/engine/conductor.ts:4593-4607 (called from every BUILD entry at :7810) hands that obsolete work to the next BUILD. Matched pair named and preserved: conductor.ts:4595-4599's `resolution === 'open'` filter is the counterpart reader — it is deliberately left unchanged because resolving the case is exactly what makes it ineligible, so no second authority reader is introduced inside the BUILD loop (Task 16 Done-when 3 forbids cross-writes between the case store and the operator disposition store, so nothing is copied in either direction). Sibling sweep: the pre-reservation acceptance drop at coordinator.ts:180-183 is the only path that keeps an accepted source out of reservation entirely and is left untouched; the late-acceptance-after-issue-filing case in the deferral loop at coordinator.ts:269-295 is found-and-excluded — retracting an already-filed intake issue is not admitted by Task 16 or any other approved task, and the finding scopes to durable action work orders. No task removes or relaxes existing coverage; build-review-adjudication-coordinator.test.ts:321-333's route-scalar assertion is kept and extended with persisted-state assertions rather than replaced.
**Governing clause:** Task 16
**Parent task:** 16
**Done when:**
- Task 16 is satisfied by this task.

### Task rem-as-built-rem-ab2-4: Derive BUILD eligibility from the COMPLETE effect state through one shared predicate so the two vocabularies cannot drift again: (a) export `isBuildEligibleActionCase(record)` from src/conductor/src/engine/remediation-case-effects.ts requiring `resolution === 'open' && effect.kind === 'action' && effect.status === 'applied'` and have BOTH src/conductor/src/engine/conductor.ts:4595-4599 and src/conductor/src/engine/build-review-adjudication.ts:24-26 consume it instead of open-coding the condition; (b) narrow the finalize at src/conductor/src/engine/remediation-case-effects.ts:112-114 from `record.resolution === 'open'` to `record.effect.status === 'reserved'` so a later reserved sibling can never rewrite a `failed` sibling to `applied` (the already-charged replay path S10.4 asserts still passes — it reaches this line with a reserved effect); (c) change the early return at :62-65 so an open action set whose effects are ALL `failed` returns `{ ok: false, reason }` naming those effect ids and their diagnostics rather than `already-applied`, leaving the all-applied idempotent replay (S7.1) unchanged. RED first: add fault-matrix rows to src/conductor/test/integration/remediation-case-recovery.integration.test.ts — one charge-throw row and one per-gate/cumulative cap-exhaustion row — asserting that after failPending a fresh `durableBuildReviewRetryContext` yields no BUILD route and the lap reaches the fail-closed needs-human halt with at most one kickback charge; keep the existing two-executor race row (S10.2). Task 19 Done-when 1-2; criterion S10.1.
**Gate:** as-built
**Rationale:** Conforming implementation drift admitted by approved plan Task 19 (Done-when 1-2), whose text already states the required behavior ('never returns PASS from a reserved/failed effect'); mirrors prd-audit criterion S10.1 (FIXABLE, plan task 19), closed by this same task and therefore not duplicated as a separate gap. Evidence: src/conductor/src/engine/remediation-case-effects.ts:88-95 publishes the order before charging at :96-111, so a thrown charge (:99-102) or an exhausted per-gate/cumulative cap (:103-111) calls failPending — effects become `failed`, cases stay `open`, and the order stays on disk — while src/conductor/src/engine/conductor.ts:4595-4599 selects BUILD input with no `effect.status` test and binds that failed effect's order at :4604; additionally a failed-only open set returns `already-applied` at :62-65 and a later reserved sibling rewrites every open action effect — including failed ones — to `applied` at :112-114, erasing the durable failure. Matched pair, derived from one source: conductor.ts:4595-4599 and build-review-adjudication.ts:24-26 are two copies of the same eligibility vocabulary that already disagree, so the task makes both consume ONE exported predicate rather than editing either side alone. Preserved coverage named: S10.4's already-charged replay (kickback-ledger.test.ts, remediation-case-effects.test.ts) still finalizes the RESERVED effect to `applied` under the narrowed finalize, and S7.1's idempotent `already-applied` replay (all effects applied, none reserved, none failed) is untouched by the narrowed early return — neither assertion is removed or relaxed. Sibling sweep: the deferral effect path (remediation-case-effects.ts:178-180) already leaves its effect `reserved` and is correctly blocked by build-review-adjudication.ts:59-61, so it carries no sibling defect and needs no change.
**Governing clause:** Task 19
**Parent task:** 19
**Done when:**
- Task 19 is satisfied by this task.

### Task rem-as-built-rem-ab3-1: src/conductor/src/engine/conductor.ts:7807-7818 — gate the `durableBuildReviewRetryContext` call on `resolveBuildReviewConfig(this.config).adjudication.enabled`, reading it through the same single accessor the raw-FAIL branch uses at :10169 (extract one private helper consumed by both sites so the pair cannot drift), so a flag-off BUILD entry performs zero reads of the remediation case store (:4581, :4593), zero work-order reads (:4604), no attempt stamp (:4608), and can never write the needs-human halt at :7811-7817; leave the default-on path (absent config) on the new route unchanged. RED first: add a conductor-loop regression to src/conductor/test/engine/conductor-build-review-adjudication.test.ts that runs with `build_review: { adjudication: { enabled: false } }` against a project root that ALREADY contains `.pipeline/remediation-cases.json` and a published `.pipeline/build-review-work-order.json` (including one malformed-store variant), asserting the pre-feature raw-reasons BUILD route/count and — via injected read spies or artifact mtimes — that neither artifact was read and no attempt stamp was written; keep the existing default-on routing assertions untouched. Task 20 Done-when 1 and Done-when 3; criterion S11.3.
**Gate:** as-built
**Rationale:** Conforming implementation drift admitted by approved plan Task 20, whose Done-when 1 states the required behavior verbatim ('Flag-off … performs zero case context/store/effect reads'); mirrors prd-audit criterion S11.3 (FIXABLE, plan task 20) and is closed by this same task, so that criterion is not duplicated as a separate gap. Evidence: src/conductor/src/engine/conductor.ts:7807-7818 invokes `durableBuildReviewRetryContext` on EVERY BUILD entry with no configuration check, while the raw-FAIL branch is correctly gated at :10169 by `resolveBuildReviewConfig(this.config).adjudication.enabled`; the ungated path reads the case-store feature at :4581, the case store at :4593, the work order at :4604, stamps attempt evidence at :4608, and can write a needs-human halt at :7811-7817 with the flag off. Matched pair: :10169 and :7807 are the two adjudication gate sites — the task brings the second along and has both read the one resolved accessor so they cannot diverge again. No existing code, test, or assertion is removed or relaxed; the change only adds a guard, and the default-on routing regression already in conductor-build-review-adjudication.test.ts is retained unchanged as the counterpart of the new flag-off row. Sibling sweep: `grep -n resolveBuildReviewConfig src/conductor/src/engine/conductor.ts` shows no third adjudication-flag site, and the remaining match is the unrelated `build_review.enabled` gate, which is deliberately not touched.
**Governing clause:** Task 20
**Parent task:** 20
**Done when:**
- Task 20 is satisfied by this task.

### Task rem-as-built-rem-ab4-1: src/conductor/src/engine/kickback-ledger.ts — add one exported typed read (e.g. `readKickbackLedgerResult(projectRoot)` returning `{ kind: 'absent' } | { kind: 'ok'; ledger } | { kind: 'unreadable'; reason }`) DERIVED FROM the same JSON parse plus `isKickbackLedger`/`normalizeKickbackLedger` path `readKickbackLedger` (:262-283) already runs, and re-express `readKickbackLedger` in terms of it so the absent/malformed/version-incompatible vocabularies cannot drift while every existing caller keeps its current fail-open return byte-for-byte; then make `chargeBuildReviewEffectInLedger` (:497-509) consume the typed result — `absent` keeps the empty-budget base case (adr-2026-08-31 decision 1 carve-out), `ok` behaves exactly as today, and `unreadable` returns a typed non-ok result WITHOUT charging and WITHOUT writing the ledger — and surface it in src/conductor/src/engine/remediation-case-effects.ts:96-111 through the existing `failPending` path so the reason reaches `fail(action.reason)` at build-review-adjudication-coordinator.ts:259 and the existing needs-human halt at conductor.ts:10251-10258. RED first: add rows to src/conductor/test/engine/kickback-ledger.test.ts and src/conductor/test/engine/remediation-case-effects.test.ts covering a malformed ledger and a version-incompatible ledger at the charge boundary — asserting no charge, no ledger write, and the fail-closed reason — while keeping the existing ENOENT/empty-budget assertions unchanged as the counterpart. Do not change conductor.ts:10198's mechanical-fault read (recorded as found-and-excluded in this gap's rationale). Governing clause: adr-2026-08-31-kickback-ledger-read-fails-closed decision 1.
**Gate:** as-built
**Rationale:** Conforming implementation drift against an APPROVED, applicable, and unchanged decision — adr-2026-08-31-kickback-ledger-read-fails-closed decision 1 — so the route is build, not architecture_review: no architectural question is open, the ADR already decides the semantics, and the as-built Resolution item 4 states the repair ('make the charge boundary consume a typed absent/readable/unreadable result and route unreadable enforcement state to the existing needs-human halt without charging or overwriting it'). Evidence: src/conductor/src/engine/kickback-ledger.ts:258-283 maps malformed, version-incompatible, and non-ENOENT read failures to `emptyLedger()`, and this feature's new `chargeBuildReviewEffectInLedger` at :497-509 consumes that reader and persists a freshly charged entry from the empty result, so a corrupt capped ledger becomes a fresh budget at the adjudication effect boundary. Matched pair: the new typed reader and the legacy `readKickbackLedger` are two readers of one durable record, so the task derives both from the SAME parse/validation path rather than writing a second independent validator, and leaves every existing caller (conductor.ts:732, :754, :2306-2321, :5876-5944, :8813, :8968, :10430, :11847 and build-review-cli.ts:195, :372) byte-compatible — this feature changes no legacy caller's fail-open behavior, which is another feature's scope under the same ADR. ADR decision 1's explicit carve-out is preserved: a genuinely absent ledger stays the empty-budget base case, so a first dispatch never halts. Found-and-excluded sibling of the same shape: conductor.ts:10198's `(await readKickbackLedger(this.projectRoot)).gates.build_review?.mechanicalFaults ?? 0` also yields a more permissive lane from a corrupt ledger, but no approved plan task and no clause cited by AB-4 admits changing the mechanical-fault lane's read semantics in this feature, so it is recorded here rather than quietly fixed. Nothing is removed or relaxed: the ENOENT/empty-budget behavior and its existing kickback-ledger.test.ts coverage are kept as the named counterpart of the new fail-closed rows.
**Governing clause:** adr-2026-08-31-kickback-ledger-read-fails-closed decision 1
**Done when:**
- adr-2026-08-31-kickback-ledger-read-fails-closed decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab1-6: src/conductor/src/engine/build-review-adjudication-coordinator.ts:240-295 — re-read exact operator authority IMMEDIATELY BEFORE each reservation boundary so a newly accepted source can never publish a work order, consume a kickback charge, or file an intake issue. (1) Just before the `tasksByCaseId` loop at :240, call `operatorResolvedFindingIds()` again inside the SAME fail-closed try/catch shape already used at :153/:172/:304 (`catch { return fail('operator disposition state is unavailable'); }`); recompute live source ids with the EXISTING `liveSourceIdsFor` helper at :161-162 — do not open-code a second acceptance predicate (named counterpart) — and skip every proposed case whose COMPLETE source set is now accepted so it contributes no entry to `tasksByCaseId`, hence no work-order case and no charge; if that leaves `tasksByCaseId` empty, apply no action effects at all, and if every dispatch source is now accepted return `routeIfAllOperatorResolved(resolved)` before any effect. (2) Apply the same suppression at the deferral reservation loop at :269-295 from that same re-read, so an acceptance arriving before intake reservation files no issue (Task 16 Step 1 names the intake-reservation boundary explicitly). Leave the pre-dispatch filter at :153-157, the post-judge admission at :180-185, and the exit-time neutralization/republish at :300-342 unchanged — they cover the earlier and later windows and their coverage is preserved. RED first, in src/conductor/test/engine/build-review-adjudication-coordinator.test.ts: KEEP the existing exit-race row at :323-342 and add rows where the injected resolver returns the acceptance only on the read immediately before effects, asserting (a) the `chargeEffect` spy is never called and `.pipeline/kickback-ledger.json` bytes are unchanged, (b) no `.pipeline/build-review-work-order.json` names the accepted case, (c) partial acceptance still publishes an order carrying exactly the unaccepted sibling's tasks and charges exactly once, and (d) the deferral variant calls `fileIssue` zero times for the accepted source while still filing for an unaccepted sibling. Task 16 Steps 1-3, Done-when 1 and 3; criterion S5.2; as-built finding AB-1.
**Gate:** as-built
**Rationale:** Conforming implementation drift admitted by approved plan Task 16 — the as-built plan-gap check found no plan gap and the approved design is unchanged, so the route is build, not plan or architecture_review. Verified at HEAD 19bd1c850: the last operator-authority read before effects is src/conductor/src/engine/build-review-adjudication-coordinator.ts:172, which freezes `liveSourceIds`/`admitted` at :182-185; the action-effect loop at :240-253 and the deferral loop at :269-295 both iterate that frozen set with NO intervening authority read, so remediation-case-effects.ts:105-130 publishes the work order and charges the stable kickback id, and :188-197 files a real tracker issue, for a source the operator accepted in that window. The exit read at :300-305 and the neutralization landed by rem-as-built-rem-ab1-4 can resolve the case and withhold the republished order but cannot refund the charge or retract the filed issue, which is why the prior lap's exit-only repair left AB-1/S5.2 open. Task 16 Step 1 names this exact boundary set ('between validation and each of work-order reservation, intake reservation, BUILD route, HALT, and PASS') and its Done-when 1 requires each late acceptance to suppress obsolete work, effect, route and HALT for its own source. Class swept, not just the cited site: BOTH reservation boundaries (action at :240 and deferral at :269) are the same shape and are fixed in the SAME task; matched pair derived from one source — the new pre-reservation read reuses the existing `liveSourceIdsFor` helper at :161-162 rather than open-coding a second acceptance predicate. Nothing removed or relaxed: the pre-dispatch filter at :153-157, the post-judge admission at :180-185, and the exit-time neutralization at :300-342 all stay, and the existing exit-race assertion at build-review-adjudication-coordinator.test.ts:323-342 is kept and extended, preserving the coverage delivered by Task 16 and by rem-as-built-rem-ab1-4. Found-and-excluded: an acceptance landing strictly INSIDE applyBuildReviewActionEffects' own store lease is not addressed — that effect boundary is already atomic under the lease and Task 16 scopes to exits, so no sub-lease authority read is introduced.
**Governing clause:** Task 16
**Parent task:** 16
**Done when:**
- Task 16 is satisfied by this task.

### Task rem-as-built-rem-ab2-6: Make the new adjudication mechanical read/bump path fail closed on unreadable enforcement state, deriving both bump vocabularies from one source. (a) In src/conductor/src/engine/kickback-ledger.ts add an exported `bumpMechanicalFaultsInLedgerResult(projectRoot, gate, fault?)` returning `{ kind: 'ok'; entry: KickbackGateEntry } | { kind: 'unreadable'; reason: string }`, built on the EXISTING `readKickbackLedgerResult` (:269-284): 'unreadable' returns the reason and writes NOTHING, 'absent' keeps today's zeroed base entry, 'ok' behaves exactly as today; then re-express the existing `bumpMechanicalFaultsInLedger` (:553-576) in terms of it so the legacy caller at src/conductor/src/engine/step-runners.ts:2065-2071 keeps its current fail-open return and write byte-for-byte (named counterpart: do not edit that caller and do not fork a second validator). (b) At src/conductor/src/engine/conductor.ts:10208-10212 replace `readKickbackLedger` with `readKickbackLedgerResult` — 'absent' yields 0 faults (adr-2026-08-31 decision 1 carve-out), 'ok' reads `gates.build_review?.mechanicalFaults ?? 0`, and 'unreadable' writes the existing needs-human halt naming the reason via the same `writeHaltMarker`/`persistPendingStateChanges`/`emitLoopHalt` sequence used at :10195-10199 and returns BEFORE `coordinateBuildReviewAdjudication` runs, so no judgement, effect, or charge is attempted. (c) At src/conductor/src/engine/conductor.ts:10300-10311 call the new typed bump and route 'unreadable' to that same needs-human halt without writing the ledger, leaving the 'ok' path's `saveConductorStepStatus`/re-land behavior at :10312-10315 unchanged. Do NOT change conductor.ts:10276's display-only read or any pre-existing legacy caller (recorded as found-and-excluded in this gap's rationale). RED first: add rows to src/conductor/test/engine/conductor-build-review-adjudication.test.ts for a malformed ledger and a version-incompatible ledger present at the raw-FAIL entry, asserting the lap halts needs-human naming the ledger reason, that `.pipeline/kickback-ledger.json` bytes are unchanged (no fresh allowance written), and that no adjudication charge or BUILD route occurs; add a src/conductor/test/engine/kickback-ledger.test.ts row proving `bumpMechanicalFaultsInLedger` still returns and writes the fail-open entry for the legacy caller; keep every existing absent-ledger/first-dispatch assertion unchanged as the counterpart. Governing clause: adr-2026-08-31-kickback-ledger-read-fails-closed decision 1; criterion S1.6; as-built finding AB-2.
**Gate:** as-built
**Rationale:** Conforming implementation drift against an APPROVED, applicable, unchanged decision — adr-2026-08-31-kickback-ledger-read-fails-closed decision 1 — so the route is build: the ADR already decides the semantics, no architectural question is open, and the as-built Resolution item 2 states the repair verbatim; fail-open semantics here would instead require a human-approved superseding ADR, which the evidence does not support. The typed reader `readKickbackLedgerResult` already exists at src/conductor/src/engine/kickback-ledger.ts:269-284 (landed by rem-as-built-rem-ab4-1, which deliberately recorded conductor.ts's mechanical read as found-and-excluded), but the feature's new adjudication branch still derives the mechanical allowance from the fail-open `readKickbackLedger` at src/conductor/src/engine/conductor.ts:10209, and on the mechanical-retry transition src/conductor/src/engine/conductor.ts:10300 calls `bumpMechanicalFaultsInLedger`, which re-reads the corrupt ledger as empty at kickback-ledger.ts:559 and atomically overwrites it at :571-574 — turning an exhausted-but-unreadable budget into a full allowance that can never be re-derived. Both sites are inside this feature's own diff (verified: the only conductor.ts hunk covering them is @@ -10075,6 +10173,146 @@ against merge base 48ae65aff). Matched pair derived from one source: the task adds ONE typed bump built on `readKickbackLedgerResult` and re-expresses the existing `bumpMechanicalFaultsInLedger` in terms of it, so the legacy caller at src/conductor/src/engine/step-runners.ts:2065 keeps byte-identical fail-open behavior and the two vocabularies cannot drift. Sibling sweep with reasons: conductor.ts:734, :756, :2311, :2318, :2326, :5887, :5927, :5955, :8824, :8979, :11859 and build-review-cli.ts:195, :372 read through the same fail-open path but are all pre-existing lines outside this feature's diff (confirmed against the merge base) and belong to the ADR's separate legacy-caller scope, so they are named here as found-and-excluded rather than quietly fixed; conductor.ts:10276 IS in-diff but supplies only the emitted kickback event's display count — it derives no budget and the charge it accompanies already fails closed in `chargeBuildReviewEffectInLedger` — so it is recorded, not changed. Nothing is removed or relaxed: the genuinely-absent ledger stays the empty-budget base case (ADR decision 1 carve-out) and its existing ENOENT assertions are kept as the counterpart of the new fail-closed rows.
**Governing clause:** adr-2026-08-31-kickback-ledger-read-fails-closed decision 1
**Done when:**
- adr-2026-08-31-kickback-ledger-read-fails-closed decision 1 is satisfied by this task.
