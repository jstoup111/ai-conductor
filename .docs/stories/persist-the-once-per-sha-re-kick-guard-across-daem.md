**Status:** Accepted

# Stories: Durable once-per-SHA re-kick guard (#286)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the durability of the sweep's per-feature last-rekick SHA and the daemon wiring that reads and writes it. Halt classification, park semantics, shipped dedup, sentinel lifecycle, and marker pruning remain outside this slice.

## Story 1: The once-per-SHA bound survives a daemon restart

### Acceptance Criteria

#### Happy Path

- Given a halted feature was re-kicked at base SHA X and the daemon then restarts with an empty in-memory guard, when a sweep runs again at X, then that feature is skipped and its halt marker, rebase state, and sentinel are left untouched.
- Given the durable record for a feature reads SHA X, when a sweep runs at a genuinely advanced SHA Y, then that feature is re-kicked and its durable record afterwards reads Y.
- Given a halted feature has no durable record at all, when a sweep runs, then it is re-kicked exactly as it is today.

#### Negative Paths

- Given the durable store is missing, unreadable, or holds a malformed body for a slug, when the daemon hydrates the guard at startup, then that slug is treated as never re-kicked and the sweep proceeds rather than failing.

### Done When

- [ ] A real-filesystem fixture proves a second sweep at the same SHA with a freshly hydrated guard skips a feature the first sweep cleared.
- [ ] The same fixture proves an advanced SHA still clears the feature and rewrites its record.
- [ ] Absent-directory, unreadable-entry, and malformed-body fixtures hydrate to no entry for that slug without throwing.

## Story 2: The durable record is written only for a re-kick that actually happened

### Acceptance Criteria

#### Happy Path

- Given a sweep clears a feature's halt marker successfully, when it records the triggering SHA, then the durable write happens after the clear and the recorded value is that sweep's SHA.

#### Negative Paths

- Given a feature's rebase abort or marker clear fails, when the sweep moves on, then no durable record is written for that feature and it stays eligible for the next sweep.
- Given the durable write itself fails, when the sweep continues, then the failure is logged as an anomaly, the in-run guard still holds the SHA, and no other feature in the sweep is affected.
- Given a sweep is constructed without the durable recording dependency, when it runs, then its observable behavior is unchanged from today.

### Done When

- [ ] A sweep fixture observes the recording call only on the cleared path and asserts its ordering after the clear.
- [ ] Failed-abort and failed-clear fixtures assert the recording call is never made for that slug.
- [ ] A throwing recorder leaves the sweep result and the remaining slugs unchanged and emits an anomaly log line.
- [ ] A sweep fixture with the dependency omitted produces the same cleared and skipped sets as the existing suite.

## Negative-category review

Input integrity is covered by the malformed-body and unreadable-entry hydration cases. Filesystem and permission failures are covered by the throwing-recorder and unreadable-store cases, both of which fail open toward the current behaviour rather than inventing a skip. Idempotency is covered by the repeated-sweep-at-the-same-SHA case; ordering is covered by the record-after-clear assertion. Backward compatibility is covered by the omitted-dependency case and by the no-record case that stands in for an upgrade from a version without the store. No deletion, queue, datastore, upload, transaction, network, or authentication surface is introduced, so those categories are inapplicable. Existing park, shipped-dedup, and halt-classification coverage remains authoritative for the guards that precede this one in the sweep.
