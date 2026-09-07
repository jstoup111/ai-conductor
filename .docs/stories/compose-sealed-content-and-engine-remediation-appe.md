**Status:** Accepted

# Stories: Compose sealed content and engine remediation appends in seal rotation (#2120)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the protected-artifact rotation evaluator, the in-repository inputs it reads, and the wording and telemetry of a rotation refusal. The reseal command, its terminal gate, the remediation append renderer, and halt retention across base advances remain outside this slice.

## Story 1: Vouch for an engine remediation append against the sealed baseline

As the engine, I want my own recorded remediation-task append accepted even after an operator resealed the same artifact, so that a feature taking the sanctioned remediation path does not halt for work no human authored.

### Acceptance Criteria

#### Happy Path

- Given a sealed artifact whose content at the seal's baseline commit matches the seal's recorded fingerprint for that path, and a committed HEAD that extends exactly that content with only the engine's recorded remediation-task blocks, when seal rotation is evaluated, then the path is accepted as an engine append and rotation is permitted.
- Given a sealed artifact whose base-branch-tip content is still a byte prefix of the committed HEAD content, when seal rotation is evaluated, then the engine append is accepted exactly as it is accepted today.

#### Negative Paths

- Given the content at the seal's baseline commit does not match the seal's recorded fingerprint for that path, when seal rotation is evaluated, then that anchor is discarded and the verdict is the one the base-tip anchor alone produces.
- Given the seal's baseline commit cannot be read in the repository, when seal rotation is evaluated there, then no sealed-baseline anchor is supplied and the verdict is the one the base-tip anchor alone produces.

### Done When

- [ ] An evaluator fixture with a resealed-then-appended artifact returns a permitted verdict listing that path as an engine-appended inclusion.
- [ ] An evaluator fixture whose seal fingerprint disagrees with the baseline-commit content returns the same refusal it returns with no sealed anchor at all.
- [ ] A real-local-Git repository fixture drives the in-repository evaluator to a permitted verdict for the resealed-then-appended artifact and to today's refusal when the baseline commit is unreadable.

## Story 2: Keep feature-authored amendments refused

As the operator, I want a human edit to a sealed DECIDE artifact to keep halting the feature, so that widening the engine-append exception does not open a bypass.

### Acceptance Criteria

#### Happy Path

- Given a committed HEAD whose divergence from every admissible anchor includes content the engine never recorded, when seal rotation is evaluated, then rotation refuses and the feature halts as it does today.

#### Negative Paths

- Given one commit that carries both recorded remediation-task blocks and an in-place edit to content preceding them, when seal rotation is evaluated, then rotation refuses.
- Given an appended suffix carrying a task heading whose id the engine never recorded, or any other markdown heading, when seal rotation is evaluated, then rotation refuses.

### Done When

- [ ] An evaluator fixture mixing a recorded append with an edit to earlier content in the same committed content returns a refusal naming that path.
- [ ] An evaluator fixture whose suffix carries an unrecorded task heading, and one whose suffix carries a non-task heading, each return a refusal naming that path.
- [ ] No fixture in which the engine recorded no appended task ids reaches a permitted verdict for an authored path.

## Story 3: Say which authorship exit refused and why

As the operator, I want a protected-artifact halt to distinguish a human edit from an engine append that could not be vouched for, so that I am never told to revert content the engine itself wrote.

### Acceptance Criteria

#### Happy Path

- Given a rotation refusal on a path whose committed content carries a heading for at least one recorded appended remediation-task id, when the seal verdict text is produced, then it reports an unvouched engine append and does not instruct the operator to revert the committed DECIDE content.
- Given any rotation refusal naming a path, when the refusal event is emitted, then it carries the outcome of the operator-reseal exit and the outcome of the engine-append exit for that path.

#### Negative Paths

- Given a rotation refusal on a path whose committed content carries no recorded appended remediation-task heading, when the seal verdict text is produced, then it is the feature-authored wording in force today, unchanged.

### Done When

- [ ] A refusal on a path carrying a recorded appended-task heading yields verdict text naming an unvouched engine append and omitting the revert instruction.
- [ ] A refusal on a path carrying no recorded appended-task heading yields verdict text byte-identical to today's feature-authored reason.
- [ ] Every emitted rotation-refusal event for a named path carries both exit outcomes, and the existing condition and verdict-condition strings are unchanged for paths with no recorded append.

## Negative-category review

Invalid input is covered by unrecorded task ids, foreign headings, and mixed same-commit edits. Data integrity is covered by refusing the sealed-baseline anchor whenever its content disagrees with the seal's recorded fingerprint. Dependency unavailability is covered by an unreadable seal baseline commit degrading to today's decision rather than widening it. Partial failure is covered by the existing best-effort telemetry path, which already swallows observer errors and must not alter a verdict. Auth, concurrency, resource exhaustion, cascade deletion, and idempotency categories are inapplicable: this evaluator is a pure synchronous decision over buffers supplied by read-only Git reads, performs no writes, and introduces no queue, datastore, or transaction.
