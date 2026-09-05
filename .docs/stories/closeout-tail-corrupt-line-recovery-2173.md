**Status:** Accepted

# Stories: Closeout tail corruption recovery

Source-Ref: jstoup111/ai-conductor#2173

Acceptance is authorized by the operator's batch request for complete, unambiguous S specs; a new design ambiguity must return to DECIDE.

## Story 1: Tailing proceeds beyond a corrupt completed record

As an operator, I want one damaged record to leave later closeout events observable.

### Acceptance Criteria

#### Happy Path
- Given a ledger containing valid A, a newline-terminated invalid JSON line, and valid B, when it is polled repeatedly, then A and B arrive once in order and the bad line produces exactly one diagnostic during that tail instance's uninterrupted traversal.
- Given valid UTF-8 records before and after a malformed line, when more bytes are appended, then offset tracking consumes complete records once without replay or skipping valid later records.

#### Negative Paths
- Given an unfinished trailing record without a newline, when polling occurs, then it is neither consumed nor diagnosed; after a newline completes it, it is processed once, or skipped once if it remains invalid JSON.
- Given an absent ledger or empty lines, when polling occurs, then neither condition emits a corruption diagnostic. Actual file truncation retains the existing cursor-reset behavior.

### Done When
- [ ] A real temporary-ledger integration records emitted A/B and one corruption diagnostic over multiple polls.
- [ ] UTF-8, empty-line, absent-file, partial-line and actual-truncation cases have concrete lower-layer coverage.

## Story 2: Concurrent poll requests share one traversal

As a consumer, I want overlapping timer and explicit poll calls to deliver events once.

### Acceptance Criteria

#### Happy Path
- Given a read or event subscriber is still pending, when another poll is requested, then at most one read/emission traversal is active and both callers await its completion.
- Given the active traversal finishes and new complete data is appended, when the next poll runs, then only the new records are emitted.

#### Negative Paths
- Given polling takes longer than the one-second timer interval, when multiple timer ticks occur, then those ticks neither double-advance the cursor nor replay the ledger from zero.
- Given a poll fails, when the underlying read becomes available and polling resumes, then the in-flight state has been released and unread complete records can be delivered.

### Done When
- [ ] Deferred read/subscriber tests prove one active traversal, no duplicate delivery, and correct next-poll delivery.
- [ ] Fake-time ticks during the deferred traversal cannot introduce duplicate reads or emissions.

## Story 3: Background failures remain contained and observable

As an operator, I want a filesystem failure to be reported without an unhandled promise rejection or loss of the tail loop.

### Acceptance Criteria

#### Happy Path
- Given a background read fails for a reason other than missing-file, when the tick completes, then a poll-failure diagnostic reaches the existing event bus and no rejected promise escapes the background callback.
- Given a malformed complete line, when it is skipped, then the diagnostic identifies the relative ledger path and byte position, and is persisted and rendered through existing event consumers.

#### Negative Paths
- Given the read fails transiently, when the next tick succeeds, then unread complete events are delivered and the failed read has not advanced the cursor.
- Given a diagnostic subscriber throws or rejects, when background polling runs, then subscriber failure cannot create an unhandled rejection or poison later polls.
- Given start is called repeatedly, or stop is called, when fake time advances, then only one timer exists while started and no new background polls begin after stop. Stop keeps its existing synchronous contract; an already running poll remains owned by its caught promise.

### Done When
- [ ] Tests drive background failures and recovery using fake timers and injected/deferred I/O without real waits.
- [ ] The typed diagnostic is persisted once per malformed completed record and rendered with its location, without echoing corrupt record contents.
- [ ] Diagnostic subscriber failure is contained; no unhandled rejection is observed.

Negative-category review: invalid JSON, read permission/dependency failures, overlapping access, and partial appends are covered. No remote service, authorization model, deletion cascade, rollback transaction, or new resource allocation boundary is introduced. File replacement races and whole-file memory growth remain existing behavior outside this bounded fix.

Status: Accepted
