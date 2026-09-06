# Implementation Plan: Summarize the DECIDE artifacts in the spec land commit body

**Date:** 2026-09-06
**Stories:** .docs/stories/summarize-the-decide-artifacts-in-the-spec-land-co.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing land contract — the commit subject is unchanged, no artifact is read that the primitive does not already read, and a composition it cannot derive degrades to today's message rather than failing the land.

## Summary

Four bounded tasks give the spec land commit a real message body, composed from the track, tier,
stories text, and plan text the land primitive already holds in scope at its commit seam, so the
pull request derived from that commit stops opening with an empty description.

## Technical Approach

The land primitive commits the authored artifact set with a single-line message and no body. The
pull request opener derives the spec PR's title and body from that commit, so an empty commit body
is structurally an empty PR body on every run. Everything a useful summary needs is already in local
scope at the commit call: the idea string, the resolved track, the parsed complexity tier, the
stories file's text, and the plan file's text — all read for validation earlier in the same function
and then discarded.

Add one new module beside the land primitive holding a single exported pure function. It takes the
idea, the track, the optional tier, the stories text, and the plan text, and returns the full commit
message: today's subject line unchanged, then a blank line, then a body. The body carries the plan's
own Summary section text, a single line naming the track and tier, one bullet per story heading, and
a line stating how many plan tasks the plan declares. Parsing is delegated to the exported helpers
that already own these shapes — the stories-block splitter and the named-section reader in the
shared story-criteria module, and the task-body enumerator in the shared plan task parser — so this
change adds no new grammar and cannot drift from the parsers the rest of the engine uses.

Two properties make the function safe at this seam. It is total: every section it cannot derive is
omitted rather than emitted empty, and with nothing derivable it returns the subject line alone, so
a legacy or malformed artifact set lands exactly as it does today. And it is inert: the build
evidence reader scans commit messages for a `Task:`-prefixed trailer, so no line the composer emits
or copies may satisfy that grammar. Rendered task lines therefore use a list-bullet prefix, and any
line copied out of an artifact that already matches the trailer grammar is dropped. Without that
guard, a spec land commit could silently register as evidence for a build task.

The call site changes only the message argument of the existing commit invocation. No file read, no
gate, no return value, and no subject line changes, so every existing land assertion holds.

Tests follow the repository's test-authoring rules. The composer is a pure function, so its cases
are unit-level with literal fixture strings and no filesystem. The land-boundary cases extend the
existing land spec file, which already builds a real temporary Git repository with a seeded valid
worktree and injects the owner runner; the commit message is observed with a Git log format read of
the landed commit. No test spawns a real provider, network call, or hosting CLI.

## Preconditions and claim ledger

- Verified: `landSpec` in `src/conductor/src/engine/engineer/land-spec.ts` commits with the argument list `['commit', '-m', 'spec: land authored artifacts for "<idea>" [engineer/land]']`, a bare subject with no body.
- Verified: at that commit call `track`, `tier`, `storiesContent`, and `planContent` are all already bound in the same function scope, so the composer needs no additional read.
- Verified: `openSpecPr` in `src/conductor/src/engine/engineer/handoff.ts` creates the spec PR with autofill, which derives the title and body from the branch's last commit message, so the commit body is the PR body.
- Verified: `splitStoryBlocks` and `sectionBody` are exported from `src/conductor/src/engine/story-criteria.ts` and split a stories file on its story headings and return a named section's body.
- Verified: `parsePlanTaskBodies` is exported from `src/conductor/src/engine/plan-task-parse.ts` and returns one entry per plan task, honoring fenced-code state; the module has no heavy dependency.
- Verified: `TASK_ID_PATTERN` is exported from that same module, and `src/conductor/src/engine/autoheal.ts` matches build evidence with a `Task: `-prefixed anchored trailer regex built from it, so the composed body must never emit a line in that shape.
- Verified: `src/conductor/test/engine/engineer/land-spec.test.ts` already builds a real temporary repository, seeds a valid worktree, injects a fake owner runner, and reads the landed commit with a Git log format call.
- Verified: no page under `docs/` describes the spec land commit message or the spec PR body, and this change adds no flag, configuration key, skill, step, gate, or hook, so no documentation page is made stale.
- Verified: the pending change to the pull request opener that composes an explicit title and body for the create call derives that title and body from this same tip commit message, so the two changes compose and neither depends on the other landing first.
- Assumption (non-load-bearing, ~85%, inferred): plan authors keep a `## Summary` section, since the plan skill's template requires one. Impact if wrong: the body omits a summary paragraph, which is the degraded path this plan already specifies. No gate depends on it.
- Verify-claims verdict: CLEAR. Every load-bearing claim above was read from the worktree; no load-bearing assumption is unconfirmed.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: not a channel — no watcher, sidecar, reconstruction timestamp, or out-of-band signal, and the composed prose is required to stay unreadable as machine evidence.

## Tasks

### Task 1: Compose the summary body from the artifacts already in scope
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/spec-commit-message.ts, src/conductor/test/engine/engineer/spec-commit-message.test.ts
**Dependencies:** none

**Steps:**
1. Add a new unit spec file for the composer with literal fixture strings for an idea, a technical track, tier S, a stories text carrying two story headings, and a plan text carrying a Summary section and three numbered tasks.
2. Write failing cases asserting the returned message's first line is byte-identical to the current subject form, its body contains the summary sentence, a line naming the track and the tier, one line per story heading, and the declared task count.
3. Write a failing case asserting that no line of the returned message matches an anchored trailer regex built from the exported task id pattern.
4. Verify the cases fail, then add the new module exporting one pure function that takes the idea, track, optional tier, stories text, and plan text and returns the composed message, delegating parsing to the exported stories-block splitter, named-section reader, and plan task enumerator.
5. Render each task as a list bullet so its line cannot satisfy the trailer grammar, then verify the file passes and commit the focused change.

**Done when:**
1. The composed message's first line is byte-identical to the subject the land primitive commits today.
2. The composed body contains the plan's summary text, the track, the tier, one line per story heading, and the declared task count.
3. No line of the composed message matches an anchored trailer regex built from the exported task id pattern.
4. The new module performs no file, process, or network access.

### Task 2: Degrade to the bare subject instead of emitting empty or evidence-shaped lines
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/spec-commit-message.ts, src/conductor/test/engine/engineer/spec-commit-message.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing case whose plan summary text contains a line already in the trailer grammar, asserting that line is absent from the composed message while the rest of the summary survives.
2. Write a failing case with empty plan text and empty stories text, asserting the composed message equals the subject line alone and that the call throws nothing.
3. Write a failing case with a plan that has no Summary section and a stories text with no story heading, asserting the message carries no heading whose section is empty.
4. Verify the cases fail, then extend the composer to drop any copied line matching the trailer grammar and to omit every section it cannot derive rather than emitting its heading.
5. Verify the whole unit file passes and commit the focused change.

**Done when:**
1. A trailer-shaped line present in the artifact text does not appear anywhere in the composed message.
2. Empty plan and stories text produce a message equal to the subject line, with no trailing blank line and no thrown error.
3. A plan with no Summary section and a stories text with no story heading produce a message containing no heading followed by an empty section.

### Task 3: Commit the composed message from the land primitive
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 2

**Steps:**
1. Add a failing case to the existing land spec file that seeds a valid worktree whose plan carries a Summary section and three tasks and whose stories carry two headings, lands it, and reads the landed commit message in full with a Git log format call.
2. Assert in that case that the landed subject line is unchanged and that the landed body carries the plan summary text, the track, the tier, both story headings, and the task count.
3. Verify the case fails, then call the composer at the existing commit invocation in the land primitive, passing the idea, the resolved track, the parsed tier, the stories text, and the plan text already bound in that scope.
4. Replace only the message argument of that invocation with the composed message, leaving the staged paths, the commit environment, and the returned result untouched.
5. Run the land spec file, confirm the existing subject assertion still passes, and commit the focused change.

**Done when:**
1. A land fixture over a real temporary repository shows the landed commit's first line unchanged from the current subject form.
2. That fixture's landed commit body contains the plan summary text, the track, the tier, both story headings, and the plan task count.
3. The land primitive's returned slug, branch, and repository path are unchanged for that fixture.

### Task 4: Keep a degraded artifact set landing
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 3

**Steps:**
1. Add a failing case that seeds a valid worktree whose plan has no Summary section and whose stories carry no story heading, and lands it.
2. Assert the land resolves successfully and the landed commit exists with its subject unchanged.
3. Assert the landed body contains no heading followed by an empty section.
4. Verify the case passes against the implementation from Tasks 2 and 3 without changing production code; if it fails, repair the composer's omission rule rather than the assertion.
5. Run the land spec file and commit the focused change.

**Done when:**
1. A land fixture whose plan has no Summary section and whose stories have no story heading resolves successfully.
2. That fixture's landed commit carries the unchanged subject line.
3. That fixture's landed body contains no heading followed by an empty section.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a worktree whose plan artifact carries a Summary section and whose stories artifact carries two story headings, when the spec is landed, then the landed commit message keeps its existing subject line and its body carries the plan's summary text. | 3 | "A land fixture over a real temporary repository shows the landed commit's first line unchanged from the current subject form." | diff-local |
| Story 1 happy: Given that same worktree declares a technical track and tier S, when the spec is landed, then the landed commit message body names the track, the tier, each story heading, and the plan's task count. | 3 | "That fixture's landed commit body contains the plan summary text, the track, the tier, both story headings, and the plan task count." | diff-local |
| Story 1 negative: Given a worktree whose plan artifact has no Summary section and whose stories artifact has no story heading, when the spec is landed, then the commit is still created and its body carries no heading for the missing sections. | 4 | "A land fixture whose plan has no Summary section and whose stories have no story heading resolves successfully." | diff-local |
| Story 2 happy: Given a plan whose tasks are numbered, when the commit body renders those tasks, then no rendered line matches the commit trailer grammar the build evidence reader uses. | 1 | "No line of the composed message matches an anchored trailer regex built from the exported task id pattern." | diff-local |
| Story 2 negative: Given artifact text that itself contains a line in that trailer grammar, when the body is composed, then that line does not appear in the composed message. | 2 | "A trailer-shaped line present in the artifact text does not appear anywhere in the composed message." | diff-local |
| Story 2 negative: Given empty or unparseable plan and stories text, when the body is composed, then the composer returns the subject line alone and raises no error. | 2 | "Empty plan and stories text produce a message equal to the subject line, with no trailing blank line and no thrown error." | diff-local |

## Test dispositions and integration ownership

All six criteria are diff-local: every one is decided by the composer's return value or by the
message of a commit this feature's own code writes, and no commit outside this diff can change
whether they hold. Tasks 1 and 2 own unit coverage of the pure composer with literal fixture strings
and no filesystem access. Task 3 owns the single integration proof that matters for this defect —
the message the land primitive actually commits, observed through a real temporary repository at the
land entry point — because a unit test of the composer proves the helper works, not that the land
path reaches it. Task 4 owns the degraded negative at that same boundary. No test spawns a real
provider, hosting CLI, or network call; the only real external system any test touches is local Git,
which is the boundary under test. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3 -> Task 4
