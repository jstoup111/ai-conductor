# Implementation Plan: plan review prompt carries an index, not every cited ADR

**Date:** 2026-10-24
**Design:** .docs/decisions/architecture-review-2026-10-24-plan-review-refuses-large-specs-whose-inlined-arti.md
**Stories:** .docs/stories/plan-review-refuses-large-specs-whose-inlined-arti.md
**Conflict check:** Clean as of 2026-10-24 (1 degrading overlap accepted by the operator)

## Summary

Round-1 plan review inlines only the plan, the stories, the changed ADR decisions and the candidate rows, and lists every other in-scope decision and the coherence artifact in an index the read-only reviewer opens. An operator budget override (config and flag) and an actionable refusal replace the fixed 400,000-character dead end. 10 tasks.

## Technical Approach

- **Split, not filter.** A new pure function in `src/conductor/src/engine/plan-review-adr-scope.ts` splits the in-scope decisions (the same ADR stems `selectPlanReviewAdrStems` returns today) into `inline` passages and `indexed` entries, comparing each decision passage with the same decision parsed from the ADR's merge-base text. The existing `selectPlanReviewAdrDecisionSections` and `selectPlanReviewAdrTexts` stay unchanged, because `computeReviewedDigest` (`plan-review-artifact.ts`) digests through the former and the land rung must see the same digest.
- **Base text comes from git, through a new helper beside `resolveIdeaFiles`.** `src/conductor/src/engine/engineer/spec-change-set.ts` gains an export that resolves the merge base the same way `resolveIdeaFiles` does and returns the base text of each requested path: a string when present, `null` when the path is absent at the base or `git show` fails, and `undefined` overall when the merge base itself cannot be resolved. `resolveIdeaFiles` is not changed, since `land-spec.ts` and `plan-review-gate.ts` share it. Base text is read only for changed ADR paths: an ADR outside the change set is unchanged by definition, so all its decisions are indexed.
- **Fallback is today's behavior.** With no canonical path there is no change set, so every decision of every cited ADR is inline, as today. A failing `resolveIdeaFiles` still rejects the review before dispatch, as today: a git failure is not a size dead end. When the change set resolves but `readMergeBaseTexts` returns `undefined`, every in-scope decision (cited and changed) is inline. A `null` base text inlines every decision of that ADR.
- **Prompt layout, round 1.** `PLAN:`, `STORIES:`, `ADR DECISIONS (changed in this spec):` (JSON of the inline passages), `INDEX (not inlined; read each item from its listed worktree path, and open it before a finding quotes or relies on it):` with one line per indexed decision `- <adr-stem>#D<n> | <title> | .docs/decisions/<adr-stem>.md` and one line `- coherence | .docs/coherence/<plan-stem>.md` when the coherence file exists, then `CANDIDATES:`. The title is the decision passage's first non-empty line, trimmed, cut at 160 characters.
- **Round 2 is untouched.** The `changed` branch of `runPlanReview` keeps its selection and keeps the coherence text inline exactly as today.
- **Budget and refusal live in the runner.** `runPlanReview` keeps `maxPromptChars` (default `PLAN_REVIEW_MAX_PROMPT_CHARS = 400_000`). Its refusal names the prompt size, the budget, every section's size, the largest section, and both overrides with the prompt size as the admitting value. A prompt equal to the budget dispatches (the existing `>` comparison).
- **Config.** A new top-level `plan_review` block with one key `max_prompt_chars` (positive integer) is validated like `prd_audit` (`validatePrdAuditBlock` in `src/conductor/src/engine/config.ts`): a closed key list in `CONFIG_CONSUMER_KEY_SETS`, an `Unknown key in plan_review` error, and a `plan_review.max_prompt_chars must be a positive integer` error. No default is materialized: the runner owns the default.
- **Documentation.** `docs/reference/configuration.md`, `docs/reference/cli.md` and the `compose plan-review` invocation in `skills/composer/SKILL.md` are kept current by this repository's gating `maintain-documentation` step (after `rebase`, `.ai-conductor/config.yml`), so, under `/plan`'s documentation boundary, no task owns them. The `compose plan-review` help text is code and belongs to Task 7.
- **Entry points.** `compose plan-review` (`src/conductor/src/engine/engineer-cli.ts`) resolves the budget as flag, then `config.plan_review?.max_prompt_chars`, then the runner default. The `conduct` path (`plan_review` branch in `src/conductor/src/engine/step-runners.ts`) passes `this.config.plan_review?.max_prompt_chars`.

Local pattern context (config block, Task 1): follow `validatePrdAuditBlock` and its call site in `validateConfig`. Traits to keep: reject a non-object block, reject keys outside `CONFIG_CONSUMER_KEY_SETS.plan_review` by name, reject a non-integer or non-positive value with a message naming the dotted key. Allowed variation: one key and no `resolve…Block`, because the runner owns the default. Search hints: `validatePrdAuditBlock`, `CONFIG_CONSUMER_KEY_SETS`, `configConsumerRegistry` in `src/conductor/test/engine/config-consumer-registry.ts`.

## Prerequisites

- None. No migration, persisted schema or new dependency.

## Tasks

### Task 1: Validate a top-level `plan_review.max_prompt_chars` config key
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: `plan_review: { max_prompt_chars: 600000 }` loads and keeps the value; `0`, `-1`, `1.5` and `"large"` each fail with `plan_review.max_prompt_chars must be a positive integer`; `plan_review: { max_chars: 1 }` fails with `Unknown key in plan_review: "max_chars"`; `steps: { plan_review: { max_prompt_chars: 600000 } }` fails with `Unknown key in steps.plan_review: "max_prompt_chars"`.
2. Verify the tests fail (RED).
3. Implement: add `'plan_review'` to `CONFIG_CONSUMER_KEY_SETS.top` and `plan_review: ['max_prompt_chars']`; add `validatePlanReviewBlock`, following `validatePrdAuditBlock` (reject non-object, closed keys by name, positive-integer check naming the dotted key); call it from `validateConfig` beside the `prd_audit` block; add `plan_review?: { max_prompt_chars?: number }` to `HarnessConfig` in `src/conductor/src/types/config.ts`; declare the two keys' runtime consumers (`engineer-cli.ts` and `step-runners.ts`) in `src/conductor/test/engine/config-consumer-registry.ts`; document `plan_review` and `plan_review.max_prompt_chars` in `templates/project-config.yml.template` the way the `prd_audit` block is documented there.
4. Verify the tests pass (GREEN), including `config-consumer-registry.test.ts` and `config-template.test.ts`.
5. Commit: "feat(config): validate plan_review.max_prompt_chars".

**Done when:**
- [test] A `config.test.ts` case asserts `validateConfig` accepts `plan_review: { max_prompt_chars: 600000 }` and the validated config carries `plan_review.max_prompt_chars === 600000`.
- [test] `config.test.ts` cases assert `validateConfig` fails for `max_prompt_chars` values `0`, `-1`, `1.5` and `"large"`, each with an error naming `plan_review.max_prompt_chars` and stating it must be a positive integer.
- [test] A `config.test.ts` case asserts `validateConfig` fails for `plan_review.max_chars` with an error naming the unknown key `max_chars`, and fails for `steps.plan_review.max_prompt_chars` with the existing unknown step key error naming `max_prompt_chars`.
- [test] `config-consumer-registry.test.ts` passes with `plan_review` and `plan_review.max_prompt_chars` declared against their runtime consumers.
- [test] `config-template.test.ts` passes with `plan_review` and `plan_review.max_prompt_chars` documented in `templates/project-config.yml.template`.

**Files likely touched:**
- src/conductor/src/engine/config.ts — key sets, `validatePlanReviewBlock`, call site
- src/conductor/src/types/config.ts — `HarnessConfig.plan_review`
- src/conductor/test/engine/config.test.ts — validation cases
- src/conductor/test/engine/config-consumer-registry.ts — consumer declarations
- templates/project-config.yml.template — `plan_review` block documentation

**Dependencies:** none

### Task 2: Split in-scope ADR decisions into changed passages and index entries
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/plan-review-adr-scope.test.ts` for `splitPlanReviewAdrDecisions({ planText, adrTexts, changedPaths, baseAdrTexts })`:
   - cited unchanged `adr-a` (D1-D6) and changed `adr-b` whose base differs only inside D2: `inline` holds exactly `adr-b#D2`; `indexed` holds `adr-a#D1`-`adr-a#D6` and `adr-b`'s other decisions, each with its first passage line as `title` and `.docs/decisions/<stem>.md` as `path`;
   - a changed `adr-new` whose base text is `null`: all its decisions are inline;
   - `baseAdrTexts` undefined: every in-scope decision is inline and `indexed` is empty;
   - a cited ADR with no `## Decision` heading contributes to neither list;
   - a decision whose base passage differs only by trailing whitespace on a line is inline, and one that differs only by `\r\n` versus `\n` line endings is indexed (`parseAdrDecisions` splits on `\r?\n` and rejoins with `\n`, so its passages compare equal).
2. Verify RED.
3. Implement the export in `src/conductor/src/engine/plan-review-adr-scope.ts`, reusing `selectPlanReviewAdrStems` for scope and `parseAdrDecisions` for both texts, comparing passage strings exactly. Leave `selectPlanReviewAdrDecisionSections` and `selectPlanReviewAdrTexts` unchanged.
4. Verify GREEN.
5. Commit: "feat(plan-review): split changed ADR decisions from indexed ones".

**Done when:**
- [test] `splitPlanReviewAdrDecisions` returns `inline` keys exactly `['adr-b#D2']` and `indexed` ids for every other decision of `adr-a` and `adr-b`, each entry carrying the decision's first line as `title` and `.docs/decisions/<adr-stem>.md` as `path`.
- [test] `splitPlanReviewAdrDecisions` inlines every decision of an ADR whose `baseAdrTexts` entry is `null`, and inlines every in-scope decision with an empty `indexed` list when `baseAdrTexts` is undefined.
- [test] `splitPlanReviewAdrDecisions` returns neither an inline passage nor an index entry for a cited ADR whose text has no `## Decision` heading.
- [test] `splitPlanReviewAdrDecisions` inlines a decision whose base passage differs only by trailing whitespace on a line, and indexes one whose base text differs only by `\r\n` versus `\n` line endings.

**Files likely touched:**
- src/conductor/src/engine/plan-review-adr-scope.ts — `splitPlanReviewAdrDecisions`
- src/conductor/test/engine/plan-review-adr-scope.test.ts — new unit tests

**Dependencies:** none

### Task 3: Read merge-base text for changed ADR paths
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/engineer/spec-change-set.test.ts` over a temp git repo with a `main` branch and a feature branch: a path modified on the feature branch returns its `main` text; a path added on the feature branch returns `null`; a canonical path with no resolvable default branch or merge base returns `undefined`.
2. Verify RED.
3. Implement `readMergeBaseTexts(worktreePath, canonicalPath, paths)` in `src/conductor/src/engine/engineer/spec-change-set.ts`: resolve `deriveDefaultBranch` and `git merge-base HEAD <branch>` as `resolveIdeaFiles` does; return `undefined` when either fails; otherwise `git show <base>:<path>` per path, mapping a failure to `null`. Do not change `resolveIdeaFiles`.
4. Verify GREEN.
5. Commit: "feat(spec-change-set): read merge-base text for changed paths".

**Done when:**
- [test] `readMergeBaseTexts` returns the default-branch text for a path modified on the feature branch and `null` for a path the feature branch added.
- [test] `readMergeBaseTexts` returns `undefined` when `git merge-base` fails, and `resolveIdeaFiles`' existing tests pass unchanged.

**Files likely touched:**
- src/conductor/src/engine/engineer/spec-change-set.ts — `readMergeBaseTexts`
- src/conductor/test/engine/engineer/spec-change-set.test.ts — new tests

**Dependencies:** none

### Task 4: Assemble the round-1 prompt from changed decisions and an index
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-runner.test.ts`, capturing `options.prompt` from the fake `providerExecutor`:
   - committed baseline with `adr-a` (D1-D6) cited by the plan and `adr-b`, then an uncommitted amendment note inside `adr-b` D2, run with `canonicalPath: root`: the prompt contains every task and story heading, the `adr-b#D2` passage, an index line for each other decision and `- coherence | .docs/coherence/idea.md`, and none of the indexed passages' text past their titles, and no coherence body text;
   - an ADR added after the baseline: all its decisions' passages appear;
   - a generated #2945-shaped fixture (125,635-character plan, 33,183 characters of stories, 50,782-character coherence, 15 ADRs on the baseline whose feature-branch versions carry 140,644 characters of decision text with 58,497 in changed decisions): the prompt length is under 400,000 and the executor is called;
   - after a round 1 that recorded a blocking finding and a plan edit, the round-2 prompt is byte-identical to the one the pre-change runner builds (changed tasks, stories and decisions, the coherence text, prior findings);
   - the written `reviewedDigest` deep-equals `computeReviewedDigest` over the full plan, stories, coherence text and every in-scope ADR text.
   Update the existing "loads cited and changed ADR Decision sections" case so the cited unchanged `adr-review` is asserted as an index line, not an inline passage.
2. Verify RED.
3. Implement in `reviewInputs`/`runPlanReview` (`src/conductor/src/engine/plan-review-runner.ts`): read base texts with `readMergeBaseTexts` for the changed ADR paths, call `splitPlanReviewAdrDecisions`, render the round-1 sections named in Technical Approach, and keep the round-2 branch and `computeReviewedDigest` inputs unchanged.
4. Verify GREEN, including every existing `plan-review-runner*.test.ts`.
5. Commit: "feat(plan-review): inline changed decisions and index the rest".

**Done when:**
- [test] `runPlanReview`'s round-1 prompt contains the full text of every plan task and every story verbatim and the changed `adr-b#D2` passage, an `INDEX` entry for each unchanged decision naming `<adr-stem>#D<n>`, the decision's first line as its title and `.docs/decisions/<adr-stem>.md` as its path, and a coherence entry naming `.docs/coherence/idea.md`, and contains no indexed passage text beyond each entry's one-line title and no coherence body.
- [test] `runPlanReview`'s round-1 prompt contains the passage of every decision of an ADR added after the merge base.
- [test] `runPlanReview` dispatches the reviewer for the generated #2945-shaped fixture with a prompt under 400,000 characters.
- [test] `runPlanReview`'s round-2 prompt is byte-identical to the pre-change round-2 prompt for the same artifacts, carrying the coherence text and prior blocking and significant findings.
- [test] The `reviewedDigest` that `runPlanReview` writes after an indexed round 1 deep-equals `computeReviewedDigest` over the full plan, stories, coherence text and every in-scope ADR text.

**Files likely touched:**
- src/conductor/src/engine/plan-review-runner.ts — round-1 prompt assembly
- src/conductor/test/engine/plan-review-runner.test.ts — prompt-shape, fixture and digest tests

**Dependencies:** Task 2, Task 3

### Task 5: Fall back to inlining when base text or inputs are unavailable
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-runner.test.ts`:
   - no `canonicalPath`: every decision of every cited ADR is inline and the prompt has no decision index lines;
   - `canonicalPath` naming a directory where `git merge-base` fails: `runPlanReview` rejects before any executor call, as today;
   - a resolved change set with `readMergeBaseTexts` stubbed to return `undefined`: every decision of every cited and every changed ADR is inline;
   - a changed ADR whose base read fails (stub `readMergeBaseTexts` to return `null` for that path only): every decision of that ADR is inline while another changed ADR is still split;
   - a cited ADR with no `## Decision` heading: no passage and no index line for it;
   - no coherence file: no `- coherence |` line, and the review dispatches;
   - an ADR whose working-tree passage differs from the base only by trailing whitespace on a line: that decision is inline; another whose text differs only by `\r\n` versus `\n` line endings: that decision is indexed.
2. Verify RED.
3. Implement: in `reviewInputs`, a missing `canonicalPath` keeps today's empty change set with `baseAdrTexts` undefined; a throwing `resolveIdeaFiles` still propagates; an `undefined` result from `readMergeBaseTexts` passes `baseAdrTexts` undefined with the resolved change set; omit the coherence index line when the file is absent.
4. Verify GREEN.
5. Commit: "fix(plan-review): inline every decision when base text is unavailable".

**Done when:**
- [test] `runPlanReview` without `canonicalPath` dispatches a prompt carrying every decision of every cited ADR inline and no decision `INDEX` lines, and with a `canonicalPath` whose `git merge-base` fails it rejects with zero executor calls.
- [test] `runPlanReview` with a resolved change set and `readMergeBaseTexts` returning `undefined` inlines every decision of every cited and every changed ADR.
- [test] `runPlanReview` inlines every decision of a changed ADR whose merge-base text is `null` while another changed ADR still has its changed decisions inlined and its unchanged decisions indexed.
- [test] `runPlanReview`'s prompt carries no passage and no index line for a cited ADR lacking a `## Decision` heading, and no coherence index entry when `.docs/coherence/<plan-stem>.md` is absent, and the executor is still called.
- [test] `runPlanReview` inlines a decision whose passage differs from the merge base only by trailing whitespace on a line, and indexes one whose text differs only by `\r\n` versus `\n` line endings.

**Files likely touched:**
- src/conductor/src/engine/plan-review-runner.ts — fallbacks
- src/conductor/test/engine/plan-review-runner.test.ts — fallback tests

**Dependencies:** Task 4

### Task 6: Refuse an over-budget prompt with sizes, the largest section and both overrides
**Story:** Story 3, Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-review-runner.test.ts`:
   - with no `maxPromptChars`, a 400,001-character round-1 prompt is refused naming budget `400000`;
   - a prompt over a given `maxPromptChars`: the error text contains `plan review prompt is too large`, the prompt length, the budget, `plan <n>`, `stories <n>`, `ADR decisions <n>`, `index <n>`, `candidates <n>`, `Largest section: <name>`, `--max-prompt-chars <prompt length>` and `plan_review.max_prompt_chars: <prompt length>`; on a round-2 refusal the sizes also include `coherence <n>` and `prior findings <n>`;
   - on refusal: zero executor calls, no `plan_review_dispatched` event, and `.docs/plan-review/<plan-stem>.md` byte-identical to before (absent stays absent);
   - `maxPromptChars` exactly equal to the prompt length dispatches.
   Update the existing refusal regex test at the "plan review prompt is too large" case to the new text.
2. Verify RED.
3. Implement in `runPlanReview`: measure each section of the prompt it built, name the largest, and throw `plan review prompt is too large: <n> characters exceeds <budget> (<section> <size>, …). Largest section: <name>. To proceed, rerun with --max-prompt-chars <n>, or set plan_review.max_prompt_chars: <n> in .ai-conductor/config.yml, or shrink the <name> section.` before any `emit` or executor call.
4. Verify GREEN.
5. Commit: "feat(plan-review): name the overrides in the size refusal".

**Done when:**
- [test] `runPlanReview` without `maxPromptChars` refuses a 400,001-character prompt with a message stating `exceeds 400000`.
- [test] `runPlanReview`'s refusal message contains the prompt length, the budget, the size of every section present (plan, stories, ADR decisions, index or coherence, candidates, and prior findings when present), `Largest section: <name>`, `--max-prompt-chars <prompt length>` and `plan_review.max_prompt_chars: <prompt length>`.
- [test] On refusal `runPlanReview` makes zero executor calls, emits no `plan_review_dispatched` event, and leaves `.docs/plan-review/<plan-stem>.md` unchanged.
- [test] `runPlanReview` dispatches when `maxPromptChars` equals the prompt length exactly.

**Files likely touched:**
- src/conductor/src/engine/plan-review-runner.ts — refusal text and section sizes
- src/conductor/test/engine/plan-review-runner.test.ts — refusal tests

**Dependencies:** Task 4

### Task 7: Accept `--max-prompt-chars` and the config budget on `compose plan-review`
**Story:** Story 3, Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-plan-review.test.ts`:
   - `detectEngineerCommand` parses `--max-prompt-chars 800000` into `maxPromptChars: 800000` on a review run;
   - `--max-prompt-chars abc`, `--max-prompt-chars 0`, and `--max-prompt-chars 800000` with `--accept F-1 --reason r` or with `--acknowledge --reason r` each make `compose plan-review` exit 1 with a message naming `--max-prompt-chars` (positive integer, or "applies only to a review run"), with no executor call and the review artifact unchanged;
   - end to end through the CLI with a fake executor and a fixture producing a 450,000-character prompt: with `.ai-conductor/config.yml` setting `plan_review.max_prompt_chars: 600000` the reviewer is dispatched; with config 600000 and `--max-prompt-chars 800000` the runner receives 800,000, and a following run without the flag receives 600,000; with no config, the refused run's printed message names `--max-prompt-chars <n>`, and rerunning with that flag dispatches;
   - the `plan-review` help text contains `--max-prompt-chars`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/engineer-cli.ts`: add the flag to the `plan-review` parser's known flags, parse it as a positive integer (reject otherwise, and reject it alongside `--accept` or `--acknowledge`), add `maxPromptChars?: number` to the `plan-review` dispatch type, pass `maxPromptChars: dispatch.maxPromptChars ?? configResult.config.plan_review?.max_prompt_chars` to `runPlanReview`, and name the flag in the `plan-review` help entry.
4. Verify GREEN.
5. Commit: "feat(compose): --max-prompt-chars and plan_review.max_prompt_chars".

**Done when:**
- [test] `compose plan-review` dispatches a 450,000-character prompt when the project config sets `plan_review.max_prompt_chars: 600000`, and refuses it when no budget is configured.
- [test] `compose plan-review --max-prompt-chars 800000` passes 800,000 to `runPlanReview` over a configured 600,000, and the next run without the flag passes 600,000.
- [test] `compose plan-review` exits 1 for values `abc` and `0` with a message naming `--max-prompt-chars` and stating it takes a positive integer, and exits 1 for the flag combined with `--accept` or `--acknowledge` with a message stating `--max-prompt-chars` applies only to a review run; each makes no executor call and leaves the review artifact unchanged.
- [test] After `compose plan-review` prints a size refusal naming `--max-prompt-chars <n>`, rerunning with that flag dispatches the reviewer.
- [test] The `compose plan-review --help` text contains `--max-prompt-chars`.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — flag parsing, dispatch type, budget resolution, help text
- src/conductor/test/engine/engineer/engineer-cli-plan-review.test.ts — parser and CLI tests

**Dependencies:** Task 1, Task 6

### Task 8: Pass the configured budget on the `conduct` plan_review step
**Story:** Story 3, Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners-plan-review.test.ts`: with `config.plan_review.max_prompt_chars: 600000` and a fixture producing a 450,000-character prompt, the step returns `{ success: true }` and the executor is called; with no budget configured, the step returns `success: false` and its `output` equals the refusal text `compose plan-review` prints for the same artifacts after its `engineer plan-review: ` prefix; with `600000` configured, a 600,001-character prompt is refused stating `exceeds 600000`.
2. Verify RED.
3. Implement in the `plan_review` branch of `src/conductor/src/engine/step-runners.ts`: pass `maxPromptChars: this.config.plan_review?.max_prompt_chars` to `runPlanReview`.
4. Verify GREEN.
5. Commit: "feat(conduct): honor plan_review.max_prompt_chars".

**Done when:**
- [test] The `conduct` `plan_review` step dispatches a 450,000-character prompt and returns `success: true` when `config.plan_review.max_prompt_chars` is 600,000, and refuses a 600,001-character prompt with `output` stating `exceeds 600000`.
- [test] With no budget configured, the `conduct` `plan_review` step returns `success: false` with `output` equal to the refusal text `compose plan-review` prints for the same artifacts after its `engineer plan-review: ` prefix.

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — budget pass-through
- src/conductor/test/engine/step-runners-plan-review.test.ts — budget tests

**Dependencies:** Task 1, Task 6

### Task 9: Tell the reviewer what the index means
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/plan-review-runner.test.ts` asserting the round-1 prompt's `INDEX` heading line states that its items are not inlined, that each is read from its listed worktree path, and that an item is opened before a finding quotes or relies on it.
2. Verify RED.
3. Implement: render that heading from one constant in `src/conductor/src/engine/plan-review-runner.ts`. In `skills/plan-review/SKILL.md` `## Inputs and evidence`, describe the `ADR DECISIONS` section as the decisions the spec changed and the `INDEX` section as the remaining in-scope decisions and the coherence artifact listed by path; add no wording-match test for the skill text (HARNESS.md forbids testing natural-language skill guidance by its wording alone).
4. Verify GREEN.
5. Commit: "feat(plan-review): brief the reviewer on the decision index".

**Done when:**
- [test] `runPlanReview`'s round-1 `INDEX` heading line states that its items are not inlined, that each is read from its listed worktree path, and that an item is opened before a finding quotes or relies on it.
- `skills/plan-review/SKILL.md` `## Inputs and evidence` names the `ADR DECISIONS` and `INDEX` sections and says indexed items are read from their listed worktree paths.

**Files likely touched:**
- src/conductor/src/engine/plan-review-runner.ts — `INDEX` heading constant
- src/conductor/test/engine/plan-review-runner.test.ts — heading assertion
- skills/plan-review/SKILL.md — index semantics in the reviewer brief

**Dependencies:** Task 4

### Task 10: Pin finding validation against indexed decisions
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Add tests in `src/conductor/test/engine/plan-review-contract.test.ts` calling `validatePlanReviewResult` with a context whose `adrTexts` holds the full text of `adr-a`:
   - a contradiction finding with reference `adr-a#D3` quoting a passage from `adr-a` D3 and a passage from a plan task, with a `.docs/` `file:line`, is accepted;
   - a contradiction finding quoting text present in no plan, story, ADR or source is rejected with the two-grounded-quotes diagnostic;
   - a finding with reference `the coherence index entry` is rejected with the reference diagnostic.
2. Verify the tests pass against the unchanged validator.
3. Commit: "test(plan-review): pin grounding for indexed decisions".

**Done when:**
- [test] `validatePlanReviewResult` accepts a contradiction finding referencing `adr-a#D3` whose two quotes are grounded in `adr-a`'s full text and a plan task.
- [test] `validatePlanReviewResult` rejects a contradiction finding whose quotes appear in no plan, story, ADR or source text with the `requires two quoted passages grounded` diagnostic, and rejects a finding whose reference is `the coherence index entry` with the `reference must name a task, story, or ADR decision` diagnostic.

**Files likely touched:**
- src/conductor/test/engine/plan-review-contract.test.ts — validation regression tests

**Verify-only:** yes

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ─────────────┬──> Task 7
Task 2 ─┐           │
Task 3 ─┴─> Task 4 ─┼──> Task 5
                    └──> Task 6 ──┬──> Task 7
                                  └──> Task 8 <── Task 1
Task 4 ──> Task 9
Task 10 (independent)
```

## Integration Points

- After Task 4: a real round-1 review over a large spec dispatches with an indexed prompt.
- After Task 7: `compose plan-review` honors config and flag budgets and prints the actionable refusal.
- After Task 8: `conduct` honors the configured budget.
- After Task 9: the reviewer receives the index's reading rule in the prompt itself.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a spec whose plan cites ADR `adr-a` (decisions D1 to D6, none changed from the merge base) and changes ADR `adr-b` by adding an amendment note inside D2 only, when a round-1 review is dispatched, then the prompt carries every plan task and every story verbatim, carries the passage of `adr-b#D2` verbatim, and carries no passage text beyond each decision's one-line index title for `adr-a#D1` to `adr-a#D6` or for `adr-b`'s other decisions. | 4 | "contains the full text of every plan task and every story verbatim and the changed `adr-b#D2` passage" | diff-local |
| Story 1 happy: Given the same spec, when a round-1 review is dispatched, then the prompt's index lists `adr-a#D1` to `adr-a#D6` and every unchanged decision of `adr-b`, each with the decision's first line as its title and `.docs/decisions/<adr-stem>.md` as its path, and lists the coherence artifact by its path `.docs/coherence/<plan-stem>.md` without its text. | 4 | "an `INDEX` entry for each unchanged decision naming `<adr-stem>#D<n>`, the decision's first line as its title and `.docs/decisions/<adr-stem>.md` as its path, and a coherence entry naming `.docs/coherence/idea.md`" | diff-local |
| Story 1 happy: Given a spec that adds a new ADR `adr-new` with decisions D1 to D4, when a round-1 review is dispatched, then the passages of all four decisions are carried verbatim. | 4 | "contains the passage of every decision of an ADR added after the merge base" | diff-local |
| Story 1 happy: Given a spec shaped like #2945 at its land commit (16 in-scope ADRs, 15 of them amended or added, 140,644 characters of in-scope decision text of which 58,497 are in changed decisions), when the round-1 prompt is assembled with the default budget, then it is within 400,000 characters and is dispatched rather than refused. | 4 | "dispatches the reviewer for the generated #2945-shaped fixture with a prompt under 400,000 characters" | diff-local |
| Story 1 happy: Given a round-1 artifact already exists and the plan has since changed, when the round-2 review is dispatched, then the prompt carries only the digest-changed tasks, stories and decisions and the prior blocking and significant findings, exactly as before this change. | 4 | "round-2 prompt is byte-identical to the pre-change round-2 prompt for the same artifacts, carrying the coherence text and prior blocking and significant findings" | diff-local |
| Story 1 negative: Given no canonical project path is supplied, so the spec's change set is unknown, when a round-1 review is dispatched, then every decision of every ADR the plan cites is carried verbatim as before this change and none is indexed. | 5 | "without `canonicalPath` dispatches a prompt carrying every decision of every cited ADR inline and no decision `INDEX` lines" | diff-local |
| Story 1 negative: Given the spec's change set cannot be resolved because `git merge-base` against the default branch fails, when a round-1 review is requested, then it fails before any reviewer is dispatched, as before this change. | 5 | "with a `canonicalPath` whose `git merge-base` fails it rejects with zero executor calls" | diff-local |
| Story 1 negative: Given the merge-base text of one changed ADR cannot be read (`git show` fails for that path), when a round-1 review is dispatched, then every decision of that ADR is carried verbatim and the other ADRs are split into changed and indexed decisions as normal. | 5 | "inlines every decision of a changed ADR whose merge-base text is `null` while another changed ADR still has its changed decisions inlined and its unchanged decisions indexed" | diff-local |
| Story 1 negative: Given a cited ADR that has no `## Decision` section, when a round-1 review is dispatched, then it contributes neither inline passages nor index entries, as before this change. | 5 | "carries no passage and no index line for a cited ADR lacking a `## Decision` heading" | diff-local |
| Story 1 negative: Given a spec with no coherence artifact, when a round-1 review is dispatched, then the index carries no coherence entry and the review still dispatches. | 5 | "no coherence index entry when `.docs/coherence/<plan-stem>.md` is absent, and the executor is still called" | diff-local |
| Story 1 negative: Given an in-scope decision whose passage differs from the merge base only by trailing whitespace on a line, when a round-1 review is dispatched, then it is treated as changed and carried verbatim; given one that differs only by `\r\n` versus `\n` line endings, it is treated as unchanged and indexed, because its parsed passage is identical. | 5 | "inlines a decision whose passage differs from the merge base only by trailing whitespace on a line, and indexes one whose text differs only by `\r\n` versus `\n` line endings" | diff-local |
| Story 2 happy: Given a round-1 prompt with indexed decisions, when the reviewer receives it, then the `INDEX` section's heading states that its items are not inlined, that each is read from its listed worktree path, and that an item must be opened before a finding quotes or relies on it. | 9 | "round-1 `INDEX` heading line states that its items are not inlined, that each is read from its listed worktree path, and that an item is opened before a finding quotes or relies on it" | diff-local |
| Story 2 happy: Given a finding whose contradiction evidence quotes a passage from an indexed decision and a passage from a plan task, when the finding is validated, then it is accepted, because grounding checks quotes against the full text of every in-scope ADR. | 10 | "accepts a contradiction finding referencing `adr-a#D3` whose two quotes are grounded in `adr-a`'s full text and a plan task" | diff-local |
| Story 2 happy: Given a round-1 review completes, when the review artifact is written, then its reviewed digest covers the full plan, stories, coherence artifact and every in-scope ADR text, so the land rung's staleness check behaves as before this change. | 4 | "deep-equals `computeReviewedDigest` over the full plan, stories, coherence text and every in-scope ADR text" | diff-local |
| Story 2 negative: Given a finding that quotes text present in no plan, story, in-scope ADR or source file, when the finding is validated, then it is rejected as ungrounded, as before this change. | 10 | "rejects a contradiction finding whose quotes appear in no plan, story, ADR or source text with the `requires two quoted passages grounded` diagnostic" | diff-local |
| Story 2 negative: Given a finding whose reference names an indexed decision `adr-a#D3` that exists, when the finding is validated, then the reference is accepted exactly as a reference to an inlined decision would be. | 10 | "accepts a contradiction finding referencing `adr-a#D3`" | diff-local |
| Story 2 negative: Given a finding whose reference is `the coherence index entry`, which names no task, story or ADR decision, when the finding is validated, then it is rejected as before this change. | 10 | "rejects a finding whose reference is `the coherence index entry` with the `reference must name a task, story, or ADR decision` diagnostic" | diff-local |
| Story 3 happy: Given no budget is configured and no flag is passed, when a review is assembled, then the budget is 400,000 characters. | 6 | "refuses a 400,001-character prompt with a message stating `exceeds 400000`" | diff-local |
| Story 3 happy: Given `.ai-conductor/config.yml` sets `plan_review: { max_prompt_chars: 600000 }`, when `ai-conductor compose plan-review --project <name> --worktree <path>` runs, then a 450,000-character prompt is dispatched rather than refused. | 7 | "dispatches a 450,000-character prompt when the project config sets `plan_review.max_prompt_chars: 600000`" | diff-local |
| Story 3 happy: Given the same config, when the `conduct` plan_review step runs, then the same 600,000-character budget applies. | 8 | "and refuses a 600,001-character prompt with `output` stating `exceeds 600000`" | diff-local |
| Story 3 happy: Given config sets 600,000 and the operator runs `compose plan-review ... --max-prompt-chars 800000`, when the review is assembled, then the budget for that run is 800,000, and a later run without the flag uses 600,000. | 7 | "passes 800,000 to `runPlanReview` over a configured 600,000, and the next run without the flag passes 600,000" | diff-local |
| Story 3 negative: Given config sets `plan_review.max_prompt_chars` to `0`, `-1`, `1.5` or `"large"`, when the config is loaded, then loading fails with an error naming `plan_review.max_prompt_chars` and stating it must be a positive integer. | 1 | "each with an error naming `plan_review.max_prompt_chars` and stating it must be a positive integer" | diff-local |
| Story 3 negative: Given config sets an unknown key under `plan_review`, such as `plan_review.max_chars`, when the config is loaded, then loading fails naming the unknown key, as for other closed config blocks. | 1 | "fails for `plan_review.max_chars` with an error naming the unknown key `max_chars`" | diff-local |
| Story 3 negative: Given the operator passes `--max-prompt-chars abc` or `--max-prompt-chars 0`, when `compose plan-review` parses its flags, then it exits 1 naming the flag and stating it takes a positive integer, and no reviewer is dispatched. | 7 | "exits 1 for values `abc` and `0` with a message naming `--max-prompt-chars` and stating it takes a positive integer" | diff-local |
| Story 3 negative: Given the operator passes `--max-prompt-chars 800000` together with `--accept <id>` or `--acknowledge`, when `compose plan-review` parses its flags, then it exits 1 stating the flag applies only to a review run, and the review artifact is unchanged. | 7 | "exits 1 for the flag combined with `--accept` or `--acknowledge` with a message stating `--max-prompt-chars` applies only to a review run; each makes no executor call and leaves the review artifact unchanged" | diff-local |
| Story 3 negative: Given `steps.plan_review.max_prompt_chars` is set instead of the top-level block, when the config is loaded, then loading fails naming the unknown step key, as for any unknown step key. | 1 | "fails for `steps.plan_review.max_prompt_chars` with the existing unknown step key error naming `max_prompt_chars`" | diff-local |
| Story 4 happy: Given a round-1 prompt of 452,000 characters and a 400,000 budget, when the review is assembled, then it is refused before any provider is dispatched, and the message states the prompt size, the budget, and the size of each section: plan, stories, inline ADR decisions, index, candidates, and prior findings when present. | 6 | "the size of every section present (plan, stories, ADR decisions, index or coherence, candidates, and prior findings when present)" | diff-local |
| Story 4 happy: Given the same refusal, when the message is read, then it names the largest section, and names both overrides with a value that would admit this prompt: `--max-prompt-chars 452000` for one run and `plan_review.max_prompt_chars` in `.ai-conductor/config.yml`. | 6 | "`Largest section: <name>`, `--max-prompt-chars <prompt length>` and `plan_review.max_prompt_chars: <prompt length>`" | diff-local |
| Story 4 happy: Given the refusal, when the operator reruns with `--max-prompt-chars 452000`, then the review dispatches. | 7 | "rerunning with that flag dispatches the reviewer" | diff-local |
| Story 4 negative: Given an over-budget prompt, when the review is refused, then no `plan_review_dispatched` event is emitted, no provider session is started, and `.docs/plan-review/<plan-stem>.md` is unchanged. | 6 | "makes zero executor calls, emits no `plan_review_dispatched` event, and leaves `.docs/plan-review/<plan-stem>.md` unchanged" | diff-local |
| Story 4 negative: Given an over-budget prompt under the `conduct` step runner, when the review is refused, then the step fails with the same message text that `compose plan-review` prints. | 8 | "returns `success: false` with `output` equal to the refusal text `compose plan-review` prints for the same artifacts after its `engineer plan-review: ` prefix" | diff-local |
| Story 4 negative: Given a prompt exactly equal to the budget, when the review is assembled, then it is dispatched, not refused. | 6 | "dispatches when `maxPromptChars` equals the prompt length exactly" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D1 | no-change | none | Step registration, tier skip and the `compose plan-review` primitive's existence are unchanged; only its flags grow. |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D2 | no-change | none | The candidate builder and its three lenses are unchanged; candidate rows stay inline in the prompt. |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D3 | task | task-4, task-6, task-7, task-9 | an `INDEX` entry for each unchanged decision naming `<adr-stem>#D<n>`, the decision's first line as its title and `.docs/decisions/<adr-stem>.md` as its path |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D4 | no-change | none | Reviewer provider selection and independence recording are unchanged. |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D5 | task | task-10 | accepts a contradiction finding referencing `adr-a#D3` whose two quotes are grounded in `adr-a`'s full text and a plan task |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D6 | task | task-4 | round-2 prompt is byte-identical to the pre-change round-2 prompt for the same artifacts |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D7 | task | task-4 | deep-equals `computeReviewedDigest` over the full plan, stories, coherence text and every in-scope ADR text |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D8 | task | task-6 | emits no `plan_review_dispatched` event |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D9 | no-change | none | Legacy fast-forward and the land rung's lack of legacy disengagement are unchanged. |
| adr-2026-10-10-source-grounded-adversarial-plan-review-step#D10 | no-change | none | The tier placement of plan §7b and coherence-check §4d is unchanged. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
