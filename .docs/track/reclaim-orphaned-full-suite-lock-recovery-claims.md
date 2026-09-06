# Track: Reclaim orphaned full-suite lock recovery claims

Track: technical

Scope boundary: Small fix for #2171, approved by the operator on 2026-09-06 (delegated). Make an orphaned recovery claim inside the full-suite verification lock reclaimable so `ensure()` recovers without an operator deleting the lock directory, while a claim held by a live recoverer keeps excluding other acquirers. The sibling lease defect in the conduct state lease (#2170) and the lease contention refusal (#2172) are a different module and stay outside this slice; so do the lock's owner-liveness rules, the acquisition timeout budget, the timeout message wording, evidence freshness, and any change to the claim record schema.

This is an internal engine correctness fix with no product requirement; acceptance criteria live in technical stories rather than a PRD.

The operator-delegated decision on 2026-09-06 chose liveness-plus-age classification over adding a process-start identity token to the claim record. The lock's owner path already combines a liveness probe with an age fallback, so reusing that shape needs no record-format change and no migration for claims written by an older engine. A claim identity token was weighed and rejected for this slice: it would version the claim record for a window measured in milliseconds.

Scope check: A — consumer-facing engine behavior (`src/conductor/src/engine/full-suite-verifier.ts` ships to every project that runs full-suite verification; no repo-only signal fires, and the change adds no rule to the harness rule file); B — n/a (no new skill); C — provider-agnostic (filesystem and process probes only, no provider surface). No catalog registration is required. No event, metric, span, or report is added, so the event spine is untouched.

Verified foundation: `quarantineClaimedStaleLock` writes `recovery.json` with `flag: 'wx'` and maps `EEXIST` straight to `OCCUPIED`; nothing anywhere parses or liveness-checks an existing claim, and `FullSuiteLockRecoveryClaim` already records `pid`, `token`, and `claimedAt`. `recoverLockIfProvablyStale` reaches that function only after proving the owner dead or the unowned lock older than `unownedStaleMs`, and it already holds the injected `clock`, `processIsLive`, and `unownedStaleMs` it would need to pass down. The acquire loop treats `OCCUPIED` as a retry until `waitTimeoutMs`, whose default is 30 seconds, so one crashed recoverer wedges every later acquisition until the lock directory is removed by hand.
