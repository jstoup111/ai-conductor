# ADR: Immutable, owner-bound state-lease recovery succession

**Date:** 2026-09-11
**Status:** APPROVED
**Deciders:** Operator approval in composer on 2026-09-11

## Context

Source: jstoup111/ai-conductor#2170. A crash after claiming recovery but before quarantining a dead owner's lease leaves recovery blocked. Existing acquisition treats an existing claim as occupied without checking its process, then can report the already-dead owner as live. The confirmed scope includes malformed claims, uncertain liveness, and replacement/concurrent recovery races, excluding the separate full-suite lock.

The approved conduct-state mutation-port and intake-ledger durability ADRs require bounded exclusive ownership and conservative refusal. They do not specify recoverable recovery-claim succession. This ADR fills that durable state-transition gap without superseding their store boundaries.

## Options Considered

### Option A: Immutable, owner-bound successor claims

- Pros: exclusive creation elects one successor; stale contenders cannot delete a replacement; preserves the filesystem lease and existing callers.
- Cons: requires owner/predecessor validation, legacy compatibility, bounded traversal, and more involved interleaving tests.

### Option B: Check and remove a dead claim in place

- Pros: fewer changes to claim layout.
- Cons: separate reads and deletion permit a delayed contender to remove another contender's replacement; another read does not make deletion conditional. Rejected for failing exclusive-ownership requirements.

### Option C: Replace the lease with process-lifetime locking

- Pros: could remove orphaned recovery claims by changing the underlying locking mechanism.
- Cons: needs platform/dependency investigation and broader migration. The operator selected repair of the existing protocol instead.

## Decision

1. **Immutable claim succession.** Keep a claim after proving its process dead. Elect its successor by exclusively creating one deterministic successor slot derived from the protected owner's token and predecessor claim identity. A competing EEXIST reader follows the existing successor instead of deleting it. If that successor also died, repeat on its distinct next slot. Never create a second reusable recovery mutex whose own stale lock needs another mutex to clear.
2. **Owner generation binding.** New claim records identify the lease owner token they concern, their own unique token, and their predecessor identity. Derive filesystem-safe slot names deterministically from these identities. Validate those fields on read. A delayed contender may never use a claim for a prior owner to move or release the current owner's directory.
3. **Legacy root compatibility.** Continue to arbitrate an initially absent root at `recovery.json` through exclusive creation. New root records retain the existing version/pid/token/claimedAt fields and add owner binding. An existing valid legacy root without owner binding is conservatively treated as belonging to the current owner: a live or unverifiable legacy claimant blocks, a provably dead one permits the first owner-bound successor. A root explicitly bound to a different owner is retained but confers no authority over the new owner; new clients elect through a deterministic root slot bound to that new owner. Old clients continue to see the canonical root and conservatively refuse recovery. Never clear legacy or foreign-generation roots in place.
4. **Exclusive winner.** Follow the current owner's chain. A live or not-provably-dead claimant stops recovery. Only the process that successfully creates the eligible terminal claim may quarantine the directory, after revalidating owner and claim identity. Other processes cannot supersede that terminal claimant while it is live. A contender that discovers an owner change or loss of authority abandons its stale attempt and retries acquisition within its original budget; it never deletes, overwrites, or quarantines the replacement generation. After quarantine, recheck the same owner/claim identity before deleting only the quarantined directory.
5. **Conservative ambiguity.** Parse and validate each encountered legacy/new claim. Malformed, incomplete, unsupported, owner/predecessor-inconsistent, unreadable, or cyclic claim state fails closed with a specific diagnostic. Neither file age nor elapsed wait is proof of death. A disappearing file/directory or owner generation is a retryable race when no unsafe mutation occurred. Every traversal and retry shares the original acquisition budget so chains and repeated replacement cannot restart or evade it.
6. **Release and diagnostics.** Release checks only recovery authority applicable to its own owner generation, while treating an unbound legacy root conservatively. A valid root explicitly bound to another generation must not permanently block the new owner's release. Release retains the existing exact-owner check. Distinguish a blocking owner, blocking recovery claimant, malformed claim, unverifiable probe, and changed generation. Never label a pid already proved dead as live, and never reuse a previous iteration's blocker after observing a different state. Preserve caller labels and public result kinds where possible.


## Consequences

### Positive

- Dead legacy claims and subsequent dead recoverers can be recovered without manual directory deletion.
- Live or ambiguous claimants retain protection, and old ownership cannot authorize mutation of replacement ownership.
- Existing store APIs remain stable, with more accurate acquisition/refusal messages.

### Negative

- Malformed and unverifiable claims still require investigation; age never authorizes stealing.
- Interrupted recovery can grow a chain until the old directory is quarantined and cleaned up. The original acquisition budget bounds traversal.
- Process-id reuse remains conservative and can delay recovery. No process-incarnation or multi-host liveness mechanism is added.
- Old clients observing a canonical claim conservatively refuse recovery; the new protocol does not require them to understand successor records.

### Follow-up Actions

- Implement the six decisions through the existing acquire/release entry points.
- Prove two-contender, replacement-generation, interrupted recovery, and persistence-boundary behavior with deterministic tests and faithful filesystem fixtures.
- Document recovery/refusal behavior in the existing operator documentation as part of the owning implementation work.

## Verify-claims ledger

Verified from `src/conductor/src/engine/conduct-state-lease.ts`: EEXIST handling, exclusive claim creation, quarantine cleanup, result types, injectable liveness/time/filesystem seams, and exact owner checks. Verified governing ADRs: `adr-2026-08-01-conduct-state-mutation-port` and `adr-2026-08-12-fail-closed-intake-ledger-durability`.

The safety argument assumes the existing single-host model, fresh owner/claim tokens, truthful dead-process detection, and terminating individual filesystem calls. These are the retained model, not guarantees of multi-host safety, pid-incarnation detection, or OS-call cancellation. The operator approved these stated limits with the complete architecture proposal on 2026-09-11. Runtime concurrency proof remains BUILD work.

Verdict: CLEAR.
