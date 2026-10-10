**Status:** Accepted

# Stories: compose forget --resolved-by on unassigned issues

Source: jstoup111/ai-conductor#2786. Track: technical (no PRD). Tier: S.

`compose forget <owner/repo#N> --resolved-by <reference>` is the composer's §3a path for dropping an
already-fixed intake idea: it comments the resolving reference on the issue, closes it, then drops the ledger
entry and strips the `engineer:handled` label. Every one of those writes passes the guarded intake
authorization, which allows it when the machine owner is the issue's sole assignee and otherwise requires an
exact, interactive operator approval. `forget` never supplies that approval route today, so it always fails on
unassigned issues — most intake issues. These stories give `forget` the same interactive approval prompt the
`github-operation` command already uses, keep non-interactive callers refused with an actionable reason, let
`--resolved-by` work on an issue with no ledger entry, and make the help and composer instructions match.

Approved by the operator on 2026-10-09 (delegated; approval route operator-settled: interactive TTY
confirmation, non-TTY stays refused).

## Story 1: An operator at an interactive terminal approves the resolved-by drop of an unassigned issue

**Requirement:** #2786 desired outcomes 1, 3

As an operator dropping an already-fixed intake idea whose issue has no assignee, I want to approve the
comment and close at my terminal, so that the composer primitive finishes the drop without a manual `gh` step.

### Acceptance Criteria

#### Happy Path

- Given a recorded github-issues ledger entry for `o/a#1` whose issue has no assignees, and stdin and stdout attached to a terminal, when the operator runs `compose forget o/a#1 --resolved-by o/a#2` and answers `y` at every approval prompt, then the issue receives a comment naming `o/a#2`, the issue is closed, the ledger entry is removed, the label removal is sent, and the result line reports `closed: true` with `resolvedBy: "o/a#2"` at exit 0.
- Given that same unassigned issue at an interactive terminal, when `forget --resolved-by` runs, then before each of the comment, close, and label-removal writes is sent the operator is shown one `Authorize <operation> on <target>? [y/N]` prompt naming that write's operation and issue `o/a#1`, so three prompts are shown in that order.
- Given an issue whose sole assignee is the machine owner, when `compose forget o/a#1 --resolved-by o/a#2` runs, then the comment, close, and label removal are sent with no approval prompt shown, exactly as before this change.

#### Negative Paths

- Given an unassigned issue at an interactive terminal, when the operator answers anything other than `y` or `yes` at the comment prompt, then no comment and no close are sent, the ledger entry remains, the command exits nonzero, and stderr names the source ref and states that the operator declined the approval.
- Given an unassigned issue at an interactive terminal, when the operator approves the comment but declines the close, then the comment is sent, no close is sent, the ledger entry remains, the command exits nonzero, and stderr states that the approval was declined and names closing the issue by hand and rerunning without `--resolved-by` as the recovery.
- Given an unassigned issue and stdin or stdout not attached to a terminal (an agent shell), when `compose forget o/a#1 --resolved-by o/a#2` runs, then no approval prompt is shown, no comment and no close are sent, the ledger entry remains, the command exits nonzero, and stderr states that the machine owner is not confirmed as the issue's sole assignee and that approval requires rerunning the same command from an interactive terminal.

### Done When
- [ ] A `dispatchEngineer` fixture with an unassigned issue and an injected confirmer that answers `true` observes the comment, close, and label-removal calls, three confirmer invocations naming `intake.issue.comment.create`, `intake.issue.close`, and `intake.issue.label.remove` for issue 1, a removed ledger entry, and `closed: true`.
- [ ] A fixture whose confirmer declines the comment observes zero comment and close calls, a retained ledger entry, exit nonzero, and stderr containing `declined`.
- [ ] A fixture with no attached terminal observes zero comment and close calls, a retained ledger entry, exit nonzero, and stderr naming `sole assignee` and `interactive terminal`.
- [ ] The existing sole-assignee `forget --resolved-by` fixture passes with zero confirmer invocations.

## Story 2: Plain forget strips the label of an unassigned issue with approval and explains a refused strip

**Requirement:** #2786 desired outcomes 2, 3

As an operator, I want the label strip in a plain `forget` to use the same approval route and to say why it
failed when it cannot, so that I am not left with a bare `explicit-authorization-required`.

### Acceptance Criteria

#### Happy Path

- Given a recorded ledger entry for an unassigned issue `o/a#1` and an interactive terminal, when the operator runs `compose forget o/a#1` and approves the prompt, then the ledger entry is removed, the label removal is sent, and the result line reports `closed: false` at exit 0.

#### Negative Paths

- Given a recorded ledger entry for an unassigned issue and no attached terminal, when `compose forget o/a#1` runs, then the ledger entry is still removed, no label removal is sent, the command exits 0, and the stderr label-strip message states that the machine owner is not confirmed as the issue's sole assignee and that approval requires an interactive terminal.

### Done When
- [ ] A plain-forget fixture with an approving confirmer on an unassigned issue observes the label-removal call, a removed ledger entry, and exit 0.
- [ ] A plain-forget fixture with no attached terminal observes no label-removal call, a removed ledger entry, exit 0, and stderr naming `sole assignee` and `interactive terminal`.

## Story 3: --resolved-by records the resolution on an issue with no ledger entry

**Requirement:** #2786 operator follow-up (no-ledger-entry refusal)

As an operator closing an already-fixed issue that the composer never claimed, I want `--resolved-by` to
comment and close it through the same guarded path, so that I do not fall back to a raw `gh issue close`.

### Acceptance Criteria

#### Happy Path

- Given no ledger entry for `o/a#9` and a write the guard authorizes (sole assignee, or an approving interactive operator), when `compose forget o/a#9 --resolved-by o/a#2` runs, then the issue receives a comment naming `o/a#2` and is then closed, no label removal is attempted, the ledger file is byte-identical to before, and the result line reports `found: false`, `closed: true`, and `resolvedBy: "o/a#2"` at exit 0.

#### Negative Paths

- Given no ledger entry for an unassigned `o/a#9` and no attached terminal, when `compose forget o/a#9 --resolved-by o/a#2` runs, then no comment and no close are sent, the ledger file is byte-identical, the command exits nonzero, and stderr states the sole-assignee and interactive-terminal reason.
- Given no ledger entry and a source ref that is not an `owner/repo#N` GitHub reference, when the resolved-by flag is supplied, then the command refuses with a nonzero exit and issues no tracker call.
- Given no ledger entry and no resolved-by flag, when `compose forget o/z#9` runs, then it reports `found: false` at exit 0 and issues no tracker call.

### Done When
- [ ] An absent-entry fixture with the flag on a sole-assigned issue observes the comment then the close, no label-removal call, an unchanged ledger file, and a result line with `found: false` and `closed: true`.
- [ ] An absent-entry fixture with the flag on an unassigned issue and no attached terminal observes zero comment and close calls, an unchanged ledger file, and exit nonzero.
- [ ] The absent-entry non-GitHub-ref fixture and the absent-entry no-flag fixture each observe zero tracker calls.

## Story 4: Help and the composer drop path describe what the primitive can actually do

**Requirement:** #2786 desired outcome 4

As an operator or composer agent, I want the `forget` help and composer §3a to state the approval route, so
that an agent hands me the command to run instead of retrying a write it cannot authorize.

### Acceptance Criteria

#### Happy Path

- Given the operator asks for the `forget` help topic, when it renders, then it states that a write on an issue the machine owner is not the sole assignee of asks for interactive approval at the terminal, that a non-interactive invocation is refused, and that `--resolved-by` also works when the issue has no ledger entry.
- Given the composer reaches an already-fixed intake idea with an originating GitHub issue and explicit operator approval, when it follows §3a, then the shipped skill directs the `--resolved-by` drop and, when that drop is refused for lack of an interactive terminal, directs the agent to give the operator the exact command to run in their own interactive terminal and not to retry or close the issue another way.

#### Negative Paths

- Given the forget help topic renders, when its text is read, then it names no flag other than `--resolved-by` and offers no override or bypass of the approval.
- Given the idea has no originating GitHub issue, or the operator has not explicitly approved the drop, when the composer reaches §3a, then the skill still forbids the `--resolved-by` form and closes nothing.

### Done When
- [ ] The rendered `forget` help contains `interactive`, states that non-interactive callers are refused, and states that a missing ledger entry does not block `--resolved-by`; it contains no `--` flag token other than `--resolved-by`.
- [ ] `skills/composer/SKILL.md` §3a names the interactive-terminal approval, the hand-the-command-to-the-operator instruction on a no-terminal refusal, and retains both preconditions (originating GitHub issue, explicit operator approval).

## Negative-category review

Authorization is the core: every write keeps the existing guard; an agent shell (no terminal) is refused
(Story 1, 2, 3 negatives), a declined prompt is refused (Story 1), and no bypass flag exists (Story 4). Partial
failure is covered by comment-approved/close-declined (Story 1) and the best-effort label strip (Story 2), with
the ledger dropped only after both resolution writes succeed. Data integrity: the absent-entry path leaves the
ledger byte-identical (Story 3). Invalid input: non-GitHub refs and blank flags keep their existing refusals
(Story 3; parse guards unchanged). Dependency unavailability: a failed assignee read is treated by the guard as
not-sole-assignee and falls to the same approval route, so it needs no new scenario. Concurrency, resource
exhaustion, cascade deletion, and idempotency keys are inapplicable: a single-shot operator command over one
ref with no new state.
