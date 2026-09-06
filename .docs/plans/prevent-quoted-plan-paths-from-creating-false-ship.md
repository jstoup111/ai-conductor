# Implementation Plan: Correct shipment association for PR checks

**Date:** 2026-09-06
**Stories:** .docs/stories/prevent-quoted-plan-paths-from-creating-false-ship.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the existing durable-shipment contract: exact declared identity, implementation diff, immutable event head, and strict record verification.

## Summary

Four bounded tasks deliver #1461 through the required check and the engine publication path that supplies its declaration. Historical audit/backfill, reconciliation association policy, record format, daemon completion rules, and live-body lookup on manual reruns are outside this small slice.

## Technical Approach

Formalize the existing fixture convention: a standalone column-zero `Plan: .docs/plans/<stem>.md` line, optionally wrapping the path in a single pair of backticks. Match the entire line, allowing trailing horizontal whitespace only. Stem is one nonempty filename component ending in exactly `.md`; reject traversal, separators, whitespace, suffix text, and empty values. Only top-level declarations outside backtick/tilde fences, HTML comments, blockquotes, and indented code count. Use a small deterministic line scanner with explicit fence/comment state, including matching closing fence character and sufficient closing length; do not scan arbitrary substrings. Repeated identical declarations deduplicate; multiple distinct existing declarations retain the classifier's existing multi-match not-applicable behavior. Missing/malformed/nonexistent declarations retain zero-match not-applicable behavior. This correction does not introduce inferred binding from changed plan paths or weaken the strict verifier after binding.

Keep the new parser/upsert together in a focused shipment-plan-declaration module. Only the check branch of dispatchShipmentEvidence adopts declaration parsing; reconcile and historical audit retain their existing extraction and semantics. Continue using classifyShipmentAssociation for non-implementation exclusions and exact existing-stem matching. Before verifying a bound check, emit the canonical plan path and `basis=explicit-plan-declaration` through the existing reporter. This is an explanation of current gate state, not a new telemetry channel.

The production FINISH adapter mechanically maintains the declaration on its retained implementation PR before successful PR outcome recording and after presentation repair. Resolve state.feature_desc through the existing resolveShipmentIdentity over plan paths, matching the shipped-record writer's exact/date-prefixed rules. Upsert a single canonical declaration while preserving unrelated prose and quoted examples. Do not depend on the accepted-risk feature-identity early return or prompt authors remembering metadata. Propagate unresolved identity and GitHub failures through existing publication-effect error handling. Reuse injected GitHub runners; do not introduce a new publication state machine or credential path.

Add edited to the existing pull_request event types. Retain the event's body, URL, base/head identity, immutable checkout, and read-only permissions. A new edited event supplies the corrected body; manually rerunning an old event remains a replay of that event. This preserves the approved durable-shipment ADR's event-only premerge contract.

Use the existing CLI runner injection and production publication adapter fixtures as semantic patterns. CLI integration retains real parsing, classification, and strict verification with fake Git/GitHub evidence. Pure parsing cases belong at unit level. The production adapter integration stops at its publication effect and injected GitHub boundary, without running Conductor.run or contacting external services. Tests may vary fixture builders and assertion grouping; they must preserve observable boundary proof. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, explicit declaration, technical track, and all three stories on 2026-09-06.
- Verified: shipment-evidence-cli.test.ts already supplies `Plan:` fixture bodies; production dispatch currently extracts arbitrary body paths.
- Verified: finish-publication-production.ts has repairPresentation and recordOutcome effects with existing deterministic PR-body projections and injected GitHub runners.
- Verified: shipment-identity.ts resolves exact and unique date-prefixed plan identities; shipped-record-cli.ts uses it.
- Verified: shipped-record.yml uses event metadata and omits edited; the governing durable-shipment ADR explicitly requires that event-only model.
- Scope check: repository-only CI/shipment behavior; no skill addition; provider-agnostic. Event-spine: no new channel, existing gate result only.
- Verify-claims verdict: CLEAR. Implementation choices above realize the approved stories; no pending product or scope assumptions.

## Tasks

### Task 1: Parse and maintain explicit plan declarations
**Story:** Story 1 happy paths; Story 2 repeated maintenance and ambiguity
**Type:** happy-path
**Files:** src/conductor/src/engine/shipment-plan-declaration.ts, src/conductor/test/engine/shipment-plan-declaration.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit tests for canonical plain/backticked declarations, duplicate same-plan lines, multiple different plans, malformed values, ordinary prose, blockquotes, indented code, both fence styles, and HTML comments. Include an unterminated fence/comment so its contents never become declarations.
2. Establish RED, then implement the deterministic scanner described above. Return exact stems; leave plan existence and implementation classification to existing callers.
3. Implement an idempotent upsert using the same recognized declaration spans: replace top-level declarations with one canonical line, preserve all other bytes including quoted examples, and append when absent. Unit tests cover wrong prior identity and byte-identical canonical input.
4. Run scoped RED/GREEN through ai-conductor scoped-run for this file and commit the focused change.

**Done when:**
1. Declaration unit cases accept only canonical top-level lines, ignore all listed prose/code/comment cases, and deduplicate identical stems without choosing among distinct stems.
2. Upsert unit cases preserve unrelated prose, replace stale declarations, and return unchanged canonical input byte-for-byte.

### Task 2: Bind the required check through declarations and report its basis
**Story:** Story 1 all criteria; Story 2 diagnostics and ambiguity
**Type:** happy-path
**Files:** src/conductor/src/engine/shipment-evidence-cli.ts, src/conductor/test/engine/shipment-evidence-cli.test.ts
**Dependencies:** 1

**Steps:**
1. Extend existing dispatchShipmentEvidence fixtures with undeclared prose/quoted paths, one declared existing plan, and multiple declared existing plans. Use real declaration parsing and classification with injected runners; do not stub the behavior under test.
2. Establish RED, then use the new extractor only for kind=check. Preserve reconcile/audit legacy extraction, non-implementation exclusions, and zero/multiple-match policy. Print canonical plan and declaration basis before the evidence verdict; print the existing classification for unbound checks.
3. Add one CLI integration with the real evaluateShipmentEvidence and faithful fake Git evidence, proving a declared implementation lacking its shipped record is refused. Keep existing valid and invalid evidence fixtures; do not duplicate the verifier's full refusal matrix.
4. Run the focused CLI tests through scoped-run and commit.

**Done when:**
1. CLI integration returns success for valid declared evidence and not-applicable for incidental prose, quotation, and code-block paths without invoking the verifier for unbound input.
2. Real-verifier CLI integration returns nonzero for the declared missing-record case, and existing invalid-evidence cases remain nonzero.
3. CLI output names the bound plan and basis=explicit-plan-declaration on success and refusal; multiple declared existing plans report multi-match without invoking the verifier.
4. Existing reconciliation CLI fixtures retain their legacy body-path association behavior.

### Task 3: Stamp the retained implementation PR mechanically
**Story:** Story 2 automatic declaration, idempotency, and publication failure
**Type:** happy-path
**Files:** src/conductor/src/engine/finish-publication-production.ts, src/conductor/test/engine/finish-publication-production.test.ts
**Dependencies:** 1

**Steps:**
1. Extend production coordinator fixtures to observe publication through the injected GitHub runner. Use the existing shipment identity resolver with temporary plan filenames and the new upsert. Write RED cases for an absent declaration, a stale declaration, canonical input, and a unique date-prefixed identity.
2. Add one small projection function in the production adapter. Read the retained PR body, resolve the canonical identity using the existing writer's rules, and edit only when the upsert changes the body. Invoke after presentation repair and before PR recordOutcome. The keep path does not invoke this projection. Do not put it behind the accepted-risk feature-store early return.
3. Cover missing/ambiguous plan resolution and GitHub read/write failure at this effect boundary. Propagate the error, and assert the finish recorder is not invoked after failed declaration maintenance. Reuse the fixture's bounded effect endpoint; never launch a full conductor lifecycle.
4. Run focused publication tests through scoped-run and commit.

**Done when:**
1. Production publication integration observes one canonical declaration at the GitHub edit boundary for the resolved exact or date-prefixed plan, preserves unrelated prose, and makes no edit for an already canonical body.
2. Publication effect tests prove missing/ambiguous identity and GitHub read/write failures prevent successful PR outcome recording, including a run without accepted-risk feature identity.
3. The keep outcome invokes no declaration edit, and presentation repair cannot leave the subsequent completed PR without its declaration.

### Task 4: Run a fresh immutable check after body edits
**Story:** Story 3 all criteria
**Type:** happy-path
**Files:** .github/workflows/shipped-record.yml, src/conductor/test/engine/shipment-evidence-cli.test.ts
**Dependencies:** 2

**Steps:**
1. Extend the workflow contract test using the installed YAML parser to inspect the machine-consumed event list, job condition, checkout ref, permissions, and command. Establish RED for missing edited. Retain the existing workflow job name and closed-event reconciliation routing.
2. Add edited to pull_request.types. Keep the current event-file argument, exact event-head checkout, and read-only premerge permissions.
3. Exercise dispatchShipmentEvidence with two real temporary event payloads at the same base/head: the original declaration binds, and the corrected body containing only a quoted path is not applicable. Use fake Git and no GitHub calls. Include missing URL/base/head cases and preserve existing malformed-event coverage.
4. Run focused workflow/CLI tests through scoped-run and commit.

**Done when:**
1. Parsed workflow configuration includes edited for the shipped-record check while retaining the event-head checkout, event-file command, read-only permissions, and merged-only reconciliation condition.
2. CLI event integration evaluates the corrected event body at the same exact commit and changes the association result without a push, reopen, or live GitHub lookup.
3. Missing event URL, base SHA, or head SHA each returns nonzero and never produces a successful shipment verdict.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an implementation PR declares exactly one existing plan and has valid shipment evidence, when the required check runs, then it succeeds for that plan. | 2 | "CLI integration returns success for valid declared evidence and not-applicable for incidental prose, quotation, and code-block paths without invoking the verifier for unbound input." | diff-local |
| Story 1 happy: Given an undeclared PR mentions plan paths in prose, quotations, or code blocks, when the required check runs, then it succeeds as not applicable without requiring a shipment record. | 1, 2 | "CLI integration returns success for valid declared evidence and not-applicable for incidental prose, quotation, and code-block paths without invoking the verifier for unbound input." | diff-local |
| Story 1 negative: Given a declared implementation has missing or invalid shipment evidence, when the required check runs, then it fails with the existing evidence refusal. | 2 | "Real-verifier CLI integration returns nonzero for the declared missing-record case, and existing invalid-evidence cases remain nonzero." | diff-local |
| Story 2 happy: Given an engine publication has one resolved shipment identity, when it maintains the implementation PR for completion, then the PR carries one explicit declaration for that identity and a repeated maintenance pass preserves the body without another edit. | 1, 3 | "Production publication integration observes one canonical declaration at the GitHub edit boundary for the resolved exact or date-prefixed plan, preserves unrelated prose, and makes no edit for an already canonical body." | diff-local |
| Story 2 happy: Given a check binds an implementation to a plan, when it reports success or refusal, then the output names the plan and the declaration basis. | 2 | "CLI output names the bound plan and basis=explicit-plan-declaration on success and refusal; multiple declared existing plans report multi-match without invoking the verifier." | diff-local |
| Story 2 negative: Given multiple distinct existing plans are declared, when the check classifies the PR, then it reports an ambiguous not-applicable result without selecting a plan. | 2 | "CLI output names the bound plan and basis=explicit-plan-declaration on success and refusal; multiple declared existing plans report multi-match without invoking the verifier." | diff-local |
| Story 2 negative: Given publication cannot resolve one plan or cannot read or write the PR declaration, when it maintains the implementation PR for completion, then that publication effect fails without recording successful completion. | 3 | "Publication effect tests prove missing/ambiguous identity and GitHub read/write failures prevent successful PR outcome recording, including a run without accepted-risk feature identity." | diff-local |
| Story 3 happy: Given a PR body is corrected, when GitHub emits the edited event, then the required check runs against that event body and exact commit identity without requiring a push or reopen. | 4 | "CLI event integration evaluates the corrected event body at the same exact commit and changes the association result without a push, reopen, or live GitHub lookup." | diff-local |
| Story 3 negative: Given the event lacks its PR URL or base or head commit identity, when the check runs, then it returns an error rather than a successful shipment verdict. | 4 | "Missing event URL, base SHA, or head SHA each returns nonzero and never produces a successful shipment verdict." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns unit parsing/upsert cases. Task 2 owns CLI-to-classifier/verifier integration for Story 1 and Story 2 diagnostics/ambiguity. Task 3 owns publication-to-GitHub adapter integration for automatic metadata and failed maintenance. Task 4 owns workflow configuration plus event-input integration for Story 3. Existing shipment-evidence tests supply the unchanged strict-refusal permutations; no new aggregate or external-service test is required. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 4
Task 1 -> Task 3

Small tier: architecture and coherence artifacts are skipped. No new ADR or amendment is required because the event-only contract and existing ambiguity policy remain intact.
