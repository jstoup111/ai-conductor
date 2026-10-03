**Status:** Accepted

# Stories: Interrupted intake claim never strands pending entries

**Source:** jstoup111/ai-conductor#2733 (technical track — criteria derived from the issue's desired
outcomes, `.docs/track/interrupted-intake-claim-still-strands-high-priori.md` (minimal scope), and
`adr-011-async-intake-queue-and-github-source` decision 6 as amended 2026-10-02)

Terms: a **strand** is an inbox envelope in the claimed (`.claimed`) state whose intake ledger
entry is `pending`. Out of scope: `compose unclaim` / `compose requeue --stale` behavior, a
`brain status` count, and claimed envelopes whose ledger entry is `done` or absent.

## Story 1: The next claim recovers every strand left by an interrupted claim

As an operator, I want any pending intake entry stranded by a killed, crashed or interrupted
`compose claim` to be claimable again at the next claim so that priority ordering is never silently
defeated by entries the queue can no longer see.

### Acceptance Criteria

#### Happy Path
- Given a prior claim process was killed after draining the inbox so that every pending envelope is left claimed while its ledger entry stays `pending`, when the operator runs `compose claim`, then every one of those envelopes is returned to the claimable state before the walk and the walk considers them as candidates
- Given strands from that killed claim include a `priority: critical` entry and the claimable inbox holds only a `priority: low` entry, when the operator runs `compose claim`, then the critical entry is the one claimed
- Given strands that already existed before this change shipped (no claim lease was ever written for them), when the operator runs the first `compose claim` after upgrading, then those strands are recovered the same way without any manual file rename
- Given the prior claim process died while holding the claim lease, when the next `compose claim` starts, then it recovers the dead owner's lease and proceeds without operator action
- Given strands were recovered, when the claim completes, then stderr carries one line stating how many strands were released back to the inbox

#### Negative Paths
- Given a strand whose envelope has a same-named claimable copy already present in the inbox, when the claim recovers strands, then exactly one claimable envelope remains for that entry and the claim never hands the entry out twice
- Given the inbox holds no strands, when the operator runs `compose claim`, then no file in the inbox is renamed before the walk and no recovery line is printed
- Given recovering one strand fails with a filesystem error other than the file having already vanished, when the claim runs, then the claim exits non-zero naming the failing envelope and performs no walk, leaving every other envelope in a state the next claim can recover
- Given a strand's envelope disappears between listing and recovery, when the claim runs, then that envelope is skipped as already handled and recovery of the rest continues

### Done When
- [ ] A test seeds an inbox where pending-ledger envelopes are claimed (simulating a killed drain) and asserts one `compose claim` run returns them to the claimable state and claims the highest-band unblocked entry
- [ ] A test seeds a stale claim lease owned by a non-live pid plus strands and asserts the claim recovers the lease and the strands
- [ ] Recovery leaves each recovered entry's ledger status `pending` with its attempt count unchanged

## Story 2: Overlapping claims never walk the same envelopes

As an operator running more than one session, I want overlapping `compose claim` invocations to be
serialized so that recovery never steals envelopes a live claim is still walking and no intake entry
is ever handed to two sessions.

### Acceptance Criteria

#### Happy Path
- Given claim A is mid-walk holding the claim lease and the drained envelopes, when claim B starts, then claim B waits for the lease and does not recover, rename or walk any envelope while A holds it
- Given claim A finishes and releases the lease within claim B's wait bound, when claim B acquires the lease, then B finds no strands from A and claims a different entry than A
- Given a claim finishes by claiming an entry, returning `empty`, or returning `all-blocked`, when it returns, then the claim lease has been released

#### Negative Paths
- Given claim A holds the claim lease longer than claim B's wait bound (for example a hung process), when claim B's wait expires, then claim B exits non-zero with a message stating a claim is in progress and naming A's pid, and makes no change to the inbox or ledger
- Given the claim walk throws an unexpected error after acquiring the lease, when the process exits, then the claim lease is released and every held envelope is released back to the inbox
- Given the claim lease cannot be acquired because its owner metadata is invalid or ambiguous, when the operator runs `compose claim`, then the claim fails closed with a non-zero exit naming the lease problem and never walks without the lease

### Done When
- [ ] A test holds the claim lease from a simulated live owner, starts a second claim, and asserts the second claim performs no inbox rename and no ledger write while the lease is held
- [ ] A test with a wait bound shorter than the holder's hold asserts a non-zero exit whose message names the holder pid, with the inbox file listing and ledger content unchanged
- [ ] A test asserts the claim lease is absent or released after each of the claim, `empty`, `all-blocked` and thrown-error outcomes

## Story 3: Recovery touches only strands

As an operator, I want claim-time recovery limited to pending-ledger entries so that delivered work
and envelopes with no ledger record are never revived.

### Acceptance Criteria

#### Happy Path
- Given an inbox holding a claimed envelope with a `pending` ledger entry, one with a `done` ledger entry, and one with no ledger entry, when the operator runs `compose claim`, then only the `pending` one returns to the claimable state and the other two stay claimed byte-for-byte
- Given recovery runs, when it inspects ledger state, then it reads ledger entries without changing any entry's status, attempts or timestamps

#### Negative Paths
- Given a claimed envelope whose ledger entry is `claimed` (a session already holds it), when the operator runs `compose claim`, then that envelope is not recovered by strand reconciliation and stale-claim reaping of `claimed` entries behaves exactly as before
- Given a claimed envelope whose ledger entry is `done`, when the operator runs `compose claim`, then it is neither recovered nor handed out
- Given the intake ledger is corrupt, when the operator runs `compose claim`, then the claim fails closed with the existing corrupt-ledger error before any envelope is recovered or renamed

### Done When
- [ ] A test seeds claimed envelopes with `pending`, `claimed`, `done` and absent ledger entries and asserts only the `pending` envelope changes state
- [ ] The ledger file is byte-identical before and after a claim run whose only effect is recovery plus an `empty` or `all-blocked` outcome
