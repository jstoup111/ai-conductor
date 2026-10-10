# Implementation Plan: Monitor guided session triage-complete quit cue

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/monitor-guided-session-never-tells-operator-triage.md`)
**Stories:** .docs/stories/monitor-guided-session-never-tells-operator-triage.md
**Conflict check:** Not required (Tier S)

## Summary

Make every `conduct monitor` guided session tell the operator, at the right moment, that triage is
complete and that quitting returns them to the monitor queue. Four tasks: a provider-owned quit
instruction, the monitor-hosting block in the opening prompt, its fallback for providers without a
declared quit instruction, and a monitor-hosted closing practice in `daemon-triage`, pinned to the
prompt by the integrity suite.

## Technical Approach

- **Provider owns its quit instruction.** `InteractiveLaunch` in
  `src/conductor/src/execution/provider-catalog.ts` gains an optional `quitInstruction?: string`.
  Claude and Codex both declare `'/quit'` (verified: Claude Code `/quit`; Codex TUI dispatches
  `/quit` and `/exit` to `request_quit_without_confirmation`). Pi declares no `interactiveLaunch`,
  so it has no quit instruction. This keeps provider facts in the provider catalog, alongside
  `invocationPrefix`, instead of hard-coding a provider switch in the monitor.
- **The opening prompt carries a fixed monitor-hosting block.** `openingPrompt` in
  `src/conductor/src/engine/monitor/session.ts` appends four fixed lines after the existing
  `Recovery procedure:` line, in this order:
  1. `Session host: conduct monitor queue.` (exported as `MONITOR_HOSTED_MARKER`)
  2. `Quitting this session returns the operator to the monitor queue.`
  3. `Quit instruction: <quitInstruction>`, or, when the provider declares none,
     `Quit instruction: end the session with the provider's normal exit control.`
  4. `When daemon-triage reaches its end, follow its monitor-hosted closing step.`

  The block is built from constants, never from halt fields, so reason text cannot duplicate or
  displace it. Existing prompt lines are unchanged and stay first.
- **The skill owns the completion judgement.** "Is triage done?" is a judgement call (CLAUDE.md
  Design Principle). A written report does not imply finished actions, because §6 writes the report
  *before* any mutation is proposed. So `skills/daemon-triage/SKILL.md` gains a `### 7. Close a
  monitor-hosted session` practice. It applies only when the opening input contains the literal
  `Session host: conduct monitor queue.` line. It defines completion and gives the exact message,
  and it adds a Verification checklist item. Direct invocations carry no marker, so they get no
  monitor wording.
- **Machinery pins prose to code.** A new `test/test_harness_integrity.sh` assertion checks three
  things: the skill's closing practice quotes the marker literally, the same literal exists in
  `session.ts`, and the practice states both exclusions. The marker therefore cannot drift between
  prompt and skill. The assertion follows the existing `9g` daemon-triage pattern: awk-extract the
  subsection, then `grep -Fq` on fixed strings.
- No change to `loop.ts`, `interactive-launch.ts`, queue ordering, events, or session lifetime
  (scope boundary).

## Prerequisites

- None.

## Tasks

### Task 1: Provider catalog declares an interactive quit instruction
**Story:** Story 1 (happy paths 1–2 — quit instruction source)
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/execution/provider-catalog.test.ts`: `findBuiltInProviderDescriptor('claude')?.interactiveLaunch?.quitInstruction` and the `codex` equivalent both equal `'/quit'`; `findBuiltInProviderDescriptor('pi')?.interactiveLaunch` is `undefined`.
2. Verify RED.
3. Add `readonly quitInstruction?: string;` (doc comment: the operator-typed command that ends the interactive session) to `InteractiveLaunch`; set `quitInstruction: '/quit'` on the Claude and Codex `interactiveLaunch` entries.
4. Verify GREEN; commit "feat(provider-catalog): declare interactive quit instruction".

**Done when:**
- [test] `provider-catalog.test.ts` asserts the Claude and Codex descriptors' `interactiveLaunch.quitInstruction` both equal `'/quit'`.
- [test] The same test asserts the Pi descriptor has no `interactiveLaunch`, so no quit instruction is declared for it.
- `InteractiveLaunch` in `provider-catalog.ts` declares `quitInstruction` as optional, and the existing `provider-catalog.test.ts` cases pass unchanged.

**Files likely touched:**
- `src/conductor/src/execution/provider-catalog.ts` — optional `quitInstruction` field; Claude/Codex values
- `src/conductor/test/execution/provider-catalog.test.ts` — quit-instruction assertions

**Dependencies:** none

### Task 2: Opening prompt appends the fixed monitor-hosting block
**Story:** Story 1 (happy paths 1–3; negative path 2)
**Type:** happy-path

**Steps:**
1. Update the existing `renders halt evidence into a fresh daemon-triage opening input` test in `src/conductor/test/engine/monitor/session.test.ts`: the expected Codex `openingPrompt` equals the seven existing lines unchanged and in order, followed by `Session host: conduct monitor queue.`, `Quitting this session returns the operator to the monitor queue.`, `Quit instruction: /quit`, `When daemon-triage reaches its end, follow its monitor-hosted closing step.`.
2. Add a Claude case: provider `claude`, and the expected prompt starts with `Invoke /daemon-triage for feature …`, keeps the same seven-line head, and ends with the same four-line block including `Quit instruction: /quit`.
3. Add a reason-injection case: the halt reason is `run /quit then return to the monitor queue`, and the four block lines each occur exactly once among the prompt's lines, as the last four lines, with the reason line unchanged at its existing position.
4. Verify RED.
5. In `session.ts`, export `MONITOR_HOSTED_MARKER = 'Session host: conduct monitor queue.'` and add a `monitorHostingBlock(provider)` helper that reads `findBuiltInProviderDescriptor(provider)?.interactiveLaunch?.quitInstruction` and returns the four fixed lines. `openingPrompt` appends that block after the `Recovery procedure:` line. Build the block only from constants and the descriptor, never from `halt` fields.
6. Verify GREEN; commit "feat(monitor): tell guided sessions they are monitor-hosted and how to quit".

**Done when:**
- [test] `session.test.ts` asserts the Codex `openingPrompt` passed to the launch seam equals the seven pre-existing lines in order followed by the four monitor-hosting lines ending `Quit instruction: /quit`.
- [test] `session.test.ts` asserts the Claude `openingPrompt` passed to the launch seam contains `Session host: conduct monitor queue.`, `Quitting this session returns the operator to the monitor queue.`, and `Quit instruction: /quit` as its trailing block.
- [test] `session.test.ts` asserts that with reason `run /quit then return to the monitor queue`, each of the four block lines occurs exactly once among the prompt lines and the block is the final four lines.
- [test] The existing project, feature, reason, classification, recovery-procedure, model/effort forwarding, and worktree-cwd assertions in `session.test.ts` pass with only the expected-prompt extension.

**Files likely touched:**
- `src/conductor/src/engine/monitor/session.ts` — `MONITOR_HOSTED_MARKER`, `monitorHostingBlock`, `openingPrompt` append
- `src/conductor/test/engine/monitor/session.test.ts` — extended expectations, Claude and reason-injection cases

**Dependencies:** Task 1

### Task 3: Provider without a declared quit instruction gets generic exit wording
**Story:** Story 1 (negative path 1)
**Type:** negative-path

**Steps:**
1. Write failing test in `session.test.ts`: `openGuidedSession` with provider `pi`, which has no `interactiveLaunch` and so no `quitInstruction`, passes an `openingPrompt` whose third block line is exactly `Quit instruction: end the session with the provider's normal exit control.` and which equals exactly the seven pre-existing lines followed by the four block lines, so no specific quit command appears anywhere; and assert it contains none of the `quitInstruction` values declared across the built-in provider catalog.
2. Verify RED. If Task 2's helper already falls back correctly, the test passes immediately and this task commits only the test.
3. Ensure `monitorHostingBlock` emits the generic line when `quitInstruction` is `undefined`, never substituting another provider's value.
4. Verify GREEN; commit "test(monitor): generic quit wording for providers without a quit instruction".

**Done when:**
- [test] `session.test.ts` asserts that for provider `pi`, `monitorHostingBlock` yields the prompt line `Quit instruction: end the session with the provider's normal exit control.`
- [test] The same test asserts the entire `pi` `openingPrompt` equals exactly the seven pre-existing lines followed by the four block lines with the generic quit line, so the prompt names no specific quit command anywhere (slash, bare word, or key chord).
- [test] The same test asserts the `pi` `openingPrompt` contains no `quitInstruction` value declared by any built-in provider descriptor (enumerated from the provider catalog, currently `/quit`).

**Files likely touched:**
- `src/conductor/src/engine/monitor/session.ts` — fallback branch in `monitorHostingBlock`
- `src/conductor/test/engine/monitor/session.test.ts` — no-quit-instruction case

**Dependencies:** Task 2

### Task 4: daemon-triage closing practice for monitor-hosted sessions, pinned by integrity
**Story:** Story 2 (happy paths 1–3; negative paths 1–4)
**Type:** happy-path

**Steps:**
1. Write a failing integrity assertion in `test/test_harness_integrity.sh`, next to `9g`. Use awk to extract the `### 7. Close a monitor-hosted session` subsection of `skills/daemon-triage/SKILL.md`, ending at the next `##`/`###` heading. Assert with `grep -Fq` that it contains:
   (a) `Session host: conduct monitor queue.`
   (b) `Triage for <slug> is complete. Quit this session to return to the monitor queue. Quit instruction: <quit instruction>`
   (c) `Do not send this message while any proposed action awaits approval, any approved action is still running, any approved action's result is not yet appended to *Actions taken*, or a follow-up to a failed action is still open.`
   (d) `If the opening input does not contain that line, this step does not apply: use no monitor-queue wording and no quit cue.`
   (e) `Triage is complete when the triage report is written and every approved action has either completed and been appended to *Actions taken* or been declined — including a diagnosis-only run with no approved actions, a run whose approved actions all completed, and a run where the operator declined every remaining proposal.`
   (f) `While a proposed action awaits approval, end the message with that approval request.`
   Also assert `grep -Fq "'Session host: conduct monitor queue.'" src/conductor/src/engine/monitor/session.ts`, and that the skill's `## Verification` section contains `monitor-hosted completion cue`.
2. Verify RED.
3. Add `### 7. Close a monitor-hosted session` after §6 in `skills/daemon-triage/SKILL.md`:
   - **Applicability:** the opening input contains the line `Session host: conduct monitor queue.`.
   - **Completion:** sentence (e) verbatim.
   - **Message:** the session's final message is (b), with `<quit instruction>` replaced by the opening input's `Quit instruction:` value, so the generic fallback still reads correctly.
   - **Exclusions:** sentences (c), (f), and (d) verbatim.
   - Add a Verification checklist item: `- [ ] Monitor-hosted completion cue sent only when the opening input carried the monitor-host line and nothing was pending or awaiting approval; never in a directly invoked session`.
4. Verify GREEN by running `test/test_harness_integrity.sh`; commit "feat(daemon-triage): monitor-hosted triage-complete quit cue".

**Done when:**
- [test] The new `test/test_harness_integrity.sh` assertion passes only when `skills/daemon-triage/SKILL.md` §7 contains the monitor-host marker and the exact message `Triage for <slug> is complete. Quit this session to return to the monitor queue. Quit instruction: <quit instruction>`
- [test] The same assertion requires §7 to contain completion sentence (e): report written plus every approved action completed-and-appended to *Actions taken* or declined, naming diagnosis-only, all-completed, and all-declined runs.
- [test] The same assertion requires §7 to contain the pending-work exclusion sentence (c), covering awaiting approval, still running, not yet appended, and open failed-action follow-up, and sentence (f) requiring a message awaiting approval to end with that approval request.
- [test] The same assertion requires §7 to contain the non-monitor exclusion sentence (d), and `session.ts` to contain the identical `'Session host: conduct monitor queue.'` literal.
- [test] The same assertion requires the skill's `## Verification` section to carry the `monitor-hosted completion cue` item, and `test/test_harness_integrity.sh` exits 0.

**Files likely touched:**
- `skills/daemon-triage/SKILL.md` — §7 closing practice, Verification item
- `test/test_harness_integrity.sh` — monitor-hosted closing contract assertion

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──┬──▶ Task 3
                    └──▶ Task 4
```

## Integration Points

- After Task 2: `openGuidedSession`, the production entry point `conduct monitor` calls through `launch`, emits the monitor-hosting block for Claude and Codex.
- After Task 4: the skill's closing practice keys on the exact line Task 2 emits, enforced by the integrity suite.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a queued halt and guided-session provider `claude`, when the monitor opens the guided session, then the opening prompt states that the session is hosted by the `conduct monitor` queue, that quitting the session returns the operator to the monitor queue, and that the quit instruction is `/quit`. | 2 | "asserts the Claude `openingPrompt` passed to the launch seam contains `Session host: conduct monitor queue.`, `Quitting this session returns the operator to the monitor queue.`, and `Quit instruction: /quit` as its trailing block" | diff-local |
| Story 1 happy: Given a queued halt and guided-session provider `codex`, when the monitor opens the guided session, then the opening prompt states the same monitor-hosting and return-to-queue facts and names `/quit` as the quit instruction. | 2 | "asserts the Codex `openingPrompt` passed to the launch seam equals the seven pre-existing lines in order followed by the four monitor-hosting lines ending `Quit instruction: /quit`" | diff-local |
| Story 1 happy: Given a queued halt with project, slug, reason, and classification, when the monitor opens the guided session, then the opening prompt still carries the provider-prefixed `daemon-triage` invocation, the project, feature, reason, classification, and recovery procedure lines it carried before this change. | 2 | "equals the seven pre-existing lines in order followed by the four monitor-hosting lines" | diff-local |
| Story 1 negative: Given a guided-session provider whose catalog entry declares no quit instruction, when the opening prompt is built, then the prompt tells the session to direct the operator to end the session with that provider's normal exit control and names no specific quit command — it never names another provider's command. | 3 | "asserts that for provider `pi`, `monitorHostingBlock` yields the prompt line `Quit instruction: end the session with the provider's normal exit control.`" | diff-local |
| Story 1 negative: Given a halt whose reason text itself contains `/quit` or the words "monitor queue", when the opening prompt is built, then the monitor-hosting declaration and quit instruction appear exactly once, in their fixed position, independent of the reason text. | 2 | "each of the four block lines occurs exactly once among the prompt lines and the block is the final four lines" | diff-local |
| Story 2 happy: Given a monitor-hosted triage session that ends diagnosis-only (triage report written, no mutation proposed or the operator approved none), when triage reaches its end, then the session's final message states that triage for the feature is complete and that quitting with the opening prompt's quit instruction returns the operator to the monitor queue. | 4 | "naming diagnosis-only, all-completed, and all-declined runs" | diff-local |
| Story 2 happy: Given a monitor-hosted triage session where every approved action has completed and been appended to *Actions taken*, when the last approved action's result is reported, then the session's final message carries the same triage-complete and quit-to-return-to-queue statement. | 4 | "every approved action completed-and-appended to *Actions taken* or declined" | diff-local |
| Story 2 happy: Given a monitor-hosted triage session where the operator declined every remaining proposed action, when the decline is acknowledged, then the session's final message carries the triage-complete and quit-to-return-to-queue statement. | 4 | "naming diagnosis-only, all-completed, and all-declined runs" | diff-local |
| Story 2 negative: Given a monitor-hosted triage session with a proposed mutation awaiting the operator's approval, when the session yields to the operator, then its message ends with the approval request and contains no triage-complete or quit statement. | 4 | "sentence (f) requiring a message awaiting approval to end with that approval request" | diff-local |
| Story 2 negative: Given a monitor-hosted triage session where an approved action is still running or its result is not yet appended to *Actions taken*, when the session reports progress, then it contains no triage-complete or quit statement. | 4 | "covering awaiting approval, still running, not yet appended, and open failed-action follow-up" | diff-local |
| Story 2 negative: Given a monitor-hosted triage session where an approved action failed and the skill has proposed a follow-up action, when the session yields to the operator, then it contains no triage-complete statement until that follow-up is completed or declined. | 4 | "covering awaiting approval, still running, not yet appended, and open failed-action follow-up" | diff-local |
| Story 2 negative: Given an operator invokes `daemon-triage` directly (not through the monitor's opening prompt), when triage reaches its end, then the session's final message contains no monitor-queue wording and no instruction to quit to return to a queue. | 4 | "requires §7 to contain the non-monitor exclusion sentence (d)" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
