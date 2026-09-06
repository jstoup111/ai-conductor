**Status:** Accepted

# Stories: Close already-fixed intake issues from compose forget (#830)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is one optional operator-approval flag on
the existing terminal `compose forget` verb, its comment-then-close write-back, its fail-closed
behavior, and the help, guide, and composer-loop text that make the gated disposition reachable.
Automatic detection of "already fixed", a new verb, and the spec-authored write-back path remain
outside this slice.

## Story 1: Close the originating issue when a claimed idea is dropped as already fixed

**As** an operator dropping a claimed intake idea that the target already fixed, **I want** the drop
to close its originating issue with an auditable comment, **so that** no manual GitHub step is left
behind.

### Acceptance Criteria

#### Happy Path

- Given a recorded github-issues ledger entry for an `owner/repo#N` source ref, when the operator drops it with the resolved-by flag naming the resolving reference, then the originating issue receives a comment naming that reference and is then closed, and the ledger entry and its intake label are removed.
- Given that same drop, when it completes, then its single result line reports the ref as no longer known to the ledger and reports the issue as closed together with the resolving reference the operator supplied.

#### Negative Paths

- Given a recorded ledger entry, when the operator drops it without the resolved-by flag, then no comment is posted and no issue is closed, the result line reports the issue as not closed, and the entry and label removal behave exactly as they do today at exit code 0.
- Given the resolved-by flag is supplied for a source ref that is not an `owner/repo#N` GitHub reference, when the command runs, then it refuses with a nonzero exit, posts no comment, closes no issue, and leaves the ledger entry present.
- Given the resolved-by flag is supplied with no value or with a blank value, when the command parses, then it prints the verb guide without dropping the entry or issuing any tracker call.

### Done When
- [ ] A dispatch fixture with an injected tracker runner observes an issue-comment call carrying the operator-supplied resolving reference, followed by an issue-close call for the same repo and issue number.
- [ ] A no-flag dispatch fixture observes only the existing label-strip call, reports the issue as not closed, and exits 0.
- [ ] A non-GitHub source ref supplied with the flag issues zero tracker calls, exits nonzero, and leaves the entry readable in the ledger.

## Story 2: Keep the ledger and the issue in agreement when the close cannot happen

**As** an operator, **I want** a failed close to stop the drop rather than silently proceed, **so
that** the ledger never reads resolved while the issue stays open.

### Acceptance Criteria

#### Happy Path

- Given the comment and the close both succeed, when the command finishes, then the ledger no longer knows the source ref and the issue is closed, so both states agree.

#### Negative Paths

- Given the tracker rejects the audit comment, when the command runs, then it exits nonzero, issues no close call, leaves the ledger entry present, and prints a diagnostic naming the source ref and the failure.
- Given the audit comment succeeds but the tracker rejects the close, when the command runs, then it exits nonzero, leaves the ledger entry present, and prints a diagnostic that names closing the issue by hand and rerunning the drop without the resolved-by flag as the recovery.
- Given no ledger entry exists for the source ref, when the resolved-by flag is supplied, then the command refuses with a nonzero exit and issues no tracker call at all.

### Done When
- [ ] An injected comment failure leaves the entry readable in the ledger, records no close call, and exits nonzero.
- [ ] An injected close failure leaves the entry readable in the ledger and its stderr text names both closing the issue by hand and rerunning the drop without the flag.
- [ ] An absent-entry fixture supplied with the flag exits nonzero with zero tracker calls and an unchanged ledger file.

## Story 3: Make the gated disposition reachable from the CLI and the composer loop

**As** an operator driving the loop from a phone, **I want** the drop-as-fixed disposition described
where I already look, **so that** I do not fall back to closing issues by hand.

### Acceptance Criteria

#### Happy Path

- Given the operator asks for the forget verb's help, when it renders, then the text names the resolved-by flag, states that it comments the resolving reference on the originating issue and closes it, and states that no close happens without the flag.
- Given the operator asks for the compose guide, when it renders, then its forget line shows the optional resolved-by form alongside the existing positional source ref.
- Given the composer loop reaches an idea it has determined is already fixed on the target, when the operator explicitly approves the drop, then the shipped composer instruction directs the gated drop with the resolving reference and ends the session without authoring a spec.

#### Negative Paths

- Given a flag outside the verb's allow-list is passed to forget, when the command parses, then it rejects that flag by name at exit 1 while the resolved-by flag itself parses successfully.
- Given the idea carries no originating issue, or the operator has not explicitly approved the drop, when the composer loop reaches the same fork, then its instruction forbids the auto-closing form and closes nothing.

### Done When
- [ ] The rendered help topic for the verb contains the flag token, the words comment and close, and the statement that the flag gates the close.
- [ ] The rendered guide line for the verb contains the optional resolved-by form, and an unknown flag passed to the verb still produces the existing named-flag rejection at exit 1 while the resolved-by flag parses.
- [ ] The shipped composer skill carries a drop-as-fixed subsection naming the gated command form, the explicit-operator-approval precondition, the originating-issue precondition, and the instruction not to author a spec on that path.

## Negative-category review

Invalid input is covered by the non-GitHub source ref, the valueless flag, and the unknown-flag
rejection. Dependency unavailability and partial failure are covered by the injected comment failure
and the injected close failure, which together pin the ordering: nothing is dropped until the
tracker has accepted both writes, and a half-completed write-back names its own recovery. Data
integrity is covered by the agreement criterion — the ledger drop is the last act, so a failed close
can never leave the ledger claiming a resolution the tracker does not show. Authorization is covered
by the flag itself: the close is impossible without the operator-supplied resolved-by value, and the
absent-entry refusal prevents closing an issue the harness holds no claim record for. Concurrency,
resource exhaustion, and cascade deletion are inapplicable: the verb is a single-shot operator
command over one ref, it deletes one ledger entry with no dependents, and it adds no queue,
datastore, upload, or transaction. Idempotency is bounded rather than solved: a rerun after a failed
close is directed to the no-flag form precisely so the audit comment is never duplicated.
