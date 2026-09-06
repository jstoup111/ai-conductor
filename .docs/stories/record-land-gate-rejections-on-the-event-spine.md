**Status:** Accepted

# Stories: Record land-gate rejections on the event spine (#1628)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the spec-landing command's rejection path: a stable gate identifier per rejection, one new persisted event carrying that identifier and the reason, and emission onto the target repository's existing event ledger. Backfill of historical rejections, precision reporting, and gate-strictness changes remain outside this slice.

## Story 1: Record every land rejection as a spine event naming its gate

### Acceptance Criteria

#### Happy Path

- Given a land invocation is rejected because its stories artifact is not approved, when the command reports the failure, then the target repository's persisted event ledger gains one land-gate-rejection event whose gate identifier names the stories-approval gate and whose reason carries the rejection message.
- Given a land invocation is rejected by the coherence gate, when the command reports the failure, then the recorded event's gate identifier names the coherence gate and its reason carries the coherence validator's own message.
- Given several land invocations against one repository are rejected by different gates, when the persisted ledger is replayed, then each rejection appears as its own event and the per-gate counts and reasons are derivable from those events alone.

#### Negative Paths

- Given a land invocation that passes every gate and commits, when the command returns success, then no land-gate-rejection event is recorded.

### Done When

- [ ] Every rejection site in the landing primitive raises an error carrying one gate identifier drawn from a closed enumeration, and the coherence gate's own rejections surface under the coherence identifier.
- [ ] An end-to-end command test drives a rejected land and reads the emitted event back from the target repository's persisted ledger, asserting gate identifier and reason.
- [ ] A successful end-to-end land in the same test file leaves no land-gate-rejection event in that ledger.

## Story 2: Never let recording degrade the rejection the operator sees

### Acceptance Criteria

#### Happy Path

- Given a rejection message longer than the recorded-reason cap, when the event is built, then the recorded reason is truncated to the cap and marked as truncated, while the message printed to the operator remains complete.

#### Negative Paths

- Given a land failure that no gate identifier classifies, when the event is built, then it is recorded under the unclassified gate identifier rather than dropped.
- Given the persisted event ledger cannot be written, when a land invocation is rejected, then the command still prints the original rejection message and the retained worktree path and still exits nonzero.

### Done When

- [ ] Classifier unit cases cover a gate-identified error, a missing-target-path error, an unrecognised error, and an over-cap reason.
- [ ] The truncation cap keeps a serialized rejection record small enough for a single atomic append, and the truncated marker is asserted.
- [ ] A command test with an unwritable ledger location asserts the unchanged stderr text and the unchanged nonzero exit code.

## Negative-category review

Input integrity is covered by the unclassified-error case, which proves an unexpected failure shape is recorded rather than silently lost. Permission and filesystem failures are covered by the unwritable-ledger case, which also proves the recording path cannot mask the operator-facing diagnosis or change the exit code. Concurrency is addressed by the reason cap: several landing processes append to one ledger, so each record is bounded to stay within a single atomic append rather than interleaving into an unparseable line. Idempotency is covered by the successful-land case, which records nothing. No deletion, queue, datastore, upload, network call, or transaction is introduced, so those categories are inapplicable; gate acceptance behaviour is unchanged, so existing landing-gate coverage remains authoritative for what is rejected in the first place.
