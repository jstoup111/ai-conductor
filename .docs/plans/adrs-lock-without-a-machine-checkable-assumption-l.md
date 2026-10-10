# Implementation Plan: ADRs carry a machine-checked assumption ledger

**Date:** 2026-10-10
**Design:** [adr-2026-10-10-adr-assumption-ledger-contract](../decisions/adr-2026-10-10-adr-assumption-ledger-contract.md) (technical track; no PRD)
**Stories:** .docs/stories/adrs-lock-without-a-machine-checkable-assumption-l.md
**Conflict check:** Clean as of 2026-10-10 (0 blocking, 1 degrading accepted)

## Summary

Add one pure ADR assumption-ledger parser and one shared in-scope-ADR evaluation. Enforce both at
`ai-conductor compose land` and at a gating `/conduct` `architecture_review` gate, and update the
ADR template and the two authoring skills. 11 tasks.

## Technical Approach

- **Parser (`parseAdrAssumptionLedger`)** sits in `src/conductor/src/engine/artifacts.ts` beside
  `adrApprovalStatus` and `parseAdrDecisions`, and follows the same hygiene. Fenced code blocks are
  stripped with the same regex `parseAdrDecisions` uses, and the heading match is line-anchored
  (`^\s{0,3}##\s+Assumptions\s*$`, case-insensitive). The section ends at the next `##` heading.
  It returns `{ kind: 'ok' }` or `{ kind: 'diagnostics', diagnostics: AdrLedgerDiagnostic[] }`.
  Each diagnostic is `{ rule, entryId?, detail }`, with `rule` drawn from the closed set
  `missing-section | empty-section | malformed-header | malformed-entry | missing-approval |
  contradictory-empty-statement`. It reports **every** offending row, not only the first. The
  required header is exported as `ADR_ASSUMPTION_LEDGER_HEADER` so the template drift test reads
  the same constant.
- **Shared in-scope evaluation (`evaluateAdrAssumptionLedgers`)** is one exported async function in
  a new module, `src/conductor/src/engine/adr-assumption-ledger-scope.ts`. Per
  adr-2026-09-23-one-owner-for-accepted-story-readability, the land rung and the gate predicate may
  not hold two implementations of the same question.
  - Input: `{ worktreePath, baseRef }`, or a pre-resolved merge-base sha.
  - It lists `.docs/decisions/adr-*.md` in the **working tree** (so uncommitted ADRs count) and runs
    `git ls-tree -r --name-only <mergeBase> -- .docs/decisions`.
  - Classification: *added* means the path is absent at the merge base. *Changed* means it is present
    at the merge base with different content (from `git show <mergeBase>:<path>`). Anything else is
    untouched.
  - It returns `{ kind: 'evaluated', failures: Array<{ path, diagnostics }> }` or
    `{ kind: 'merge-base-unresolved', detail }`. Added ADRs are always parsed. Changed ADRs are parsed
    only when their working-tree content contains an `## Assumptions` heading (ADR decision 3).
  - The merge-base resolution mirrors `coverage-binding-decide-set.ts`: prefer `origin/«default»`
    from `originDefaultBranch`, fall back to the local default branch. If neither yields a merge
    base, it returns `merge-base-unresolved` rather than an empty set. This fail-closed rule is ADR
    decision 6, an operator decision.
- **Land rung.** In `engineer/land-spec.ts`'s existing 4e ADR rung, after the approval, citability,
  and filename checks, call `evaluateAdrAssumptionLedgers` with the rung's merge base. Throw
  `landGateError('adr-assumption-ledger', …)` with one message listing every failing ADR path, rule,
  and entry id. Add `'adr-assumption-ledger'` to the `LandGateReason` union. The refusal happens
  before any commit, like the sibling rungs.
- **Conduct rung.** Add `architecture_review` to `GATE_ONLY_PREDICATES` in `artifacts.ts`, calling
  `evaluateAdrAssumptionLedgers` on the feature worktree. Flip `architecture_review` in
  `src/conductor/src/engine/steps.ts` to `enforcement: 'gating'`, keeping `skippableForTiers: ['S']`
  and `kickbackTarget: true`. Built-in step enforcement cannot be overridden by config
  (`config.ts` rejects `steps.<built-in>.enforcement`), so the flip is the only switch. ADR
  assumption A3 says the step-generic gate-verdict path (`checkGateCompletion` →
  `computeAndWriteVerdict`) evaluates the new entry. Task 9 proves this with a conductor-level test
  and wires the call for this step if the proof fails (review condition C1).
- **Discovery is untouched.** `daemon-backlog.ts` gains no ledger call (ADR decision 7). Task 7 pins
  that a merged unledgered ADR does not block its spec.
- **Authoring.** `skills/architecture-review/templates/adr.md.template` gains the section, with a
  placeholder row whose values are invalid on purpose, plus the empty-statement option.
  `skills/architecture-review/SKILL.md` and `skills/verify-claims/SKILL.md` name the table and the
  marker form.

**Focused local pattern (parser and land rung, Tasks 1-6).** Follow the citability work:
`parseAdrDecisions` / `AdrDecisionParseResult` in `artifacts.ts` and the
`landGateError('adr-uncitable-decision'` rung with its `uncitableAdrs` accumulator in
`land-spec.ts`. Traits to keep:
- a pure function returning a discriminated result;
- fences stripped before matching;
- a land refusal that names every offending file with a remedy sentence;
- fixtures written as literal ADR text in tests.

Allowed variation: return all diagnostics per ADR instead of a single diagnostic. Search hints:
`parseAdrDecisions`, `adr-uncitable-decision`, `APPROVED_UNCITABLE_ADR` in
`test/engine/engineer/land-spec.test.ts`.

## Prerequisites

- None. No migrations, packages, or config changes.

## Tasks

### Task 1: Parser accepts a well-formed ledger and the explicit empty statement
**Story:** Story 1 happy paths 1-3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/adr-assumption-ledger.test.ts` with literal ADR fixtures: (a) a full ledger table with header `| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |` and valid rows `A1`, `A2`; (b) a section containing only `No load-bearing assumptions.`; (c) that statement followed by a table whose every row has Load-bearing `no`.
2. Verify the tests fail (RED): `parseAdrAssumptionLedger` does not exist.
3. Implement `parseAdrAssumptionLedger` and export `ADR_ASSUMPTION_LEDGER_HEADER` in `src/conductor/src/engine/artifacts.ts`, following the focused local pattern (strip fences with the `parseAdrDecisions` regex, line-anchored `## Assumptions` heading, section ends at the next `##`).
4. Verify the tests pass (GREEN).
5. Commit: "feat(artifacts): parse ADR assumption ledgers".

**Done when:**
- [test] `parseAdrAssumptionLedger` returns `{ kind: 'ok' }` for the full valid ledger-table fixture with rows A1 and A2.
- [test] `parseAdrAssumptionLedger` returns `{ kind: 'ok' }` for a section containing only `No load-bearing assumptions.`.
- [test] `parseAdrAssumptionLedger` returns `{ kind: 'ok' }` for the empty statement followed by a table whose every row has Load-bearing `no`.
- `ADR_ASSUMPTION_LEDGER_HEADER` is exported from `artifacts.ts` and equals the seven-column header string used in the fixtures.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — new parser, result types, header constant
- `src/conductor/test/engine/adr-assumption-ledger.test.ts` — new unit tests

**Dependencies:** none

### Task 2: Parser diagnoses missing, empty, misheaded, and contradictory sections
**Story:** Story 1 negative paths 1, 2, 3, 4, and 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/adr-assumption-ledger.test.ts` for: no heading; heading only inside a fenced block; heading immediately followed by the next `##`; header missing `Load-bearing`, and a header with columns reordered; empty statement plus a row with Load-bearing `yes`; two `## Assumptions` headings; a correct header with no data rows (ADR decision 1).
2. Verify RED.
3. Implement the section-level rules in `parseAdrAssumptionLedger`.
4. Verify GREEN.
5. Commit: "feat(artifacts): diagnose malformed ADR ledger sections".

**Done when:**
- [test] An ADR with no `## Assumptions` heading, and an ADR whose only such heading is inside a fenced code block, each yield a diagnostic with rule `missing-section`.
- [test] An `## Assumptions` heading followed directly by the next `##` heading yields rule `empty-section`.
- [test] A ledger header omitting `Load-bearing`, and a header with columns reordered, each yield rule `malformed-header`.
- [test] `No load-bearing assumptions.` together with a table row whose Load-bearing is `yes` yields rule `contradictory-empty-statement`.
- [test] An ADR with two `## Assumptions` headings yields rule `malformed-header` whose detail names the duplicate heading, and a correct ledger header with no data rows yields rule `empty-section`.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — section-level rules
- `src/conductor/test/engine/adr-assumption-ledger.test.ts` — negative tests

**Dependencies:** Task 1

### Task 3: Parser reports every malformed ledger row by id
**Story:** Story 1 negative paths 5, 6, and 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/adr-assumption-ledger.test.ts`: rows `A1` Basis `guessed`, `A2` Confidence `high`, `A3` empty Impact; two rows both `A1`; a row with Confidence `140%`.
2. Verify RED.
3. Implement per-row validation (id `A<n>` unique; non-empty Assumption and Impact; Basis in verified/inferred/unverified case-insensitive; Confidence integer 0-100 followed by `%`; Load-bearing yes/no), accumulating every failure instead of stopping at the first.
4. Verify GREEN.
5. Commit: "feat(artifacts): validate every ADR ledger row".

**Done when:**
- [test] The three-bad-row fixture yields exactly three `malformed-entry` diagnostics whose `entryId`s are `A1`, `A2`, and `A3`.
- [test] A ledger with two rows both using id `A1` yields a `malformed-entry` diagnostic naming the duplicated id `A1`.
- [test] A row with Confidence `140%` yields a `malformed-entry` diagnostic naming that row's id.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — row validation
- `src/conductor/test/engine/adr-assumption-ledger.test.ts` — row tests

**Dependencies:** Task 1

### Task 4: Load-bearing non-verified rows require a dated operator approval marker
**Story:** Story 2 happy paths 1-3 and negative paths 1-4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/adr-assumption-ledger.test.ts`: (yes, inferred, `APPROVED by operator 2026-10-10`); (yes, verified, `—`); (no, unverified, empty); (yes, unverified, `—`) as `A2`; (yes, inferred, `PENDING`) as `A3`; (yes, inferred, `APPROVED by operator 2026-02-30`) as `A4`; (yes, inferred, `approved`).
2. Verify RED.
3. Implement the approval rule: when Load-bearing is `yes` and Basis is not `verified`, Approval must match `^APPROVED by operator (\d{4})-(\d{2})-(\d{2})$`, and the date must round-trip through a UTC `Date` (the `isCanonicalAdrFilename` calendar check). Otherwise emit `missing-approval` with the row id. Other rows are never checked for approval.
4. Verify GREEN.
5. Commit: "feat(artifacts): require operator approval on unverified load-bearing assumptions".

**Done when:**
- [test] Rows (yes, inferred, `APPROVED by operator 2026-10-10`), (yes, verified, `—`), and (no, unverified, empty Approval) raise no diagnostic from `parseAdrAssumptionLedger`.
- [test] Rows `A2` (yes, unverified, `—`) and `A3` (yes, inferred, `PENDING`) each yield a `missing-approval` diagnostic naming that row id.
- [test] Row `A4` with `APPROVED by operator 2026-02-30` yields `missing-approval` naming `A4`, because the calendar check rejects the date.
- [test] A load-bearing inferred row with Approval `approved` yields `missing-approval`, because the marker lacks the `by operator YYYY-MM-DD` form.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — approval rule
- `src/conductor/test/engine/adr-assumption-ledger.test.ts` — approval tests

**Dependencies:** Task 1

### Task 5: Shared in-scope ADR evaluation over the working tree and merge base
**Story:** Story 3 happy paths 3 and 4; Story 4 happy path 2 and negative paths 3 and 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/adr-assumption-ledger-scope.test.ts` using real temporary git repos (base commit on `main`, feature branch):
   - a pre-existing ADR without the section, changed on the branch (status flipped to `SUPERSEDED by …`);
   - untouched pre-existing unledgered ADRs;
   - a branch whose ADRs all exist at the merge base;
   - an added ADR left uncommitted that lacks the section;
   - an `origin/main`-absent repo that falls back to local `main`;
   - a repo where no merge base can be resolved.
2. Verify RED.
3. Implement `evaluateAdrAssumptionLedgers` in the new module `src/conductor/src/engine/adr-assumption-ledger-scope.ts`, as described in Technical Approach. Reuse `makeGitRunner`, `originDefaultBranch`, and the merge-base helper from `rebase.js`, the same imports `coverage-binding-decide-set.ts` uses. Return `merge-base-unresolved` rather than treating an unknown diff as empty.
4. Verify GREEN.
5. Commit: "feat(engine): evaluate in-scope ADR ledgers against the merge base".

**Done when:**
- [test] `evaluateAdrAssumptionLedgers` returns `{ kind: 'evaluated', failures: [] }` when the only touched ADR is a pre-existing one with no `## Assumptions` heading whose status was changed, and no ledger is required of it.
- [test] `evaluateAdrAssumptionLedgers` returns no failure for untouched pre-existing ADRs lacking the section, and returns `failures: []` without parsing when every ADR exists unchanged in the merge-base tree.
- [test] An added ADR that is uncommitted in the working tree and lacks the section appears in `failures` with rule `missing-section`.
- [test] With no `origin/main` ref, the merge base falls back to local `main`; with no resolvable merge base, the result is `{ kind: 'merge-base-unresolved' }` whose detail says the merge base could not be resolved.

**Files likely touched:**
- `src/conductor/src/engine/adr-assumption-ledger-scope.ts` — new shared evaluation
- `src/conductor/test/engine/adr-assumption-ledger-scope.test.ts` — git-backed tests

**Dependencies:** Tasks 1, 2, 3, 4

### Task 6: Compose land refuses specs whose in-scope ADRs fail the ledger contract
**Story:** Story 3 happy paths 1-4 and negative paths 1-3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-spec-adr-assumption-ledger.test.ts`. Drive `landSpec` (the function behind `ai-conductor compose land`) against real temporary git worktrees:
   - an added APPROVED ADR with a valid ledger;
   - an added ADR whose section is `No load-bearing assumptions.`;
   - a changed legacy ADR without the heading;
   - a spec adding no ADR over untouched unledgered ADRs;
   - an added ADR with no section;
   - two added ADRs, one missing its section and one with a `missing-approval` row `A2`;
   - a changed pre-existing ADR that already has the section and gains a malformed row `A5`.
2. Verify RED.
3. Implement, following the focused local pattern (`adr-uncitable-decision` rung):
   - add `'adr-assumption-ledger'` to the `LandGateReason` union in `src/conductor/src/engine/engineer/land-spec.ts`;
   - in the 4e ADR rung, call `evaluateAdrAssumptionLedgers` with the rung's merge base;
   - throw `landGateError('adr-assumption-ledger', …)` with one message listing every failing ADR path, rule, and entry id, plus a remedy sentence naming the template's `## Assumptions` section;
   - treat `merge-base-unresolved` as a refusal with the same reason.
4. Verify GREEN.
5. Commit: "feat(land): refuse specs whose new ADRs lack a valid assumption ledger".

**Done when:**
- [test] `landSpec` completes and commits the spec for an added APPROVED ADR with a valid ledger, and for an added ADR whose section is `No load-bearing assumptions.`.
- [test] `landSpec` completes for a spec that changes a legacy ADR lacking the heading and for a spec that adds no ADR over untouched unledgered ADRs, raising no ledger diagnostic.
- [test] For an added ADR with no section, `landSpec` rejects with reason `adr-assumption-ledger`, a message naming the ADR path and `missing-section`, and the branch HEAD unchanged (nothing committed).
- [test] For two failing added ADRs, a single `landSpec` rejection message names both ADR paths, `missing-section`, `missing-approval`, and `A2`.
- [test] For a changed pre-existing ADR already carrying the section with malformed row `A5`, `landSpec` rejects with reason `adr-assumption-ledger` naming that ADR and `A5`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/land-spec.ts` — reason union member and ledger rung
- `src/conductor/test/engine/engineer/land-spec-adr-assumption-ledger.test.ts` — land tests

**Dependencies:** Task 5

### Task 7: Daemon discovery keeps building merged specs whose ADRs lack a ledger
**Story:** Story 3 negative path 4
**Type:** negative-path

**Steps:**
1. Write a test in `src/conductor/test/engine/daemon-backlog.test.ts`, using the file's existing base-tree fixture helpers: a merged, otherwise-eligible spec whose APPROVED ADR on the base branch has no `## Assumptions` section.
2. Run it against the current code. It should pass, because discovery has no ledger rung (ADR decision 7). If it fails, stop and report: that would contradict decision 7.
3. Commit the test: "test(daemon-backlog): unledgered merged ADRs do not block discovery".

**Done when:**
- [test] Daemon backlog discovery returns the merged spec as an eligible backlog item and records no blocked item for it when its APPROVED ADR has no `## Assumptions` section.
- `src/conductor/src/engine/daemon-backlog.ts` contains no reference to `parseAdrAssumptionLedger` or `evaluateAdrAssumptionLedgers`.

**Files likely touched:**
- `src/conductor/test/engine/daemon-backlog.test.ts` — discovery regression test

**Dependencies:** Task 1

### Task 8: `architecture_review` gate-only predicate applies the shared evaluation
**Story:** Story 4 happy paths 1-2 and negative paths 3-4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-scope-adr-assumption-ledger.test.ts`, calling `GATE_ONLY_PREDICATES.architecture_review!` against real temporary git worktrees (the pattern of `gate-scope-441.test.ts`):
   - an added ADR with a valid ledger, once committed and once uncommitted;
   - a worktree whose ADRs all exist at the merge base and all lack the section;
   - an uncommitted added ADR lacking the section;
   - a repo with no `origin/main` that falls back to local `main`;
   - a repo with no resolvable merge base.
2. Verify RED.
3. Implement the `architecture_review` entry in `GATE_ONLY_PREDICATES` (`src/conductor/src/engine/artifacts.ts`). It calls `evaluateAdrAssumptionLedgers` on the gate's directory and maps the result to `CompletionResult`: `done: true` when there are no failures; otherwise `done: false`, with a reason naming each ADR path, rule, and entry id, or saying the merge base could not be resolved.
4. Verify GREEN.
5. Commit: "feat(gates): gate architecture_review on new ADR assumption ledgers".

**Done when:**
- [test] `GATE_ONLY_PREDICATES.architecture_review` returns `done: true` for an added ADR with a valid ledger, both committed and uncommitted.
- [test] `GATE_ONLY_PREDICATES.architecture_review` returns `done: true` for a worktree whose ADRs all exist unchanged in the merge-base tree and all lack an `## Assumptions` section (daemon-build shape, assumption A5), proving no ledger is read for them because parsing any of them would fail.
- [test] For an uncommitted added ADR lacking the section, the predicate returns `done: false` with a reason naming the ADR path and `missing-section`.
- [test] With no `origin/main` the predicate uses local `main`; with no resolvable merge base it returns `done: false` with a reason stating the merge base could not be resolved.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `GATE_ONLY_PREDICATES.architecture_review`
- `src/conductor/test/engine/gate-scope-adr-assumption-ledger.test.ts` — predicate tests

**Dependencies:** Task 5

### Task 9: `architecture_review` becomes gating and blocks conductor runs on a bad ledger
**Story:** Story 4 happy path 3 and negative paths 1-2
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - In `src/conductor/test/engine/steps.test.ts`: `architecture_review` declares `enforcement: 'gating'`, `skippableForTiers` equal to `['S']`, and `kickbackTarget: true`.
   - In `src/conductor/test/engine/conductor.test.ts`, using its existing auto-mode harness: an auto-mode run whose feature worktree adds an ADR with no `## Assumptions` section, which must halt rather than record `architecture_review` as skipped.
   - An interactive-mode run with an added ADR whose row `A3` lacks approval, where the step must not be marked done and the failure reason must name the ADR and `A3`.
   - A tier-S run, where `architecture_review` is still skipped for the tier.
2. Verify RED.
3. Change `architecture_review` in `src/conductor/src/engine/steps.ts` to `enforcement: 'gating'`. If the auto-mode test shows the conductor does not evaluate `GATE_ONLY_PREDICATES.architecture_review` when the step finishes (assumption A3), wire `computeAndWriteVerdict` for this step at the DECIDE-step completion site in `src/conductor/src/engine/conductor.ts`, the same way the `stories` and `plan` gate verdicts are reached.
4. Verify GREEN.
5. Commit: "feat(steps): make architecture_review gating so ledger failures block".

**Done when:**
- [test] `steps.test.ts` asserts `architecture_review` has `enforcement: 'gating'`, `skippableForTiers` `['S']`, and `kickbackTarget: true`.
- [test] In an auto-mode conductor run whose worktree adds an unledgered ADR, the `architecture_review` gate verdict is unsatisfied with a reason naming the ADR and `missing-section`, the run halts, and the step status is not `skipped`.
- [test] In an interactive conductor run with an added ADR whose row `A3` lacks approval, `architecture_review` is not marked `done` and the recorded failure reason names the ADR and `A3`.
- [test] In a tier-S conductor run, `architecture_review` is recorded as skipped for the tier, as before.

**Files likely touched:**
- `src/conductor/src/engine/steps.ts` — enforcement flip
- `src/conductor/src/engine/conductor.ts` — gate-verdict wiring for the step, only if the A3 proof fails
- `src/conductor/test/engine/steps.test.ts` — step definition test
- `src/conductor/test/engine/conductor.test.ts` — auto, interactive, and tier-S runs

**Dependencies:** Task 8

### Task 10: ADR template carries the ledger section the parser requires
**Story:** Story 5 happy paths 1-2 and negative paths 1-2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/adr-template-assumption-ledger.test.ts`:
   - read `skills/architecture-review/templates/adr.md.template` and assert its `## Assumptions` table header equals `ADR_ASSUMPTION_LEDGER_HEADER`, reporting any column that differs;
   - assert the template shows the `No load-bearing assumptions.` alternative;
   - parse an ADR built from the template with the placeholder row replaced by valid values, including a load-bearing `yes` row, and the empty-statement line removed as the template instructs, which should be `ok`;
   - parse the template's section with the placeholder row left unfilled, which should give `malformed-entry`.
2. Verify RED.
3. Add the `## Assumptions` section to `skills/architecture-review/templates/adr.md.template`, between `## Decision` and `## Consequences`. Include the exact header, one placeholder row whose Basis, Confidence, and Load-bearing are `{{…}}` placeholders (invalid as values on purpose), the empty-statement alternative (introduced by an instruction line saying to keep either the table or that statement, never a load-bearing `yes` row together with it), and a one-line note on the approval marker form `APPROVED by operator YYYY-MM-DD`. Leave the status vocabulary and `## Decision` guidance unchanged.
4. Verify GREEN.
5. Commit: "feat(templates): add the assumption ledger to the ADR template".

**Done when:**
- [test] The drift test asserts the template's `## Assumptions` header equals `ADR_ASSUMPTION_LEDGER_HEADER` and, on mismatch, fails with a message naming the first differing column.
- [test] The template contains the line `No load-bearing assumptions.` inside its `## Assumptions` section.
- [test] `parseAdrAssumptionLedger` returns `ok` for an ADR built from the template with its placeholder row replaced by valid values (including a load-bearing `yes` row) and the empty-statement line removed as the template instructs.
- [test] `parseAdrAssumptionLedger` returns `malformed-entry` for the template's section with the placeholder row left unfilled.

**Files likely touched:**
- `skills/architecture-review/templates/adr.md.template` — new section
- `src/conductor/test/engine/adr-template-assumption-ledger.test.ts` — template tests

**Dependencies:** Tasks 1, 3, 4

### Task 11: Authoring skills require the ledger table and the approval marker
**Story:** Story 5 happy path 3
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/adr-template-assumption-ledger.test.ts`. It asserts that `skills/architecture-review/SKILL.md` §7 and `skills/verify-claims/SKILL.md` Practice 5 each contain the literal `## Assumptions` and `APPROVED by operator YYYY-MM-DD`.
2. Verify RED.
3. Edit `skills/architecture-review/SKILL.md` §7 (ADR format) to require the `## Assumptions` section in every new ADR, enforced at land and at the architecture_review gate. Edit `skills/verify-claims/SKILL.md` Practice 5 to state that an ADR's ledger takes the template's `## Assumptions` table form with the approval marker `APPROVED by operator YYYY-MM-DD`.
4. Verify GREEN.
5. Commit: "feat(skills): require the ADR assumption ledger in authoring skills".

**Done when:**
- [test] The skill-text test asserts `skills/architecture-review/SKILL.md` contains `## Assumptions` and `APPROVED by operator YYYY-MM-DD` in its ADR-format practice, naming the section as required in every new ADR.
- [test] The skill-text test asserts `skills/verify-claims/SKILL.md` contains `## Assumptions` and `APPROVED by operator YYYY-MM-DD` in its ledger-recording practice.

**Files likely touched:**
- `skills/architecture-review/SKILL.md` — §7 ADR format
- `skills/verify-claims/SKILL.md` — Practice 5
- `src/conductor/test/engine/adr-template-assumption-ledger.test.ts` — skill-text assertions

**Dependencies:** Task 10

## Task Dependency Graph

```text
Task 1 ─┬─ Task 2 ─┐
        ├─ Task 3 ─┼─ Task 5 ─┬─ Task 6
        ├─ Task 4 ─┘          └─ Task 8 ─ Task 9
        ├─ Task 7
        └─ (Tasks 1,3,4) ─ Task 10 ─ Task 11
```

## Integration Points

- After Task 6: `ai-conductor compose land` refuses an unledgered new ADR end to end.
- After Task 9: a `/conduct` run halts at `architecture_review` on an unledgered new ADR.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an ADR whose `## Assumptions` section holds a table whose header has exactly the seven columns `#`, `Assumption`, `Basis`, `Confidence`, `Load-bearing`, `Impact if wrong`, `Approval` in that order, and rows each with a unique `A<n>` id, non-empty Assumption and Impact, Basis in {verified, inferred, unverified}, Confidence an integer 0-100 followed by `%`, and Load-bearing in {yes, no}, when the ledger is parsed, then the result is `ok`. | 1 | "returns `{ kind: 'ok' }` for the full valid ledger-table fixture" | diff-local |
| Story 1 happy: Given an ADR whose `## Assumptions` section contains only the line `No load-bearing assumptions.`, when the ledger is parsed, then the result is `ok`. | 1 | "returns `{ kind: 'ok' }` for a section containing only `No load-bearing assumptions.`" | diff-local |
| Story 1 happy: Given an ADR whose section holds `No load-bearing assumptions.` followed by a table whose every row has Load-bearing `no`, when the ledger is parsed, then the result is `ok`. | 1 | "for the empty statement followed by a table whose every row has Load-bearing `no`" | diff-local |
| Story 1 negative: Given an ADR with no `## Assumptions` heading, when the ledger is parsed, then the result is a diagnostic with rule `missing-section`. | 2 | "each yield a diagnostic with rule `missing-section`" | diff-local |
| Story 1 negative: Given an ADR whose only `## Assumptions` heading appears inside a fenced code block, when the ledger is parsed, then the result is a diagnostic with rule `missing-section`. | 2 | "each yield a diagnostic with rule `missing-section`" | diff-local |
| Story 1 negative: Given an ADR whose `## Assumptions` heading is followed directly by the next `##` heading, when the ledger is parsed, then the result is a diagnostic with rule `empty-section`. | 2 | "followed directly by the next `##` heading yields rule `empty-section`" | diff-local |
| Story 1 negative: Given a ledger table whose header omits the `Load-bearing` column or orders columns differently, when the ledger is parsed, then the result is a diagnostic with rule `malformed-header`. | 2 | "each yield rule `malformed-header`" | diff-local |
| Story 1 negative: Given a ledger with rows `A1` (Basis `guessed`), `A2` (Confidence `high`), and `A3` (empty Impact if wrong), when the ledger is parsed, then the result carries three `malformed-entry` diagnostics naming `A1`, `A2`, and `A3`, not only the first. | 3 | "exactly three `malformed-entry` diagnostics whose `entryId`s are `A1`, `A2`, and `A3`" | diff-local |
| Story 1 negative: Given a ledger where two rows both use id `A1`, when the ledger is parsed, then the result is a `malformed-entry` diagnostic naming the duplicated id `A1`. | 3 | "naming the duplicated id `A1`" | diff-local |
| Story 1 negative: Given a ledger row with Confidence `140%`, when the ledger is parsed, then the result is a `malformed-entry` diagnostic naming that row. | 3 | "A row with Confidence `140%` yields a `malformed-entry` diagnostic naming that row's id" | diff-local |
| Story 1 negative: Given a section holding `No load-bearing assumptions.` and a table with a row whose Load-bearing is `yes`, when the ledger is parsed, then the result is a diagnostic with rule `contradictory-empty-statement`. | 2 | "yields rule `contradictory-empty-statement`" | diff-local |
| Story 2 happy: Given a ledger row with Load-bearing `yes`, Basis `inferred`, and Approval `APPROVED by operator 2026-10-10`, when the ledger is parsed, then that row raises no diagnostic. | 4 | "(yes, inferred, `APPROVED by operator 2026-10-10`)" | diff-local |
| Story 2 happy: Given a ledger row with Load-bearing `yes`, Basis `verified`, and Approval `—`, when the ledger is parsed, then that row raises no diagnostic. | 4 | "(yes, verified, `—`)" | diff-local |
| Story 2 happy: Given a ledger row with Load-bearing `no`, Basis `unverified`, and an empty Approval cell, when the ledger is parsed, then that row raises no diagnostic. | 4 | "(no, unverified, empty Approval) raise no diagnostic" | diff-local |
| Story 2 negative: Given a ledger row `A2` with Load-bearing `yes`, Basis `unverified`, and Approval `—`, when the ledger is parsed, then the result is a `missing-approval` diagnostic naming `A2`. | 4 | "Rows `A2` (yes, unverified, `—`)" | diff-local |
| Story 2 negative: Given a ledger row `A3` with Load-bearing `yes`, Basis `inferred`, and Approval `PENDING`, when the ledger is parsed, then the result is a `missing-approval` diagnostic naming `A3`. | 4 | "`A3` (yes, inferred, `PENDING`) each yield a `missing-approval` diagnostic naming that row id" | diff-local |
| Story 2 negative: Given a ledger row `A4` with Load-bearing `yes`, Basis `inferred`, and Approval `APPROVED by operator 2026-02-30`, when the ledger is parsed, then the result is a `missing-approval` diagnostic naming `A4`, because the date is not a valid calendar date. | 4 | "because the calendar check rejects the date" | diff-local |
| Story 2 negative: Given a ledger row with Load-bearing `yes`, Basis `inferred`, and Approval `approved`, when the ledger is parsed, then the result is a `missing-approval` diagnostic, because the marker lacks the `by operator YYYY-MM-DD` form. | 4 | "because the marker lacks the `by operator YYYY-MM-DD` form" | diff-local |
| Story 3 happy: Given a spec worktree that adds an APPROVED ADR with a valid ledger, when `compose land` runs, then the ADR rung passes and the spec commits as before. | 6 | "commits the spec for an added APPROVED ADR with a valid ledger" | diff-local |
| Story 3 happy: Given a spec worktree that adds an APPROVED ADR whose section is `No load-bearing assumptions.`, when `compose land` runs, then the ADR rung passes. | 6 | "for an added ADR whose section is `No load-bearing assumptions.`" | diff-local |
| Story 3 happy: Given a spec that changes a pre-existing ADR with no `## Assumptions` heading (for example, flipping its status to `SUPERSEDED by …`), when `compose land` runs, then no ledger is required of that ADR and the rung passes. | 5, 6 | "whose status was changed, and no ledger is required of it" | diff-local |
| Story 3 happy: Given a repository whose untouched pre-existing ADRs carry no `## Assumptions` section, when `compose land` runs for a spec that adds none, then no ledger diagnostic is raised for any of them. | 5, 6 | "returns no failure for untouched pre-existing ADRs lacking the section" | diff-local |
| Story 3 negative: Given a spec worktree that adds an ADR with no `## Assumptions` section, when `compose land` runs, then landing is refused with reason `adr-assumption-ledger`, the message names the ADR path and rule `missing-section`, and nothing is committed. | 6 | "the branch HEAD unchanged (nothing committed)" | diff-local |
| Story 3 negative: Given a spec that adds two ADRs, one missing its section and one with a `missing-approval` row `A2`, when `compose land` runs, then a single refusal names both ADRs, `missing-section`, `missing-approval`, and `A2`. | 6 | "a single `landSpec` rejection message names both ADR paths, `missing-section`, `missing-approval`, and `A2`" | diff-local |
| Story 3 negative: Given a spec that changes a pre-existing ADR which already carries an `## Assumptions` section and introduces a malformed row `A5`, when `compose land` runs, then landing is refused with reason `adr-assumption-ledger` naming that ADR and `A5`. | 6 | "rejects with reason `adr-assumption-ledger` naming that ADR and `A5`" | diff-local |
| Story 3 negative: Given a spec already merged to the default branch whose ADR has no ledger, when daemon discovery evaluates the backlog, then the spec is not blocked or skipped for the missing ledger. | 7 | "returns the merged spec as an eligible backlog item and records no blocked item for it" | diff-local |
| Story 4 happy: Given a feature worktree whose newly added ADR (committed or uncommitted) has a valid ledger, when the `architecture_review` gate is evaluated, then it is satisfied. | 8 | "returns `done: true` for an added ADR with a valid ledger, both committed and uncommitted" | diff-local |
| Story 4 happy: Given a feature worktree whose ADRs all already exist in the merge-base tree (the shape of a daemon build of a merged spec), when the `architecture_review` gate is evaluated, then it is satisfied without reading any ledger. | 8 | "proving no ledger is read for them because parsing any of them would fail" | diff-local |
| Story 4 happy: Given a tier-S feature, when the conductor reaches `architecture_review`, then the step is still skipped for the tier as before. | 9 | "`architecture_review` is recorded as skipped for the tier, as before" | diff-local |
| Story 4 negative: Given an auto-mode run whose feature worktree adds an ADR with no `## Assumptions` section, when `architecture_review` finishes, then the gate verdict is unsatisfied with a reason naming the ADR and `missing-section`, and the run halts for a human instead of recording the step as skipped. | 9 | "the run halts, and the step status is not `skipped`" | diff-local |
| Story 4 negative: Given an interactive run whose feature worktree adds an ADR with a `missing-approval` row `A3`, when `architecture_review` finishes, then the step is not marked done and the failure reason names the ADR and `A3`. | 9 | "`architecture_review` is not marked `done` and the recorded failure reason names the ADR and `A3`" | diff-local |
| Story 4 negative: Given a feature worktree that adds an ADR which is still uncommitted and lacks the section, when the gate is evaluated, then it is unsatisfied, because the check reads the working tree and does not wait for a commit. | 8 | "For an uncommitted added ADR lacking the section, the predicate returns `done: false` with a reason naming the ADR path and `missing-section`" | diff-local |
| Story 4 negative: Given a worktree with no reachable `origin/«default»` ref, when the gate is evaluated, then it falls back to the local default branch for the merge base, as `coverage-binding-decide-set.ts` does. If no merge base can be determined, it is unsatisfied with a reason saying the merge base could not be resolved, rather than passing. | 8 | "with no resolvable merge base it returns `done: false` with a reason stating the merge base could not be resolved" | diff-local |
| Story 5 happy: Given the shipped `skills/architecture-review/templates/adr.md.template`, when it is read, then it contains an `## Assumptions` section whose table header is exactly the column header the parser requires, and it shows the `No load-bearing assumptions.` alternative. | 10 | "asserts the template's `## Assumptions` header equals `ADR_ASSUMPTION_LEDGER_HEADER`" | diff-local |
| Story 5 happy: Given an ADR produced from the template with its placeholder rows replaced by real values meeting Story 1 and Story 2, when the ledger is parsed, then the result is `ok`. | 10 | "returns `ok` for an ADR built from the template with its placeholder row replaced by valid values" | diff-local |
| Story 5 happy: Given `skills/architecture-review/SKILL.md` and `skills/verify-claims/SKILL.md`, when an author reads the ADR-authoring and ledger-recording practices, then both name the `## Assumptions` table as required in every new ADR and state the approval-marker form `APPROVED by operator YYYY-MM-DD`. | 11 | "`skills/architecture-review/SKILL.md` contains `## Assumptions` and `APPROVED by operator YYYY-MM-DD`" | diff-local |
| Story 5 negative: Given an ADR copied from the template with its placeholder row left unfilled, when the ledger is parsed, then it is rejected with `malformed-entry` (placeholder values are not valid Basis, Confidence, or Load-bearing values), so an untouched template cannot pass the gate. | 10 | "returns `malformed-entry` for the template's section with the placeholder row left unfilled" | diff-local |
| Story 5 negative: Given the template's `## Assumptions` header is edited so that a column is renamed or reordered, when the template-drift test runs, then it fails and names the column that no longer matches the parser's required header. | 10 | "fails with a message naming the first differing column" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-adr-assumption-ledger-contract#D1 | task | task-1, task-2, task-3 | yield a diagnostic with rule `missing-section` |
| adr-2026-10-10-adr-assumption-ledger-contract#D2 | task | task-4 | each yield a `missing-approval` diagnostic naming that row id |
| adr-2026-10-10-adr-assumption-ledger-contract#D3 | task | task-5 | appears in `failures` with rule `missing-section` |
| adr-2026-10-10-adr-assumption-ledger-contract#D4 | task | task-1 | `ADR_ASSUMPTION_LEDGER_HEADER` is exported from `artifacts.ts` |
| adr-2026-10-10-adr-assumption-ledger-contract#D5 | task | task-6 | rejects with reason `adr-assumption-ledger` |
| adr-2026-10-10-adr-assumption-ledger-contract#D6 | task | task-8, task-9 | asserts `architecture_review` has `enforcement: 'gating'` |
| adr-2026-10-10-adr-assumption-ledger-contract#D7 | task | task-7 | contains no reference to `parseAdrAssumptionLedger` or `evaluateAdrAssumptionLedgers` |
| adr-2026-10-10-adr-assumption-ledger-contract#D8 | task | task-10, task-11 | The template contains the line `No load-bearing assumptions.` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
