# Implementation Plan: Operator acceptance of a build_review finding survives a re-raise (#3271)

**Date:** 2026-10-19
**Design:** .docs/decisions/architecture-review-2026-10-19-operator-acceptance-of-a-build-review-finding-does.md (APPROVED WITH CONDITIONS) + .docs/architecture/operator-acceptance-of-a-build-review-finding-does.md
**Stories:** .docs/stories/operator-acceptance-of-a-build-review-finding-does.md
**Conflict check:** Clean as of 2026-10-19 (8 blocking conflicts resolved, see .docs/conflicts/operator-acceptance-of-a-build-review-finding-does.md)
**Tier:** M (see .docs/complexity/operator-acceptance-of-a-build-review-finding-does.md)

## Summary

A finding that the `remediate` adjudicator binds to an operator-accepted remediation case, in a later
lap, settles as carried operator acceptance instead of halting, opening a decision stop, or demanding
a fresh `build-review accept`. Every reader of accepted risk resolves it through one shared,
read-only resolver. The plan has 12 tasks.

## Technical Approach

- **One read-side resolver, nothing new persisted.** A new module,
  `src/conductor/src/engine/build-review-acceptance-resolver.ts`, exports
  `resolveBuildReviewAcceptance`. Its inputs are the feature's disposition records (from
  `BuildReviewDispositionStore`), the case records it is given (from `RemediationCaseStore`), and
  the feature identity. Its result classifies each finding id as `direct` (an exact disposition
  match, using the existing `matchesBuildReviewDisposition` semantics), `carried` (with origin
  finding id, origin lap = the origin disposition's `sourceLapId`, operator, rationale and case id),
  or `none`. The disposition store stays the sole owner of accepted risk; the case store stays the
  sole owner of equivalence links.
- **The carry rule is mechanical and uses only existing fields.** A case source link is carried when
  all of the following hold:
  - its finding has no exact disposition;
  - its case holds a source A with an exact feature disposition;
  - the link's `recordedAt` is strictly later than both A's `acceptedAt` and A's own link
    `recordedAt`.

  So links made in the same reconciliation as A (the accepting lap), links recorded before the
  acceptance, and cases with no accepted source never carry. The coordinator also refuses to carry
  when the current lap id equals the origin's `sourceLapId`. Source ids in the case store are
  rubric-namespaced (`buildReviewAdjudicationSourceId`), and the resolver maps them back to finding
  ids the same way `finalizedBuildReviewSourceIds` does.
- **The coordinator owns the carry decision.** It decides in `coordinateBuildReviewAdjudication`,
  after the judgement validates and before action authorization, the `neverBuilt` strip,
  `classifyRemediationCaseReuse`, reconciliation and decision stops. A proposed case whose
  `existingCaseId` names an accepted case is partitioned out as carried, whatever its disposition.
  Its live sources are appended to the accepted case by a new reconciler function,
  `appendCarriedRemediationCaseSources`. That function takes the store lease, appends only missing
  links, and leaves the case's disposition, resolution, effect and existing links byte-identical. The
  carried finding ids join the operator-resolved set passed to `finalize`, and one
  `build_review_disposition_carried` event is emitted per newly appended link. Carried escalations
  are removed from the judgement before `authorizeBuildReviewRemediationActionEffects`, so they
  neither block sibling actions nor reach `persistBuildReviewDecisionStop`.
- **Consumers.** The effective verdict (`build-review-effective.ts`, `build-review-aggregate.ts`,
  and the accepted-id construction and re-reader in `conductor.ts`) reads carry from the resolver.
  It reads the case store only when `build_review.adjudication.enabled` is on, and uses the same
  child-scoped case store the coordinator uses (`new RemediationCaseStore(projectRoot, feature, {
  child })`). The prior-case context gains an `operatorAccepted` marker. `build-review findings` and
  the accepted-risk renderer list carried rows. `skills/remediate/SKILL.md` states the binding rule.
- **Local pattern (repeated in each affected task):** follow `finalizedBuildReviewSourceIds`
  (`remediation-case-store.ts`). It is a pure function of case records that returns
  rubric-namespaced source ids, and the coordinator, the effective verdict and the CLI all call it.
  The resolver should keep the same traits: pure, no I/O, given already-read records, and called
  identically by every consumer. Allowed variation: the resolver also takes disposition records and
  returns origin metadata. Search hints: `finalizedBuildReviewSourceIds`,
  `buildReviewAdjudicationSourceId`, `matchesBuildReviewDisposition`.

## Prerequisites

- None. No migration: both stores keep their schemas and versions.

## Tasks

### Task 1: Shared acceptance resolver with the carry rule
**Story:** Story 1, Story 3, Story 4, Story 8
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-acceptance-resolver.test.ts` covering:
   - a direct match;
   - a carried link with origin finding id, lap, operator, rationale and case id;
   - a same-reconciliation sibling (equal `recordedAt` to the accepted link);
   - a link recorded before `acceptedAt`;
   - a case without an accepted source;
   - a foreign-feature disposition;
   - a three-link chain;
   - unreadable case input, unreadable disposition input, and a removed origin disposition.
2. Verify RED.
3. Implement `resolveBuildReviewAcceptance` in `src/conductor/src/engine/build-review-acceptance-resolver.ts` as a pure function over already-read disposition records, case records (or a case-read failure) and the feature identity. Follow the `finalizedBuildReviewSourceIds` pattern: pure, no I/O, rubric-namespaced source ids mapped with `buildReviewAdjudicationSourceId`. Use `matchesBuildReviewDisposition` for direct matches. A carried origin is always a directly accepted source, never another carried link, so chains resolve to the first acceptance.
4. Verify GREEN and commit.

**Done when:**
- [test] `resolveBuildReviewAcceptance` returns `direct` for a finding with an exact feature disposition and `carried` naming origin finding id, origin lap, operator, rationale and case id for a case link recorded strictly after both the origin `acceptedAt` and the origin link's `recordedAt`, as asserted in `build-review-acceptance-resolver.test.ts`.
- [test] The resolver returns `none` for a link recorded in the same reconciliation as the accepted source, for a link recorded before the origin `acceptedAt`, for a link on a case holding no directly accepted source, and for any finding when the only disposition carries a different feature identity.
- [test] For a chain where lap 2 and lap 3 each re-raise under a new id bound to the accepted case, the lap-3 finding resolves `carried` with the lap-1 origin finding id and lap, not the lap-2 finding.
- [test] A case-store read failure or malformed case store yields `none` for every finding without an exact disposition while exact dispositions still resolve `direct`, a disposition-store read failure or malformed disposition store returns the existing fail-closed failure unchanged with nothing carried, and removing the origin disposition record makes every link carried from it resolve `none`.

**Files:** src/conductor/src/engine/build-review-acceptance-resolver.ts; src/conductor/test/engine/build-review-acceptance-resolver.test.ts

**Dependencies:** none

### Task 2: Carried-acceptance event on the spine
**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Write a failing assertion in `src/conductor/test/engine/event-sinks.test.ts` that `EVENT_SINKS.build_review_disposition_carried` exists with `persist: true` and `audit: true`.
2. Verify RED.
3. Add `{ type: 'build_review_disposition_carried'; feature: string; lapId: string; findingId: string; caseId: string; originFindingId: string; originLapId: string }` to the `ConductorEvent` union in `src/conductor/src/types/events.ts` beside `build_review_disposition_version_invalidated`, and register it in `src/conductor/src/engine/event-sinks.ts` with `{ render: false, persist: true, audit: true, otel: false }`, matching that sibling.
4. Verify GREEN and commit.

**Done when:**
- The `ConductorEvent` union in `src/conductor/src/types/events.ts` declares `build_review_disposition_carried` with fields `feature`, `lapId`, `findingId`, `caseId`, `originFindingId` and `originLapId`.
- [test] `event-sinks.test.ts` asserts `EVENT_SINKS` declares `build_review_disposition_carried` with `persist: true` and `audit: true`, so every sink registration covers the new variant.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/test/engine/event-sinks.test.ts

**Dependencies:** none

### Task 3: Effective verdict and operator-resolved set read carry
**Story:** Story 1, Story 4, Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-effective.test.ts` covering:
   - a lap whose only unresolved content finding is linked as carried, which must derive PASS;
   - a stacked child carrying through its own child store, while a case id present only in a sibling child carries nothing;
   - an unbound finding, which must stay FAIL;
   - an unreadable case store;
   - adjudication disabled.
2. Verify RED.
3. In `build-review-effective.ts` (custom and built-in paths) and `build-review-aggregate.ts` (`deriveEffectiveBuildReviewVerdictWithDispositions`), read the case store and pass both record sets to `resolveBuildReviewAcceptance`, counting `direct` and `carried` as accepted. Read the case store through the same child-scoped `RemediationCaseStore` the coordinator uses, and only when `build_review.adjudication.enabled` is on. In `conductor.ts`, keep building the accepted-id set and its re-reader from `effective.acceptedFindingIds`, so carried ids flow to the coordinator unchanged. Follow the `finalizedBuildReviewSourceIds` call pattern: read records once, call the pure function.
4. Verify GREEN and commit.

**Done when:**
- [test] `deriveEffectiveBuildReviewVerdict` resolves accepted risk through `resolveBuildReviewAcceptance`, so a lap whose only unresolved content finding resolves `carried` derives effective PASS with that id in `acceptedFindingIds` and with zero kickback ledger increments, as asserted in `build-review-effective.test.ts`.
- [test] For a stacked child the effective verdict resolves carry against that child's case store paired with the feature disposition store, and a finding bound only by a case id present in a sibling child's store resolves `none`.
- [test] A finding linked to no accepted case keeps today's FAIL effective verdict and stays in the unresolved set.
- [test] With an unreadable or malformed case store the effective verdict keeps exact dispositions accepted, treats every other finding as unresolved, and returns the same route it returns today for that aggregate.
- [test] With `build_review.adjudication.enabled: false` the effective verdict does not open the case store and resolves only exact dispositions.

**Files:** src/conductor/src/engine/build-review-effective.ts; src/conductor/src/engine/build-review-aggregate.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/build-review-effective.test.ts

**Dependencies:** Task 1

### Task 4: Prior-case context marks operator-accepted cases
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-context.test.ts` covering: an accepted case carries the marker with origin finding ids and laps; an unaccepted case carries none; the context contains no operator or rationale text; a fixture over the byte ceiling still returns the existing overflow stop.
2. Verify RED.
3. In `build-review-adjudication-context.ts`, have `assembleBuildReviewAdjudicationContext` accept disposition records and add `operatorAccepted: { originFindingIds, originLapIds }` to each projected prior case that holds a directly accepted source, computed with `resolveBuildReviewAcceptance`. Pass the records from the coordinator's existing context call. Count the marker in the existing byte budget, and leave the overflow rule unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `assembleBuildReviewAdjudicationContext` projects `operatorAccepted` with origin finding ids and origin lap ids on each prior case holding a directly accepted source and projects no such field on a case without one, as asserted in `build-review-adjudication-context.test.ts`.
- [test] The serialized context contains neither the operator username nor the rationale of any disposition record.
- [test] A context fixture over its byte ceiling that includes accepted cases returns the existing overflow stop, and in a context that fits every prior case is projected in full with no case omitted and no case field, including its `operatorAccepted` marker, truncated.

**Files:** src/conductor/src/engine/build-review-adjudication-context.ts; src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-context.test.ts

**Dependencies:** Task 1

### Task 5: Coordinator settles a binding to an accepted case as carried
**Story:** Story 1, Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - In `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`, cover:
     - an `act` binding to an accepted case with an `applied` effect;
     - the same binding where the effect was retired as `failed`;
     - a carried finding alongside an unbound `act` finding;
     - an unaccepted-case `act` binding (today's halts);
     - a crash replay after the link append;
     - a lap with no carry.
   - In `src/conductor/test/engine/remediation-case-reconciler.test.ts`, cover `appendCarriedRemediationCaseSources` idempotence and byte-identical preservation.
   - In `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`, replay the #3211 sequence through the conductor's build_review path.
2. Verify RED.
3. Implement `appendCarriedRemediationCaseSources(store, { caseId, sources, recordedAt })` in `remediation-case-reconciler.ts`. It runs under the store lease, appends only links not already present, and changes no other field. In `coordinateBuildReviewAdjudication`, after `validateRemediationCaseGraph`:
   - resolve acceptance over the prior cases;
   - partition out every proposed case whose `existingCaseId` names an accepted case, provided the current lap id differs from the origin `sourceLapId`;
   - append those proposals' live sources;
   - emit one `build_review_disposition_carried` per newly appended link;
   - add the carried finding ids to the resolved set used by `liveSourceIdsFor` and `finalize`;
   - drop the carried proposals from `admitted` before the `neverBuilt` strip, `classifyRemediationCaseReuse` and `reconcileRemediationCases`.
4. Verify GREEN and commit.

**Done when:**
- [test] In `build-review-adjudication-coordinator.test.ts` a judgement binding a re-raised finding with disposition `act` to an accepted case whose action effect is `applied` settles with the finding resolved `carried` in the coordinator's operator-resolved set, no `remediation_semantic_repeat_halt` event, no `semantic remediation case regression` or `semantic remediation case repeat` detail, no reserved effect, no published work order and no kickback ledger increment.
- [test] The same binding to an accepted case whose action effect was retired as `failed` keeps the binding instead of minting a fresh `act` case and settles with the finding resolved `carried`, and `appendCarriedRemediationCaseSources` leaves that case's prior sources, disposition, resolution and effect byte-identical apart from the appended link.
- [test] In one lap with one carried finding and one unbound `act` finding, the coordinator settles the carried finding and routes the unbound finding to today's work order and single kickback charge, and an `act` binding to a case holding no operator-accepted source still returns today's `halt-regression` or `halt-repeat` result.
- [test] Re-running the coordinator after a crash that followed both the link append and the carry event emission but preceded settlement appends no duplicate link, reserves no effect, charges nothing, and across both runs emits and persists to `.pipeline/events.jsonl` through the existing event persister exactly one `build_review_disposition_carried` event naming feature, lapId, findingId, caseId, originFindingId and originLapId per carried finding, while a lap with no carried finding emits none.
- [test] `conductor-build-review-adjudication.test.ts` replays the #3211 sequence through the conductor build_review path (accepted eventSpine finding on lap 1, re-raised under a new id on lap 2 and bound to the accepted case) and lap 2 settles PASS with no HALT file written and no second `build-review accept`.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/src/engine/remediation-case-reconciler.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/engine/remediation-case-reconciler.test.ts; src/conductor/test/engine/conductor-build-review-adjudication.test.ts

**Dependencies:** Task 1, Task 2, Task 3

### Task 6: Carry never widens past the binding
**Story:** Story 1, Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` covering:
   - the accepting-lap sibling finding;
   - acceptance landing mid-adjudication;
   - a lap-3 chain;
   - an unbound look-alike finding;
   - an unaccepted-case binding for each of `act`, `escalate` and `reject`;
   - a mixed lap where an infrastructure failure sits beside a carried finding.
2. Verify RED where the Task 5 partition is too broad, and pin today's behavior where it already holds.
3. Tighten the Task 5 partition so it carries only when `resolveBuildReviewAcceptance` reports the bound case accepted under the strict-later rule and the lap id differs from the origin `sourceLapId`. Re-read acceptance at every exit through the existing `operatorResolvedFindingIds` re-reader. Leave infrastructure handling untouched.
4. Verify GREEN and commit.

**Done when:**
- [test] When the operator accepts one finding of a case during a lap and the judge placed a second finding of that lap in the same case, the coordinator does not carry the second finding and returns today's blocking route for it.
- [test] When an acceptance is recorded while the same lap's adjudication is running and that lap binds another finding to the accepted case, the coordinator does not carry that finding, because the current lap id equals the origin `sourceLapId`.
- [test] A lap-3 re-raise bound to the case already holding the lap-2 carried link settles carried from the lap-1 origin finding and lap.
- [test] A finding bound to no case, including one matching an accepted finding's rubric, path and summary, stays unresolved and receives exactly the route today's coordinator returns for it, and a binding to a case holding no operator-accepted source returns today's route for each of the `act`, `escalate` and `reject` dispositions.
- [test] On a mixed lap whose infrastructure member failed and whose only content finding is carried, the infrastructure result still blocks until it heals or has an exact reduced-coverage disposition.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Task 5

### Task 7: Escalations bound to an accepted case are carried, not decision stops
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` and `src/conductor/test/engine/remediation-case-effects.test.ts` covering:
   - an `escalate` binding to an open escalate case whose sources are all accepted (today: `conflicting-case-id`);
   - an `escalate` binding to a resolved accepted case with different source ids (today: a new open case);
   - a carried escalation beside an unbound escalation;
   - a carried escalation beside an admitted `act` on a case-v2 lap;
   - an escalation bound to an unaccepted case.
2. Verify RED.
3. In the coordinator, apply the Task 5 partition before splitting `escalationCases`, so carried escalations never reach `persistBuildReviewDecisionStop`. Pass a judgement with the carried case rows removed to `authorizeBuildReviewRemediationActionEffects` (`build-review-adjudication.ts`), so only non-carried escalations deny actions. `remediation-case-effects.ts` keeps today's behavior for everything it still receives.
4. Verify GREEN and commit.

**Done when:**
- [test] An `escalate` binding to an open escalate case whose sources are all operator-accepted settles carried and the coordinator result is not `decision stop conflicting-case-id`.
- [test] An `escalate` binding to a resolved case holding an operator-accepted source with differing source ids settles carried and the case store afterward holds no new open escalate case.
- [test] A carried escalation performs no external effect, files no intake issue and charges no kickback, and `authorizeBuildReviewRemediationActionEffects` still authorizes an admitted sibling `act` on the same case-v2 lap.
- [test] In a lap with one carried escalation and one unbound escalation, the unbound escalation still produces its decision stop, and an escalation bound to a case holding no operator-accepted source returns today's `conflicting-case-id` or new decision stop exactly.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/src/engine/build-review-adjudication.ts; src/conductor/src/engine/remediation-case-effects.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/engine/remediation-case-effects.test.ts

**Dependencies:** Task 5

### Task 8: `build-review findings` lists carried rows
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts` covering carried rows in the text and `--json` output, and a pre-acceptance link that is not listed as carried.
2. Verify RED.
3. In `dispatchBuildReviewFindings` (`build-review-cli.ts`), the case store is already opened under the guarded read. Pass its records and the disposition records to `resolveBuildReviewAcceptance`. Render each carried finding as `carried from <origin finding id> (lap <origin lap>)` with operator and rationale, and add `carried: { originFindingId, originLapId, operator, rationale, caseId }` to its JSON record.
4. Verify GREEN and commit.

**Done when:**
- [test] `conduct build-review findings --feature <slug>` text output lists a carried finding as carried with its origin finding id, origin lap, operator and rationale, as asserted in `build-review-cli.test.ts`.
- [test] The `--json` output record for that finding carries `carried.originFindingId`, `carried.originLapId`, `carried.operator` and `carried.rationale`.
- [test] A source linked to an accepted case before the origin acceptance is not listed as carried in either output.

**Files:** src/conductor/src/engine/build-review-cli.ts; src/conductor/test/engine/build-review-cli.test.ts

**Dependencies:** Task 1

### Task 9: PR accepted-risk section lists carried findings
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/shipped-record.test.ts` and `src/conductor/test/engine/finish-publication-production.test.ts` covering:
   - carried rows with id, rubric, and carried-from id and lap;
   - no operator or rationale in the rendered section;
   - an unreadable case store, where direct rows still render, no carried row appears, and a reported line is present;
   - a pre-acceptance link that is not rendered.
2. Verify RED.
3. Extend `renderBuildReviewAcceptedRisk` / `upsertBuildReviewAcceptedRisk` in `build-review-accepted-risk.ts` to take carried rows. In `finish-publication-production.ts` and in the shipped-record writer (`shipped-record.ts`, `shipped-record-cli.ts`), read the case store with the existing guarded read and resolve carried rows with `resolveBuildReviewAcceptance`. On an unreadable case store, render the direct rows plus `Carried acceptance unavailable: remediation case state unreadable`.
4. Verify GREEN and commit.

**Done when:**
- [test] `renderBuildReviewAcceptedRisk` lists each carried finding with its id, rubric, and `carried from <origin finding id> (lap <origin lap>)`, and finish publication and the shipped-record writer pass carried rows resolved by `resolveBuildReviewAcceptance`.
- [test] The rendered accepted-risk section contains neither the operator username nor the rationale for any carried row.
- [test] With an unreadable case store, publication renders every direct row, renders no carried row, and includes the line `Carried acceptance unavailable: remediation case state unreadable`.
- [test] A source linked to an accepted case before the origin acceptance is not rendered as a carried row.

**Files:** src/conductor/src/engine/build-review-accepted-risk.ts; src/conductor/src/engine/finish-publication-production.ts; src/conductor/src/engine/shipped-record.ts; src/conductor/src/engine/shipped-record-cli.ts; src/conductor/test/engine/shipped-record.test.ts; src/conductor/test/engine/finish-publication-production.test.ts

**Dependencies:** Task 1

### Task 10: `remediate` skill contract states the binding rule
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write a failing assertion in `src/conductor/test/engine/remediate-skill-contract.test.ts` that `skills/remediate/SKILL.md` says a prior case marked `operatorAccepted` may be bound by `existingCaseId` when the current finding has the same substance, and still says never to assert or create operator acceptance.
2. Verify RED.
3. Edit the prior-case guidance in `skills/remediate/SKILL.md` next to the existing "Never assert or create operator acceptance" rule.
4. Verify GREEN and commit.

**Done when:**
- [test] `remediate-skill-contract.test.ts` asserts `skills/remediate/SKILL.md` permits binding a current finding of the same substance to a prior case marked `operatorAccepted` through `existingCaseId`.
- [test] The same test asserts the skill still forbids asserting or creating operator acceptance and forbids treating an autonomous case outcome as accepted risk.

**Files:** skills/remediate/SKILL.md; src/conductor/test/engine/remediate-skill-contract.test.ts

**Dependencies:** none

### Task 11: Consumer parity and the single-resolver guard
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write `src/conductor/test/engine/build-review-acceptance-consumers.test.ts`. Build one fixture: a disposition store, a case store with one accepted case, and an aggregate with one carried finding. Feed it to the seven consumers through their production entry functions:
   - the effective verdict;
   - the coordinator's accepted set;
   - the reuse partition;
   - the decision-stop partition;
   - `assembleBuildReviewAdjudicationContext`;
   - `dispatchBuildReviewFindings`;
   - `renderBuildReviewAcceptedRisk` through the finish-publication reader.

   Add a static guard. It reads every file under `src/conductor/src/` and fails, naming the file, if one calls `matchesBuildReviewDisposition(` and is not `build-review-dispositions.ts` or `build-review-acceptance-resolver.ts`.
2. Verify RED for any consumer still matching directly.
3. Route any remaining direct match through `resolveBuildReviewAcceptance`.
4. Verify GREEN and commit.

**Done when:**
- [test] Against one shared fixture, the effective verdict, the coordinator accepted set, the reuse partition, the decision-stop partition, the adjudication context, the findings output and the accepted-risk renderer each report the same finding as carried with the same origin finding id and lap, and a consumer that disagrees fails the test with a message naming that consumer.
- [test] The static guard in `build-review-acceptance-consumers.test.ts` fails naming the file when any production file other than `build-review-dispositions.ts` or `build-review-acceptance-resolver.ts` calls `matchesBuildReviewDisposition(`, and passes on the delivered tree.

**Files:** src/conductor/test/engine/build-review-acceptance-consumers.test.ts; src/conductor/src/engine/build-review-effective.ts; src/conductor/src/engine/build-review-cli.ts

**Dependencies:** Task 3, Task 4, Task 5, Task 7, Task 8, Task 9

### Task 12: A halt on a judge-bound reuse records the binding
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`:
   - lap 2 binds a re-raised finding with `act` to a resolved `act` case with an `applied` effect and no accepted source, and halts as a regression;
   - the operator then accepts that finding;
   - lap 3 re-raises the same substance under another new id, bound to the same case.
2. Verify RED (today lap 3 halts again, because the lap-2 source was never linked).
3. In `coordinateBuildReviewAdjudication`'s pre-reconciliation reuse loop, when `classifyRemediationCaseReuse` returns `halt-regression` or `halt-repeat` for an explicit `existingCaseId` binding, call `appendCarriedRemediationCaseSources` with the proposal's live sources and the judge's source outcomes before emitting `remediation_semantic_repeat_halt` and calling `failUnlessAccepted`. Reserve no effect, and change nothing else on the case.
4. Verify GREEN and commit.

**Done when:**
- [test] A lap-2 `act` binding that halts as `semantic remediation case regression` first appends its live sources to the reused case through `appendCarriedRemediationCaseSources`, leaving that case's disposition, resolution, effect and earlier links byte-identical and reserving no effect, and the halt detail and `remediation_semantic_repeat_halt` event are unchanged.
- [test] After the operator accepts that lap-2 finding, a lap-3 re-raise under another new id bound to the same case settles carried from the lap-2 finding with no halt, no reserved effect and no kickback charge.

**Files:** src/conductor/src/engine/build-review-adjudication-coordinator.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Task 5

## Task Dependency Graph

```
Task 1 ─┬─> Task 3 ─┐
        ├─> Task 4 ─┤
        ├─> Task 8 ─┤
        └─> Task 9 ─┤
Task 2 ─────────────┼─> Task 5 ─┬─> Task 6
Task 3 ─────────────┘           └─> Task 7 ─┐
Task 10 (independent)                       └─> Task 11 (also after 3, 4, 5, 8, 9)
Task 5 ──> Task 12
```

## Integration Points

- After Task 3: carried ids flow from the effective verdict to the coordinator through `conductor.ts`.
- After Task 5: the conductor build_review path settles a #3211-shaped re-raise end to end (Task 5 owns that integration proof).
- After Task 9: finish publication renders carried rows in the PR body.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an `act` case whose source finding the operator accepted on lap L1 and whose action effect is `applied`, when lap L2 raises the same substance under a new finding id and the adjudicator binds it to that case with disposition `act`, then the finding is operator-resolved as carried, no `semantic remediation case regression` or `semantic remediation case repeat` halt occurs, no BUILD work order is published, and no kickback is charged. | 5 | "[test] In `build-review-adjudication-coordinator.test.ts` a judgement binding a re-raised finding with disposition `act` to an accepted case whose action effect is `applied` settles with the finding resolved `carried` in the coordinator's operator-resolved set, no `remediation_semantic_repeat_halt` event, no `semantic remediation case regression` or `semantic remediation case repeat` detail, no reserved effect, no published work order and no kickback ledger increment." | diff-local |
| Story 1 happy: Given an accepted case whose action effect was retired as `failed` by the operator acceptance, when a later lap's re-raised finding is bound to it, then the binding is kept and the finding settles as carried rather than opening a fresh `act` case. | 5 | "[test] The same binding to an accepted case whose action effect was retired as `failed` keeps the binding instead of minting a fresh `act` case and settles with the finding resolved `carried`, and `appendCarriedRemediationCaseSources` leaves that case's prior sources, disposition, resolution and effect byte-identical apart from the appended link." | diff-local |
| Story 1 happy: Given a carried finding is the only unresolved content finding of a lap, when the effective verdict is derived, then the effective verdict is PASS with no further operator action. | 3 | "[test] `deriveEffectiveBuildReviewVerdict` resolves accepted risk through `resolveBuildReviewAcceptance`, so a lap whose only unresolved content finding resolves `carried` derives effective PASS with that id in `acceptedFindingIds` and with zero kickback ledger increments, as asserted in `build-review-effective.test.ts`." | diff-local |
| Story 1 happy: Given a finding carried on lap L2 and the same substance re-raised again under a third finding id on lap L3 and bound to the same case, when lap L3 settles, then it is carried from the original L1 acceptance as well. | 6 | "[test] A lap-3 re-raise bound to the case already holding the lap-2 carried link settles carried from the lap-1 origin finding and lap." | diff-local |
| Story 1 happy: Given a lap whose re-raised finding the adjudicator binds to a resolved `act` case with an `applied` effect halts as a `semantic remediation case regression` and the operator then accepts that finding, when a later lap re-raises the same substance under another new id and the adjudicator binds it to the same case, then that later finding settles as carried with no halt. | 12 | "[test] After the operator accepts that lap-2 finding, a lap-3 re-raise under another new id bound to the same case settles carried from the lap-2 finding with no halt, no reserved effect and no kickback charge." | diff-local |
| Story 1 negative: Given the #3211 sequence (accepted eventSpine finding on one lap, re-raised under a new id next lap and bound to the accepted case), when it is replayed as a regression test, then the lap settles without any halt and without a second `build-review accept`. | 5 | "[test] `conductor-build-review-adjudication.test.ts` replays the #3211 sequence through the conductor build_review path (accepted eventSpine finding on lap 1, re-raised under a new id on lap 2 and bound to the accepted case) and lap 2 settles PASS with no HALT file written and no second `build-review accept`." | diff-local |
| Story 1 negative: Given a re-raised finding bound to an accepted case and a second, unbound content finding in the same lap, when the lap settles, then only the bound finding is carried and the unbound finding routes exactly as it does today. | 5 | "[test] In one lap with one carried finding and one unbound `act` finding, the coordinator settles the carried finding and routes the unbound finding to today's work order and single kickback charge, and an `act` binding to a case holding no operator-accepted source still returns today's `halt-regression` or `halt-repeat` result." | diff-local |
| Story 1 negative: Given a re-raised finding bound to an accepted case, when the case store is updated, then the case's existing sources, disposition, resolution and effect are unchanged apart from the appended source link. | 5 | "[test] The same binding to an accepted case whose action effect was retired as `failed` keeps the binding instead of minting a fresh `act` case and settles with the finding resolved `carried`, and `appendCarriedRemediationCaseSources` leaves that case's prior sources, disposition, resolution and effect byte-identical apart from the appended link." | diff-local |
| Story 1 negative: Given the adjudication is replayed after a crash between binding and settlement, when the lap resumes, then the finding is carried exactly once and no effect is reserved or charged. | 5 | "[test] Re-running the coordinator after a crash that followed both the link append and the carry event emission but preceded settlement appends no duplicate link, reserves no effect, charges nothing, and across both runs emits and persists to `.pipeline/events.jsonl` through the existing event persister exactly one `build_review_disposition_carried` event naming feature, lapId, findingId, caseId, originFindingId and originLapId per carried finding, while a lap with no carried finding emits none." | diff-local |
| Story 2 happy: Given an open escalate case whose sources are all operator-accepted, when a later lap's re-raised finding is bound to it as `escalate`, then the finding settles as carried and the lap does not halt with `decision stop conflicting-case-id`. | 7 | "[test] An `escalate` binding to an open escalate case whose sources are all operator-accepted settles carried and the coordinator result is not `decision stop conflicting-case-id`." | diff-local |
| Story 2 happy: Given a resolved case holding an operator-accepted source, when a later lap's re-raised finding is bound to it as `escalate` with source ids that differ from the case's, then no new open escalate case is created and the finding settles as carried. | 7 | "[test] An `escalate` binding to a resolved case holding an operator-accepted source with differing source ids settles carried and the case store afterward holds no new open escalate case." | diff-local |
| Story 2 negative: Given an escalate case with no operator-accepted source, when a later lap binds a finding to it as `escalate`, then the decision stop is created or refused exactly as it is today, including `conflicting-case-id`. | 7 | "[test] In a lap with one carried escalation and one unbound escalation, the unbound escalation still produces its decision stop, and an escalation bound to a case holding no operator-accepted source returns today's `conflicting-case-id` or new decision stop exactly." | diff-local |
| Story 2 negative: Given an escalation bound to an accepted case, when the lap settles, then no external effect is performed, no intake issue is filed, and no kickback is charged. | 7 | "[test] A carried escalation performs no external effect, files no intake issue and charges no kickback, and `authorizeBuildReviewRemediationActionEffects` still authorizes an admitted sibling `act` on the same case-v2 lap." | diff-local |
| Story 2 negative: Given a lap in which one escalation is bound to an accepted case and another escalation is unbound, when it settles, then the unbound escalation still produces its decision stop. | 7 | "[test] In a lap with one carried escalation and one unbound escalation, the unbound escalation still produces its decision stop, and an escalation bound to a case holding no operator-accepted source returns today's `conflicting-case-id` or new decision stop exactly." | diff-local |
| Story 3 happy: Given an accepted case, when a later lap raises a finding the adjudicator does not bind to any case, then the finding is unresolved and routes exactly as it does today. | 6 | "[test] A finding bound to no case, including one matching an accepted finding's rubric, path and summary, stays unresolved and receives exactly the route today's coordinator returns for it, and a binding to a case holding no operator-accepted source returns today's route for each of the `act`, `escalate` and `reject` dispositions." | diff-local |
| Story 3 happy: Given a case that holds no operator-accepted source, when a later lap binds a finding to it, then the finding is not carried and today's reuse, repeat and regression rules apply. | 6 | "[test] A finding bound to no case, including one matching an accepted finding's rubric, path and summary, stays unresolved and receives exactly the route today's coordinator returns for it, and a binding to a case holding no operator-accepted source returns today's route for each of the `act`, `escalate` and `reject` dispositions." | diff-local |
| Story 3 happy: Given an infrastructure failure on a lap that also carries a finding, when the lap settles, then the infrastructure result still blocks until it heals or has an exact reduced-coverage decision. | 6 | "[test] On a mixed lap whose infrastructure member failed and whose only content finding is carried, the infrastructure result still blocks until it heals or has an exact reduced-coverage disposition." | diff-local |
| Story 3 negative: Given a lap where the operator accepts one finding of a case and leaves a second finding of the same case unaccepted, when that lap settles, then the second finding is not carried and still blocks. | 6 | "[test] When the operator accepts one finding of a case during a lap and the judge placed a second finding of that lap in the same case, the coordinator does not carry the second finding and returns today's blocking route for it." | diff-local |
| Story 3 negative: Given an acceptance recorded while the same lap's adjudication is still running, when that lap binds another finding to the accepted case, then that finding is not carried. | 6 | "[test] When an acceptance is recorded while the same lap's adjudication is running and that lap binds another finding to the accepted case, the coordinator does not carry that finding, because the current lap id equals the origin `sourceLapId`." | diff-local |
| Story 3 negative: Given a source linked to an accepted case before the origin acceptance time, when any later read resolves accepted risk, then that source is not reported as carried. | 1 | "[test] The resolver returns `none` for a link recorded in the same reconciliation as the accepted source, for a link recorded before the origin `acceptedAt`, for a link on a case holding no directly accepted source, and for any finding when the only disposition carries a different feature identity." | diff-local |
| Story 3 negative: Given a current finding whose exact id matches no disposition and which the adjudicator does not bind, when it resembles an accepted finding by rubric, path or summary, then it is not suppressed. | 6 | "[test] A finding bound to no case, including one matching an accepted finding's rubric, path and summary, stays unresolved and receives exactly the route today's coordinator returns for it, and a binding to a case holding no operator-accepted source returns today's route for each of the `act`, `escalate` and `reject` dispositions." | diff-local |
| Story 4 happy: Given an accepted case on feature A, when feature B's lap raises a finding with the same substance, then feature B's finding is not carried. | 1 | "[test] The resolver returns `none` for a link recorded in the same reconciliation as the accepted source, for a link recorded before the origin `acceptedAt`, for a link on a case holding no directly accepted source, and for any finding when the only disposition carries a different feature identity." | diff-local |
| Story 4 happy: Given a stacked child feature, when its lap binds a finding to one of its own accepted cases, then the finding is carried using the child's case store and the feature's disposition store, as the coordinator already pairs them. | 3 | "[test] For a stacked child the effective verdict resolves carry against that child's case store paired with the feature disposition store, and a finding bound only by a case id present in a sibling child's store resolves `none`." | diff-local |
| Story 4 negative: Given a disposition record whose feature identity differs from the current feature, when accepted risk is resolved, then it neither accepts nor carries any finding. | 1 | "[test] The resolver returns `none` for a link recorded in the same reconciliation as the accepted source, for a link recorded before the origin `acceptedAt`, for a link on a case holding no directly accepted source, and for any finding when the only disposition carries a different feature identity." | diff-local |
| Story 4 negative: Given a stacked child whose sibling child holds an accepted case, when the child binds a finding by a case id that exists only in the sibling, then the binding is not resolved against the sibling's case and nothing is carried. | 3 | "[test] For a stacked child the effective verdict resolves carry against that child's case store paired with the feature disposition store, and a finding bound only by a case id present in a sibling child's store resolves `none`." | diff-local |
| Story 5 happy: Given a prior case holding an operator-accepted source, when the adjudication context is assembled, then that case carries an operator-accepted marker naming the origin finding ids and lap. | 4 | "[test] `assembleBuildReviewAdjudicationContext` projects `operatorAccepted` with origin finding ids and origin lap ids on each prior case holding a directly accepted source and projects no such field on a case without one, as asserted in `build-review-adjudication-context.test.ts`." | diff-local |
| Story 5 happy: Given the `remediate` skill contract, when it describes prior cases, then it states that a binding to an operator-accepted case is judged by substance and that the adjudicator never asserts or creates acceptance. | 10 | "[test] `remediate-skill-contract.test.ts` asserts `skills/remediate/SKILL.md` permits binding a current finding of the same substance to a prior case marked `operatorAccepted` through `existingCaseId`." | diff-local |
| Story 5 negative: Given a prior case with no operator-accepted source, when the context is assembled, then it carries no operator-accepted marker. | 4 | "[test] `assembleBuildReviewAdjudicationContext` projects `operatorAccepted` with origin finding ids and origin lap ids on each prior case holding a directly accepted source and projects no such field on a case without one, as asserted in `build-review-adjudication-context.test.ts`." | diff-local |
| Story 5 negative: Given an operator-accepted case, when the context is assembled, then the operator's rationale and username are absent from the context. | 4 | "[test] The serialized context contains neither the operator username nor the rationale of any disposition record." | diff-local |
| Story 5 negative: Given an accepted case marker, when the context is assembled near its byte ceiling, then the existing overflow rule applies unchanged and no case is truncated. | 4 | "[test] A context fixture over its byte ceiling that includes accepted cases returns the existing overflow stop, and in a context that fits every prior case is projected in full with no case omitted and no case field, including its `operatorAccepted` marker, truncated." | diff-local |
| Story 6 happy: Given a carried finding, when `conduct build-review findings --feature <slug>` runs, then the finding is listed as carried, with its origin finding id, origin lap, operator and rationale. | 8 | "[test] `conduct build-review findings --feature <slug>` text output lists a carried finding as carried with its origin finding id, origin lap, operator and rationale, as asserted in `build-review-cli.test.ts`." | diff-local |
| Story 6 happy: Given a carried finding, when `conduct build-review findings --feature <slug> --json` runs, then the record carries the same origin fields in machine-readable form. | 8 | "[test] The `--json` output record for that finding carries `carried.originFindingId`, `carried.originLapId`, `carried.operator` and `carried.rationale`." | diff-local |
| Story 6 happy: Given a feature with carried findings, when finish publication or the shipped record renders the accepted-risk section, then each carried finding is listed with its id, rubric, and carried-from origin finding id and lap. | 9 | "[test] `renderBuildReviewAcceptedRisk` lists each carried finding with its id, rubric, and `carried from <origin finding id> (lap <origin lap>)`, and finish publication and the shipped-record writer pass carried rows resolved by `resolveBuildReviewAcceptance`." | diff-local |
| Story 6 negative: Given a carried finding, when the PR accepted-risk section is rendered, then the operator username and rationale do not appear in it. | 9 | "[test] The rendered accepted-risk section contains neither the operator username nor the rationale for any carried row." | diff-local |
| Story 6 negative: Given a case store that cannot be read when the PR section is rendered, when publication runs, then directly accepted findings are still rendered, no carried row is fabricated, and the unreadable state is reported rather than silently dropped. | 9 | "[test] With an unreadable case store, publication renders every direct row, renders no carried row, and includes the line `Carried acceptance unavailable: remediation case state unreadable`." | diff-local |
| Story 6 negative: Given a source linked to an accepted case before the origin acceptance, when the findings output or PR section is rendered, then that source is not listed as carried. | 8, 9 | "[test] A source linked to an accepted case before the origin acceptance is not listed as carried in either output." | diff-local |
| Story 7 happy: Given a finding carried on a lap, when the lap settles, then exactly one `build_review_disposition_carried` event is persisted naming the feature, lap, finding, case, origin finding and origin lap. | 5 | "[test] Re-running the coordinator after a crash that followed both the link append and the carry event emission but preceded settlement appends no duplicate link, reserves no effect, charges nothing, and across both runs emits and persists to `.pipeline/events.jsonl` through the existing event persister exactly one `build_review_disposition_carried` event naming feature, lapId, findingId, caseId, originFindingId and originLapId per carried finding, while a lap with no carried finding emits none." | diff-local |
| Story 7 happy: Given the event union, when sink registration is checked, then `build_review_disposition_carried` is declared in every event sink. | 2 | "[test] `event-sinks.test.ts` asserts `EVENT_SINKS` declares `build_review_disposition_carried` with `persist: true` and `audit: true`, so every sink registration covers the new variant." | diff-local |
| Story 7 negative: Given a lap with no carried finding, when it settles, then no `build_review_disposition_carried` event is emitted. | 5 | "[test] Re-running the coordinator after a crash that followed both the link append and the carry event emission but preceded settlement appends no duplicate link, reserves no effect, charges nothing, and across both runs emits and persists to `.pipeline/events.jsonl` through the existing event persister exactly one `build_review_disposition_carried` event naming feature, lapId, findingId, caseId, originFindingId and originLapId per carried finding, while a lap with no carried finding emits none." | diff-local |
| Story 7 negative: Given a lap resumed after a crash that already emitted a carry event, when it settles again, then no duplicate carry event is emitted for the same lap, finding and case. | 5 | "[test] Re-running the coordinator after a crash that followed both the link append and the carry event emission but preceded settlement appends no duplicate link, reserves no effect, charges nothing, and across both runs emits and persists to `.pipeline/events.jsonl` through the existing event persister exactly one `build_review_disposition_carried` event naming feature, lapId, findingId, caseId, originFindingId and originLapId per carried finding, while a lap with no carried finding emits none." | diff-local |
| Story 8 happy: Given a carried finding, when the effective verdict, the coordinator's accepted set, the reuse classification, the decision-stop path, the adjudication context, the findings output and the accepted-risk renderer each evaluate it, then all seven report the same carried state and the same origin. | 11 | "[test] Against one shared fixture, the effective verdict, the coordinator accepted set, the reuse partition, the decision-stop partition, the adjudication context, the findings output and the accepted-risk renderer each report the same finding as carried with the same origin finding id and lap, and a consumer that disagrees fails the test with a message naming that consumer." | diff-local |
| Story 8 happy: Given the origin disposition record is removed from the feature's disposition store, when the next lap resolves accepted risk, then no finding is carried from it. | 1 | "[test] A case-store read failure or malformed case store yields `none` for every finding without an exact disposition while exact dispositions still resolve `direct`, a disposition-store read failure or malformed disposition store returns the existing fail-closed failure unchanged with nothing carried, and removing the origin disposition record makes every link carried from it resolve `none`." | diff-local |
| Story 8 negative: Given a case store that is unreadable or malformed, when accepted risk is resolved, then no finding is carried, directly accepted findings still resolve, and the gate takes today's path for every other finding. | 1, 3 | "[test] A case-store read failure or malformed case store yields `none` for every finding without an exact disposition while exact dispositions still resolve `direct`, a disposition-store read failure or malformed disposition store returns the existing fail-closed failure unchanged with nothing carried, and removing the origin disposition record makes every link carried from it resolve `none`." | diff-local |
| Story 8 negative: Given a disposition store that is unreadable or malformed, when accepted risk is resolved, then the existing fail-closed behavior is unchanged and nothing is carried. | 1 | "[test] A case-store read failure or malformed case store yields `none` for every finding without an exact disposition while exact dispositions still resolve `direct`, a disposition-store read failure or malformed disposition store returns the existing fail-closed failure unchanged with nothing carried, and removing the origin disposition record makes every link carried from it resolve `none`." | diff-local |
| Story 8 negative: Given a production consumer that matches dispositions directly instead of through the shared resolution, when the test suite runs, then a test fails naming that consumer. | 11 | "[test] Against one shared fixture, the effective verdict, the coordinator accepted set, the reuse partition, the decision-stop partition, the adjudication context, the findings output and the accepted-risk renderer each report the same finding as carried with the same origin finding id and lap, and a consumer that disagrees fails the test with a message naming that consumer." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | no-change | none | Rubric fan-out, the raw join and the mechanical lane are untouched; carry is decided only after the raw aggregate exists. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | task | task-5 | settles with the finding resolved `carried` in the coordinator's operator-resolved set |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | task | task-4 | projects `operatorAccepted` with origin finding ids and origin lap ids on each prior case holding a directly accepted source |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | no-change | none | The case-v1/case-v2 artifact schema, source outcome vocabulary and validator are unchanged; carry adds no outcome and no case row field. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-5 | `appendCarriedRemediationCaseSources` leaves that case's prior sources, disposition, resolution and effect byte-identical apart from the appended link |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | task | task-5 | appends no duplicate link, reserves no effect, charges nothing |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-5 | no reserved effect, no published work order and no kickback ledger increment |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | task | task-3 | derives effective PASS with that id in `acceptedFindingIds` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-2 | asserts `EVENT_SINKS` declares `build_review_disposition_carried` with `persist: true` and `audit: true` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | task | task-3 | With `build_review.adjudication.enabled: false` the effective verdict does not open the case store and resolves only exact dispositions. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D1 | no-change | none | Finding identity derivation is unchanged; custom-identity stabilization is excluded by the track scope boundary. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D2 | task | task-3 | resolves accepted risk through `resolveBuildReviewAcceptance` |
| adr-2026-08-13-stable-build-review-finding-dispositions#D3 | no-change | none | The resolver is a pure read over already-read records and writes no disposition state, so the existing lock and atomic-write transaction is unchanged. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D4 | task | task-8 | text output lists a carried finding as carried with its origin finding id, origin lap, operator and rationale |
| adr-2026-08-13-stable-build-review-finding-dispositions#D5 | no-change | none | `build-review accept` and its external-process closeout events are unchanged; the carry event is emitted in-process by the coordinator through the existing emitter. |
| adr-2026-08-13-stable-build-review-finding-dispositions#D6 | task | task-9 | lists each carried finding with its id, rubric, and `carried from <origin finding id> (lap <origin lap>)` |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | task | task-6 | the infrastructure result still blocks until it heals or has an exact reduced-coverage disposition |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | Still one `remediate` dispatch per lap; carry is decided by the coordinator from that dispatch's existing `existingCaseId` binding. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-5 | an `act` binding to a case holding no operator-accepted source still returns today's `halt-regression` or `halt-repeat` result |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Grader-confidence suppression and the operator floor are untouched; suppressed findings never reach the carry partition. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | existing | none | Exact-id recurrence of a settled source is already excluded from dispatch by `finalizedBuildReviewSourceIds` in the coordinator; carry does not alter that path. |
| adr-2026-09-10-portable-build-review-policy#D1 | no-change | none | Custom rubric declaration and execution configuration are not touched. |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | Installed-catalog skill resolution is not touched. |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | Policy bundle binding is not touched. |
| adr-2026-09-10-portable-build-review-policy#D4 | no-change | none | The installed-policy contract is not touched. |
| adr-2026-09-10-portable-build-review-policy#D5 | no-change | none | Frozen review access for custom laps is not touched. |
| adr-2026-09-10-portable-build-review-policy#D6 | no-change | none | Policy-dependent cache operations are not touched. |
| adr-2026-09-10-portable-build-review-policy#D7 | no-change | none | Custom result identity is not touched; its lap-to-lap drift is the cause this feature tolerates, and stabilizing it is out of scope. |
| adr-2026-09-10-portable-build-review-policy#D8 | task | task-4 | projects `operatorAccepted` with origin finding ids and origin lap ids |
| adr-2026-09-10-portable-build-review-policy#D9 | task | task-7 | settles carried and the coordinator result is not `decision stop conflicting-case-id` |
| adr-2026-09-10-portable-build-review-policy#D10 | existing | none | Attended and daemon execution already reach adjudication only through the shared review-outcome operation in `build-review-outcome.ts`, the sole production caller of `coordinateBuildReviewAdjudication`, which is the only place carry is decided. |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-5 | no reserved effect, no published work order and no kickback ledger increment |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-2 | declares `build_review_disposition_carried` with fields `feature`, `lapId`, `findingId`, `caseId`, `originFindingId` and `originLapId` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-5a: build-review-adjudication-coordinator.test.ts: an act binding to an accepted case with an applied effect settles carried, with no halt event or detail, no reserved effect, no work order and no kickback charge
**Gate:** prd-audit
**Rationale:** The carry exclusion is in the coordinator, but task 5's required coordinator test is missing. The test-file diff changed only the Covers header (verified, 95%). This is missing test coverage inside an approved task.
**Criterion:** S1.1
**Parent task:** 5
**Done when:**
- [test] S1.1 is satisfied by this task.
- The repair for task rem-prd-audit-5a is committed and its targeted tests pass.

### Task rem-prd-audit-5b: build-review-adjudication-coordinator.test.ts: an act binding to an accepted case whose effect was retired as failed keeps the binding, mints no fresh act case and settles carried; the case is byte-identical apart from the appended link
**Gate:** prd-audit
**Rationale:** Only the append helper has a test. Task 5's coordinator-level test for a failed-effect accepted case is missing.
**Criterion:** S1.2
**Parent task:** 5
**Done when:**
- [test] S1.2 is satisfied by this task.
- The repair for task rem-prd-audit-5b is committed and its targeted tests pass.

### Task rem-prd-audit-6a: build-review-adjudication-coordinator.test.ts: a lap-3 re-raise bound to a case already holding the lap-2 carried link settles carried, naming the lap-1 origin finding and lap
**Gate:** prd-audit
**Rationale:** Task 6's lap-3 coordinator test is absent. The coordinator derives origins from its own map (directOriginsBySourceId, line 676), not the shared resolver. Tests and the resolver consolidation for as-built finding 2 should land together.
**Criterion:** S1.4
**Parent task:** 6
**Done when:**
- [test] S1.4 is satisfied by this task.
- The repair for task rem-prd-audit-6a is committed and its targeted tests pass.

### Task rem-prd-audit-12a: build-review-adjudication-coordinator.test.ts: a lap-2 act halt-regression appends live sources through appendCarriedRemediationCaseSources, leaves the case's disposition, resolution, effect and earlier links byte-identical, reserves no effect, and leaves the halt detail and event unchanged
**Gate:** prd-audit
**Rationale:** The halt-path append exists at coordinator:812, but both of task 12's tests are missing.
**Criterion:** S1.5
**Parent task:** 12
**Done when:**
- [test] S1.5 is satisfied by this task.
- The repair for task rem-prd-audit-12a is committed and its targeted tests pass.

### Task rem-prd-audit-12b: build-review-adjudication-coordinator.test.ts: after the operator accepts the lap-2 finding, a lap-3 re-raise bound to the same case settles carried from the lap-2 finding, with no halt, effect or charge
**Gate:** prd-audit
**Rationale:** The halt-path append exists at coordinator:812, but both of task 12's tests are missing.
**Criterion:** S1.5
**Parent task:** 12
**Done when:**
- [test] S1.5 is satisfied by this task.
- The repair for task rem-prd-audit-12b is committed and its targeted tests pass.

### Task rem-prd-audit-5c: conductor-build-review-adjudication.test.ts: replay #3211 (accepted eventSpine finding on lap 1, re-raised under a new id on lap 2 and bound to the accepted case); lap 2 settles PASS, writes no HALT file and needs no second accept
**Gate:** prd-audit
**Rationale:** Task 5 requires a conductor-level replay test of #3211. None exists.
**Criterion:** S1.6
**Parent task:** 5
**Done when:**
- [test] S1.6 is satisfied by this task.
- The repair for task rem-prd-audit-5c is committed and its targeted tests pass.

### Task rem-prd-audit-5d: build-review-adjudication-coordinator.test.ts: a mixed lap settles the carried finding while the unbound act gets today's work order and a single kickback charge; an act binding to a case with no accepted source still returns halt-regression or halt-repeat
**Gate:** prd-audit
**Rationale:** Task 5's mixed-lap and no-accepted-source regression tests are missing.
**Criterion:** S1.7
**Parent task:** 5
**Done when:**
- [test] S1.7 is satisfied by this task.
- The repair for task rem-prd-audit-5d is committed and its targeted tests pass.

### Task rem-prd-audit-5e: remediation-case-reconciler.ts and build-review-adjudication-coordinator.ts: treat carried case ids as referenced, so reconcileRemediationCases never flips their resolution in the same lap; add a coordinator test asserting carried open act and non-act cases keep their resolution
**Gate:** prd-audit
**Rationale:** Likely defect, at the audit's 70% confidence. Carried cases are removed from ordinaryCases, so reconcileRemediationCases may resolve them as unreferenced open cases. This violates task 5's 'byte-identical apart from the appended link' requirement. The fix is conforming implementation plus a test.
**Criterion:** S1.8
**Parent task:** 5
**Done when:**
- [test] S1.8 is satisfied by this task.
- The repair for task rem-prd-audit-5e is committed and its targeted tests pass.

### Task rem-prd-audit-5f: build-review-adjudication-coordinator.test.ts: re-running after a crash that followed the append and the emission but preceded settlement appends no duplicate link, reserves no effect and charges nothing
**Gate:** prd-audit
**Rationale:** Task 5's crash-replay test is missing. It belongs with the crash-safe emission fix for as-built finding 3.
**Criterion:** S1.9
**Parent task:** 5
**Done when:**
- [test] S1.9 is satisfied by this task.
- The repair for task rem-prd-audit-5f is committed and its targeted tests pass.

### Task rem-prd-audit-7a: build-review-adjudication-coordinator.test.ts: an escalate binding to an open escalate case whose sources are all operator-accepted settles carried and does not return decision stop conflicting-case-id
**Gate:** prd-audit
**Rationale:** Task 7's escalate-carry tests are absent; only the Covers header was added.
**Criterion:** S2.1
**Parent task:** 7
**Done when:**
- [test] S2.1 is satisfied by this task.
- The repair for task rem-prd-audit-7a is committed and its targeted tests pass.

### Task rem-prd-audit-7b: build-review-adjudication-coordinator.test.ts: an escalate binding to a resolved accepted case with differing source ids settles carried, and the store afterward holds no new open escalate case
**Gate:** prd-audit
**Rationale:** Missing task 7 test.
**Criterion:** S2.2
**Parent task:** 7
**Done when:**
- [test] S2.2 is satisfied by this task.
- The repair for task rem-prd-audit-7b is committed and its targeted tests pass.

### Task rem-prd-audit-7c: build-review-adjudication-coordinator.test.ts: a carried escalation performs no external effect, files no intake issue and charges no kickback, while authorizeBuildReviewRemediationActionEffects still authorizes an admitted sibling act on the same case-v2 lap
**Gate:** prd-audit
**Rationale:** Missing task 7 test.
**Criterion:** S2.4
**Parent task:** 7
**Done when:**
- [test] S2.4 is satisfied by this task.
- The repair for task rem-prd-audit-7c is committed and its targeted tests pass.

### Task rem-prd-audit-7d: build-review-adjudication-coordinator.test.ts: with one carried and one unbound escalation, the unbound escalation still produces its decision stop; an escalation bound to a case with no accepted source returns today's conflicting-case-id or new decision stop
**Gate:** prd-audit
**Rationale:** Missing task 7 test.
**Criterion:** S2.5
**Parent task:** 7
**Done when:**
- [test] S2.5 is satisfied by this task.
- The repair for task rem-prd-audit-7d is committed and its targeted tests pass.

### Task rem-prd-audit-5g: build-review-adjudication-coordinator.test.ts: exactly one build_review_disposition_carried event per carried finding (feature, lapId, findingId, caseId, originFindingId, originLapId) is persisted to .pipeline/events.jsonl through the existing EventPersister across crash and replay; a lap with no carried finding emits none
**Gate:** prd-audit
**Rationale:** The emission exists at coordinator:732, but task 5's event-persistence assertion is missing.
**Criterion:** S7.1
**Parent task:** 5
**Done when:**
- [test] S7.1 is satisfied by this task.
- The repair for task rem-prd-audit-5g is committed and its targeted tests pass.

### Task rem-prd-audit-11a: build-review-acceptance-consumers.test.ts: a shared-fixture parity test across the effective verdict, coordinator accepted set, reuse partition, decision-stop partition, adjudication context, findings output and accepted-risk renderer; on disagreement it fails naming the consumer
**Gate:** prd-audit
**Rationale:** Task 11's parity test across the seven consumers is missing; only the static guard exists.
**Criterion:** S8.1
**Parent task:** 11
**Done when:**
- [test] S8.1 is satisfied by this task.
- The repair for task rem-prd-audit-11a is committed and its targeted tests pass.

### Task rem-as-built-3a: step-runners.ts (~3656, ~4394) and artifacts.ts (~3869, ~3977): pass child and adjudicationEnabled to resolveEffectiveBuildReviewVerdict; add tests that a child carry is accepted by both the conductor and the artifact predicate, and that adjudication disabled never opens the case store
**Gate:** as-built
**Rationale:** Partial wiring of an approved task, with no architecture change needed. The step-runners.ts and artifacts.ts resolver call sites do not pass child or adjudicationEnabled. The call sites were verified at artifacts.ts:3869/3977 and in step-runners.ts. Task 3 requires child-store resolution and that adjudication-disabled runs skip the case store.
**Parent task:** 3
**Governing clause:** Task 3
**Done when:**
- Task 3 is satisfied by this task.
- The repair for task rem-as-built-3a is committed and its targeted tests pass.

### Task rem-as-built-6b: build-review-acceptance-resolver.ts: add the current lapId input and resolve none when it equals the origin sourceLapId; build-review-adjudication-coordinator.ts: replace the independent directOriginsBySourceId carry classification and the post-halt acceptance refresh with resolveBuildReviewAcceptance
**Gate:** as-built
**Rationale:** The ADR decision 2 amendment is approved and authoritative, and the code drifts from it. Verified: resolveBuildReviewAcceptance takes no lap and checks only timestamps, and the coordinator reimplements origin and lap exclusion (lines 676-699). The conforming fix is to give the shared resolver the accepting-lap exclusion and route the coordinator's carry classification and post-halt refresh through it. Tasks 6 and 11 admit this. No new architectural decision is needed.
**Governing clause:** adr-2026-08-13-stable-build-review-finding-dispositions decision 2
**Done when:**
- adr-2026-08-13-stable-build-review-finding-dispositions decision 2 is satisfied by this task.
- The repair for task rem-as-built-6b is committed and its targeted tests pass.

### Task rem-as-built-6c: build-review-adjudication-coordinator.test.ts: a same-lap finding appended on the repeat/regression path and then refreshed is not classified carried and keeps today's blocking route; a second finding the judge placed in a case accepted during the same lap is not carried
**Gate:** as-built
**Rationale:** The ADR decision 2 amendment is approved and authoritative, and the code drifts from it. Verified: resolveBuildReviewAcceptance takes no lap and checks only timestamps, and the coordinator reimplements origin and lap exclusion (lines 676-699). The conforming fix is to give the shared resolver the accepting-lap exclusion and route the coordinator's carry classification and post-halt refresh through it. Tasks 6 and 11 admit this. No new architectural decision is needed.
**Governing clause:** adr-2026-08-13-stable-build-review-finding-dispositions decision 2
**Done when:**
- adr-2026-08-13-stable-build-review-finding-dispositions decision 2 is satisfied by this task.
- The repair for task rem-as-built-6c is committed and its targeted tests pass.

### Task rem-as-built-5h: build-review-adjudication-coordinator.ts: emit build_review_disposition_carried for every carried finding in the lap that has no persisted event (dedup by lapId, findingId, caseId), not only for newly appended links
**Gate:** as-built
**Rationale:** The event requirement is already approved, and the fix is within the coordinator under task 5. Today the event is emitted only for newly appended links, so a crash between the append (line 722) and the emission loses the event. Fix it so every carried link whose event is absent from the spine is emitted at settlement, with dedup by (lapId, findingId, caseId). This matches task 5's exactly-once requirement through the existing persister.
**Governing clause:** adr-2026-08-13-stable-build-review-finding-dispositions decision 2
**Done when:**
- adr-2026-08-13-stable-build-review-finding-dispositions decision 2 is satisfied by this task.
- The repair for task rem-as-built-5h is committed and its targeted tests pass.

### Task rem-as-built-5i: build-review-adjudication-coordinator.test.ts: a crash after the link append but before emission still yields exactly one persisted carried event on replay, with no duplicate link, effect or charge
**Gate:** as-built
**Rationale:** The event requirement is already approved, and the fix is within the coordinator under task 5. Today the event is emitted only for newly appended links, so a crash between the append (line 722) and the emission loses the event. Fix it so every carried link whose event is absent from the spine is emitted at settlement, with dedup by (lapId, findingId, caseId). This matches task 5's exactly-once requirement through the existing persister.
**Governing clause:** adr-2026-08-13-stable-build-review-finding-dispositions decision 2
**Done when:**
- adr-2026-08-13-stable-build-review-finding-dispositions decision 2 is satisfied by this task.
- The repair for task rem-as-built-5i is committed and its targeted tests pass.
