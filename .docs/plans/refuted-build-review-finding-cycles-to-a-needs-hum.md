# Implementation Plan: Refuted build_review finding cycles to a needs-human halt instead of settling

**Date:** 2026-09-09
**Design:** .docs/decisions/architecture-review-2026-09-09-refuted-build-review-finding-cycles-to-a-needs-hum.md
**Stories:** .docs/stories/refuted-build-review-finding-cycles-to-a-needs-hum.md
**Conflict check:** Clean as of 2026-09-09 (zero blocking; one degrading resolved by ADR amendment)

## Summary

Adds the bounded refutation lane to the build_review case-v1 adjudicator in 13 tasks: one new case disposition `refute` (source outcome `refuted`) that the judge may bind only to an already-attempted action case, admitted by the engine under mechanical bounds, persisted with its rationale, emitted on the spine, rendered by `build-review findings`, and settled without a kickback; the narrow remainder rides the existing deferral effect. Unrefuted repeats halt exactly as today.

## Technical Approach

- **Vocabulary, engine-first.** `RemediationCaseDisposition` gains `refute`; `RemediationCaseSourceOutcome` gains `refuted`. A `refute` case row carries a `refutation` object: `claim` (bounded text), `assertions` (1–16 entries of `{ assertion, verdict: 'refuted' | 'upheld', evidence: [{ path, excerpt }] }`), and requires `existingCaseId`, `confidence: 'high'`, and effect `{ kind: 'none' }` or a complete deferral effect. Any `lineNumber`, `line`, `hunk`, `sha`, or `commit` key on an evidence entry is malformed. Parse, validate, store, and skill text widen in the same change (adr-2026-08-25 D9 shape discipline).
- **Evidence resolution is mechanical.** A small resolver (`src/conductor/src/engine/remediation-refutation-evidence.ts`) takes the project root and every evidence entry: the path must pass the existing canonical repo-relative path predicate in `build-review-domain.ts` and exist as a file; the excerpt, whitespace-normalized (`trim`, collapse `\s+` to one space), must occur in the file's whitespace-normalized content. Any miss rejects the whole judgement with `unresolvable-refutation-evidence`. It runs in the coordinator after graph validation and before reconciliation, so nothing durable is written for an unresolvable refutation.
- **One legal transition.** The reconciler's existing-case branch admits `act` → `refute` iff the bound record is `open`, `disposition: 'act'`, `effect.kind === 'action' && status === 'applied'`, its id is in `attemptedCaseIds`, and it carries no `refutation`. Admission rewrites the record to `disposition: 'refute'`, `resolution: 'resolved'`, `refutation` persisted, `rationale` replaced by the refute row's rationale, effect `none` or a reserved deferral, and appends the source link with outcome `refuted`. Every other pairing keeps `illegal-disposition-transition`. A `refute` bound to a record that already has a `refutation` returns the new rejection `refutation-repeat`. `classifyRemediationCaseReuse` treats `refute` as non-act (`reuse`), so the repeat classifier is untouched for `act`.
- **Settle, no charge, no route.** The coordinator's finalized-source predicate treats a `refute` case with effect `none` or an `applied` deferral as settled (D5.3), excluding its source ids from later live sets by exact id. The kickback charge path is only reached for action cases, so a refutation charges nothing by construction; a test pins it. The reducer already routes PASS for finalized non-action outcomes; the existing `hasUnfinishedEffect` check blocks PASS while a residual deferral is `reserved` or `failed`.
- **Halts.** `refutation-repeat` surfaces through the existing `failUnlessAccepted` return with detail `refutation repeat <caseId>`, which the conductor's adjudication branch already writes as a `needs-human` halt; no new writer, no new halt class.
- **Spine.** New member `remediation_case_refuted { domain: 'build_review', lapId, caseId, residualEffectId? }` declared in the union and the total `EVENT_SINKS` table (`render: true, persist: true, audit: true, otel: false`) with a `renderDaemonEvent` case. Emitted once per admitted refutation by the coordinator via `input.emit`.
- **Operator surface.** `build-review findings` opens `RemediationCaseStore` for the feature with the same guarded read discipline as the disposition store: absent file → "no autonomous cases"; malformed or unknown version → report and exit non-zero. Cases print under an "Autonomous case outcomes" section distinct from operator dispositions, in both human and `--json` modes.
- **Judge contract.** `skills/remediate/SKILL.md` case-v1 section documents `refute`/`refuted`, the refutation record, and the binding, confidence, evidence, and once-per-case rules; `test/engine/remediate-skill-contract.test.ts` pins them.
- **Local pattern context.** New parse/validate/reconcile rejections follow the existing closed-union rejection style in `remediation-case-artifact.ts`, `remediation-case-validator.ts`, and `remediation-case-reconciler.ts` (string-literal reason unions, `{ ok: false, reason }` results, exact-key checks). Tests follow the existing coordinator test harness in `test/engine/build-review-adjudication-coordinator.test.ts` (in-memory store, injected `judge`, `emit` capture, fake tracker). Search hints: `illegal-disposition-transition`, `classifyRemediationCaseReuse`, `finalizedSourceIds`, `failUnlessAccepted`, `applyBuildReviewDeferralEffect`, `EVENT_SINKS`.
- **Sequencing.** Contract types first (T1), then validation and the resolver (T2, T3), store (T4), reconciler (T5), coordinator wiring (T6), reducer/effect coverage (T7), event (T8), negative-path coordinator proofs (T9–T11), CLI (T12), skill text (T13).

## Prerequisites

- None. `build_review.adjudication.enabled` (default on) remains the rollback switch; no new config key.

## Tasks

### Task 1: Parse the refute disposition and refutation record
**Story:** Story 2 (admission bounds — parse-level shape); Story 1 happy path 1 (effect shape)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/remediation-case-artifact.test.ts`: a `refute` row with `existingCaseId`, `confidence: 'high'`, effect `{ kind: 'none' }`, and a `refutation` of one `refuted` assertion with `[{ path, excerpt }]` parses; a row whose evidence entry carries `line`, `lineNumber`, `hunk`, `sha`, or `commit` is rejected `malformed-refutation-evidence`; a `refute` row missing `refutation` is rejected `invalid-refutation`; a source row with outcome `refuted` parses.
2. Verify RED.
3. Implement: extend `RemediationCaseSourceOutcome` with `refuted`, `RemediationCaseDisposition` with `refute`, add `RemediationCaseRefutation` types, exact-key parse of `refutation` (`claim`, `assertions`), per-assertion exact keys (`assertion`, `verdict`, `evidence`), per-evidence exact keys (`path`, `excerpt`) with bounded lengths and 1–16 assertions / 1–8 evidence entries; `parseEffect` for `refute` accepts `none` or the deferral shape.
4. Verify GREEN. 5. Commit: "feat(remediation): parse refute disposition and refutation record".

**Done when:**
- `readRemediationCaseJudgement` returns a `refute` case row with a typed `refutation` for the valid fixture and returns `malformed-refutation-evidence` for each of the five forbidden evidence keys, as asserted by the artifact tests.
- A `refute` row without a `refutation` object, or with zero assertions, is rejected `invalid-refutation` before any case is returned.
- The source-outcome parser accepts `refuted` and still rejects any other unknown outcome with `invalid-source-outcome`.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-artifact.ts — vocabulary, refutation types, parse
- src/conductor/test/engine/remediation-case-artifact.test.ts — fixtures

**Dependencies:** none

### Task 2: Validate refute rows in the case graph
**Story:** Story 2 negative paths (no binding; upheld-only; non-high confidence; action effect); Story 5 negative path (deferral without exclusion rationale)
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/engine/remediation-case-validator.test.ts`: `refute` without `existingCaseId` → `refute-without-binding`; all assertions `upheld` → `refutation-without-refuted-assertion`; `confidence` not `high` → `refutation-confidence-not-high`; effect `{ kind: 'action', ... }` → `invalid-refute-effect`; deferral effect missing `exclusionRationale` → `invalid-deferral-effect`; source outcome `refuted` on a `reject` case → `contradictory-source-outcome`; valid `refute` graph → `ok: true`.
2. Verify RED.
3. Implement in `validateRemediationCaseGraph`: extend `RemediationCaseGraphRejection` with the three new reasons plus `invalid-refute-effect`; extend `validateEffect` and `outcomeMatchesDisposition` (`refuted` ↔ `refute`).
4. Verify GREEN. 5. Commit: "feat(remediation): validate refute rows".

**Done when:**
- `validateRemediationCaseGraph` returns each of `refute-without-binding`, `refutation-without-refuted-assertion`, `refutation-confidence-not-high`, and `invalid-refute-effect` for its fixture, and every rejection above leaves the case store byte-identical because the validator has no persistence boundary.
- A `refute` row whose deferral omits `exclusionRationale` returns the existing `invalid-deferral-effect` reason, as asserted by the validator test.
- `outcomeMatchesDisposition` accepts `refuted` only for disposition `refute` and `merged` for any disposition, pinned by a table-driven test.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-validator.ts — rejections, effect and outcome rules
- src/conductor/test/engine/remediation-case-validator.test.ts — fixtures

**Dependencies:** 1

### Task 3: Resolve refutation evidence against the tree
**Story:** Story 2 happy path 1 and negative paths (missing path; excerpt not present)
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `test/engine/remediation-refutation-evidence.test.ts` using a temp directory: an entry whose path exists and whose normalized excerpt occurs → `ok: true`; a path outside the repo or non-canonical → `unresolvable-refutation-evidence` naming the path; an existing path whose excerpt does not occur after whitespace normalization → `unresolvable-refutation-evidence` naming the path and excerpt; a directory path → unresolvable.
2. Verify RED.
3. Implement `resolveRefutationEvidence({ projectRoot, refutation })` in a new module: reuse `isCanonicalBuildReviewRepoRelativePath` from `build-review-domain.ts`, `stat` the file, read it, normalize both sides (`trim`, `\s+` → single space), substring test; return `{ ok: true }` or `{ ok: false, reason: 'unresolvable-refutation-evidence', path, excerpt? }`.
4. Verify GREEN. 5. Commit: "feat(remediation): resolve refutation evidence by path and excerpt".

**Done when:**
- `resolveRefutationEvidence` returns `ok: true` only when every evidence entry's path is canonical, exists as a regular file, and contains the normalized excerpt, as asserted by the four temp-directory tests.
- The first failing entry is reported with its path (and excerpt when the path existed), and no read error is swallowed into a pass; an unreadable file reports unresolvable.
- Every rejection above leaves the case store byte-identical because the resolver performs no durable write.

**Files likely touched:**
- src/conductor/src/engine/remediation-refutation-evidence.ts — new resolver
- src/conductor/test/engine/remediation-refutation-evidence.test.ts — new tests

**Dependencies:** 1

### Task 4: Persist the refutation on the case record
**Story:** Story 1 happy path 3; Story 2 happy path 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/remediation-case-store.test.ts`: a case record with `disposition: 'refute'`, `resolution: 'resolved'`, effect `none`, and a `refutation` round-trips through `parseState`; a `refute` record with a deferral effect round-trips; a `refute` record missing `refutation` → `malformed-state`; an `act` record carrying `refutation` → `malformed-state`.
2. Verify RED.
3. Implement: extend the store record type with optional `refutation` (required iff `disposition === 'refute'`), extend `parseEffect` (refute → `none` or deferral), keep `STORE_VERSION` unchanged; extend `freezePriorCase` in `build-review-adjudication-context.ts` to carry `refutation` so the judge sees a prior refutation.
4. Verify GREEN. 5. Commit: "feat(remediation): persist refutation on case records".

**Done when:**
- `RemediationCaseStore` reads back a `refute` record with its `refutation`, `rationale`, and `resolution: 'resolved'` intact, as asserted by the round-trip test.
- `parseState` returns `malformed-state` for a `refute` record without `refutation` and for a non-refute record carrying one.
- `assembleBuildReviewAdjudicationContext` includes `refutation` on a prior refuted case in `priorCases`, as asserted by a context test.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-store.ts — record shape, parse
- src/conductor/src/engine/build-review-adjudication-context.ts — prior-case projection
- src/conductor/test/engine/remediation-case-store.test.ts — round-trip
- src/conductor/test/engine/build-review-adjudication-context.test.ts — projection

**Dependencies:** 1

### Task 5: Admit the act-to-refute transition once per case
**Story:** Story 2 happy path 1 and negative paths (unattempted; reserved/failed effect; defer/reject case); Story 3 happy path 2 (second refutation)
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/remediation-case-reconciler.test.ts`: `refute` bound to an open attempted `act` case with `applied` action effect and no refutation → admitted, record becomes `refute`/`resolved` with `refutation`, source link appended with outcome `refuted`, effect `none` (or a reserved deferral when supplied); bound to an unattempted `act` case → `illegal-disposition-transition`; bound to an `act` case with `reserved` or `failed` effect → `illegal-disposition-transition`; bound to a `defer` or `reject` case → `illegal-disposition-transition`; bound to a record already carrying `refutation` → `refutation-repeat`; `classifyRemediationCaseReuse` on a `refute` record → `reuse`.
2. Verify RED.
3. Implement in the existing-case branch of `reconcileState`: the single admitted pairing, the `refutation-repeat` rejection, record rewrite, and source-link append; add `refutation-repeat` to `RemediationCaseReconciliationRejection`.
4. Verify GREEN. 5. Commit: "feat(remediation): admit act-to-refute once per attempted case".

**Done when:**
- `reconcileRemediationCases` admits `act` → `refute` only for an open, attempted, `applied` action case without a prior refutation, rewriting it to `disposition: 'refute'`, `resolution: 'resolved'` with the refutation persisted, as asserted by the admitted-case test.
- Every rejection above leaves the case store byte-identical: the unattempted, reserved, failed, defer, and reject fixtures each return `illegal-disposition-transition` and the store mutation is not committed.
- A second `refute` binding of a refuted record returns `refutation-repeat` and the original refutation is unchanged in the store.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-reconciler.ts — transition, rejection
- src/conductor/test/engine/remediation-case-reconciler.test.ts — fixtures

**Dependencies:** 4

### Task 6: Settle a refuted re-raise in the coordinator
**Story:** Story 1 happy paths 1–3; Story 2 negative path (unresolvable evidence rejects fail-closed); Story 7 happy path 1 (emission)
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/build-review-adjudication-coordinator.test.ts`: lap two re-raises the source of an attempted `applied` action case; the injected judge returns a valid `refute` binding with effect `none`; assert route `pass`, trace reports a finalized non-action outcome, the kickback ledger charge stub was not called, no work order published, the store holds the refuted record, and exactly one `remediation_case_refuted` event with the case id was emitted; a judge returning a `refute` whose evidence does not resolve → `ok: false` with detail naming `unresolvable-refutation-evidence`, no store change, `remediation_adjudication_failed` emitted with that reason.
2. Verify RED.
3. Implement: call `resolveRefutationEvidence` for every `refute` row after `validateRemediationCaseGraph` and before `reconcileRemediationCases` (fail via `failUnlessAccepted`); extend `finalizedSourceIds` to treat `refute` with effect `none` or `applied` deferral as settled (D5.3); emit `remediation_case_refuted` after reconciliation for each admitted refute case; leave the action-effect and charge paths untouched.
4. Verify GREEN. 5. Commit: "feat(build-review): settle refuted re-raises without charge".

**Done when:**
- For a valid refutation the coordinator routes PASS with unchanged ledger counts and no published work order, and the store's case record is `refute`/`resolved` carrying claim, assertion verdicts, and rationale, as asserted by the coordinator settle test.
- `finalizedSourceIds` returns the refuted source id for a `refute` case with effect `none` and for one with an `applied` deferral, pinned by a unit test on the predicate.
- An unresolvable evidence entry returns `ok: false` before reconciliation with detail containing `unresolvable-refutation-evidence`, and every rejection above leaves the case store byte-identical.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts — resolver call, settled predicate, emission
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts — settle and rejection cases

**Dependencies:** 2, 3, 5, 8

### Task 7: Reducer and effect vocabulary cover refute cases
**Story:** Story 4 negative path 1 (unfinished residual blocks PASS); Story 1 happy path 1 (PASS reason)
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/build-review-adjudication.test.ts` and `test/engine/remediation-case-effects.test.ts`: `reduceBuildReviewAdjudication` with one `refute` case (effect `none`) covering the current source → route `pass`; with a `refute` case whose deferral is `reserved` → route `halt` reason "remediation effect is not finalized"; `isBuildEligibleActionCase` is false for a `refute` record; `hasReservedOrFailedRemediationEffect` is true for a refute record with a reserved deferral.
2. Verify RED (type-level additions may already pass some; keep only genuinely failing assertions).
3. Implement any narrowing needed so `refute` flows through the existing non-action branches.
4. Verify GREEN. 5. Commit: "test(build-review): refute cases reduce as finalized non-action outcomes".

**Done when:**
- `reduceBuildReviewAdjudication` routes `pass` for a refute case with effect `none` covering every current source, as asserted by the reducer test.
- The reducer routes `halt` with reason "remediation effect is not finalized" when the refute case's deferral effect is `reserved` or `failed`.
- `isBuildEligibleActionCase` returns false for every `refute` record fixture.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication.ts — reducer (if narrowing needed)
- src/conductor/src/engine/remediation-case-effects.ts — vocabulary predicates (if narrowing needed)
- src/conductor/test/engine/build-review-adjudication.test.ts — reducer cases
- src/conductor/test/engine/remediation-case-effects.test.ts — predicate cases

**Dependencies:** 4

### Task 8: Declare the refutation occurrence on the event spine
**Story:** Story 7 happy path 1; Story 7 negative path 2
**Type:** infrastructure

**Steps:**
1. Write failing tests: `test/engine/event-sinks.test.ts` asserts `EVENT_SINKS.remediation_case_refuted` equals `{ render: true, persist: true, audit: true, otel: false }`; a daemon renderer test asserts `renderDaemonEvent` produces a line naming the case id for the new member.
2. Verify RED (compile failure counts as RED for the sink table exhaustiveness).
3. Implement: add the union member in `src/conductor/src/types/events.ts`, the sink row, and the renderer case.
4. Verify GREEN. 5. Commit: "feat(events): add remediation_case_refuted".

**Done when:**
- `ConductorEvent` includes `remediation_case_refuted` with `domain`, `lapId`, `caseId`, and optional `residualEffectId`, and the total `EVENT_SINKS` record fails to compile without its row.
- `EVENT_SINKS.remediation_case_refuted` is `{ render: true, persist: true, audit: true, otel: false }`, as asserted by the sink test.
- `renderDaemonEvent` renders the member with the case id, as asserted by the renderer test.

**Files likely touched:**
- src/conductor/src/types/events.ts — union member
- src/conductor/src/engine/event-sinks.ts — sink row
- src/conductor/src/daemon-cli.ts — renderer case
- src/conductor/test/engine/event-sinks.test.ts — sink assertion
- src/conductor/test/daemon-cli-render.test.ts — renderer assertion

**Dependencies:** none

### Task 9: Unrefuted repeat and repeated refutation both halt
**Story:** Story 3 happy paths 1–2 and negative paths 1–3
**Type:** negative-path

**Steps:**
1. Write failing coordinator tests: judge re-proposes `act` on an attempted case → `ok: false`, detail `semantic remediation case repeat <id>`, `remediation_semantic_repeat_halt` emitted with reason `already-attempted`; judge binds a refuted case (via a live drifted-id source) with another `refute` → `ok: false`, detail `refutation repeat <id>`, store unchanged, charge stub not called, no `remediation_case_refuted` emitted; a conductor-level test (existing adjudication halt harness) asserts the halt marker class is `needs-human` for the refutation-repeat detail.
2. Verify RED.
3. Implement: map `refutation-repeat` from reconciliation to `failUnlessAccepted(\`refutation repeat ${caseId}\`)` in the coordinator.
4. Verify GREEN. 5. Commit: "feat(build-review): halt on repeated refutation".

**Done when:**
- The coordinator returns `ok: false` with detail `semantic remediation case repeat <id>` and emits `remediation_semantic_repeat_halt` for an `act` re-proposal, unchanged from the pre-feature assertion.
- For a second refutation the halt reason names the case id and the class is needs-human, the case store is byte-identical to its pre-lap content, and the kickback ledger recorded no charge.
- No `remediation_case_refuted` occurrence is emitted on either halt.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts — refutation-repeat mapping
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts — halt cases
- src/conductor/test/engine/conductor-build-review-adjudication.test.ts — halt class

**Dependencies:** 6

### Task 10: A refuted source stays settled across laps
**Story:** Story 4 happy paths 1–2 and negative paths 1–3
**Type:** negative-path

**Steps:**
1. Write a failing two-lap coordinator test: lap A admits a refutation (effect `none`); lap B re-raises the exact source id → judge not dispatched for it, route `pass`, no regression halt, no `remediation_semantic_repeat_halt`; variant with an `applied` residual deferral → same; variant with a `reserved` residual → judge not dispatched, route not `pass`, trace names the unfinished effect; lap B raises a drifted id → judge dispatched with that id as a live source.
2. Verify RED.
3. Implement any gap in the live-source exclusion (expected covered by Task 6's predicate; this task owns the proof).
4. Verify GREEN. 5. Commit: "test(build-review): refuted sources settle by exact id".

**Done when:**
- On lap B the exact refuted source id is absent from the live source set handed to the judge and the lap routes PASS, as asserted by the two-lap test.
- A drifted finding id is present in the live source set and is adjudicated, as asserted by the drifted-id variant.
- A `reserved` or `failed` residual deferral keeps the lap from routing PASS and the trace names the unfinished effect, with no regression halt written.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts — only if the exclusion needs narrowing
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts — two-lap cases

**Dependencies:** 6

### Task 11: The residual files an intake issue through the deferral effect
**Story:** Story 5 happy paths 1–2 and negative paths 2–4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/remediation-case-effects.test.ts` and the coordinator test: a `refute` case with a reserved deferral is applied through the injected fake tracker client → issue filed with the sanitized body and marker, effect `applied` with `issueUrl`, `remediation_case_refuted` carries `residualEffectId`; tracker throws → effect `failed`, `remediation_effect_failed` emitted, coordinator returns not-PASS; marker already present on an existing issue → reused, no create call; body containing tracker-directed text → `sanitizeIntakeText` output is what the fake received; no action task and no plan append occurred.
2. Verify RED.
3. Implement: route a `refute` case's deferral through the existing deferral executor in the coordinator's effect phase exactly as a `defer` case; include `residualEffectId` in the emission.
4. Verify GREEN. 5. Commit: "feat(build-review): file refutation residuals as deferrals".

**Done when:**
- The residual is filed through the injected tracker client with the sanitized body and the effect marker, and the store records the deferral `applied` with the issue reference, as asserted by the executor test.
- A tracker failure leaves the deferral `failed`, emits `remediation_effect_failed`, and the coordinator does not route PASS.
- An existing issue carrying the marker is reused with no create call, and no BUILD action task or plan task exists after the lap.

**Files likely touched:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts — residual routing and emission field
- src/conductor/src/engine/remediation-case-effects.ts — accept refute cases in the deferral executor
- src/conductor/test/engine/remediation-case-effects.test.ts — executor cases
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts — residual cases

**Dependencies:** 6

### Task 12: Render refuted cases in build-review findings
**Story:** Story 6 happy paths 1–2 and negative paths 1–4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/build-review-cli.test.ts`: a feature with a refuted case renders an "Autonomous case outcomes" section listing case id, disposition, resolution, source ids, effect state, claim, each assertion verdict, and rationale; an operator disposition renders in its own section; `--json` carries the same case fields under `cases`; malformed store → non-zero exit naming the store; unknown version → non-zero exit naming the version; absent store → success with "no autonomous cases".
2. Verify RED.
3. Implement in the `findings` handler: open `RemediationCaseStore` via its existing read API, map read failures to the CLI's failure result, render the section.
4. Verify GREEN. 5. Commit: "feat(cli): render remediation cases in build-review findings".

**Done when:**
- `findings` prints the refuted case fields under an autonomous-outcomes section distinct from the operator disposition section, in both human and JSON modes, as asserted by the CLI tests.
- A malformed case store or unknown store version makes `findings` exit non-zero with a message naming the store rather than omitting cases.
- An absent case store yields a successful listing containing "no autonomous cases".

**Files likely touched:**
- src/conductor/src/engine/build-review-cli.ts — findings rendering
- src/conductor/test/engine/build-review-cli.test.ts — rendering and failure cases

**Dependencies:** 4

### Task 13: Document and pin the refute contract in the remediate skill
**Story:** Story 7 happy path 2 and negative paths 1 and 3
**Type:** infrastructure

**Steps:**
1. Write failing assertions in `test/engine/remediate-skill-contract.test.ts`: the case-v1 section matches `` `act` \| `defer` \| `reject` \| `refute` ``, `` `acted` \| `deferred` \| `rejected` \| `merged` \| `refuted` ``, names `refutation`, `claim`, `assertions`, `refuted`/`upheld`, `path`, `excerpt`, and states the binding rule ("MUST bind an `existingCaseId`"), the confidence rule ("`high`"), the evidence rule ("no line numbers"), and the once-per-case rule.
2. Verify RED.
3. Implement: extend the case-v1 section of `skills/remediate/SKILL.md` with the `refute` disposition, the refutation record, and the four rules; add a coordinator test asserting a rejected refutation emits `remediation_adjudication_failed` with the rejection reason and no `remediation_case_refuted`.
4. Verify GREEN. 5. Commit: "docs(remediate): document the refute disposition".

**Done when:**
- The contract test asserts each vocabulary token and rule string above against the skill text, and one refutation occurrence per case id is persisted only for admitted refutations while a rejected refutation emits `remediation_adjudication_failed` carrying the reason, as asserted by the coordinator test.
- Removing the once-per-case sentence from the skill text fails the contract test naming it.
- The skill text still satisfies every pre-existing contract assertion.

**Files likely touched:**
- skills/remediate/SKILL.md — case-v1 section
- src/conductor/test/engine/remediate-skill-contract.test.ts — pins
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts — rejected-refutation emission

**Dependencies:** 6

## Task Dependency Graph

```
1 ──┬─▶ 2 ──┐
    ├─▶ 3 ──┤
    └─▶ 4 ──┬─▶ 5 ──┴─▶ 6 ──┬─▶ 9
            ├─▶ 7           ├─▶ 10
            └─▶ 12          ├─▶ 11
8 ──────────────────────────┘   └─▶ 13
```

## Integration Points

- After Task 6: a refuted re-raise settles end to end through `coordinateBuildReviewAdjudication` (validate → resolve evidence → reconcile → settle → emit → route PASS).
- After Task 11: the residual reaches the tracker through the existing deferral executor.
- After Task 12: the operator sees the refutation via `ai-conductor build-review findings`.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | no-change | none | Autonomous case judgement still never grants reduced coverage; refutation touches content sources only |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | task | task-6, task-12 | "carrying claim, assertion verdicts, and rationale" |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | existing | none | Rubric branches and the raw join are untouched; the coordinator runs after the join as shipped in PR #2087 |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | task | task-1, task-2 | "returns each of `refute-without-binding`" |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-5 | "rewriting it to `disposition: 'refute'`, `resolution: 'resolved'`" |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | task | task-11 | "filed through the injected tracker client with the sanitized body and the effect marker" |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-6, task-9 | "routes PASS with unchanged ledger counts" |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | no-change | none | Frozen build_review snapshot and lap identity are not touched by any task |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-8 | "the total `EVENT_SINKS` record fails to compile without its row" |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | no-change | none | `build_review.adjudication.enabled` remains the only switch; no configuration key is added |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Mechanical and content branches are classified before the coordinator; no task edits the classifier |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | existing | none | One fresh `remediate` dispatch over every live source and prior case, as shipped in the coordinator |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-6, task-9 | "unchanged from the pre-feature assertion" |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Grader confidence and suppression bookkeeping are untouched; the refute row's `high` is the case-level enum already in the contract |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-6, task-10 | "the exact refuted source id is absent from the live source set" |
| adr-2026-07-13-kickback-build-no-op-escalation#D1 | no-change | none | The progress classifier and its baseline capture are not read or written by any task |
| adr-2026-07-13-kickback-build-no-op-escalation#D2 | task | task-6 | "routes PASS with unchanged ledger counts and no published work order" |
| adr-2026-07-13-kickback-build-no-op-escalation#D3 | no-change | none | The ledger schema for the D2 baseline is unchanged; a refutation charges nothing and records nothing there |
| adr-2026-08-13-stable-build-review-finding-dispositions#D4 | task | task-12 | "prints the refuted case fields under an autonomous-outcomes section" |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an attempted case and a new lap whose rubric re-raises the same source id, when the judge binds that case with a `refute` row carrying one `refuted` assertion, resolvable evidence references, `high` confidence, and an effect of `none`, then the lap routes PASS with the trace reporting a finalized non-action outcome for that source | 6 | "the coordinator routes PASS with unchanged ledger counts and no published work order" | diff-local |
| Story 1 happy: Given the same refutation, when the lap completes, then the kickback ledger's build_review count and cumulative count are unchanged from before the lap and no BUILD work order is published | 6 | "the coordinator routes PASS with unchanged ledger counts and no published work order" | diff-local |
| Story 1 happy: Given the same refutation, when the lap completes, then the case record is resolved with a `refuted` terminal and carries the refuted claim, every assertion verdict, and the judge rationale | 6 | "the coordinator routes PASS with unchanged ledger counts and no published work order" | diff-local |
| Story 1 negative: Given an attempted case and a re-raise, when the judge binds it with a `refute` row whose every assertion is `upheld`, then the judgement is rejected fail-closed before any durable write and the lap does not route PASS | 6 | "the coordinator routes PASS with unchanged ledger counts and no published work order" | diff-local |
| Story 1 negative: Given an attempted case and a re-raise, when the judge binds it with a `refute` row whose confidence is `medium` or `low`, then the judgement is rejected fail-closed and the case remains open with disposition `act` | 6 | "the coordinator routes PASS with unchanged ledger counts and no published work order" | diff-local |
| Story 1 negative: Given an attempted case and a re-raise, when the judge binds it with a `refute` row whose effect is a BUILD action, then the judgement is rejected fail-closed and no work order is published | 6 | "the coordinator routes PASS with unchanged ledger counts and no published work order" | diff-local |
| Story 2 happy: Given a `refute` row bound to an attempted case with no prior refutation, when every evidence reference names an existing path whose file contains the normalized excerpt, then the row is admitted and the case transitions from `act` to `refute` | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 happy: Given an admitted refutation, when the case store is read back, then the refutation is present on the case record and no operator disposition record was created or changed | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a `refute` row with no existing-case binding, when the judgement is validated, then it is rejected with a reason naming the missing binding and nothing is persisted | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a `refute` row bound to an open `act` case that BUILD never attempted, when the judgement is reconciled, then it is rejected as an illegal disposition transition and the case remains open with disposition `act` | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a `refute` row bound to an attempted case whose action effect is still reserved or failed, when the judgement is reconciled, then it is rejected as an illegal disposition transition | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a `refute` row bound to a case with disposition `defer` or `reject`, when the judgement is reconciled, then it is rejected as an illegal disposition transition | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a `refute` row whose evidence reference names a path that does not exist at the current tree, when the judgement is validated, then the whole judgement is rejected fail-closed and no waiver path accepts it | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a `refute` row whose evidence reference names an existing path but an excerpt that does not occur in that file after whitespace normalization, when the judgement is validated, then the whole judgement is rejected fail-closed | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a `refute` row whose evidence reference carries a line number, hunk offset, or commit SHA field, when the judgement is parsed, then it is rejected as malformed | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 2 negative: Given a valid refutation, when the operator disposition store is inspected afterwards, then it contains no record for the refuted finding and the finding is not reported as operator-accepted | 2, 3, 5 | "every rejection above leaves the case store byte-identical" | diff-local |
| Story 3 happy: Given an attempted case and a re-raise, when the judge again proposes `act` on that case, then the lap halts needs-human with the existing semantic remediation case repeat reason naming the case id and the existing repeat-halt occurrence is emitted | 9 | "the halt reason names the case id and the class is needs-human" | diff-local |
| Story 3 happy: Given a case already resolved by refutation, when a later judgement binds a live source (one whose id is not the refuted source id) to that case with another `refute` row, then the lap halts needs-human with a reason naming the case id and the refutation repeat | 9 | "the halt reason names the case id and the class is needs-human" | diff-local |
| Story 3 negative: Given the second-refutation halt, when the case store is read back, then the original refutation is unchanged and no second refutation was persisted | 9 | "the halt reason names the case id and the class is needs-human" | diff-local |
| Story 3 negative: Given the second-refutation halt, when the kickback ledger is read back, then no charge was recorded | 9 | "the halt reason names the case id and the class is needs-human" | diff-local |
| Story 3 negative: Given an attempted case and a re-raise where the judge proposes `act`, when the halt is written, then its class is needs-human and the halt survives daemon sweeps until an operator clears it | 9 | "the halt reason names the case id and the class is needs-human" | diff-local |
| Story 4 happy: Given a case resolved by refutation with effect `none`, when a later lap re-raises the exact same source id, then that source is removed from the live source set, the judge is not dispatched for it, and the lap routes PASS when no other source is live | 10 | "the exact refuted source id is absent from the live source set" | diff-local |
| Story 4 happy: Given a case resolved by refutation whose residual deferral is applied, when a later lap re-raises the same source id, then the source is settled the same way | 10 | "the exact refuted source id is absent from the live source set" | diff-local |
| Story 4 negative: Given a case resolved by refutation whose residual deferral effect is reserved or failed, when a later lap re-raises the same source id, then the source is not settled, the lap does not route PASS, and the unfinished effect is reported as the blocker | 10 | "the exact refuted source id is absent from the live source set" | diff-local |
| Story 4 negative: Given a case resolved by refutation, when a later lap raises a finding whose id has drifted from the refuted source id, then the drifted finding is a live source and is adjudicated normally | 10 | "the exact refuted source id is absent from the live source set" | diff-local |
| Story 4 negative: Given a case resolved by refutation, when a later lap re-raises the same source id, then no regression halt is written for that case | 10 | "the exact refuted source id is absent from the live source set" | diff-local |
| Story 5 happy: Given a `refute` row whose effect is a complete deferral with a title, body, and exclusion rationale, when the refutation is admitted, then one intake issue is filed through the existing tracker seam with the sanitized body and the deferral effect is recorded as applied with the issue reference | 11 | "residual is filed through the injected tracker client with the sanitized body" | diff-local |
| Story 5 happy: Given the same lap, when it completes, then no BUILD action task exists for the remainder and no plan task was appended | 11 | "residual is filed through the injected tracker client with the sanitized body" | diff-local |
| Story 5 negative: Given a `refute` row whose deferral omits the exclusion rationale, when the judgement is validated, then it is rejected with the existing invalid-deferral reason | 11 | "residual is filed through the injected tracker client with the sanitized body" | diff-local |
| Story 5 negative: Given a `refute` row with a deferral, when the tracker is unavailable at filing time, then the deferral effect is recorded as failed, the lap does not route PASS, and the failure occurrence is emitted | 11 | "residual is filed through the injected tracker client with the sanitized body" | diff-local |
| Story 5 negative: Given a `refute` row with a deferral whose marker already matches an existing issue, when the effect is applied, then the existing issue is reused and no duplicate is filed | 11 | "residual is filed through the injected tracker client with the sanitized body" | diff-local |
| Story 5 negative: Given a `refute` row with a deferral whose body contains tracker-directed text, when the issue is filed, then the body passed to the tracker is the sanitized form | 11 | "residual is filed through the injected tracker client with the sanitized body" | diff-local |
| Story 6 happy: Given a feature whose case store holds a refuted case, when the operator runs `build-review findings` for that feature, then the output lists the case id, disposition, resolution, source ids, effect state, the refuted claim, each assertion verdict, and the judge rationale, labeled as an autonomous outcome | 12 | "prints the refuted case fields under an autonomous-outcomes section" | diff-local |
| Story 6 happy: Given a feature with both an operator disposition and a refuted case, when findings is rendered, then the two are printed in distinct sections and neither is described as the other | 12 | "prints the refuted case fields under an autonomous-outcomes section" | diff-local |
| Story 6 negative: Given a feature whose case store file is malformed, when findings runs, then the command reports the unreadable store and exits non-zero rather than omitting the cases | 12 | "prints the refuted case fields under an autonomous-outcomes section" | diff-local |
| Story 6 negative: Given a feature whose case store carries an unknown store version, when findings runs, then the command reports the unknown version and exits non-zero | 12 | "prints the refuted case fields under an autonomous-outcomes section" | diff-local |
| Story 6 negative: Given a feature with no case store file, when findings runs, then the listing succeeds and reports no autonomous cases | 12 | "prints the refuted case fields under an autonomous-outcomes section" | diff-local |
| Story 6 negative: Given the JSON output mode, when a refuted case is present, then the JSON carries the same case fields as the human rendering | 12 | "prints the refuted case fields under an autonomous-outcomes section" | diff-local |
| Story 7 happy: Given an admitted refutation, when the lap completes, then exactly one refutation occurrence for that case id is persisted to the events file with the lap id and, when a residual was filed, the residual effect id | 8, 13 | "one refutation occurrence per case id is persisted" | diff-local |
| Story 7 happy: Given the remediate skill text, when the contract test runs, then the case-v1 section enumerates `refute` and `refuted`, the refutation record fields, and the binding, confidence, and evidence rules | 8, 13 | "one refutation occurrence per case id is persisted" | diff-local |
| Story 7 negative: Given a rejected refutation, when the lap completes, then no refutation occurrence is emitted and the existing adjudication-failed occurrence carries the rejection reason | 8, 13 | "one refutation occurrence per case id is persisted" | diff-local |
| Story 7 negative: Given the event sink registry, when the refutation member is missing a sink declaration, then the registry's exhaustiveness check fails to compile | 8, 13 | "one refutation occurrence per case id is persisted" | diff-local |
| Story 7 negative: Given the remediate skill text with the refutation rules removed, when the contract test runs, then it fails naming the missing rule | 8, 13 | "one refutation occurrence per case id is persisted" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks with a named mechanism
- [ ] Dependencies are explicit and acyclic
