# Implementation Plan: Budgeted, mode-aware test_suite verification (#2021)

**Date:** 2026-08-28
**Stories:** .docs/stories/test-suite-re-runs-and-re-passes-the-full-suite-10.md
**Conflict check:** Clean as of 2026-08-28

## Summary

Adds the `test_suite.verification` config block (per-category drift budget + aggregate-vs-scoped
mode) judged inside `FullSuiteVerifier`, with evidence/event auditability and `config init`
recording — 21 tasks.

## Technical Approach

Governing decision: adr-2026-08-28-test-suite-drift-budget-and-verification-mode (D1–D8).
Inspection is never skipped; the budget changes only the consequence of an observed fingerprint
mismatch, inside the single choke point `FullSuiteVerifier.resolveInspection`
(`src/conductor/src/engine/full-suite-verifier.ts:772`).

- **Config:** new optional `verification` sub-block parsed and validated fail-closed in
  `validateTestSuiteBlock` (`src/conductor/src/engine/config.ts:1612-1706`; allowlist at `:127`),
  following its existing presence rule (`:1624-1629`) and content rule (`:1638-1651`) styles.
  Resolved shape: `mode: 'aggregate' | 'scoped'` plus a total per-category bound map where every
  unlisted category is `none`. Unbudgetable categories (`dependencies`, `migrations`,
  `environment`, `project_config`) are engine constants, rejected as budget keys at load.
- **One classifier:** the path→category table in
  `src/conductor/src/engine/full-suite-fingerprint.ts:250-288` is extracted into a single exported
  function consumed by both the fingerprint and the new drift measurement (review condition C2).
- **Drift measurement:** on fingerprint mismatch, `git diff --name-only <provenanceHeadSha>..HEAD`
  plus worktree-dirty paths, classified per category, compared cumulatively against the budget.
  Any indeterminacy (unresolvable provenance SHA, git failure, prior-version evidence) resolves to
  re-run (condition C5). The closed fail-closed set is: absent config, unknown evidence version,
  unresolvable provenance commit, git command failure, and any drift in an unbudgetable category.
- **Evidence:** `.pipeline/test-suite-evidence.json` version bump adding `mode`, `selectors`, and
  an append-only `driftLedger` (`src/conductor/src/engine/full-suite-evidence.ts`); readers treat
  earlier versions as stale.
- **Scoped mode:** selectors are the feature surface's changed paths classified `tests`
  (merge-base derivation pattern: `src/conductor/src/engine/gate-code-validity.ts:107-120`),
  executed through the existing engine-owned interface
  (`src/conductor/src/engine/scoped-run.ts:39-132`) unchanged; empty selection routes to the
  aggregate verifier and the route is recorded. Scoped identity (template + selector set) joins
  `normalizeSuiteConfig` (`full-suite-fingerprint.ts:504-516`).
- **Events:** additive fields on the existing `test_suite_verification` /
  `build_member_evidence_reused` members (`src/conductor/src/types/events.ts:672-703`; emit sites
  `src/conductor/src/engine/conductor.ts:11160-11204`) — no new channel.
- **CLI/bootstrap:** `conduct-ts config init` (`src/conductor/src/engine/registry-cli.ts:152-205`)
  gains verification flags that instantiate the template block; the bootstrap skill asks the two
  questions and passes the answers through the CLI.

Sequencing: config contract → shared classifier → drift judgement → evidence → scoped mode →
events → CLI/skill. Local pattern context repeated in affected tasks; test fixtures follow the
existing `config.test.ts` / `full-suite-verifier.test.ts` mocked-adapter idiom (no real git or
child processes in unit tests; faithful fakes at process boundaries).

## Prerequisites

None — all work is inside `src/conductor` plus one template and one skill file.

## Tasks

### Task 1: Verification config types and valid-shape parsing
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: `loadConfig` fixtures for (a) `verification.mode: aggregate` with no budget resolving to zero tolerance, (b) a budget naming only budgetable categories with `none`/integer/`unlimited` values resolving to exactly those bounds, (c) `mode: scoped` with a valid `scoped_command` resolving to scoped mode.
2. Verify tests fail (RED).
3. Implement: add `TestSuiteVerificationConfig` to `src/conductor/src/types/config.ts`; add `verification` to the `test_suite` allowlist (`config.ts:127`); parse and resolve inside `validateTestSuiteBlock` following its existing rule style, defaulting mode `aggregate` and every unlisted category to `none`.
4. Verify tests pass (GREEN).
5. Commit: "feat(config): parse test_suite.verification block".

**Done when:**
- The three valid fixtures load with resolved settings matching the declaration exactly
- A fixture with no `verification` key resolves to aggregate mode and all-`none` bounds
- The resolved type exposes mode plus a total category→bound map (no optional holes downstream)

**Files likely touched:**
- src/conductor/src/types/config.ts — verification config types
- src/conductor/src/engine/config.ts — allowlist + parsing/resolution
- src/conductor/src/engine/config.test.ts — fixtures

**Dependencies:** none

### Task 2: Verification config rejection shapes
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests, one per rejection: scoped mode without `scoped_command` (message names `test_suite.scoped_command`); unknown budget category (message names the key and lists valid names); unbudgetable budget category (message names it unbudgetable); zero/negative/non-integer bound value (message names key and value); mode outside the two allowed values (message names them); unknown key inside `verification`.
2. Verify tests fail (RED).
3. Implement the six validation rules in `validateTestSuiteBlock`, each returning a `validation_error` in the function's existing message style.
4. Verify tests pass (GREEN).
5. Commit: "feat(config): fail-closed validation for test_suite.verification".

**Done when:**
- Each of the six invalid fixtures fails `loadConfig` with a message containing the named key, category, or allowed values listed in Steps
- No invalid shape falls through to a resolved config (the closed rejection set is exactly the six cases above)

**Files likely touched:**
- src/conductor/src/engine/config.ts — validation rules
- src/conductor/src/engine/config.test.ts — rejection fixtures

**Dependencies:** 1

### Task 3: Extract the shared category classifier
**Story:** 2
**Type:** refactor

**Steps:**
1. Write failing test: a new exported classifier function maps one representative path per category (all eight) identically to the current fingerprint behavior.
2. Verify test fails (RED).
3. Implement: extract the path→category logic at `full-suite-fingerprint.ts:250-288` into one exported function; the fingerprint calls it; no behavior change.
4. Verify tests pass (GREEN) including the existing fingerprint suite unmodified.
5. Commit: "refactor(fingerprint): export shared path-category classifier".

**Done when:**
- The exported classifier returns the same category as before for one representative path per category (eight assertions)
- The existing full-suite-fingerprint test suite passes without behavioral edits
- Category assignment logic exists in exactly one function (fingerprint imports it)

**Files likely touched:**
- src/conductor/src/engine/full-suite-fingerprint.ts — extraction
- src/conductor/src/engine/full-suite-fingerprint.test.ts — classifier test

**Dependencies:** none

### Task 4: Drift measurement from the attested PASS
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests against a faked git seam: (a) changed paths since a provenance SHA plus dirty paths are counted per category via the shared classifier; (b) an unresolvable provenance SHA yields an indeterminate result; (c) a git command failure yields an indeterminate result.
2. Verify tests fail (RED).
3. Implement a drift-measurement function in `full-suite-verifier.ts` (or a sibling module) that shells `git diff --name-only <sha>..HEAD` and `git status --porcelain` through the verifier's existing process seam, classifies with Task 3's function, and returns per-category counts or an explicit indeterminate marker.
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): measure per-category drift from attested PASS".

**Done when:**
- Per-category counts match the faked diff/status fixtures (distinct paths, deduplicated across diff and dirty sets)
- Both indeterminacy branches (bad SHA, git failure) return the explicit indeterminate marker, never a partial count
- No real git process runs in the unit tests (faked seam asserted)

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — drift measurement
- src/conductor/src/engine/full-suite-verifier.test.ts — faked-git tests

**Dependencies:** 3

### Task 5: Evidence schema bump — mode, selectors, drift ledger
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing tests: (a) a PASS evidence round-trip preserves `mode`, `selectors`, and `driftLedger` entries `{at, headSha, categories}`; (b) reading an evidence file with the previous version number reports it unusable-as-current.
2. Verify tests fail (RED).
3. Implement: bump the evidence version constant, extend the PASS schema in `full-suite-evidence.ts`, default `mode: 'aggregate'` and empty ledger on write, and make version-mismatch reads resolve to stale.
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): evidence v-next with mode, selectors, drift ledger".

**Done when:**
- Round-trip test proves mode, selectors, and ledger entries survive write/read byte-faithfully
- A prior-version evidence fixture is reported stale (never parsed as a current PASS)
- Existing evidence tests pass with only the version-constant expectation updated

**Files likely touched:**
- src/conductor/src/engine/full-suite-evidence.ts — schema + version
- src/conductor/src/engine/full-suite-evidence.test.ts — round-trip + version tests

**Dependencies:** 1

### Task 6: Within-budget preservation in resolveInspection
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: with a budget of source 20 and a faked drift of 3 source paths, `inspect()` after a fingerprint mismatch returns a preserved outcome, never launches the suite command, and appends a ledger entry naming the category and count; a two-category within-bounds drift preserves and records both.
2. Verify tests fail (RED).
3. Implement: on digest mismatch in `resolveInspection` (`full-suite-verifier.ts:772`), call Task 4's measurement; when every drifted category is budgeted and within bound, return the new preserved outcome and append the ledger entry via Task 5's schema.
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): preserve PASS within declared drift budget".

**Done when:**
- The preserved path is proven to spawn no suite process (spy on the executor seam)
- The appended ledger entry carries the evaluation head SHA and per-category counts from the fixture
- With an absent budget the same fixture re-runs (preservation is reachable only through declared bounds)

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — judgement wiring
- src/conductor/src/engine/full-suite-verifier.test.ts — preservation tests

**Dependencies:** 2, 4, 5

### Task 7: Cumulative measurement and the ratchet negative
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) after a preservation tolerating 15 source paths, a further 4-path drift measures 19 cumulative from the attested PASS and preserves; (b) at 19 tolerated, 2 more paths measure 21 and force a re-run.
2. Verify tests fail (RED).
3. Implement: measurement always diffs against the attested PASS provenance (never the previous evaluation), so repeated small drifts cannot ratchet past a bound.
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): drift budget is cumulative from the attested PASS".

**Done when:**
- The 19-total fixture preserves and the 21-total fixture re-runs against the same budget of 20
- The measurement base SHA in both fixtures is the attested provenance SHA, asserted on the faked git seam

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — cumulative base
- src/conductor/src/engine/full-suite-verifier.test.ts — ratchet tests

**Dependencies:** 6

### Task 8: Fail-closed branches resolve to re-run
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: with a generous budget configured, each of (a) unresolvable provenance SHA, (b) git failure during measurement, (c) prior-version evidence file resolves to a re-run with a stale reason naming the indeterminacy (or version staleness), never a preservation.
2. Verify tests fail (RED).
3. Implement: map Task 4's indeterminate marker and Task 5's version-stale read to re-run outcomes with distinct typed reasons.
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): indeterminate drift never preserves".

**Done when:**
- All three fixtures re-run despite a budget that would tolerate any measured drift
- Each re-run's recorded reason distinguishes indeterminate measurement from version staleness

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — fail-closed mapping
- src/conductor/src/engine/full-suite-verifier.test.ts — fail-closed tests

**Dependencies:** 6

### Task 9: Exceeded and unbudgetable drift re-runs naming the category
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) 6 source paths against a bound of 5 re-runs with a reason naming source, count 6, bound 5; (b) one path in each unbudgetable category (`dependencies`, `migrations`, `environment`, `project_config`) re-runs naming that category as unbudgetable regardless of budget; (c) mixed within-budget + exceeded drift re-runs naming the exceeded category; (d) drift in an unlisted budgetable category re-runs under the default bound.
2. Verify tests fail (RED).
3. Implement the exceeded/unbudgetable branch of the judgement with a typed reason carrying category, measured count, and bound.
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): re-run names the exhausted or unbudgetable category".

**Done when:**
- All four fixture families re-run and the recorded reason carries the exact category (plus count and bound for the exhausted case)
- One exceeded category defeats preservation even when other drifted categories are within bounds

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — exceeded branch
- src/conductor/src/engine/full-suite-verifier.test.ts — category-naming tests

**Dependencies:** 6

### Task 10: A new PASS resets the drift epoch
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: after an exhaustion-forced re-run records a new PASS, a subsequent drift measurement uses the new PASS's provenance SHA and an empty ledger.
2. Verify test fails (RED).
3. Implement: a fresh PASS write starts a new ledger and provenance base (largely falls out of Task 5's write path; assert it).
4. Verify test passes (GREEN).
5. Commit: "feat(test-suite): drift measurement restarts at each new PASS".

**Done when:**
- The post-re-run fixture measures against the new provenance SHA (asserted on the faked git seam)
- The new PASS's evidence carries an empty drift ledger with no entries from the prior epoch

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — epoch reset assertion
- src/conductor/src/engine/full-suite-verifier.test.ts — epoch test

**Dependencies:** 9

### Task 11: Absent configuration locks today's behavior
**Story:** 5
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Add regression tests (expected to pass once Tasks 1–9 land): with no `verification` key, (a) resolution is aggregate mode + all-`none` bounds; (b) a one-path source drift re-runs with the existing per-category stale reason; (c) a fingerprint-identical tree reuses without running; (d) no ledger entry is ever appended.
2. Confirm the existing full-suite-verifier behavioral assertions pass unmodified.
3. Complete with an evidence trailer if no production edit is needed.

**Done when:**
- The four absent-config regression tests pass and are named in the suite
- The pre-existing verifier test suite passes with zero behavioral-assertion edits

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.test.ts — regression lock

**Dependencies:** 9

### Task 12: Preservation leaves the kickback ledger untouched
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing engine-level test: a within-budget evaluation completes with the `test_suite` kickback ledger entry byte-identical and no kickback event emitted; a genuine re-run failure still consumes exactly one kickback as today; a re-run that times out or fails to launch still takes the existing non-kickback halt path with no kickback consumed.
2. Verify test fails (RED) — or documents the already-true invariant if preservation short-circuits before the kickback path (then record it as verification, not new code).
3. Implement only if the preserved outcome reaches the kickback consumption site (`conductor.ts:9786-9845`); otherwise no production change.
4. Verify tests pass (GREEN).
5. Commit: "test(engine): budget preservation cannot consume a kickback".

**Done when:**
- The preservation fixture leaves the ledger file byte-identical (hash compare) and emits no kickback event
- The existing nonzero-exit kickback test still consumes exactly one kickback
- The timeout and launch-failure fixtures halt without consuming a kickback (existing path asserted)

**Files likely touched:**
- src/conductor/src/engine/conductor.test.ts — ledger invariant test
- src/conductor/src/engine/kickback-ledger.test.ts — unchanged-path assertion

**Dependencies:** 6

### Task 13: Scoped selector derivation from the feature surface
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests against a faked git seam: merge-base..HEAD changed paths filtered to those the shared classifier marks `tests` become the selector set; a surface with no changed test paths yields an explicitly empty selection result.
2. Verify tests fail (RED).
3. Implement selector derivation beside the verifier, following the merge-base surface pattern used by the gate-validity module (traits: derive base from the default branch merge-base, name-only diff, pure path filtering, no runner-specific logic — variation allowed in module placement, not in framework-agnosticism).
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): derive scoped selectors from the feature surface".

**Done when:**
- The derivation returns exactly the classifier-`tests` subset of the faked surface as selectors
- An empty subset returns the explicit empty-selection result (never an empty argv splice)
- No test-runner-specific selector logic exists (paths only)

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — derivation seam
- src/conductor/src/engine/full-suite-verifier.test.ts — derivation tests

**Dependencies:** 3

### Task 14: Scoped execution satisfies the gate only in scoped mode
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: in scoped mode with selectors present, `ensure()` executes through the existing scoped-run interface and a passing exit writes a PASS (mode scoped, selectors recorded) that satisfies the gate; in aggregate mode the same evidence does not satisfy the gate and the aggregate command runs; a selector containing a space reaches the faked runner intact.
2. Verify tests fail (RED).
3. Implement: route scoped-mode execution in `ensure()` through `scoped-run.ts`'s existing template substitution (its quoting and refusal contract unchanged), and bind gate satisfaction to mode-matching evidence.
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): scoped mode executes scoped_command and satisfies the gate".

**Done when:**
- A scoped PASS satisfies the gate only when resolved mode is scoped (mode-mismatch fixture reads stale)
- The faked runner receives the space-bearing selector as one token
- The scoped-run module's own tests pass unmodified (interface reused, not forked)

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — scoped execution + satisfaction binding
- src/conductor/src/engine/full-suite-verifier.test.ts — mode-bound tests

**Dependencies:** 5, 13

### Task 15: Empty scoped selection routes to aggregate, recorded
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: scoped mode with an empty derived selection executes the aggregate command, and both the evidence and the emitted verification event record that the aggregate route was taken from scoped mode.
2. Verify test fails (RED).
3. Implement the recorded aggregate route on empty selection (never an empty-selector scoped launch, never an unrecorded fallback).
4. Verify tests pass (GREEN).
5. Commit: "feat(test-suite): empty scoped selection routes to aggregate with a recorded basis".

**Done when:**
- The empty-selection fixture runs the aggregate command and its evidence names the aggregate-route basis
- No fixture path can launch the scoped template with zero selectors (refusal asserted)

**Files likely touched:**
- src/conductor/src/engine/full-suite-verifier.ts — recorded route
- src/conductor/src/engine/full-suite-verifier.test.ts — empty-selection test

**Dependencies:** 14

### Task 16: Scoped identity joins the fingerprint
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: with mode scoped, `normalizeSuiteConfig` output changes when `scoped_command` changes and when the selector set changes; with mode aggregate it is byte-identical to today for identical inputs.
2. Verify tests fail (RED).
3. Implement: include the scoped template and resolved selector set in the normalized identity only when mode is scoped (`full-suite-fingerprint.ts:504-516`).
4. Verify tests pass (GREEN).
5. Commit: "feat(fingerprint): scoped template and selectors join the evidence identity".

**Done when:**
- A selector-set change stales a scoped PASS (fixture asserts STALE)
- Aggregate-mode fingerprints are byte-identical to the pre-change fixtures (no invalidation of existing evidence on upgrade)

**Files likely touched:**
- src/conductor/src/engine/full-suite-fingerprint.ts — normalized identity
- src/conductor/src/engine/full-suite-fingerprint.test.ts — identity tests

**Dependencies:** 14

### Task 17: Verification events carry mode and budget verdict
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) a within-budget preservation emits a verification event with mode, a preserved-within-budget outcome, and the drifted categories; (b) an exhausted re-run's event names the exhausted or unbudgetable category; (c) the reused-evidence event carries mode; (d) with no verification config, event shapes are unchanged apart from additive fields and existing consumers' parsing tests pass.
2. Verify tests fail (RED).
3. Implement: extend the two existing event members (`types/events.ts:672-703`) additively and emit the preservation outcome at the existing sites (`conductor.ts:11160-11204`) — today's STALE-only emission gains the preserved branch.
4. Verify tests pass (GREEN).
5. Commit: "feat(events): verification events record mode and budget verdict".

**Done when:**
- The four event fixtures serialize through the persister and round-trip with the asserted fields
- No new event type is added (the diff extends only the two existing members)
- Existing event-consumer tests pass without edits

**Files likely touched:**
- src/conductor/src/types/events.ts — additive fields
- src/conductor/src/engine/conductor.ts — preservation emission
- src/conductor/src/engine/events.test.ts — round-trip tests

**Dependencies:** 6, 14

### Task 18: Rebase preservation basis and refund integrity
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a post-rebase evaluation preserved within budget surfaces through the existing rebase-preserved event with a budget basis and grants no build-review convergence refund; (b) a genuine post-rebase invalidation (budget exceeded) still grants the refund under the existing conditions.
2. Verify tests fail (RED).
3. Implement: thread the budget basis through the rebase pre-verify path's existing preserved/invalidated event split; the refund trigger stays keyed on invalidation and is not touched.
4. Verify tests pass (GREEN).
5. Commit: "feat(rebase): budget preservation is a preserved gate, refund stays on invalidation".

**Done when:**
- The preserved-within-budget rebase fixture emits the preserved event with budget basis and the refund counter is unchanged
- The exceeded rebase fixture still invalidates and refunds exactly as the pre-change tests assert

**Files likely touched:**
- src/conductor/src/engine/rebase.ts — basis threading
- src/conductor/src/engine/rebase.test.ts — refund integrity tests

**Dependencies:** 6, 17

### Task 19: config init verification flags and presets
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) `config init` with a mode flag and a preset flag writes a config whose verification block matches the preset (strict = today's zero-tolerance aggregate; tolerant = the documented budgetable bounds); (b) each generated block passes `loadConfig`; (c) with no verification flags the output is byte-identical to the bare template copy; (d) an unknown preset or invalid mode exits non-zero naming allowed values and writes nothing; (e) an existing config still refuses clobber with flags present.
2. Verify tests fail (RED).
3. Implement: extend `runConfigInit` (`registry-cli.ts:152-205`) from a bare copy to a parameterized instantiation of the template — substitution only when flags are given; define the two presets as engine constants.
4. Verify tests pass (GREEN).
5. Commit: "feat(cli): config init records test_suite verification answers".

**Done when:**
- All five fixture families pass, including byte-identical flagless output and refuse-to-clobber with flags
- Both preset outputs load through `loadConfig` with zero validation errors

**Files likely touched:**
- src/conductor/src/engine/registry-cli.ts — flags + instantiation
- src/conductor/src/engine/registry-cli.test.ts — flag tests
- templates/project-config.yml.template — substitution anchor comment

**Dependencies:** 2

### Task 20: Bootstrap asks the two verification questions
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Edit `skills/bootstrap/SKILL.md` step 1b-i: interactively ask the verification mode and drift-budget preset questions and pass the answers as the Task 19 flags; in auto mode record the strict preset without prompting; the hand-authoring prohibition sentence stays intact.
2. Run the harness validation suite (`test/test_harness_integrity.sh`) and fix any frontmatter/reference failures.
3. Commit: "feat(bootstrap): record suite-verification answers via config init".

**Done when:**
- The skill's config-generation step names both questions, the flag mapping, and the auto-mode strict default
- The hand-authoring prohibition sentence is unchanged
- The harness validation suite passes

**Files likely touched:**
- skills/bootstrap/SKILL.md — question flow

**Dependencies:** 19

### Task 21: Consumer registry entries for the two new keys
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test run: the documented-config-key consumer registry coverage test, with the two new keys documented, fails until entries exist.
2. Implement: add registry declarations for `test_suite.verification.mode` and `test_suite.verification.drift_budget` naming their production consumer (the verifier's resolution path).
3. Verify the coverage test passes (GREEN).
4. Commit: "chore(config): register verification keys in the consumer registry".

**Done when:**
- The registry coverage test passes with both keys declared and resolvable to a production consumer
- Neither key is declared consumerless

**Files likely touched:**
- src/conductor/src/engine/config-key-consumers.ts — registry entries
- src/conductor/src/engine/config-key-consumers.test.ts — coverage expectations

**Dependencies:** 1

## Task Dependency Graph

```
1 ─┬─ 2 ── 19 ── 20
   ├─ 5 ─┐
   └─ 21 │
3 ─┬─ 4 ─┴─(with 2)─ 6 ─┬─ 7
   └─ 13 ─ 14 ─┬─ 15    ├─ 8
               ├─ 16    ├─ 9 ── 10
               └─(with 6)─ 17 ── 18   6 ─ 11, 6 ─ 12
```

Linearizable order: 1, 3, 2, 4, 5, 21, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20.

## Integration Points

- After Task 6: within-budget preservation observable end-to-end in verifier unit tests.
- After Task 12: engine-level proof that foreign drift cannot burn a kickback.
- After Task 17: `.pipeline/events.jsonl` shows the mode and budget verdict for every evaluation.
- After Task 19: a fresh project can be generated with an explicit recorded verification answer.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks with closed enumerations
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s1-6-1: src/conductor/src/engine/config.ts:1788 — reject ANY explicit drift_budget key naming an unbudgetable category regardless of bound (drop the `bound !== 'none'` conjunct), keeping the existing message style that names the category as unbudgetable; single-source the vocabulary so config.ts:1731 UNBUDGETABLE_TEST_SUITE_DRIFT_CATEGORIES and full-suite-verifier.ts:1243 UNBUDGETABLE_DRIFT_CATEGORIES cannot drift (export one set and import it in the other); extend src/conductor/test/engine/config.test.ts:143 with a `none`-valued fixture per unbudgetable category (dependencies, environment, migrations, project_config) while leaving the existing value-`1` rejection assertion in place — Task 2's Done-when coverage of the six rejection shapes is preserved, not replaced. Lands together with rem-as-built-rem-ab1-1, which removes the same four keys from both generated presets.
**Gate:** prd-audit
**Rationale:** Confirmed impl gap, 98% (verified from the audit's executed loadConfig probe): src/conductor/src/engine/config.ts:1788 guards the unbudgetable-category rule with `bound !== 'none'`, so `drift_budget.dependencies: none` loads instead of failing, leaving Story 1's negative criterion undelivered; plan Task 2 already owns the six load-time rejection rules, so this is conforming implementation drift with an existing owner, not a planning or architecture question. Matched pair named in the task: the unbudgetable vocabulary is duplicated at config.ts:1731 and full-suite-verifier.ts:1243, and the generated presets at registry-cli.ts:156-176 emit all four forbidden keys — the preset half is tasked separately under AB-1 (rem-as-built-rem-ab1-1) and must land in the same build lap, since tightening the validator alone would make `config init` generate a config that fails loadConfig. Sibling sweep: docs/reference/configuration.md:594 already documents the strict rule and needs no edit; the example block at configuration.md:1338 uses only budgetable keys (source, tests), and templates/project-config.yml.template:19 carries only the substitution anchor, so neither is a site of this class.
**Criterion:** S1.6
**Parent task:** 2
**Done when:**
- S1.6 is satisfied by this task.

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/full-suite-verifier.ts:1057-1081 — make resolveInspection/inspect() read-only per adr-2026-08-28 D4: keep constructing the revised PRESERVED_WITHIN_BUDGET evidence (new fingerprint digest, categoryFingerprints, appended driftLedger entry) and RETURN it as the inspection value, but delete the writeEvidence call from that branch; add ONE exported caller-invoked recording seam on FullSuiteVerifier (e.g. recordPreservation(inspection)) that owns the single writeEvidence call with declaredEnvironmentValues, so evidence construction is single-sourced and inspection and recording cannot build different evidence. Also give ensure() (full-suite-verifier.ts:715) and ensureLocked() (:738-750, preserved REUSED branch at :795-800) an optional already-resolved inspection parameter so a caller can hand over the one result instead of re-resolving. Coverage preserved, not dropped — Task 6's no-suite-process preservation assertions (test/engine/full-suite-verifier.test.ts:1252-1290), Task 7's cumulative/ratchet fixtures (:1414-1420, :1500), Task 10's epoch-reset fixture (:1787) and the provenanceHeadSha anchoring assertion (:1346) all stay, updated to call the recording seam between inspections where they previously relied on inspect()'s implicit write; add one new assertion that inspect() alone leaves .pipeline/test-suite-evidence.json byte-unchanged.
**Gate:** as-built
**Rationale:** Conforming implementation drift against an approved, still-authoritative architecture (verified in current source this lap, 99%): adr-2026-08-28 D4 as amended 2026-08-29 (.docs/decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md:148-164) requires inspection to RETURN the preservation as a value, forbids the append from resolveInspection or anything the tree-attesting predicate reaches, and requires the caller that acted on the judgement to record it once and emit D7's event from that same result without re-inspecting; current src/conductor/src/engine/full-suite-verifier.ts:1057-1081 still builds the revised evidence and calls writeEvidence inside resolveInspection, which the read-only completion predicate reaches via src/conductor/src/engine/artifacts.ts:3539-3545 (also breaching adr-2026-08-19 D3's read-only boundary at .docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md:140-146), and src/conductor/src/engine/conductor.ts:11207-11208 still calls inspect() then ensure(), performing exactly the second inspection D4 forbids. The amendment fully specifies the target shape and the review states the design is not the limit, so no architectural decision is open and no ADR needs changing: build, not architecture_review and not halt. Plan-task coverage examined before considering plan: Task 6 (plan:171-192) owns the preservation outcome and its ledger append in the verifier, Task 17 (:404-426) owns emitting the budget verdict from the caller's result, and Task 18 (:427-447) owns the rebase pre-verify preservation basis — every site this repair touches is admitted by an existing task, so this is not a planning omission. Matched pair: the revised-evidence construction (fingerprint + categoryFingerprints + appended driftLedger entry) must live in exactly ONE place, so the tasks move construction and the single writeEvidence behind one seam every caller invokes rather than duplicating it per caller. Sibling sweep of every site that inspects or acts on a preservation: conductor.ts:11207 (dispatched gate), conductor.ts:5970-5996 (tree-attesting completion), conductor.ts:12016 (in-loop rebase pre-verify) and daemon-rekick.ts:382-399 (re-kick pre-verify) are all tasked; conductor.ts:2546-2549 (completionCtx inspect seam), artifacts.ts:3539-3554 (completion predicate) and src/conductor/src/engine/build-review-inputs.ts:525 (build_review input inspection) are read-only consumers that today mutate evidence only because resolveInspection writes — rem-as-built-rem-ab1-1 fixes them by construction and none gains a write. Found and deliberately EXCLUDED with reason: the Drift Notes diagram staleness in .docs/architecture/test-suite-re-runs-and-re-passes-the-full-suite-10.md:13,:66-99 and .docs/architecture/sequences/test-suite-re-runs-and-re-passes-the-full-suite-10.md:27-37 is not a Blocking Finding, and both files are sealed protected artifacts of this feature (.pipeline/protected-artifact-seal.json), so editing them from build raises 'Protected artifact self-amendments detected' and needs an operator reseal or the owning architecture_review step; it is recorded here rather than quietly tasked. Nothing is removed or relaxed: every existing preservation assertion is retained, with the ratchet fixtures re-pointed at the new recording seam.
**Governing clause:** adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4
**Done when:**
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4 is satisfied by this task.

### Task rem-as-built-rem-ab1-2: src/conductor/src/engine/conductor.ts:11205-11244 (runTestSuiteStep) — carry ONE inspection result through the dispatched evaluation: stop calling inspect() and then ensure() (:11207-11208), pass the single resolved inspection into ensure() via rem-as-built-rem-ab1-1's parameter, record the preservation exactly once through the new seam, and emit the existing test_suite_verification event from that same result. Additive only: the STALE emission branch and the freshness/mode/budgetVerdict/executionBasis field shapes stay exactly as they are and Task 17's four event fixtures keep their assertions unedited; add a conductor test proving exactly one inspection and exactly one preservation record per dispatched preserved evaluation.
**Gate:** as-built
**Rationale:** Conforming implementation drift against an approved, still-authoritative architecture (verified in current source this lap, 99%): adr-2026-08-28 D4 as amended 2026-08-29 (.docs/decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md:148-164) requires inspection to RETURN the preservation as a value, forbids the append from resolveInspection or anything the tree-attesting predicate reaches, and requires the caller that acted on the judgement to record it once and emit D7's event from that same result without re-inspecting; current src/conductor/src/engine/full-suite-verifier.ts:1057-1081 still builds the revised evidence and calls writeEvidence inside resolveInspection, which the read-only completion predicate reaches via src/conductor/src/engine/artifacts.ts:3539-3545 (also breaching adr-2026-08-19 D3's read-only boundary at .docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md:140-146), and src/conductor/src/engine/conductor.ts:11207-11208 still calls inspect() then ensure(), performing exactly the second inspection D4 forbids. The amendment fully specifies the target shape and the review states the design is not the limit, so no architectural decision is open and no ADR needs changing: build, not architecture_review and not halt. Plan-task coverage examined before considering plan: Task 6 (plan:171-192) owns the preservation outcome and its ledger append in the verifier, Task 17 (:404-426) owns emitting the budget verdict from the caller's result, and Task 18 (:427-447) owns the rebase pre-verify preservation basis — every site this repair touches is admitted by an existing task, so this is not a planning omission. Matched pair: the revised-evidence construction (fingerprint + categoryFingerprints + appended driftLedger entry) must live in exactly ONE place, so the tasks move construction and the single writeEvidence behind one seam every caller invokes rather than duplicating it per caller. Sibling sweep of every site that inspects or acts on a preservation: conductor.ts:11207 (dispatched gate), conductor.ts:5970-5996 (tree-attesting completion), conductor.ts:12016 (in-loop rebase pre-verify) and daemon-rekick.ts:382-399 (re-kick pre-verify) are all tasked; conductor.ts:2546-2549 (completionCtx inspect seam), artifacts.ts:3539-3554 (completion predicate) and src/conductor/src/engine/build-review-inputs.ts:525 (build_review input inspection) are read-only consumers that today mutate evidence only because resolveInspection writes — Task 24 fixes them by construction and none gains a write. Found and deliberately EXCLUDED with reason: the Drift Notes diagram staleness in .docs/architecture/test-suite-re-runs-and-re-passes-the-full-suite-10.md:13,:66-99 and .docs/architecture/sequences/test-suite-re-runs-and-re-passes-the-full-suite-10.md:27-37 is not a Blocking Finding, and both files are sealed protected artifacts of this feature (.pipeline/protected-artifact-seal.json), so editing them from build raises 'Protected artifact self-amendments detected' and needs an operator reseal or the owning architecture_review step; it is recorded here rather than quietly tasked. Nothing is removed or relaxed: every existing preservation assertion is retained, with the ratchet fixtures re-pointed at the new recording seam.
**Governing clause:** adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4
**Done when:**
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4 is satisfied by this task.

### Task rem-as-built-rem-ab1-3: src/conductor/src/engine/conductor.ts:5969-5997 — on the tree-attesting completion path, record the preservation once through rem-as-built-rem-ab1-1's seam from the fullSuiteInspection already captured by the completionCtx wrapper, immediately before the existing test_suite_verification emission at :5989-5996, and leave src/conductor/src/engine/artifacts.ts:3539-3554 and the conductor.ts:2546-2549 inspect seam read-only (no write is added to the predicate, per adr-2026-08-19 D3). Keep the existing done-gate skip semantics (`continue`) and emitted event shape unchanged; add a test asserting exactly one record plus one preserved verification event per completion recheck, and neither when the inspection is CURRENT.
**Gate:** as-built
**Rationale:** Conforming implementation drift against an approved, still-authoritative architecture (verified in current source this lap, 99%): adr-2026-08-28 D4 as amended 2026-08-29 (.docs/decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md:148-164) requires inspection to RETURN the preservation as a value, forbids the append from resolveInspection or anything the tree-attesting predicate reaches, and requires the caller that acted on the judgement to record it once and emit D7's event from that same result without re-inspecting; current src/conductor/src/engine/full-suite-verifier.ts:1057-1081 still builds the revised evidence and calls writeEvidence inside resolveInspection, which the read-only completion predicate reaches via src/conductor/src/engine/artifacts.ts:3539-3545 (also breaching adr-2026-08-19 D3's read-only boundary at .docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md:140-146), and src/conductor/src/engine/conductor.ts:11207-11208 still calls inspect() then ensure(), performing exactly the second inspection D4 forbids. The amendment fully specifies the target shape and the review states the design is not the limit, so no architectural decision is open and no ADR needs changing: build, not architecture_review and not halt. Plan-task coverage examined before considering plan: Task 6 (plan:171-192) owns the preservation outcome and its ledger append in the verifier, Task 17 (:404-426) owns emitting the budget verdict from the caller's result, and Task 18 (:427-447) owns the rebase pre-verify preservation basis — every site this repair touches is admitted by an existing task, so this is not a planning omission. Matched pair: the revised-evidence construction (fingerprint + categoryFingerprints + appended driftLedger entry) must live in exactly ONE place, so the tasks move construction and the single writeEvidence behind one seam every caller invokes rather than duplicating it per caller. Sibling sweep of every site that inspects or acts on a preservation: conductor.ts:11207 (dispatched gate), conductor.ts:5970-5996 (tree-attesting completion), conductor.ts:12016 (in-loop rebase pre-verify) and daemon-rekick.ts:382-399 (re-kick pre-verify) are all tasked; conductor.ts:2546-2549 (completionCtx inspect seam), artifacts.ts:3539-3554 (completion predicate) and src/conductor/src/engine/build-review-inputs.ts:525 (build_review input inspection) are read-only consumers that today mutate evidence only because resolveInspection writes — Task 24 fixes them by construction and none gains a write. Found and deliberately EXCLUDED with reason: the Drift Notes diagram staleness in .docs/architecture/test-suite-re-runs-and-re-passes-the-full-suite-10.md:13,:66-99 and .docs/architecture/sequences/test-suite-re-runs-and-re-passes-the-full-suite-10.md:27-37 is not a Blocking Finding, and both files are sealed protected artifacts of this feature (.pipeline/protected-artifact-seal.json), so editing them from build raises 'Protected artifact self-amendments detected' and needs an operator reseal or the owning architecture_review step; it is recorded here rather than quietly tasked. Nothing is removed or relaxed: every existing preservation assertion is retained, with the ratchet fixtures re-pointed at the new recording seam.
**Governing clause:** adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4
**Done when:**
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4 is satisfied by this task.

### Task rem-as-built-rem-ab1-4: src/conductor/src/engine/conductor.ts:12014-12020 (in-loop rebase preVerify) and src/conductor/src/engine/daemon-rekick.ts:382-399 (makeRekickBuildPreVerify) — both rebase pre-verify callers record the preservation once through rem-as-built-rem-ab1-1's seam from the single inspection they already hold (the in-loop preVerify from its own inspect(), daemon-rekick from its fullSuiteInspect wrapper), with no second inspect() on either path, so preservationBasis 'test_suite_drift_budget' still reaches applyRebaseVerdicts and src/conductor/src/engine/rebase.ts:1311-1326 unchanged. Coverage preserved unedited: Task 18's preserved-within-budget and exceeded-budget rebase fixtures in test/engine/rebase.test.ts and Task 12's kickback-ledger-bytes assertion keep their current expectations; add a daemon-rekick test asserting exactly one inspection and one preservation record per re-kick.
**Gate:** as-built
**Rationale:** Conforming implementation drift against an approved, still-authoritative architecture (verified in current source this lap, 99%): adr-2026-08-28 D4 as amended 2026-08-29 (.docs/decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md:148-164) requires inspection to RETURN the preservation as a value, forbids the append from resolveInspection or anything the tree-attesting predicate reaches, and requires the caller that acted on the judgement to record it once and emit D7's event from that same result without re-inspecting; current src/conductor/src/engine/full-suite-verifier.ts:1057-1081 still builds the revised evidence and calls writeEvidence inside resolveInspection, which the read-only completion predicate reaches via src/conductor/src/engine/artifacts.ts:3539-3545 (also breaching adr-2026-08-19 D3's read-only boundary at .docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md:140-146), and src/conductor/src/engine/conductor.ts:11207-11208 still calls inspect() then ensure(), performing exactly the second inspection D4 forbids. The amendment fully specifies the target shape and the review states the design is not the limit, so no architectural decision is open and no ADR needs changing: build, not architecture_review and not halt. Plan-task coverage examined before considering plan: Task 6 (plan:171-192) owns the preservation outcome and its ledger append in the verifier, Task 17 (:404-426) owns emitting the budget verdict from the caller's result, and Task 18 (:427-447) owns the rebase pre-verify preservation basis — every site this repair touches is admitted by an existing task, so this is not a planning omission. Matched pair: the revised-evidence construction (fingerprint + categoryFingerprints + appended driftLedger entry) must live in exactly ONE place, so the tasks move construction and the single writeEvidence behind one seam every caller invokes rather than duplicating it per caller. Sibling sweep of every site that inspects or acts on a preservation: conductor.ts:11207 (dispatched gate), conductor.ts:5970-5996 (tree-attesting completion), conductor.ts:12016 (in-loop rebase pre-verify) and daemon-rekick.ts:382-399 (re-kick pre-verify) are all tasked; conductor.ts:2546-2549 (completionCtx inspect seam), artifacts.ts:3539-3554 (completion predicate) and src/conductor/src/engine/build-review-inputs.ts:525 (build_review input inspection) are read-only consumers that today mutate evidence only because resolveInspection writes — Task 24 fixes them by construction and none gains a write. Found and deliberately EXCLUDED with reason: the Drift Notes diagram staleness in .docs/architecture/test-suite-re-runs-and-re-passes-the-full-suite-10.md:13,:66-99 and .docs/architecture/sequences/test-suite-re-runs-and-re-passes-the-full-suite-10.md:27-37 is not a Blocking Finding, and both files are sealed protected artifacts of this feature (.pipeline/protected-artifact-seal.json), so editing them from build raises 'Protected artifact self-amendments detected' and needs an operator reseal or the owning architecture_review step; it is recorded here rather than quietly tasked. Nothing is removed or relaxed: every existing preservation assertion is retained, with the ratchet fixtures re-pointed at the new recording seam.
**Governing clause:** adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4
**Done when:**
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4 is satisfied by this task.

### Task 22: The test-suite CLI records its own preservation
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write a failing CLI test: `ai-conductor test-suite` against a tree whose drift is within budget preserves the recorded PASS AND appends exactly one drift-ledger entry, so a later invocation measures cumulatively from the attested PASS rather than from a stale baseline.
2. Verify the test fails (RED) — today `src/conductor/src/engine/test-suite-cli.ts:60-61` constructs its own FullSuiteVerifier and calls `ensure()` without retaining or recording the inspection.
3. Implement: retain the resolved inspection and record it once through rem-as-built-rem-ab1-1's recording seam, exactly as the dispatched, completion, and rebase callers do. No second inspection, and no write inside any predicate path.
4. Verify tests pass (GREEN).
5. Commit: "fix(test-suite-cli): record the preservation through the caller-owned seam".

**Done when:**
- A CLI regression test proves one in-budget `ai-conductor test-suite` preservation appends exactly one drift-ledger entry
- A repeated in-budget CLI invocation measures drift cumulatively against the attested PASS rather than the previous evaluation
- A CURRENT (digest-match) CLI invocation records no ledger entry
- The existing test-suite CLI output contract and exit codes are unchanged

**Files likely touched:**
- src/conductor/src/engine/test-suite-cli.ts — retain and record the inspection
- src/conductor/test/engine/test-suite-cli.test.ts — CLI preservation regression test

**Dependencies:** rem-as-built-rem-ab1-1

**Operator note:** Authored by the operator on 2026-08-30 to resolve a needs-human plan gap. The build evaluator found this CLI preservation path unowned; both gates' remediation laps and the 5-task shared plan-growth allowance were already spent, so remediation could not append it itself. adr-2026-08-28 decision 4 makes the drift budget cumulative against the attested PASS specifically so a feature "cannot ratchet unlimited drift through repeated small preservations" — the ledger append is that mechanism, and a caller that preserves without recording defeats it. rem-as-built-rem-ab1-4's sibling sweep enumerated conductor.ts:11207, conductor.ts:5970-5996, conductor.ts:12016 and daemon-rekick.ts:382-399 as the acting callers and build-review-inputs.ts:525 as read-only, but did not reach test-suite-cli.ts:60 — this task closes that one omission and nothing else.
