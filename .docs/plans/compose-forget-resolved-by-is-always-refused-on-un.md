# Implementation Plan: compose forget --resolved-by on unassigned issues

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/compose-forget-resolved-by-is-always-refused-on-un.md`)
**Stories:** .docs/stories/compose-forget-resolved-by-is-always-refused-on-un.md
**Conflict check:** Not required (Tier S)

## Summary

Give `compose forget` the interactive approval route its guarded intake writes already accept, explain refusals,
let `--resolved-by` work without a ledger entry, and align help and composer §3a. Six tasks.

## Technical Approach

- **One terminal confirmer, shared.** The `InteractiveGithubOperationConfirmation` inlined in
  `src/conductor/src/index.ts` for the `github-operation` command (TTY check, `node:readline/promises`,
  `Authorize ${operation} on ${formatGithubOperationTarget(target)}? [y/N] `, `y`/`yes` only) moves verbatim into
  a new module `src/conductor/src/engine/github-operation-terminal-confirmation.ts` exporting
  `createTerminalGithubOperationConfirmation(io?: { input?, output?, isTerminal?: () => boolean })`. Defaults are
  `process.stdin`, `process.stdout`, and `process.stdin.isTTY && process.stdout.isTTY`. When `isTerminal()` is
  false it returns `false` without writing a prompt. `index.ts` uses the factory; its prompt behavior is unchanged.
  The module name deliberately does not start with `engineer`: the orphaned-primitive guard
  (`test/acceptance/engineer-agent-hosted.test.ts`) forbids the text `node:readline` in `src/engine/engineer*`
  files, and engineer-cli only imports the factory.
- **forget supplies the confirmer.** `DispatchEngineerOpts` gains
  `githubOperationConfirmation?: InteractiveGithubOperationConfirmation`. The `forget` case resolves
  `opts.githubOperationConfirmation ?? createTerminalGithubOperationConfirmation({ isTerminal: attached })`, where
  `attached` is the existing `opts.isAttachedTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY))`,
  and passes it as `confirmation` to BOTH `createGithubIntakeAuthorization` calls (resolution writes and label
  strip). No other subcommand receives it. The approval seam and assignment rule are untouched: approval stays one
  exact request per prompt, so comment, close, and label removal each prompt once.
- **Refusals say why.** A local helper in `engineer-cli.ts` maps a caught `GithubTrackerOperationRefusalError`
  (`src/conductor/src/engine/tracker-client.ts`) whose `reason` is `explicit-authorization-required` to an
  explanation: with no attached terminal, "the machine owner is not confirmed as this issue's sole assignee, and
  approval requires rerunning the same command from an interactive terminal"; with an attached terminal, "the
  operator declined the interactive approval". It is appended to the existing comment-failure, close-failure, and
  label-strip stderr lines; other errors print unchanged.
- **Absent entry with `--resolved-by`.** The early refusal at the no-entry branch is replaced: when the ref parses
  as `owner/repo#N`, run the same comment-then-close sequence (sharing code with the entry path), then print
  `{kind:'forget', sourceRef, found:false, removed:false, closed:true, resolvedBy}` and exit 0, without calling
  `ledger.forget` or the label strip. A non-GitHub ref still refuses before any tracker call; no-flag stays
  `found:false` with zero calls.
- **Help and §3a** are text edits in `SUBCOMMAND_HELP.forget` and `skills/composer/SKILL.md` §3a.
- Tests extend `src/conductor/test/engine/engineer/engineer-cli-intake.test.ts` (its `makeGh` serves
  `issue view --json assignees`; an unassigned fixture returns `{"assignees":[]}`) and
  `engineer-cli-help.test.ts`, injecting `githubOperationConfirmation` (a recording `{mode:'interactive', confirm}`)
  and `isAttachedTerminal`, so no test reads real stdin.

## Prerequisites

- None.

## Tasks

### Task 1: Extract the shared terminal GitHub-operation confirmer
**Story:** Story 1 (happy path 2 — prompt text)
**Type:** refactor

**Steps:**
1. Write failing test `src/conductor/test/engine/github-operation-terminal-confirmation.test.ts` using injected `PassThrough` input/output: (a) `isTerminal: () => false` → `confirm` resolves `false` and writes nothing to output; (b) terminal, input `y\n` → `true` and output contains `Authorize intake.issue.close on o/a#1? [y/N] `; (c) terminal, input `n\n` and `\n` → `false`; `yes` → `true`.
2. Verify RED (module absent).
3. Create `src/conductor/src/engine/github-operation-terminal-confirmation.ts` by moving the inline confirmer from `src/conductor/src/index.ts` verbatim behind `createTerminalGithubOperationConfirmation(io?)`; replace the inline object in `index.ts`'s `github-operation` dispatch with a factory call.
4. Verify GREEN and that the existing `github-operations-cli` tests pass.
5. Commit.

**Done when:**
- [test] `github-operation-terminal-confirmation.test.ts` asserts the non-terminal factory resolves `false` and writes no prompt, and a terminal answer of `y` or `yes` resolves `true` while `n` and empty resolve `false`.
- [test] The same test asserts the written prompt is exactly `Authorize intake.issue.close on o/a#1? [y/N] ` for an issue target `o/a#1`.
- `src/conductor/src/index.ts` contains no inline `mode: 'interactive'` confirmer and calls `createTerminalGithubOperationConfirmation` for the `github-operation` command.

**Files likely touched:**
- src/conductor/src/engine/github-operation-terminal-confirmation.ts — new factory
- src/conductor/src/index.ts — use the factory
- src/conductor/test/engine/github-operation-terminal-confirmation.test.ts — new tests

**Dependencies:** none

### Task 2: forget passes the interactive confirmer to its guarded intake writes
**Story:** Story 1 (happy paths 1–3), Story 2 (happy path)
**Type:** happy-path

**Steps:**
1. Write failing tests in `engineer-cli-intake.test.ts` (`engineer forget` describe): an unassigned-issue `makeGh` variant; a recording confirmer answering `true` and `isAttachedTerminal: () => true`; (a) `forget o/a#1 --resolved-by o/a#2` with a ledger entry → calls include comment (body contains `o/a#2`), close, label DELETE; confirmer invoked three times in order with operations `intake.issue.comment.create`, `intake.issue.close`, `intake.issue.label.remove` and target issue 1 of `o/a`; ledger entry gone; output `closed: true`, `resolvedBy: 'o/a#2'`; exit 0. (b) plain `forget o/a#1` → one confirmer call for `intake.issue.label.remove`, label DELETE sent, entry removed, `closed: false`, exit 0. (c) the existing sole-assignee `--resolved-by` test additionally injects the recording confirmer and asserts zero invocations.
2. Verify RED (confirmer never invoked; writes refused).
3. Implement: add `githubOperationConfirmation?: InteractiveGithubOperationConfirmation` to `DispatchEngineerOpts`; in `case 'forget'` resolve it as `opts.githubOperationConfirmation ?? createTerminalGithubOperationConfirmation({ isTerminal: attached })` and pass `confirmation` into both `createGithubIntakeAuthorization` calls. Import only the factory (never `node:readline`) into `engineer-cli.ts`.
4. Verify GREEN, plus `test/acceptance/engineer-agent-hosted.test.ts` (readline guard).
5. Commit.

**Done when:**
- [test] Through `dispatchEngineer` forget on an unassigned issue with an approving confirmer, the gh calls include the comment naming `o/a#2`, the close, and the label DELETE; the ledger entry is removed; the result line has `closed: true`, `resolvedBy: "o/a#2"`; exit is 0.
- [test] The same fixture records exactly three confirmer prompts, in order `intake.issue.comment.create`, `intake.issue.close`, `intake.issue.label.remove`, each targeting issue 1 of `o/a`, each recorded before its corresponding gh write call.
- [test] A plain forget on an unassigned issue with an approving confirmer sends the label DELETE, removes the entry, reports `closed: false`, and exits 0.
- [test] The sole-assignee `--resolved-by` fixture sends comment, close, and label DELETE with zero confirmer invocations.
- `src/conductor/src/engine/engineer-cli.ts` does not contain the text `node:readline`, and `engineer-agent-hosted.test.ts` passes.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — opts field, confirmer wiring in forget
- src/conductor/test/engine/engineer/engineer-cli-intake.test.ts — new forget fixtures

**Dependencies:** Task 1

### Task 3: forget explains an authorization refusal
**Story:** Story 1 (negative paths 1–3), Story 2 (negative path)
**Type:** negative-path

**Steps:**
1. Write failing tests on an unassigned issue with a ledger entry: (a) attached terminal, confirmer declines the comment → no comment/close calls, entry retained, exit nonzero, stderr contains `o/a#1` and `declined`; (b) attached, confirmer approves the comment then declines the close → comment sent, no close, entry retained, exit nonzero, stderr contains `declined`, `by hand`, and `without --resolved-by`; (c) `isAttachedTerminal: () => false` with no injected confirmer → no comment/close calls, entry retained, exit nonzero, stderr contains `sole assignee`, `interactive terminal`, and `rerun the same command`; (d) plain forget, `isAttachedTerminal: () => false` → entry removed, no label DELETE, exit 0, stderr label-strip line contains `sole assignee` and `interactive terminal`.
2. Verify RED (bare `explicit-authorization-required` only).
3. Implement the refusal-explanation helper in `engineer-cli.ts` keyed on `err instanceof GithubTrackerOperationRefusalError && err.reason === 'explicit-authorization-required'` and the resolved `attached` value; append its text to the comment-failure, close-failure, and label-strip messages.
4. Verify GREEN. 5. Commit.

**Done when:**
- [test] A declined comment prompt yields zero comment and close calls, a retained ledger entry, a nonzero exit, and stderr naming `o/a#1` and `declined`.
- [test] An approved comment with a declined close yields the comment call, no close call, a retained entry, a nonzero exit, and stderr containing `declined`, `by hand`, and `without --resolved-by`.
- [test] With no attached terminal, `--resolved-by` on an unassigned issue shows no prompt (the default terminal confirmer writes nothing), sends no comment or close, retains the entry, exits nonzero, and stderr contains `sole assignee`, `interactive terminal`, and `rerun the same command`.
- [test] With no attached terminal, a plain forget removes the entry, sends no label DELETE, exits 0, and its label-strip stderr contains `sole assignee` and `interactive terminal`.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — refusal-explanation helper and message wiring
- src/conductor/test/engine/engineer/engineer-cli-intake.test.ts — refusal fixtures

**Dependencies:** Task 2

### Task 4: --resolved-by comments and closes an issue with no ledger entry
**Story:** Story 3 (happy path, negative paths 1–3)
**Type:** happy-path

**Steps:**
1. Replace the existing test `refuses an absent ledger entry with the flag …` with failing tests: (a) sole-assigned `o/a#9`, no entry for it (another entry `o/a#1` recorded), flag `o/a#2` → calls are exactly assignee view, comment (body contains `o/a#2`), assignee view, close; no label DELETE; ledger file byte-identical; output `found: false`, `closed: true`, `resolvedBy: 'o/a#2'`; exit 0; repeat (a) on an unassigned `o/a#9` with `isAttachedTerminal: () => true` and an approving recording confirmer, expecting the same calls (plus confirmer prompts) and output. (b) unassigned `o/a#9`, no entry, `isAttachedTerminal: () => false` → no comment/close calls, ledger byte-identical, exit nonzero, stderr contains `sole assignee`. Keep the existing non-GitHub-ref and no-flag absent tests unchanged (zero tracker calls).
2. Verify RED.
3. Implement: in the no-entry branch, when `resolvedBy` is set, parse the ref (non-GitHub → existing refusal, zero calls) and run the shared comment-then-close sequence with the Task 2 confirmer and Task 3 explanations; print `{kind:'forget', sourceRef, found:false, removed:false, closed:true, resolvedBy}` and return 0 without `ledger.forget` or the label strip.
4. Verify GREEN. 5. Commit.

**Done when:**
- [test] An absent-entry fixture with the flag, run once on a sole-assigned issue and once on an unassigned issue with an attached terminal and an approving confirmer, records in each run the comment naming `o/a#2` then the close, no label DELETE call, a byte-identical ledger file, and a result line with `found: false`, `closed: true`, `resolvedBy: "o/a#2"` at exit 0.
- [test] An absent-entry fixture with the flag on an unassigned issue and no attached terminal records zero comment and close calls, a byte-identical ledger file, a nonzero exit, and stderr containing `sole assignee` and `interactive terminal`.
- [test] The absent-entry non-GitHub-ref fixture with the flag exits nonzero with zero tracker calls, and the absent-entry no-flag fixture reports `found: false` at exit 0 with zero tracker calls.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — absent-entry resolution branch
- src/conductor/test/engine/engineer/engineer-cli-intake.test.ts — absent-entry fixtures

**Dependencies:** Task 3

### Task 5: forget help states the approval route and the absent-entry behavior
**Story:** Story 4 (happy path 1, negative path 1)
**Type:** happy-path

**Steps:**
1. Extend `engineer-cli-help.test.ts` `resolved intake forget help`: the rendered topic contains `sole assignee` and `interactive`, a statement that non-interactive invocations are refused, and a statement that `--resolved-by` works without a ledger entry; the only flag token (single- or double-dash) it contains is `--resolved-by`, and it contains none of `override`, `bypass`, `skip`, or an all-caps environment-variable name. Keep the existing assertions (including `without … --resolved-by … does not close`).
2. Verify RED.
3. Update `SUBCOMMAND_HELP.forget` in `engineer-cli.ts`.
4. Verify GREEN. 5. Commit.

**Done when:**
- [test] The rendered `forget` help topic contains `sole assignee` and `interactive` in the statement that such writes ask for terminal approval, states non-interactive callers are refused, and states `--resolved-by` works when the issue has no ledger entry.
- [test] Every flag token (any whitespace-delimited token beginning with `-` followed by a letter or `-`) in the rendered `forget` help topic equals `--resolved-by`, the text contains none of `override`, `bypass`, or `skip` and no all-caps environment-variable name, and the existing comment/close/does-not-close assertions still pass.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — `SUBCOMMAND_HELP.forget`
- src/conductor/test/engine/engineer/engineer-cli-help.test.ts — help assertions

**Dependencies:** none

### Task 6: Composer §3a matches the primitive
**Story:** Story 4 (happy path 2, negative path 2)
**Type:** infrastructure

**Steps:**
1. Edit `skills/composer/SKILL.md` §3a: keep both preconditions (originating GitHub issue; explicit operator approval) and the prohibition otherwise; replace "dropping the claim" with wording that works with or without a ledger entry; add that on an issue not solely assigned to the machine owner each write asks for interactive terminal approval, that an agent shell cannot give it, and that on a refusal naming the interactive terminal the agent gives the operator the exact command to run in their own terminal and neither retries nor closes the issue another way.
2. Run `test/test_provider_skill_contracts.sh` (composer frontmatter contract) and confirm it passes.
3. Commit.

**Done when:**
- `skills/composer/SKILL.md` §3a contains the phrase `interactive terminal` and an instruction to give the operator the exact command to run in their own terminal when the drop is refused for lack of one, and forbids retrying or closing the issue another way.
- `skills/composer/SKILL.md` §3a still requires both an originating GitHub issue and explicit operator approval before `--resolved-by`, and still forbids closing anything otherwise.
- `test/test_provider_skill_contracts.sh` exits 0.

**Files likely touched:**
- skills/composer/SKILL.md — §3a

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3 ──▶ Task 4
Task 5 (independent)
Task 6 (independent)
```

## Integration Points

- After Task 2: `ai-conductor compose forget <ref> --resolved-by <ref>` on an unassigned issue prompts at a real terminal.
- After Task 4: the no-ledger-entry `--resolved-by` path is reachable through `dispatchEngineer`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a recorded github-issues ledger entry for `o/a#1` whose issue has no assignees, and stdin and stdout attached to a terminal, when the operator runs `compose forget o/a#1 --resolved-by o/a#2` and answers `y` at every approval prompt, then the issue receives a comment naming `o/a#2`, the issue is closed, the ledger entry is removed, the label removal is sent, and the result line reports `closed: true` with `resolvedBy: "o/a#2"` at exit 0. | 2 | "Through `dispatchEngineer` forget on an unassigned issue with an approving confirmer, the gh calls include the comment naming `o/a#2`, the close, and the label DELETE; the ledger entry is removed; the result line has `closed: true`, `resolvedBy: "o/a#2"`; exit is 0." | diff-local |
| Story 1 happy: Given that same unassigned issue at an interactive terminal, when `forget --resolved-by` runs, then before each of the comment, close, and label-removal writes is sent the operator is shown one `Authorize <operation> on <target>? [y/N]` prompt naming that write's operation and issue `o/a#1`, so three prompts are shown in that order. | 1, 2 | "The same fixture records exactly three confirmer prompts, in order `intake.issue.comment.create`, `intake.issue.close`, `intake.issue.label.remove`, each targeting issue 1 of `o/a`, each recorded before its corresponding gh write call." | diff-local |
| Story 1 happy: Given an issue whose sole assignee is the machine owner, when `compose forget o/a#1 --resolved-by o/a#2` runs, then the comment, close, and label removal are sent with no approval prompt shown, exactly as before this change. | 2 | "The sole-assignee `--resolved-by` fixture sends comment, close, and label DELETE with zero confirmer invocations." | diff-local |
| Story 1 negative: Given an unassigned issue at an interactive terminal, when the operator answers anything other than `y` or `yes` at the comment prompt, then no comment and no close are sent, the ledger entry remains, the command exits nonzero, and stderr names the source ref and states that the operator declined the approval. | 3, 1 | "A declined comment prompt yields zero comment and close calls, a retained ledger entry, a nonzero exit, and stderr naming `o/a#1` and `declined`." | diff-local |
| Story 1 negative: Given an unassigned issue at an interactive terminal, when the operator approves the comment but declines the close, then the comment is sent, no close is sent, the ledger entry remains, the command exits nonzero, and stderr states that the approval was declined and names closing the issue by hand and rerunning without `--resolved-by` as the recovery. | 3 | "An approved comment with a declined close yields the comment call, no close call, a retained entry, a nonzero exit, and stderr containing `declined`, `by hand`, and `without --resolved-by`." | diff-local |
| Story 1 negative: Given an unassigned issue and stdin or stdout not attached to a terminal (an agent shell), when `compose forget o/a#1 --resolved-by o/a#2` runs, then no approval prompt is shown, no comment and no close are sent, the ledger entry remains, the command exits nonzero, and stderr states that the machine owner is not confirmed as the issue's sole assignee and that approval requires rerunning the same command from an interactive terminal. | 3 | "With no attached terminal, `--resolved-by` on an unassigned issue shows no prompt (the default terminal confirmer writes nothing), sends no comment or close, retains the entry, exits nonzero, and stderr contains `sole assignee`, `interactive terminal`, and `rerun the same command`." | diff-local |
| Story 2 happy: Given a recorded ledger entry for an unassigned issue `o/a#1` and an interactive terminal, when the operator runs `compose forget o/a#1` and approves the prompt, then the ledger entry is removed, the label removal is sent, and the result line reports `closed: false` at exit 0. | 2 | "A plain forget on an unassigned issue with an approving confirmer sends the label DELETE, removes the entry, reports `closed: false`, and exits 0." | diff-local |
| Story 2 negative: Given a recorded ledger entry for an unassigned issue and no attached terminal, when `compose forget o/a#1` runs, then the ledger entry is still removed, no label removal is sent, the command exits 0, and the stderr label-strip message states that the machine owner is not confirmed as the issue's sole assignee and that approval requires an interactive terminal. | 3 | "With no attached terminal, a plain forget removes the entry, sends no label DELETE, exits 0, and its label-strip stderr contains `sole assignee` and `interactive terminal`." | diff-local |
| Story 3 happy: Given no ledger entry for `o/a#9` and a write the guard authorizes (sole assignee, or an approving interactive operator), when `compose forget o/a#9 --resolved-by o/a#2` runs, then the issue receives a comment naming `o/a#2` and is then closed, no label removal is attempted, the ledger file is byte-identical to before, and the result line reports `found: false`, `closed: true`, and `resolvedBy: "o/a#2"` at exit 0. | 4 | "An absent-entry fixture with the flag on an unassigned issue and no attached terminal records zero comment and close calls, a byte-identical ledger file, a nonzero exit, and stderr containing `sole assignee` and `interactive terminal`." | diff-local |
| Story 3 negative: Given no ledger entry for an unassigned `o/a#9` and no attached terminal, when `compose forget o/a#9 --resolved-by o/a#2` runs, then no comment and no close are sent, the ledger file is byte-identical, the command exits nonzero, and stderr states the sole-assignee and interactive-terminal reason. | 4 | "An absent-entry fixture with the flag on an unassigned issue and no attached terminal records zero comment and close calls, a byte-identical ledger file, a nonzero exit, and stderr containing `sole assignee` and `interactive terminal`." | diff-local |
| Story 3 negative: Given no ledger entry and a source ref that is not an `owner/repo#N` GitHub reference, when the resolved-by flag is supplied, then the command refuses with a nonzero exit and issues no tracker call. | 4 | "The absent-entry non-GitHub-ref fixture with the flag exits nonzero with zero tracker calls, and the absent-entry no-flag fixture reports `found: false` at exit 0 with zero tracker calls." | diff-local |
| Story 3 negative: Given no ledger entry and no resolved-by flag, when `compose forget o/z#9` runs, then it reports `found: false` at exit 0 and issues no tracker call. | 4 | "The absent-entry non-GitHub-ref fixture with the flag exits nonzero with zero tracker calls, and the absent-entry no-flag fixture reports `found: false` at exit 0 with zero tracker calls." | diff-local |
| Story 4 happy: Given the operator asks for the `forget` help topic, when it renders, then it states that a write on an issue the machine owner is not the sole assignee of asks for interactive approval at the terminal, that a non-interactive invocation is refused, and that `--resolved-by` also works when the issue has no ledger entry. | 5 | "The rendered `forget` help topic contains `sole assignee` and `interactive` in the statement that such writes ask for terminal approval, states non-interactive callers are refused, and states `--resolved-by` works when the issue has no ledger entry." | diff-local |
| Story 4 happy: Given the composer reaches an already-fixed intake idea with an originating GitHub issue and explicit operator approval, when it follows §3a, then the shipped skill directs the `--resolved-by` drop and, when that drop is refused for lack of an interactive terminal, directs the agent to give the operator the exact command to run in their own interactive terminal and not to retry or close the issue another way. | 6 | "`skills/composer/SKILL.md` §3a contains the phrase `interactive terminal` and an instruction to give the operator the exact command to run in their own terminal when the drop is refused for lack of one, and forbids retrying or closing the issue another way." | diff-local |
| Story 4 negative: Given the forget help topic renders, when its text is read, then it names no flag other than `--resolved-by` and offers no override or bypass of the approval. | 5 | "Every flag token (any whitespace-delimited token beginning with `-` followed by a letter or `-`) in the rendered `forget` help topic equals `--resolved-by`, the text contains none of `override`, `bypass`, or `skip` and no all-caps environment-variable name, and the existing comment/close/does-not-close assertions still pass." | diff-local |
| Story 4 negative: Given the idea has no originating GitHub issue, or the operator has not explicitly approved the drop, when the composer reaches §3a, then the skill still forbids the `--resolved-by` form and closes nothing. | 6 | "`skills/composer/SKILL.md` §3a still requires both an originating GitHub issue and explicit operator approval before `--resolved-by`, and still forbids closing anything otherwise." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
