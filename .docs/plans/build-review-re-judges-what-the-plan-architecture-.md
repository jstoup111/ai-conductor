# Implementation Plan: One owner per review question (#1805)

**Date:** 2026-08-22
**Design:** .docs/specs/build-review-re-judges-what-the-plan-architecture-.md
**Stories:** .docs/stories/build-review-re-judges-what-the-plan-architecture-.md
**Conflict check:** Clean as of 2026-08-22 (one degrading resolved in place)

## Summary

Retires three build_review rubrics, makes build_review a registry-driven opt-in container with one
reshaped `test-quality` rubric, evidences `Done when:` at task close, re-keys `prd_audit` to stories
with graded findings and an engine-enforced capped kickback, makes the as-built review run always
with a `PLAN_GAP` verdict, and keeps old config and old plans working. 32 tasks.

## Technical Approach

- **Ownership** follows adr-2026-08-22-one-owner-per-review-question. Nothing new judges at
  BUILD except the opt-in `test-quality` rubric; `prd_audit` is the completion authority at SHIP.
- **Container.** `build-review-registry.ts` becomes the single source of rubric membership.
  `coordinateBuildReviewRubrics` dispatches only registered + enabled rubrics; an empty set
  short-circuits to PASS with spine reason `build_review_no_rubrics`. Config keeps the old rubric
  ids on an accepted-deprecated list (precedent: the `wiring` key in adr-2026-08-14) and warns once
  per load with event `config_deprecated_key`. The `config.ts:1093` "at least one enabled rubric"
  error is removed.
- **test-quality** is `build-review-tautology` renamed and re-contracted: projection = changed
  tests (merge-base..HEAD) ∩ tests carrying a resolvable `Covers:` marker (`FR-N`, `S<n>.<m>`,
  `task:<id>`); preflight runs only when enabled and non-empty and is carried as typed evidence;
  the only concern kind is `test-insensitive` with a `content-region` anchor (three-kind schema
  preserved). The `Covers:` grammar lives in one parser used by the projection builder.
- **Done when: at task close.** A parser in `plan-task-parse.ts` extracts per-task checks. The
  task-close path (`task-cli.ts` complete → `task-progress.ts`) requires one `doneWhen` evidence
  entry per check when the block exists, writes them engine-side on the task-status record
  (adr-2026-07-05 H1), and halts class `plan-gap` when a check is declared unsatisfiable.
- **prd_audit.** `steps.ts` drops `skippableForTracks`; `GATE_SURFACE.prd_audit` adds
  `.docs/stories/**` and `.docs/specs/**`. The verdict parser (`artifacts.ts` `.pipeline/prd-audit.md`
  reader) gains a per-finding `Grade` column validated against `PASS|FIXABLE|PLAN_GAP|OVER_SCOPE`;
  `FIXABLE` requires resolvable `planTask` + `criterion`. The remediation path in `conductor.ts`
  (before `appendRemediationTasks`) enforces caps from config (`prd_audit.max_remediation_laps`,
  `max_appended_tasks`, `max_appended_ratio`, `halt_on_any_plan_gap`), records `growth` in
  `kickback-ledger.ts`, and appends tasks carrying `Criterion:` and a derived `Done when:` block.
  OVER_SCOPE routing reads an `intentRelation`; an operator-accepted widening record is written
  when an `over-scope` halt is cleared through the mutation port.
- **As-built.** `steps.ts` removes the tier skip and `skipWhenSkipped`; per-check policy keys
  under `architecture_review_as_built.checks.<check>.tiers`; the `.pipeline/architecture-review-as-built.md`
  reader accepts `PLAN_GAP` plus `Outcome delivered: yes|no`; the as-built → build route in the
  SHIP tail is removed.
- **Recorded findings** (harmless OVER_SCOPE, edge PLAN_GAP, as-built PLAN_GAP) are persisted in
  the gate verdict and copied into `.docs/shipped/<slug>.md` under `findings:` by the
  shipped-record writer (`shipment-association.ts` / finish path), shaped for #1810.
- **Backward compat** is tolerant readers: verdict/disposition readers ignore unknown rubric ids
  with a log line; plans without `Done when:` close under the prior rule; pre-existing `rem-*`
  tasks count as authored.
- **Cleanup** deletes the three rubric skills, their engine branches, exemption modules,
  fixtures, tests, model-table rows; `build-review-tautology` is renamed, not deleted.
- **Skill authoring pattern:** when writing or reshaping `build-review-test-quality`, `prd-audit`,
  and `architecture-review` §12, consult `skill-creator`'s effective-skill guidance (not its
  evals) and keep each skill's `## Verification` done-checklist. Search hint: existing
  `skills/build-review-*/SKILL.md` result-contract sections for the judgement-only shape to keep.
- **Sequencing:** Done when: machinery first (1–3) so every later task in this build closes under it; then four independent chains run in parallel — config/registry/container/test-quality (4–7, 11–16), prd_audit (8–9, 17–26), as-built (10, 27–29), and shipped-record/compat (30–31) — before cleanup (32), acceptance (33), and the repo config opt-in (34).
- Tests: unit in `src/conductor/test/*.test.ts`; acceptance in `src/conductor/test/acceptance/`
  with faithful fakes at the provider boundary (no live LLM).

## Prerequisites
- None beyond HEAD of main at 2026-08-22 (#1808 hotfix present).

## Tasks
### Task 1: Done when: block parser per plan task
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: `plan-task-parse.test.ts` — `parsePlanTaskDoneWhen(text)` returns a map taskId → ordered check strings for a fixture with two tasks (one with three checks, one without a block → absent key).
2. Verify RED.
3. Implement in `plan-task-parse.ts` beside `parsePlanTaskPreserves`, same fail-closed style.
4. Verify GREEN; commit "feat(plan): parse Done when: checks per task".

**Done when:**
- The test asserts three checks for the first task and no key for the second.
- A task with an empty `**Done when:**` heading and no checks is reported as malformed, not as absent.

**Files:** src/conductor/src/engine/plan-task-parse.ts; src/conductor/test/plan-task-parse.test.ts

**Dependencies:** none

### Task 2: Task close requires Done when: evidence when the block exists
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: `task-progress.test.ts` — a task with three checks and `--done-when` evidence for all three closes `completed` with three `doneWhen` entries on the record; with two, close is refused and the response names check 3; a task with no block closes as before; a verify-only task with a block closes through the prove-closed path with each check marked `source: 'verify-only'`.
2. Verify RED.
3. Implement in `task-cli.ts` (`complete` accepts repeated `--done-when <n>=<evidence>`) and `task-progress.ts` (engine-owned write; adr-2026-07-05 H1).
4. Verify GREEN; commit "feat(build): task close evidences Done when: checks".

**Done when:**
- The three assertions pass; the refusal message contains the missing check text.
- Task-status JSON for a legacy task has no `doneWhen` key; for a verify-only task every `doneWhen[i].source === 'verify-only'`.

**Files:** src/conductor/src/engine/task-cli.ts; src/conductor/src/engine/task-progress.ts; src/conductor/test/task-progress.test.ts

**Dependencies:** 1

### Task 3: Unsatisfiable Done when: check halts as plan-gap
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: `task-cli` `complete --plan-gap <n> --reason <text>` writes `.pipeline/HALT` with class `plan-gap` naming task and check, appends no task, emits a `loop_halt` event with that class.
2. Verify RED.
3. Implement; add `plan-gap` to the total halt classification (adr-2026-07-28).
4. Verify GREEN; commit "feat(build): plan-gap halt from task close".

**Done when:**
- HALT.class reads `plan-gap`; the halt-classification exhaustiveness test includes it.
- Plan file byte-identical before/after.

**Files:** src/conductor/src/engine/task-cli.ts; src/conductor/src/engine/halt-classification.ts; src/conductor/test/task-cli.test.ts

**Dependencies:** 2

### Task 4: Covers: marker parser accepts FR, story-criterion, and task references
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test: `covers-marker.test.ts` parses `Covers: FR-2, S3.1, task:7` from a leading comment line and from a suite name into `[{kind:'fr',id:'FR-2'},{kind:'criterion',id:'S3.1'},{kind:'task',id:'7'}]`; rejects `S3` and `task:` with a parse error naming the token.
2. Verify RED.
3. Implement `src/conductor/src/engine/covers-marker.ts` exporting `parseCoversMarkers(text)`; grammar is language-agnostic (comment line or suite title, any comment syntax).
4. Verify GREEN; commit "feat(review): Covers: marker parser with FR/criterion/task kinds".

**Done when:**
- `covers-marker.test.ts` passes with the three kinds and the two rejections above.
- The parser has no file-extension or framework branch (grep for `.test.ts`/`describe(` in the module returns nothing).

**Files:** src/conductor/src/engine/covers-marker.ts; src/conductor/test/covers-marker.test.ts

**Dependencies:** 3

### Task 5: Config accepts retired rubric keys as no-ops with a one-time warning
**Story:** 15
**Type:** happy-path

**Steps:**
1. Write failing test: `config.test.ts` — loading `build_review.rubrics.scope.enabled: true` succeeds; `build_review.enabled: true` with every registered rubric disabled loads with no `validation_error`; `warnings` contains exactly one entry naming `scope` and `adr-2026-08-22-build-review-opt-in-rubric-container`; `rootCause` + `causalIntegrity` together no longer error; a never-shipped key still errors.
2. Verify RED.
3. Implement `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS = ['scope','completeness','rootCause','causalIntegrity','tautology','wiring']` in `config.ts`; skip policy validation for them; drop the rootCause/causalIntegrity ambiguity check (search hint: the `validation_error` whose message mentions `causalIntegrity`); emit `config_deprecated_key` once per key per load; remove the rule that rejects an enabled gate with no enabled rubric (search hint: the message `must contain at least one enabled rubric`).
4. Verify GREEN; commit "feat(config): retired build_review rubric keys are accepted no-ops".

**Done when:**
- The five assertions in step 1 pass; the string `must contain at least one enabled rubric` no longer appears in `config.ts`.
- `config_deprecated_key` is a member of the `ConductorEvent` union with a sink row (adr-2026-07-26 exhaustiveness test passes).

**Files:** src/conductor/src/engine/config.ts; src/conductor/src/engine/conductor-events.ts; src/conductor/test/config.test.ts

**Dependencies:** 3

### Task 6: prd_audit cap and as-built per-check config keys
**Story:** 10
**Type:** infrastructure

**Steps:**
1. Write failing test: `config.test.ts` — defaults resolve `prd_audit.max_remediation_laps=1`, `max_appended_tasks=5`, `max_appended_ratio=0.25`, `halt_on_any_plan_gap=false`; `max_remediation_laps: 0` and `max_appended_tasks: 0` each produce a `validation_error` naming the key; `architecture_review_as_built.checks.reachability.tiers: ['M','L']` resolves and an unknown check name errors.
2. Verify RED.
3. Implement schema + defaults in `config.ts`.
4. Verify GREEN; commit "feat(config): prd_audit caps and as-built per-check policy".

**Done when:**
- All assertions in step 1 pass; defaults match the ADR values.
- Ratio outside (0,1] is rejected with the key named.

**Files:** src/conductor/src/engine/config.ts; src/conductor/test/config.test.ts

**Dependencies:** 5

### Task 7: Registry lists only test-quality; retired ids are unregistered
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `build-review-registry.test.ts` — `BUILD_REVIEW_RUBRIC_IDS` equals `['testQuality']`; `isRegisteredRubric('completeness')` is false.
2. Verify RED.
3. Rename the tautology registry entry to `testQuality` (skill `build-review-test-quality`), remove the other three entries and their policy defaults.
4. Verify GREEN; commit "feat(build-review): registry holds only test-quality".

**Done when:**
- The two assertions pass; `grep -n "rootCause\|completeness\|'scope'" build-review-registry.ts` is empty.

**Files:** src/conductor/src/engine/build-review-registry.ts; src/conductor/test/build-review-registry.test.ts

**Dependencies:** 5

### Task 8: prd_audit runs on every track; gate surface includes stories and specs
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: `steps.test.ts` — `prd_audit` has no `skippableForTracks`; `gate-invalidation.test.ts` — editing a fixture stories file or a fixture PRD file (temp-dir fixtures, not repository artifacts) after a prd_audit PASS invalidates it; editing a runtime source file still invalidates.
2. Verify RED.
3. Remove `skippableForTracks` from the `prd_audit` step definition in `steps.ts`; extend `GATE_SURFACE.prd_audit` in `gate-invalidation.ts` (superset invariant kept).
4. Verify GREEN; commit "feat(prd-audit): run on every track; stories/specs in gate surface".

**Done when:**
- The three assertions pass; the `configDisableAllowed` skip still records the config path as reason (existing test).

**Files:** src/conductor/src/engine/steps.ts; src/conductor/src/engine/gate-invalidation.ts; src/conductor/test/steps.test.ts; src/conductor/test/gate-invalidation.test.ts

**Dependencies:** 3

### Task 9: prd_audit verdict parser reads per-criterion rows and grades
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing test: `prd-audit-coverage.test.ts` — a report whose Verdict Table rows are keyed `S2.1` with columns `Grade | Plan task | Evidence` parses; `FIXABLE` with `planTask: 4`, `criterion: S2.1` accepted; `PLAN_GAP` with criterion accepted; PRD-present flag read from `**PRD:** present|none`.
2. Verify RED.
3. Implement in `artifacts.ts` (`.pipeline/prd-audit.md` reader) with a closed grade enum.
4. Verify GREEN; commit "feat(prd-audit): graded per-criterion verdict rows".

**Done when:**
- Assertions pass; `Grade` outside the four → parse error (tested in Task 18).

**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/test/prd-audit-coverage.test.ts

**Dependencies:** 3

### Task 10: As-built step runs on every tier and track
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing test: `steps.test.ts` — `architecture_review_as_built` has no `skippableForTiers` and no `skipWhenSkipped`; the S-tier pinned gate-set test (adr-2026-07-21 D4) includes it.
2. Verify RED.
3. Edit the `architecture_review_as_built` step definition in `steps.ts`; update the pinned set test.
4. Verify GREEN; commit "feat(as-built): run on every tier".

**Done when:**
- Both assertions pass; no other step's skip rules changed (snapshot test).

**Files:** src/conductor/src/engine/steps.ts; src/conductor/test/steps.test.ts

**Dependencies:** 3

### Task 11: Coordinator dispatches only enabled registered rubrics; empty set is PASS
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: `build-review-coordinator.test.ts` with a fake dispatcher — no enabled rubric → verdict PASS, zero dispatches, reason `build_review_no_rubrics`; test-quality enabled → exactly one dispatch.
2. Verify RED.
3. Implement in `build-review-coordinator.ts`; emit the reason on the spine via the existing build_review verdict event.
4. Verify GREEN; commit "feat(build-review): registry-driven dispatch with empty-set PASS".

**Done when:**
- Both assertions pass; the PASS verdict JSON carries `reason: 'build_review_no_rubrics'`.
- The build_review step never calls `appendRemediationTasks` (grep in `build-review-*.ts` returns nothing).

**Files:** src/conductor/src/engine/build-review-coordinator.ts; src/conductor/test/build-review-coordinator.test.ts

**Dependencies:** 7

### Task 12: Verdict validator rejects unregistered rubric ids as mechanical faults
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: `build-review-aggregate.test.ts` — a judged envelope with `rubric: 'completeness'` is rejected with reason naming `completeness` and classified on the mechanical-fault lane, not FAIL.
2. Verify RED.
3. Implement in the envelope validator (`build-review-aggregate.ts` / `build-review-artifacts.ts`).
4. Verify GREEN; commit "fix(build-review): unregistered rubric in a verdict is a mechanical fault".

**Done when:**
- The test passes; the fault reason string contains the rubric id.

**Files:** src/conductor/src/engine/build-review-aggregate.ts; src/conductor/test/build-review-aggregate.test.ts

**Dependencies:** 7

### Task 13: test-quality projection intersects changed tests with Covers:-bound tests
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: `build-review-inputs.test.ts` — fixture diff with three changed test files: one `Covers: S3.1` (criterion exists in the feature's stories file), one `Covers: task:7` (task exists in the feature's plan), one unmarked; projection `inScopeTests` contains the first two; a fourth with `Covers: S9.9` (absent) appears in `unresolvedMarkers` and not in scope. Changed set derives from `git diff <mergeBase>..HEAD`, and stories/plan are the engine-recorded artifacts for this feature (the active plan path and its `**Stories:**` reference), never a directory glob over the docs tree.
2. Verify RED.
3. Implement in `build-review-inputs.ts` using Task 1's parser and Task 2's/plan parsers.
4. Verify GREEN; commit "feat(test-quality): projection scoped to criterion-bound changed tests".

**Done when:**
- Assertions in step 1 pass.
- A rebase fixture (base gains another feature's tests) leaves `inScopeTests` unchanged.

**Files:** src/conductor/src/engine/build-review-inputs.ts; src/conductor/test/build-review-inputs.test.ts

**Dependencies:** 4, 1, 7

### Task 14: Empty scope passes without dispatch or preflight
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: coordinator test — test-quality enabled, `inScopeTests` empty → PASS with reason `test_quality_empty_scope`, no grader dispatch, preflight runner not invoked (fake records calls).
2. Verify RED.
3. Implement in `build-review-coordinator.ts`: an empty in-scope set resolves the rubric to PASS as a property of the projection, so neither grader dispatch nor preflight execution can be reached for it regardless of how the coordinator orders its stages.
4. Verify GREEN; commit "feat(test-quality): empty scope is a no-dispatch PASS".

**Done when:**
- Test passes; preflight fake call count is 0.

**Files:** src/conductor/src/engine/build-review-coordinator.ts; src/conductor/test/build-review-coordinator.test.ts

**Dependencies:** 13

### Task 15: Preflight is typed evidence, gated on enabled + non-empty scope
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: `build-review-tautology-preflight.test.ts` (renamed to `test-quality-preflight`) — with scope non-empty the projection carries `preflight: {classification, excerpt}`; a green classification produces zero findings from the engine; a test-command execution error classifies as a mechanical fault.
2. Verify RED.
3. Rename the preflight module to `build-review-test-quality-preflight.ts`. End state: the preflight result is a typed field of the projection only; no engine module maps a preflight classification to a finding (adr-2026-08-17 D4 as amended); an execution error still routes to the mechanical-fault lane.
4. Verify GREEN; commit "feat(test-quality): preflight is evidence, never a verdict".

**Done when:**
- No engine module constructs a finding whose input is `preflight.classification` (a test stubs every classification value and asserts zero findings from the engine).
- Execution error → mechanical fault assertion passes.

**Files:** src/conductor/src/engine/build-review-test-quality-preflight.ts; src/conductor/test/build-review-test-quality-preflight.test.ts

**Dependencies:** 14

### Task 16: build-review-test-quality skill replaces build-review-tautology
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: harness integrity (`test/test_harness_integrity.sh`) and `model-table-metadata` expect `build-review-test-quality` and not `build-review-tautology`; the skill's result contract test (`build-review-prompt.test.ts`) accepts `{concernKind:'test-insensitive', anchor:{rubric:'testQuality', locus:<content-region>}}` and rejects any other kind.
2. Verify RED.
3. `git mv skills/build-review-tautology skills/build-review-test-quality`; rewrite SKILL.md per adr-2026-08-22-build-review-opt-in-rubric-container §3 — consult `skill-creator` effective-skill guidance, keep the judgement-only shape and the `## Verification` checklist; update `model-table-metadata.ts`, `bin/generate-model-table`, HARNESS.md table; update `build-review-prompt.ts` vocabulary.
4. Verify GREEN + `test/test_harness_integrity.sh`; commit "feat(skill): build-review-test-quality replaces tautology".

**Done when:**
- `test/test_harness_integrity.sh` passes with the new skill and no reference to the old name.
- `build-review-prompt.test.ts` accepts `test-insensitive` and rejects `symptom-only-fix`.

**Files:** skills/build-review-test-quality/SKILL.md; src/conductor/src/engine/model-table-metadata.ts; src/conductor/src/engine/build-review-prompt.ts; HARNESS.md; src/conductor/test/build-review-prompt.test.ts

**Dependencies:** 15

### Task 17: Malformed grades and unbound FIXABLE findings are rejected
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing test: FIXABLE with no plan task → rejected naming the finding; FIXABLE naming task `99` absent from the plan → rejected; grade `MAYBE` → rejected + mechanical-fault classification; a row with `FIXABLE, PLAN_GAP` → rejected; two separate rows with one grade each → accepted.
2. Verify RED.
3. Implement in the parser; resolution of plan task ids uses `plan-task-parse.ts`.
4. Verify GREEN; commit "fix(prd-audit): reject unbound or multi-graded findings".

**Done when:**
- All five assertions pass; no rejected report reaches the remediation path (conductor test in Task 21 asserts zero appends).

**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/test/prd-audit-coverage.test.ts

**Dependencies:** 9

### Task 18: Unreadable criteria fail the gate naming the stories file
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: prd_audit gate with a stories file containing no parseable criteria → gate unsatisfied with reason containing the stories path; an FR with no covering story → a `PLAN_GAP` row against `FR-n` is required or the gate fails.
2. Verify RED.
3. Implement in the prd_audit gate evaluation in `artifacts.ts` (search hint: the reader of `.pipeline/prd-audit.md`) using the story criteria extractor.
4. Verify GREEN; commit "fix(prd-audit): fail closed on unreadable criteria".

**Done when:**
- Both assertions pass.

**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/test/prd-audit-coverage.test.ts

**Dependencies:** 9

### Task 19: Growth record in the kickback ledger
**Story:** 14
**Type:** infrastructure

**Steps:**
1. Write failing test: `kickback-ledger.test.ts` — `recordGrowth(root, {authored, added, byGate})` persists `growth` and `readGrowth` returns `{authored:19, added:3, byGate:{prd_audit:3}, remaining:1}` for cap 4; a ledger with no growth derives counts from the plan (pre-existing `rem-*` counted as authored; the plan is the engine-recorded active plan path, never a directory glob over the plans folder); an impossible hand-edited record is recomputed and logged.
2. Verify RED.
3. Implement in `kickback-ledger.ts`; emit `plan_growth` event with the counts.
4. Verify GREEN; commit "feat(ledger): per-feature plan growth record".

**Done when:**
- Assertions pass; `plan_growth` has a sink row.

**Files:** src/conductor/src/engine/kickback-ledger.ts; src/conductor/src/engine/conductor-events.ts; src/conductor/test/kickback-ledger.test.ts

**Dependencies:** 6

### Task 20: prd-audit skill re-keyed to stories with grades
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: skill contract test (`prd-audit-coverage.test.ts`) renders the expected report skeleton from the SKILL.md contract: per-criterion rows, `Grade`, `PRD:` flag, intent sources line.
2. Verify RED.
3. Rewrite `skills/prd-audit/SKILL.md` per adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback: stories are authority, FRs are intent context, OVER_SCOPE judgement incl. reseal rationale, FIXABLE must name the owning task. Consult `skill-creator` effective-skill guidance; keep `## Verification`.
4. Verify GREEN + harness integrity; commit "feat(skill): prd-audit judges stories with graded findings".

**Done when:**
- Harness integrity passes; the skill contains the four grades and the rule "FIXABLE names an owning plan task" verbatim.

**Files:** skills/prd-audit/SKILL.md; agents/prd-auditor.md; src/conductor/test/prd-audit-coverage.test.ts

**Dependencies:** 9

### Task 21: Per-check policy resolved from config and artifact presence
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing test: `as-built-policy.test.ts` — S-tier, no ADRs, no diagrams → `{reachability:on, planGap:on, adrCompliance:off(reason:'no approved ADRs'), diagramDrift:off(reason:'no diagrams')}`; L with ADRs → all on; config turning reachability off for S → off with the config key as reason.
2. Verify RED.
3. Implement `resolveAsBuiltPolicy` in `as-built-policy.ts`; pass it into the step prompt (`step-runners.ts` STEP_PROMPTS).
4. Verify GREEN; commit "feat(as-built): per-check policy".

**Done when:**
- Three assertions pass; the rendered prompt lists each check with on/off and reason.

**Files:** src/conductor/src/engine/as-built-policy.ts; src/conductor/src/engine/step-runners.ts; src/conductor/test/as-built-policy.test.ts

**Dependencies:** 6

### Task 22: Cap enforcement before appending prd_audit fix tasks
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing test: conductor remediation path with a fake plan of 20 tasks and 3 FIXABLE findings → 3 tasks appended, each with `Criterion:` and `Parent task:` lines and a `Done when:` block restating the criterion; ledger lap = 1.
2. Verify RED.
3. Implement the cap check in `conductor.ts` at the single call site of `appendRemediationTasks` (search hint: `recordAppendedRemediationTaskIds`); extend `remediation-append.ts` to render the three lines. For `prd_audit` the configurable lap cap REPLACES the generic `MAX_KICKBACKS_PER_GATE` count so the gate has exactly one bound; other gates keep the generic count.
4. Verify GREEN; commit "feat(prd-audit): capped, criterion-bound fix tasks".

**Done when:**
- Appended block text contains `**Criterion:** S2.1`, `**Parent task:** 4`, and a `**Done when:**` block.
- `gates.prd_audit.laps === 1` after the append, and the generic per-gate count is not consulted for `prd_audit` (test: with `MAX_KICKBACKS_PER_GATE` lowered to 0 the prd_audit lap still proceeds).

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/remediation-append.ts; src/conductor/test/remediation-append.test.ts; src/conductor/test/prd-audit-kickback.test.ts

**Dependencies:** 17, 19

### Task 23: Over-cap and second-lap FAILs halt with every finding listed
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing test: 12-task plan, 4 FIXABLE (cap 3 by ratio) → zero appends, HALT class `kickback-cap`, body lists all four; lap already 1 and a new FIXABLE → same halt; config 8/0.5 with 6 FIXABLE on 20 tasks → 6 appended.
2. Verify RED.
3. Implement; add `kickback-cap` to halt classification.
4. Verify GREEN; commit "feat(prd-audit): cap breach halts, appends nothing".

**Done when:**
- Plan text unchanged in the two halt cases; all three assertions pass.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/halt-classification.ts; src/conductor/test/prd-audit-kickback.test.ts

**Dependencies:** 22

### Task 24: PLAN_GAP routing by criterion section
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing test: PLAN_GAP on a criterion under `#### Happy Path` → HALT class `plan-gap` naming it; under `#### Negative Paths` → recorded in the verdict's `findings[]` and the gate passes; unclassifiable criterion → treated as happy-path; `halt_on_any_plan_gap: true` → negative-path also halts.
2. Verify RED.
3. Implement routing where the SHIP tail consumes prd_audit gaps in `conductor.ts` (search hint: `gapMemberNames`), using the stories section extractor.
4. Verify GREEN; commit "feat(prd-audit): PLAN_GAP halts only on happy-path criteria".

**Done when:**
- Four assertions pass; recorded findings carry `{grade, criterion, summary, gate:'prd_audit'}`.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/prd-audit-kickback.test.ts

**Dependencies:** 17

### Task 25: OVER_SCOPE routing and operator-accepted widenings
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing test: OVER_SCOPE `intentRelation: within` → recorded as accepted widening, gate passes; `outside-harmless` → recorded finding, passes; `outside-visible` → HALT class `over-scope`; clearing that halt through the mutation port writes `.pipeline/accepted-widenings.json` entry and the next parse grades the same finding `within`.
2. Verify RED.
3. Implement in `conductor.ts` + a small `accepted-widenings.ts` store; reseal evidence and `Scope:` trailer rationales are added to the prd_audit projection (reuse `scope-widening-rationale.ts`).
4. Verify GREEN; commit "feat(prd-audit): scope-as-intent routing with operator-accepted widenings".

**Done when:**
- Four assertions pass; `over-scope` is in the halt classification.
- prd_audit projection includes `resealEvidence` and `scopeTrailers` arrays (asserted on a fixture).

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/accepted-widenings.ts; src/conductor/src/engine/halt-classification.ts; src/conductor/test/prd-audit-kickback.test.ts

**Dependencies:** 17

### Task 26: As-built parser accepts PLAN_GAP; no as-built → build route
**Story:** 13
**Type:** happy-path

**Steps:**
1. Write failing test: `.pipeline/architecture-review-as-built.md` with `Verdict: PLAN_GAP` + `Outcome delivered: yes` → gate satisfied, finding recorded; `Outcome delivered: no` → HALT class `plan-gap`; `BLOCKED` → halt as today; missing verdict → unsatisfied; conductor SHIP tail emits no kickback to build for any as-built verdict.
2. Verify RED.
3. Implement in the as-built reader in `artifacts.ts` (search hint: `.pipeline/architecture-review-as-built.md`). In `conductor.ts`, as-built findings are excluded from the validation-group `planRemediation` join (adr-2026-07-10 amended): only prd_audit gaps feed remediation; as-built verdicts resolve to proceed / record / halt directly.
4. Verify GREEN; commit "feat(as-built): PLAN_GAP verdict; never kicks back to BUILD".

**Done when:**
- Five assertions pass; a test with an as-built BLOCKED and a prd_audit FIXABLE in the same validation group appends only the prd_audit task and halts on the as-built verdict.

**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/as-built-verdict.test.ts

**Dependencies:** 10

### Task 27: architecture-review §12 updated for always-run, policy, PLAN_GAP
**Story:** 13
**Type:** happy-path

**Steps:**
1. Write failing test: harness integrity + a contract test that the skill text contains `Verdict: APPROVED | APPROVED WITH DRIFT NOTES | PLAN_GAP | BLOCKED` and `Outcome delivered:`.
2. Verify RED.
3. Edit `skills/architecture-review/SKILL.md` §12 (and the DECIDE-time note that it no longer skips); consult `skill-creator` guidance; keep `## Verification`.
4. Verify GREEN; commit "feat(skill): as-built review reports PLAN_GAP".

**Done when:**
- Integrity passes; the two strings are present; no mention of "skips this gate entirely when the DECIDE-phase architecture_review was skipped" remains.

**Files:** skills/architecture-review/SKILL.md; src/conductor/test/skill-contracts.test.ts

**Dependencies:** 26

### Task 28: Recorded findings copied into the shipped record
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing test: finish path with recorded findings from prd_audit and as-built → `.docs/shipped/<slug>.md` carries a `findings:` list with `{gate, grade, criterion|outcome, summary}`; none → key absent.
2. Verify RED.
3. Implement in the shipped-record writer (`shipment-association.ts` / finish publication path).
4. Verify GREEN; commit "feat(finish): shipped record carries recorded review findings".

**Done when:**
- Both assertions pass; the shape matches the intake filed as #1810 (field names above).

**Files:** src/conductor/src/engine/shipment-association.ts; src/conductor/src/engine/finish-publication-production.ts; src/conductor/test/shipped-record.test.ts

**Dependencies:** 24, 26

### Task 29: Readers ignore retired-rubric dispositions and verdicts
**Story:** 16
**Type:** negative-path

**Steps:**
1. Write failing test: a dispositions file with a `scope` record and a lap verdict for `rootCause` → `buildReviewEffectiveResolver` returns without throwing and logs `ignored retired rubric record: scope`; the removal guard still blocks on a missing recorded `rem-*` heading.
2. Verify RED.
3. Implement tolerant reads in `build-review-dispositions.ts` / `build-review-effective.ts` / `build-review-cache.ts`.
4. Verify GREEN; commit "fix(build-review): tolerate retired-rubric state on resume".

**Done when:**
- Both assertions pass; no reader throws on the fixture.

**Files:** src/conductor/src/engine/build-review-dispositions.ts; src/conductor/src/engine/build-review-effective.ts; src/conductor/src/engine/build-review-cache.ts; src/conductor/test/build-review-compat.test.ts

**Dependencies:** 12

### Task 30: Delete retired rubric skills, engine branches, exemptions, fixtures, tests
**Story:** 1
**Type:** refactor

**Steps:**
1. Write failing test: `harness-catalog.test.ts` asserts the three skill directories are absent and `model-table-metadata` has no row for them; `tsc` + full suite as the guard.
2. Verify RED.
3. Delete `skills/build-review-scope`, `skills/build-review-completeness`, `skills/build-review-root-cause`; remove their registry policies, `build-review-removals.ts`/`build-review-accepted-risk.ts` where only they consumed them, `preservationContext`/`verifyOnlyContext`/`removalContext` projection fields, `perTaskFloor` advisory, their prompt templates, fixtures under `src/conductor/test/fixtures/build-review/*`, and tests; update `bin/generate-model-table` output and HARNESS.md table; remove deleted symlink targets handling per adr-2026-07-29 (#7/#9).
4. Verify GREEN (`npm test`, `test/test_harness_integrity.sh`); commit "chore(build-review): remove retired rubric code and tests".

**Done when:**
- `grep -rn "rootCause\|build-review-completeness\|build-review-scope" src skills HARNESS.md` returns only the deprecated-key list in `config.ts` and ADR citations.
- Full default test suite and harness integrity pass.

**Files:** skills/build-review-scope; skills/build-review-completeness; skills/build-review-root-cause; src/conductor/src/engine/build-review-removals.ts; src/conductor/src/engine/build-review-accepted-risk.ts; src/conductor/src/engine/build-review-inputs.ts; src/conductor/src/engine/build-review-prompt.ts; src/conductor/src/engine/model-table-metadata.ts; HARNESS.md; src/conductor/test/harness-catalog.test.ts

**Dependencies:** 16, 29

### Task 31: Acceptance: pre-change feature and plan-conformant feature reach SHIP
**Story:** 16
**Type:** happy-path

**Steps:**
1. Write failing acceptance tests in `src/conductor/test/acceptance/` with faithful fakes: (a) fixture plan with no `Done when:` and five `rem-*` tasks plus stale dispositions builds to SHIP, five counted as authored; (b) a plan-conformant feature traverses BUILD→SHIP with zero halts; (c) as-built `PLAN_GAP` with criteria passing ships with the finding recorded; (d) S-tier technical feature cannot finish without a prd_audit verdict. Mark suites `Covers: S16.1, S16.2` / `S7.1` / `S13.1`.
2. Verify RED against the pre-change engine paths where applicable.
3. Wire fixtures; no production change expected beyond prior tasks.
4. Verify GREEN; commit "test(acceptance): consolidation end-to-end paths".

**Done when:**
- Four acceptance tests pass in the default suite; none contact a real provider.

**Files:** src/conductor/test/acceptance/build-review-re-judges-what-the-plan-architecture-.acceptance.test.ts

**Dependencies:** 3, 23, 25, 28, 29

### Task 32: This repository enables test-quality; scaffolder emits no retired keys; migration block
**Story:** 2
**Type:** infrastructure

> **Amended 2026-08-22 by #1805 (operator decision):** this task no longer edits this
> repository's own `.ai-conductor/config.yml`. That edit is deferred to a follow-up PR
> landed after this feature merges. Rationale: the daemon resolves gate policy from the
> feature worktree's config but runs the engine built from `main`, so a config naming
> `build_review.rubrics.testQuality` is validated by an engine whose rubric ids are still
> `tautology, scope, rootCause, completeness`. The result was a deterministic
> `invalid_config: Unknown rubric ID: build_review.rubrics.testQuality` at `test_suite`,
> which re-opened `build` every lap and could never converge (observed 2026-08-23T00:06
> and 00:11 in `.daemon/daemon.log`). The scaffolder template, engine rubric-id, and test
> halves of this task are unchanged and still required; only the repository's own
> enablement moves. **Done when** is amended accordingly: the `.ai-conductor/config.yml`
> clause does not apply on this branch; the scaffolder-test and migration-block clauses
> still do.

**Steps:**
1. Write failing test: config scaffolder output contains no retired rubric key and sets `testQuality.enabled: false`; a default-resolution test asserts test-quality off with no overrides.
2. Verify RED.
3. Edit `.ai-conductor/config.yml`: enable `build_review.rubrics.testQuality`, delete the interim rootCause-disable block (#1808); update the scaffolder template. Record the release metadata the finish step must emit in the implementation PR body: `Release-Disposition: note`, `Release-Category: Changed`, `Release-Semver: minor`, and a `## Migration` section with a runnable ```bash migration``` fence that renames `build_review.rubrics.tautology` → `testQuality` in a consumer's `.ai-conductor/config.yml` (retired keys need no edit; they are ignored). Put this text in the commit message body of this task so finish has it verbatim.
4. Verify GREEN; commit "chore(config): enable test-quality for ai-conductor; scaffolder and migration".

**Done when:**
- `.ai-conductor/config.yml` has `testQuality: { enabled: true }` and no `rootCause` key; the scaffolder test passes.
- The task's commit message carries the Release-* lines and a runnable migration fence naming the `tautology` → `testQuality` rename (checked by `isRunnableMigrationBlock`).

**Files:** .ai-conductor/config.yml; src/conductor/src/engine/config.ts; src/conductor/test/config.test.ts

**Dependencies:** 30

## Task Dependency Graph

Tasks 1–3 land first and block everything else. After them, four chains run in parallel and
converge on cleanup → acceptance → repo config.

```
1 Done when: parser
└─ 2 task close evidences Done when:
   └─ 3 plan-gap halt                 ◄── gates every task below
      │
      ├─ CHAIN A (container / test-quality)
      │   4 Covers: parser ───────────────────────┐
      │   5 config: retired keys no-op, empty set  │
      │   ├─ 6 cap + per-check config keys         │
      │   │   ├─ 19 growth record in ledger        │
      │   │   └─ 21 as-built per-check policy      │
      │   └─ 7 registry = test-quality only        │
      │       ├─ 11 coordinator: empty set PASS    │
      │       ├─ 12 unregistered rubric = fault ── 29 compat readers
      │       └─ 13 projection (needs 4, 1) ◄──────┘
      │           └─ 14 empty scope PASS
      │               └─ 15 preflight = evidence
      │                   └─ 16 test-quality skill
      │
      ├─ CHAIN B (prd_audit)
      │   8 run on every track + gate surface
      │   9 graded verdict parser
      │   ├─ 17 reject malformed grades
      │   │   ├─ 22 cap enforcement (needs 19)
      │   │   │   └─ 23 over-cap halts
      │   │   ├─ 24 PLAN_GAP routing
      │   │   └─ 25 OVER_SCOPE + accepted widenings
      │   ├─ 18 unreadable criteria fail closed
      │   └─ 20 prd-audit skill
      │
      └─ CHAIN C (as-built)
          10 step runs on every tier
          └─ 26 PLAN_GAP verdict, no build route
              └─ 27 architecture-review skill §12

CONVERGENCE
28 shipped record carries findings   ◄ 24, 26
30 delete retired rubric code/tests  ◄ 16, 29
31 acceptance paths                  ◄ 3, 23, 25, 28, 29
32 repo config opt-in + migration    ◄ 30
```

Exact edges are the `**Dependencies:**` lines; this picture is the reading aid.

## Integration Points
- After Task 3: BUILD closes tasks with Done when: evidence and can halt plan-gap.
- After Task 11: build_review runs as a container; an empty set passes end-to-end.
- After Task 16: test-quality judges a real diff in a self-host dry run.
- After Task 26: prd_audit grades, caps, and routes; a kickback lap appends bounded tasks.
- After Task 28: as-built always runs and can report PLAN_GAP.
- After Task 33: all four acceptance paths pass.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
