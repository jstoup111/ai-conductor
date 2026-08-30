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

**Files:**
- `src/conductor/src/engine/conductor.ts` — enabled raw-FAIL integration and transition application
- `src/conductor/src/engine/build-review-adjudication.ts` — conductor-facing result port
- `src/conductor/src/engine/build-review-work-order.ts` — BUILD attempt/context hook
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
