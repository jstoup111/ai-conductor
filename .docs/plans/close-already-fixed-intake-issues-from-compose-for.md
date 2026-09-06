# Implementation Plan: Close already-fixed intake issues from compose forget

**Date:** 2026-09-06
**Stories:** .docs/stories/close-already-fixed-intake-issues-from-compose-for.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent is additive to one existing terminal verb and conforms to the established intake contract: the source ref is parsed by the shared parser, tracker writes go through the injected runner, and the ledger drop stays the verb's last act.

## Summary

Four bounded tasks deliver #830 by giving the existing terminal abandon verb an optional
operator-approval flag that comments the resolving reference on the originating GitHub issue and
closes it before the ledger entry is dropped. A new verb, automatic already-fixed detection, a new
ledger status, and the spec-authored write-back path are outside this slice.

## Technical Approach

The abandon path already exists: the `forget` subcommand parses a positional source ref with an
empty flag allow-list, and its dispatch branch reads the ledger entry, drops it, then best-effort
strips the intake label through the injected `gh` runner. The only missing pieces are an
operator-approval flag and two tracker writes, both of which have existing implementations.

Add one optional flag, `--fixed-by <ref>`, to the `forget` grammar. Extend the verb's allow-list so
the flag parses and every other unknown flag keeps producing the existing named-flag rejection. Its
value is free text — a PR reference, an issue reference, or a commit — and is validated only as
non-empty and non-flag-shaped, which the shared flag reader already enforces by returning null for a
missing, blank, or `--`-prefixed value; a null value falls through to the verb's existing guide
descriptor. Carry the parsed value on the dispatch descriptor as an optional field so a drop with no
flag keeps a byte-identical descriptor shape.

In the dispatch branch, gate every tracker write on the flag being present. When it is absent the
branch runs exactly as it does today. When it is present, resolve the source ref through the shared
`parseSourceRef` compat shim; a null result means a non-GitHub grammar, which must refuse rather
than silently skip the way the advisory label strip does. Then, in this order: post the audit
comment, close the issue, drop the ledger entry, strip the label. Ordering is the mechanism that
delivers ledger/issue agreement — nothing durable is dropped until both tracker writes have been
accepted, so a failure can only leave the issue open with the entry still present, never the
reverse. The audit comment must contain the operator-supplied resolving reference verbatim so the
closure is auditable from the issue alone.

Both tracker writes reuse `createGithubTrackerClient` from the tracker client module, constructed
over the same injected runner the branch already uses; `upsertIssueComment` and `closeIssue` take a
repo plus an issue reference and are exactly the two operations needed, so no new adapter, argv
builder, or credential path is introduced. On either failure, exit nonzero without touching the
ledger and print a diagnostic through the branch's existing stderr sink. The close-failure
diagnostic names the recovery explicitly — close the issue by hand, then rerun the drop without the
flag — because rerunning with the flag would post a second audit comment; that bounded recovery is
the deliberate alternative to comment deduplication, which this slice does not attempt. An absent
ledger entry with the flag present is likewise a refusal with zero tracker calls: the flag declares
a disposition on a claimed idea, and closing an issue the harness holds no claim record for is
outside what the operator approved.

The single JSON result line gains a `closed` boolean, present on both paths, plus the resolving
reference when one was supplied. This is the verb's existing report channel, not a new one; no
event, metric, span, or sidecar file is added.

Surface the disposition in the three places an operator meets it: the verb's help topic, the compose
guide line, and the shipped composer skill's loop instructions. The skill gains a short subsection
for the already-fixed disposition placed between the DECIDE authoring step and the land step, since
that is where the loop discovers the idea needs no spec. It states the two preconditions the CLI
cannot check for itself — explicit operator approval and an originating issue — and states that this
path authors and lands nothing. Keep the wording host neutral; the surrounding loop already scopes
its host-specific invocation mechanics on their own lines and those lines are not touched.

Tests follow the repository's test-design rules and the two existing CLI test files' established
seams. Grammar cases are unit tests over the pure command parser. Behavior cases are dispatch-level
integration tests that run the real dispatch branch, the real ledger, and the real tracker client
against a fake runner that records argv and can be told to reject a named operation, so the internal
flow is real and only the third-party boundary is faked. Surface cases extend the existing help test
file, which already asserts on rendered help and guide content. No test may reach a real tracker,
network, or LLM.

## Preconditions and claim ledger

- Operator approved the Small scope, the technical track, the single-flag approach over a new verb, and all three stories on 2026-09-06 (delegated).
- Verified: the `forget` subcommand grammar parses a positional source ref, returns the guide descriptor when it is absent or flag-shaped, and calls the unknown-flag finder with an empty allow-list.
- Verified: the `forget` dispatch branch reads the ledger entry, returns a `found:false` result at exit 0 when absent, calls `ledger.forget`, then strips the intake label best-effort through the injected runner, printing one JSON result line.
- Verified: the shared flag reader returns null for a missing, blank, or `--`-prefixed value, so a valueless flag needs no bespoke validation.
- Verified: the shared source-ref compat shim returns a repo plus issue string for `owner/repo#N` and null for any other grammar, and the dispatch branch already uses it for the label strip.
- Verified: the tracker client module exports a GitHub-backed client factory over the same runner signature the dispatch options supply, and that client already implements an issue-comment and an issue-close operation.
- Verified: the intake write-back module exports only routed and done reporters and is reached only from the spec-authored land and handoff paths, so it cannot serve a drop that authors no spec.
- Verified: the implementation-merge closer only injects a closing keyword into an implementation PR body, and an already-fixed idea produces no implementation PR, so that path can never fire here.
- Verified: the existing CLI test files cover the verb's grammar and dispatch with an injected runner, and the help test file asserts on rendered help-topic and guide content, so both seams already exist.
- Verified: the release gate's breaking-surface classifier keys on the shell entry point, the installer, hook paths, settings files, and removed skill directories; the engine source file changed here matches none of them, so no migration block or waiver is owed.
- Scope check: consumer-facing; no new skill; provider-agnostic. Event spine: no new channel — the verb's existing result line and stderr diagnostic only.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior cited above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Parse the operator-approval flag on the abandon verb
**Story:** Story 1 (negative path)
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-intake.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing grammar test block for the verb with cases for the flag carrying a value, the flag with no value, the flag followed by another flag, the verb with no flag at all, and an unknown flag alongside the new one.
2. Establish RED, then widen the descriptor union's forget member with an optional resolved-by field and add the flag to that subcommand's allow-list so the unknown-flag finder keeps rejecting everything else by name.
3. Read the value with the shared flag reader and map its null result to the verb's existing guide descriptor, so a valueless flag never reaches dispatch.
4. Run the focused test file through the repository's scoped test invocation, then its typecheck target that covers test files, and commit.

**Done when:**
1. The command parser accepts the flag with a value and carries that value on the forget descriptor alongside the positional source ref.
2. The flag with a missing, blank, or flag-shaped value yields the guide descriptor, and an unknown flag still yields the named-flag rejection descriptor.
3. A forget invocation with no flag yields a descriptor carrying no resolved-by value, identical in shape to today's.

### Task 2: Comment the resolving reference and close the originating issue
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-intake.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the fake runner in the existing dispatch test file so it records argv for issue-comment and issue-close invocations, then write RED cases for a recorded entry dropped with the flag and the same entry dropped without it.
2. Establish RED, then in the dispatch branch construct the GitHub-backed tracker client over the injected runner and, only when the flag is present and the source ref parses, post the audit comment containing the operator-supplied reference verbatim, then close the issue, and only then drop the entry and strip the label.
3. Add the closed boolean and the resolving reference to the single JSON result line, keeping the existing fields and their values unchanged on the no-flag path.
4. Run the focused test file through the repository's scoped test invocation, then its typecheck target that covers test files, and commit.

**Done when:**
1. A dispatch fixture with an injected tracker runner observes an issue-comment call carrying the operator-supplied resolving reference, followed by an issue-close call for the same repo and issue number.
2. After a successful comment and close the ledger no longer knows the source ref, the intake label strip still runs, and the single result line reports the issue as closed together with that resolving reference.
3. A dispatch with no resolved-by value observes only the existing label-strip call, reports the issue as not closed, and exits 0.

### Task 3: Refuse the drop when the issue cannot be closed
**Story:** Story 1 (negative path)
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-intake.test.ts
**Dependencies:** 2

**Steps:**
1. Give the test file's fake runner an injectable rejection for a named operation, then write RED cases for a rejected comment, a rejected close, a source ref that is not an owner-repo-hash-number GitHub reference, and an absent ledger entry — each with the flag supplied.
2. Establish RED, then wrap the two tracker writes so either failure returns a nonzero exit before the ledger is touched, and print the failure through the branch's existing stderr sink naming the source ref.
3. Make the close-failure diagnostic name both recovery steps — close the issue by hand, then rerun the drop without the flag — and make the unparseable-ref and absent-entry cases refuse before any tracker call is made.
4. Assert in each case that the entry is still readable through the real ledger afterwards; run the focused test file through the repository's scoped test invocation, then its typecheck target that covers test files, and commit.

**Done when:**
1. An injected comment failure leaves the entry readable in the ledger, records no close call, exits nonzero, and prints a diagnostic naming the source ref.
2. An injected close failure leaves the entry readable in the ledger and its stderr text names both closing the issue by hand and rerunning the drop without the flag.
3. A source ref that is not a GitHub owner-repo-number reference, and an absent ledger entry, each exit nonzero with zero tracker calls and an unchanged ledger file.

### Task 4: Surface the gated disposition in help, guide, and the composer loop
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer-cli.ts, skills/composer/SKILL.md, src/conductor/test/engine/engineer/engineer-cli-help.test.ts
**Dependencies:** 1

**Steps:**
1. Add RED cases to the existing help test file asserting the verb's rendered help topic names the flag, the comment, the close, and the fact that no close happens without the flag, and asserting the rendered guide line shows the optional flag form.
2. Establish RED, then update the verb's help entry and the guide's verb line, keeping the entry's existing flags, mutates, and loop-fit paragraphs and its established sentence shapes.
3. Add a short subsection to the shipped composer skill between its DECIDE authoring step and its land step covering the already-fixed disposition: the gated command form, that explicit operator approval is required, that the idea must carry an originating issue, and that this path authors and lands nothing before the session ends. Keep the wording host neutral and leave the surrounding host-scoped invocation lines untouched.
4. Run the focused help test file through the repository's scoped test invocation, then its typecheck target that covers test files, then the repository's harness integrity suite, and commit.

**Done when:**
1. The rendered help topic for the verb contains the flag token, the words comment and close, and the statement that the flag gates the close.
2. The rendered guide line for the verb contains the optional resolved-by form, and an unknown flag passed to the verb still produces the existing named-flag rejection at exit 1 while the resolved-by flag parses.
3. The shipped composer skill carries a drop-as-fixed subsection naming the gated command form, the explicit-operator-approval precondition, the originating-issue precondition, and the instruction not to author a spec on that path.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a recorded github-issues ledger entry for an `owner/repo#N` source ref, when the operator drops it with the resolved-by flag naming the resolving reference, then the originating issue receives a comment naming that reference and is then closed, and the ledger entry and its intake label are removed. | 2 | "A dispatch fixture with an injected tracker runner observes an issue-comment call carrying the operator-supplied resolving reference, followed by an issue-close call for the same repo and issue number." | diff-local |
| Story 1 happy: Given that same drop, when it completes, then its single result line reports the ref as no longer known to the ledger and reports the issue as closed together with the resolving reference the operator supplied. | 2 | "After a successful comment and close the ledger no longer knows the source ref, the intake label strip still runs, and the single result line reports the issue as closed together with that resolving reference." | diff-local |
| Story 1 negative: Given a recorded ledger entry, when the operator drops it without the resolved-by flag, then no comment is posted and no issue is closed, the result line reports the issue as not closed, and the entry and label removal behave exactly as they do today at exit code 0. | 2 | "A dispatch with no resolved-by value observes only the existing label-strip call, reports the issue as not closed, and exits 0." | diff-local |
| Story 1 negative: Given the resolved-by flag is supplied for a source ref that is not an `owner/repo#N` GitHub reference, when the command runs, then it refuses with a nonzero exit, posts no comment, closes no issue, and leaves the ledger entry present. | 3 | "A source ref that is not a GitHub owner-repo-number reference, and an absent ledger entry, each exit nonzero with zero tracker calls and an unchanged ledger file." | diff-local |
| Story 1 negative: Given the resolved-by flag is supplied with no value or with a blank value, when the command parses, then it prints the verb guide without dropping the entry or issuing any tracker call. | 1 | "The flag with a missing, blank, or flag-shaped value yields the guide descriptor, and an unknown flag still yields the named-flag rejection descriptor." | diff-local |
| Story 2 happy: Given the comment and the close both succeed, when the command finishes, then the ledger no longer knows the source ref and the issue is closed, so both states agree. | 2 | "After a successful comment and close the ledger no longer knows the source ref, the intake label strip still runs, and the single result line reports the issue as closed together with that resolving reference." | diff-local |
| Story 2 negative: Given the tracker rejects the audit comment, when the command runs, then it exits nonzero, issues no close call, leaves the ledger entry present, and prints a diagnostic naming the source ref and the failure. | 3 | "An injected comment failure leaves the entry readable in the ledger, records no close call, exits nonzero, and prints a diagnostic naming the source ref." | diff-local |
| Story 2 negative: Given the audit comment succeeds but the tracker rejects the close, when the command runs, then it exits nonzero, leaves the ledger entry present, and prints a diagnostic that names closing the issue by hand and rerunning the drop without the resolved-by flag as the recovery. | 3 | "An injected close failure leaves the entry readable in the ledger and its stderr text names both closing the issue by hand and rerunning the drop without the flag." | diff-local |
| Story 2 negative: Given no ledger entry exists for the source ref, when the resolved-by flag is supplied, then the command refuses with a nonzero exit and issues no tracker call at all. | 3 | "A source ref that is not a GitHub owner-repo-number reference, and an absent ledger entry, each exit nonzero with zero tracker calls and an unchanged ledger file." | diff-local |
| Story 3 happy: Given the operator asks for the forget verb's help, when it renders, then the text names the resolved-by flag, states that it comments the resolving reference on the originating issue and closes it, and states that no close happens without the flag. | 4 | "The rendered help topic for the verb contains the flag token, the words comment and close, and the statement that the flag gates the close." | diff-local |
| Story 3 happy: Given the operator asks for the compose guide, when it renders, then its forget line shows the optional resolved-by form alongside the existing positional source ref. | 4 | "The rendered guide line for the verb contains the optional resolved-by form, and an unknown flag passed to the verb still produces the existing named-flag rejection at exit 1 while the resolved-by flag parses." | diff-local |
| Story 3 happy: Given the composer loop reaches an idea it has determined is already fixed on the target, when the operator explicitly approves the drop, then the shipped composer instruction directs the gated drop with the resolving reference and ends the session without authoring a spec. | 4 | "The shipped composer skill carries a drop-as-fixed subsection naming the gated command form, the explicit-operator-approval precondition, the originating-issue precondition, and the instruction not to author a spec on that path." | diff-local |
| Story 3 negative: Given a flag outside the verb's allow-list is passed to forget, when the command parses, then it rejects that flag by name at exit 1 while the resolved-by flag itself parses successfully. | 1, 4 | "The rendered guide line for the verb contains the optional resolved-by form, and an unknown flag passed to the verb still produces the existing named-flag rejection at exit 1 while the resolved-by flag parses." | diff-local |
| Story 3 negative: Given the idea carries no originating issue, or the operator has not explicitly approved the drop, when the composer loop reaches the same fork, then its instruction forbids the auto-closing form and closes nothing. | 4 | "The shipped composer skill carries a drop-as-fixed subsection naming the gated command form, the explicit-operator-approval precondition, the originating-issue precondition, and the instruction not to author a spec on that path." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures; nothing here depends on a commit outside
this feature's diff. Task 1 owns pure unit coverage of the command parser. Task 2 owns the
integration proof at the CLI entry point: the real dispatch branch, the real ledger, and the real
tracker client running against a fake runner at the third-party boundary, which is the boundary this
change crosses and therefore the one integration this feature owes. Task 3 owns the failure and
refusal permutations at that same boundary using injected rejections. Task 4 owns the rendered help
and guide surfaces plus the shipped skill instruction. The existing dispatch tests supply the
unchanged no-flag behavior; no new aggregate, end-to-end, or external-service test is added, and no
terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 1 -> Task 4

Small tier: architecture, conflict-check, and coherence artifacts are skipped. No ADR is created or
amended: the change adds an optional flag inside an existing verb's established contract and
introduces no new seam, boundary, or decision that an existing approved decision record contradicts.
