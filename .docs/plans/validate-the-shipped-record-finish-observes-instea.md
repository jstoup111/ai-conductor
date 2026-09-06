# Implementation Plan: Validate the shipped record FINISH observes

**Date:** 2026-09-06
**Stories:** .docs/stories/validate-the-shipped-record-finish-observes-instea.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing publication contract — the evidence union, its mapping, the invalid-record reason token, and the three coordinator branches that consume it are all unchanged, and only the production observation that feeds them is widened.

## Summary

Four bounded tasks deliver #1647 by replacing FINISH's existence-only shipped-record observation with one that resolves the writer's canonical shipment identity and judges the record's own recorded slug and spec hash, so the invalid-record disposition already written in the coordinator becomes reachable. Record format, the strict premerge verifier, backlog dedup, and the duplicate-record-commit defect are outside this slice.

## Technical Approach

Add one focused module, `shipped-record-validity.ts`, in the engine directory alongside the writer and the strict verifier. It carries two exported seams. The first is a pure classifier that takes a record body, the expected slug, and the expected spec digest, and returns `malformed` (the body has no closed frontmatter block, or omits its slug or hash), `stale` (a recorded slug or hash that disagrees), or `present`. The second is the filesystem-backed observation: it lists the plan filenames under the project's plans directory, resolves the shipment identity with `resolveShipmentIdentity`, reads the record at the resolved record path, reads the plan bytes and the stories bytes, computes the expected digest with `specHash`, and hands both to the classifier.

Compose, never re-derive. `resolveShipmentIdentity`, `parseShippedRecord`, `parseStoriesReference`, and `specHash` are the same functions the record writer and the strict premerge verifier already call, and the approved fail-closed shipment-evidence decision explicitly rejects a second verifier implementation as policy drift at this seam. The one extraction this requires is the writer's private stories-bytes resolver in `shipped-record-cli.ts`: lift it into the new module as an exported helper taking the project root, the canonical slug, and the plan content, and have the writer call it, so a stories reference can never resolve one way for the writer and another for the observer.

Degrade in exactly two directions, both deliberately. When the identity cannot be resolved — no plans directory, no matching plan, or more than one date-prefixed candidate — the observation falls back to today's behavior: presence or absence of the file at the undated record path, and never `stale` or `malformed`. That keeps a project with no plan artifact, and every existing fixture that has none, on the path it is on now. When a read fails for any reason other than absence, the observation returns `unavailable`, which the existing mapping turns into an indeterminate dimension rather than into either completion or a halt; a transient filesystem fault must not manufacture a human-required stop.

`present` here stays an observation, not a terminal verdict. This boundary reads the working tree and compares slug and hash only. `evaluateShipmentEvidence` — which additionally binds the record's PR, its presence in the candidate commit, and that commit's reachability from the implementation head — remains the authority for terminal ship state at the finish recorder, the completion predicate, and the merged-PR guard, and is not touched. Nothing downstream of the observation changes: the evidence union already carries `stale` and `malformed`, `mapOptionalEvidence` already maps both to `invalid`, the reason token already has its human-required rendering entry, and the three coordinator branches that return it are already covered by existing tests.

Wiring is one edit. The adapter's `shippedRecord` port becomes a delegation to the new observation, keyed on the same `state.feature_desc` and project root it uses today; the port's signature, its position in the observation input, and the snapshot assembly are unchanged.

Two local test patterns apply. Pure classification and identity/degradation cases belong at unit level against the new module's exported seams, with a real temporary directory only where the filesystem is itself the boundary under test. The production observation proof follows the existing convention in the FINISH production adapter's test file: build a temporary project root, construct the coordinator with injected git and GitHub runners that return canned JSON, and observe the snapshot the coordinator receives — the file already mocks `advanceFinishPublication` to capture a snapshot for exactly this purpose, and separately drives the real coordinator to assert a disposition. Reuse whichever of the two the assertion needs; a test may vary its fixture builders and assertion grouping as long as it proves the observation at that adapter boundary. No conductor lifecycle run, no real process, and no network call belongs in any of these tests. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the compose-from-existing-blocks approach, and both stories on 2026-09-06 (delegated).
- Verified: the production observer at `finish-publication-production.ts:471-475` is a bare `exists` check on the undated record path returning only `present` or `missing`.
- Verified: `finish-publication.ts:111-116` defines the observation union including `stale` and `malformed`, and documents `present` as found *and verified*.
- Verified: `mapOptionalEvidence` at `finish-publication.ts:241-256` maps `stale` and `malformed` to `invalid`, and the `invalid_shipped_record` human-required branches at `finish-publication.ts:1733`, `:1768`, and `:1787` consume it.
- Verified: `invalid_shipped_record` already has its rendering entry at `finish-publication.ts:544`, so no reason token, union, or rendering change is required.
- Verified: `resolveShipmentIdentity` at `shipment-identity.ts:27-41` accepts an exact stem or exactly one `YYYY-MM-DD`-prefixed match and returns `resolved`, `missing`, or `ambiguous` with the canonical record path.
- Verified: the writer at `shipped-record-cli.ts:118-140` resolves that identity and writes at `identity.recordPath`, while the observer keys on the raw feature description — the two disagree for every date-prefixed plan, and 66 of the 377 plans on `origin/main` are date-prefixed.
- Verified: `parseShippedRecord` at `shipped-record.ts:335-378` never throws and returns `{ malformed: true }` for content with no closed frontmatter or a missing slug or hash; `specHash` at `shipped-record.ts:81-105` and `parseStoriesReference` at `shipped-record.ts:66-79` are exported.
- Verified: `readStoriesBytes` at `shipped-record-cli.ts:79-100` is module-private and is the writer's stories resolution — reference first, then the same-stem fallback.
- Verified: the production adapter's test file already builds a temporary project root with injected git and GitHub runners and captures the observed snapshot through a mocked `advanceFinishPublication`.
- Verified: no acceptance fixture that commits a placeholder record body also creates a plan for that feature, so the unresolvable-identity fallback keeps those fixtures on their current path.
- Verified by repository-wide sweep of the decision records: no approved decision confines record validity to CI or to the strict verifier alone, none is contradicted, and none needs amending; the fail-closed shipment-evidence decision requires strict engine-side validation at this boundary and forbids a second verifier implementation.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no new event, metric, span, log line, or report — this feature only widens what an existing observation port can return.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Classify a record against its shipment's spec identity
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/shipped-record-validity.ts, src/conductor/test/engine/shipped-record-validity.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests for the classifier: a body with no closed frontmatter block, a body whose frontmatter omits the slug, a body whose frontmatter omits the spec hash, a record naming a different feature's slug, a record whose hash differs from the expected digest, and a record where slug and hash both agree.
2. Verify the tests fail (RED).
3. Implement the classifier as a pure function taking the record body, the expected slug, and the expected digest. Delegate parsing to the existing `parseShippedRecord` rather than re-reading frontmatter; return `malformed` for its malformed sentinel, `stale` for a slug or hash disagreement, and `present` only when both agree.
4. Verify the tests pass (GREEN), run the scoped test for this file, and commit the focused change.

**Done when:**
1. The classifier returns malformed for a body with no closed frontmatter block and for a body whose frontmatter omits either the slug or the spec hash.
2. The classifier returns stale for a record whose slug names another feature and for a record whose spec hash differs from the expected digest, and returns present only when both agree.
3. The classifier reaches no filesystem, process, or network boundary: it takes the record body, the expected slug, and the expected digest as arguments and calls only the existing record parser.

### Task 2: Observe the record through the writer's own shipment identity
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/shipped-record-validity.ts, src/conductor/src/engine/shipped-record-cli.ts, src/conductor/test/engine/shipped-record-validity.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing tests over a temporary project root — the filesystem is the boundary under test here, so use a real temporary directory and clean it up: an undated feature description with exactly one date-prefixed plan and its record; a plan whose stories reference names a differently named stories file; a feature description with no matching plan; one with two date-prefixed candidates; an absent record; and a record or plan whose read fails for a reason other than absence.
2. Verify the tests fail (RED).
3. Lift the writer's private stories-bytes resolver out of the record CLI into the new module as an exported helper with the same reference-then-stem order, and have the writer call it, so both sides resolve stories through one function.
4. Implement the observation: list the plan filenames under the project's plans directory, resolve the identity with `resolveShipmentIdentity`, read the record at the resolved record path, read the plan and stories bytes, compute the expected digest with `specHash`, and hand the body, canonical slug, and digest to Task 1's classifier.
5. Implement the two degradations: an unresolved or ambiguous identity, or an unreadable plans directory, falls back to presence or absence at the undated record path and never returns stale or malformed; an absent record returns missing, and any other read failure returns unavailable.
6. Verify the tests pass (GREEN), run the scoped tests for the changed files, and commit.

**Done when:**
1. The observation resolves an undated feature description to the same record path the record writer resolves for that description when exactly one date-prefixed plan matches.
2. The observation arrives at the digest the writer commits for a plan whose stories reference names a differently named stories file, because writer and observation call one extracted stories-bytes helper.
3. With no matching plan, with two date-prefixed candidates, or with no plans directory, the observation returns present or missing from the undated record path and never returns stale or malformed.
4. An absent record returns missing, and a read failure other than absence on the record or its plan returns unavailable.

### Task 3: Wire the production FINISH observation to the validity observation
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/finish-publication-production.ts, src/conductor/test/engine/finish-publication-production.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing integration tests at the production adapter boundary, following the convention already in that test file: build a temporary project root, construct the coordinator with injected git and GitHub runners returning canned JSON, and observe the coordinator's snapshot or its returned disposition. Cover a committed record matching its resolved date-prefixed plan and stories, and a resolved shipment with no record at all.
2. Verify the tests fail (RED).
3. Replace the adapter's shipped-record port body with a delegation to Task 2's observation, keyed on the same project root and feature description it uses today. Leave the port signature, its position in the observation input, and the snapshot assembly unchanged.
4. Verify the tests pass (GREEN), run the scoped tests for the changed files, and commit.

**Done when:**
1. A production coordinator fixture whose committed record matches its resolved date-prefixed plan and stories observes the shipped-record dimension as valid, reaches the ready-PR transition, and dispatches no record write.
2. A production coordinator fixture with no record for the resolved shipment selects the write-shipped-record transition, exactly as it does before this change.
3. The adapter's shipped-record port delegates to the validity observation and keeps returning missing for a feature description with no resolvable plan and no record file.

### Task 4: Stop publication on a record that is not this shipment's
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/finish-publication-production.test.ts
**Dependencies:** 3

**Steps:**
1. Write failing integration tests at the production adapter boundary for three record shapes committed against a resolvable plan: a record naming a foreign slug, a record whose spec hash disagrees with the current plan and stories bytes, and a record whose body has no closed frontmatter block. Drive the real coordinator so the returned disposition is the assertion, and read each record file back after the call.
2. Verify the tests fail (RED) — before Task 3 they publish past the record.
3. Confirm each fixture reaches the existing human-required branch through the unchanged evidence mapping, adjusting only the fixtures, not the coordinator or the reason union.
4. Verify the tests pass (GREEN), run the scoped tests for the changed file, and commit.

**Done when:**
1. Production coordinator fixtures for a record naming a foreign slug, a record whose spec hash disagrees with the current plan and stories bytes, and a record with an unparseable body each return the human-required disposition carrying the existing invalid-shipped-record reason.
2. Each of those three fixtures leaves its record file byte-for-byte unchanged and dispatches no record write.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the feature's plan resolves and its committed record carries this feature's slug and a spec hash equal to the hash of that plan and its stories bytes, when FINISH observes the shipped-record dimension, then the record counts as valid evidence and publication continues to readying the PR without dispatching another record write. | 3 | "A production coordinator fixture whose committed record matches its resolved date-prefixed plan and stories observes the shipped-record dimension as valid, reaches the ready-PR transition, and dispatches no record write." | diff-local |
| Story 1 happy: Given no record exists for the resolved shipment, when FINISH observes the shipped-record dimension, then the record reads as missing and FINISH selects the write-shipped-record transition exactly as it does today. | 3 | "A production coordinator fixture with no record for the resolved shipment selects the write-shipped-record transition, exactly as it does before this change." | diff-local |
| Story 1 negative: Given a record whose recorded slug names a different feature, when FINISH observes the shipped-record dimension, then publication stops with the human-required invalid-record disposition instead of readying the PR. | 1, 4 | "Production coordinator fixtures for a record naming a foreign slug, a record whose spec hash disagrees with the current plan and stories bytes, and a record with an unparseable body each return the human-required disposition carrying the existing invalid-shipped-record reason." | diff-local |
| Story 1 negative: Given a record whose recorded spec hash disagrees with the hash of the feature's current plan and stories bytes, when FINISH observes the shipped-record dimension, then publication stops with the human-required invalid-record disposition and the existing record file is left byte-for-byte unchanged. | 1, 4 | "Each of those three fixtures leaves its record file byte-for-byte unchanged and dispatches no record write." | diff-local |
| Story 1 negative: Given a record whose content has no closed frontmatter block, or omits its slug or its spec hash, when FINISH observes the shipped-record dimension, then publication stops with the human-required invalid-record disposition rather than accepting the file's existence as evidence. | 1, 4 | "The classifier returns malformed for a body with no closed frontmatter block and for a body whose frontmatter omits either the slug or the spec hash." | diff-local |
| Story 2 happy: Given a feature description carrying no date prefix and exactly one date-prefixed plan matching it, when FINISH observes the shipped-record dimension, then it reads the record at the same date-prefixed path the writer commits to, so a record written moments earlier reads as valid rather than missing. | 2, 3 | "The observation resolves an undated feature description to the same record path the record writer resolves for that description when exactly one date-prefixed plan matches." | diff-local |
| Story 2 happy: Given a plan that names its stories file through a stories reference rather than by matching stem, when FINISH computes the hash the record must match, then it resolves those stories bytes in the same reference-then-stem order the record writer uses and arrives at the writer's digest. | 2 | "The observation arrives at the digest the writer commits for a plan whose stories reference names a differently named stories file, because writer and observation call one extracted stories-bytes helper." | diff-local |
| Story 2 negative: Given no plan resolves for the feature description, or more than one date-prefixed plan matches it, when FINISH observes the shipped-record dimension, then the observation reports only presence or absence at the undated record path and never reports the record invalid. | 2 | "With no matching plan, with two date-prefixed candidates, or with no plans directory, the observation returns present or missing from the undated record path and never returns stale or malformed." | diff-local |
| Story 2 negative: Given the resolved record or its plan cannot be read for any reason other than absence, when FINISH observes the shipped-record dimension, then the dimension reads indeterminate rather than valid or invalid. | 2 | "An absent record returns missing, and a read failure other than absence on the record or its plan returns unavailable." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns unit-level classification of the record body against an expected slug and digest, at the narrowest seam that proves it. Task 2 owns identity resolution, the shared stories resolution, and both degradations, over a real temporary project root because the filesystem is the boundary under test there. Task 3 owns the cross-boundary integration proof: it is the single task that proves the production FINISH adapter actually reaches the new observation, asserted through the coordinator's own observed dimension and selected transition rather than through a direct call to the helper. Task 4 owns the negative-path integration proof that an invalid observation reaches the coordinator's already-written human-required disposition. Existing coordinator tests supply the unchanged branch coverage for that disposition, and the strict premerge verifier's existing refusal matrix remains authoritative for record content beyond slug and hash; neither is duplicated. No new aggregate, external-service, or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3 -> Task 4
