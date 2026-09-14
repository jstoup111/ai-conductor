# Architecture Review: Recover stale conduct-state lease recovery claims

Date: 2026-09-11
Mode: Medium, lightweight technical feasibility and architectural alignment
Source: jstoup111/ai-conductor#2170
**Verdict:** APPROVED

Operator approved this complete design on 2026-09-11.

## Feasibility

Verified from `createConductStateLease` in `src/conductor/src/engine/conduct-state-lease.ts`: lease creation uses an exclusive directory, recovery claims use exclusive file creation, and completed recovery quarantines the lease directory before removing it. The filesystem seam already accepts arbitrary claim paths through `writeRecoveryClaim` and `readRecoveryClaim`. The selected approach retains those primitives and all public store entry points; no new service, dependency, CLI, or user configuration is needed.

The existing EEXIST path returns occupied without reading the claim and carries the already-dead owner's pid into the timeout. This verifies the reported mechanism by source inspection, not crash reproduction.

A read/liveness-check/unlink sequence is insufficient: two contenders may read the same old claim, one remove it and install a replacement, and the other's delayed unlink remove that replacement. Re-reading immediately before unlink does not make those separate operations conditional or atomic. We must avoid deleting or overwriting an active claim as part of electing its successor.

## Approved recovery protocol

1. **Immutable claim succession.** Keep a claim after proving its process dead. Elect its successor by exclusively creating one deterministic successor slot derived from the protected owner's token and predecessor claim identity. A competing EEXIST reader follows the existing successor instead of deleting it. If that successor also died, repeat on its distinct next slot. Never create a second reusable recovery mutex whose own stale lock needs another mutex to clear.
2. **Owner generation binding.** New claim records identify the lease owner token they concern, their own unique token, and their predecessor identity. Derive filesystem-safe slot names deterministically from these identities. Validate those fields on read. A delayed contender may never use a claim for a prior owner to move or release the current owner's directory.
3. **Legacy root compatibility.** Continue to arbitrate an initially absent root at `recovery.json` through exclusive creation. New root records retain the existing version/pid/token/claimedAt fields and add owner binding. An existing valid legacy root without owner binding is conservatively treated as belonging to the current owner: a live or unverifiable legacy claimant blocks, a provably dead one permits the first owner-bound successor. A root explicitly bound to a different owner is retained but confers no authority over the new owner; new clients elect through a deterministic root slot bound to that new owner. Old clients continue to see the canonical root and conservatively refuse recovery. Never clear legacy or foreign-generation roots in place.
4. **Exclusive winner.** Follow the current owner's chain. A live or not-provably-dead claimant stops recovery. Only the process that successfully creates the eligible terminal claim may quarantine the directory, after revalidating owner and claim identity. Other processes cannot supersede that terminal claimant while it is live. A contender that discovers an owner change or loss of authority abandons its stale attempt and retries acquisition within its original budget; it never deletes, overwrites, or quarantines the replacement generation. After quarantine, recheck the same owner/claim identity before deleting only the quarantined directory.
5. **Conservative ambiguity.** Parse and validate each encountered legacy/new claim. Malformed, incomplete, unsupported, owner/predecessor-inconsistent, unreadable, or cyclic claim state fails closed with a specific diagnostic. Neither file age nor elapsed wait is proof of death. A disappearing file/directory or owner generation is a retryable race when no unsafe mutation occurred. Every traversal and retry shares the original acquisition budget so chains and repeated replacement cannot restart or evade it.
6. **Release and diagnostics.** Release checks only recovery authority applicable to its own owner generation, while treating an unbound legacy root conservatively. A valid root explicitly bound to another generation must not permanently block the new owner's release. Release retains the existing exact-owner check. Distinguish a blocking owner, blocking recovery claimant, malformed claim, unverifiable probe, and changed generation. Never label a pid already proved dead as live, and never reuse a previous iteration's blocker after observing a different state. Preserve caller labels and public result kinds where possible.

## Safety argument and limits

Within the existing single-host model, a process proved dead cannot later continue its paused recovery. At each eligible successor slot, exclusive creation elects one writer. A live winner cannot be superseded, and losing contenders neither remove its claim nor advance beyond it. Binding successor slots and checks to the owner generation prevents stale observations from conferring authority over a replacement lease. Deterministic interleaving tests must verify this argument through the actual acquire/release entry point.

Process-id reuse remains conservative: a reused live pid may block recovery; this change does not introduce cross-host liveness or claim that pid identity proves a process incarnation. The existing `processIsLive` boolean seam remains compatible: false permits recovery, true blocks it. Probe errors refuse recovery; production probe outcomes that cannot prove death must not yield an unsupported assertion that the claimant is live. The complete acquisition remains bounded under the existing assumption that individual filesystem operations terminate; no OS-call cancellation mechanism is added.

## Alignment and structural prerequisite

The approved `adr-2026-08-01-conduct-state-mutation-port` requires bounded exclusive ownership and failure rather than concurrent persistence when ownership is uncertain. The approved `adr-2026-08-12-fail-closed-intake-ledger-durability` requires reusing this primitive for the intake ledger. This design preserves both.

Immutable succession changes durable recovery state transitions, which the existing ADRs do not specify. Therefore a focused ADR is warranted for that uncovered decision, without superseding the existing store architecture. The approved protocol is recorded as `adr-2026-09-11-immutable-state-lease-recovery-succession` with numbered decisions matching the six protocol points above.

Local pattern basis: preserve the existing filesystem adapter's exclusive creation, token ownership, bounded acquisition, quarantine-before-cleanup, and fail-closed metadata checks. These are the applicable traits. Claim file naming and parsing may evolve as described above; the separate full-suite lock's age-based reclaim policy is not authority for this lease and is excluded.

## Wiring Surface

- `src/conductor/src/engine/conduct-state-lease.ts`: internal classification, successor election, generation checks, bounded traversal, and release/diagnostic changes are called from the existing exported `createConductStateLease().acquire()` and returned `handle.release()`. No orphan helper or new public command is planned.
- Existing production consumers remain wired through this factory: `filesystem-conduct-state-store.ts`, `engine-state-store.ts`, `engineer/intake/ledger.ts`, `remediation-case-store.ts`, `build-review-dispositions.ts`, `kickback-ledger.ts`, and `closeout-events.ts`.
- `src/conductor/test/engine/conduct-state-lease.test.ts`: extend the faithful injected filesystem and deterministic liveness/clock/interleaving coverage; verify the production filesystem behavior with a fixture-owned temporary directory. One existing persistent-store entry point must demonstrate that recovery permits the pending mutation and refusal permits no write.
- `README.md` and `docs/runbooks/corrupt-intake-ledger.md`: document automatic dead-claim recovery, conservative refusal, and accurate diagnoses as part of the owning implementation task.

Advisory overlap scan over the lease source and its tests: no overlap detected and no open blockers; the tool notes that renames or name-only diffs may not be detected.

## Test design and review risks

Apply repository-local write-tests guidance: use injected liveness and clock, deterministic barriers rather than wall-clock sleeps, no process killing or real external service calls, fixture-owned filesystem paths, and await all concurrent work before teardown.

Required proof includes legacy dead-root recovery; multiple dead successors; live and unverifiable claimants; malformed or partial root/successor metadata; two contenders for one dead predecessor; a contender paused before exclusive claim creation while the lease is replaced; a winner paused before quarantine while another contender attempts recovery; release in the presence of foreign-generation claims; disappearing paths; timeout during chain traversal; and preserved serialization through a real state-store mutation entry point. A single happy-path helper test cannot close this work.

High-impact risk: incorrectly implemented election or generation checks can permit concurrent writes or disturb a live replacement. Mitigation: the immutable protocol plus adversarial interleaving tests at the exported lease boundary and a production persistence integration proof. This is why the operator approved Medium depth.

Availability trade-off: malformed or unverifiable claims remain a diagnosed refusal requiring investigation, and each interrupted recoverer adds one immutable record until successful quarantine removes that old generation. Bounded acquisition prevents an arbitrarily long chain from consuming an unbounded loop.

## Event-spine decision

No new reporting channel. Claim records are ownership state (exception C), not an event log. Reuse existing result/callback paths, and do not add a watcher, sidecar log, or timestamp-based recovery authority. No new emitted event is required for the requested accurate failure messages.

## Verify-claims ledger

Verified: current EEXIST behavior, existing filesystem methods, store caller wiring, governing ADRs, and available injected test seams, from the named source files and test source. No runtime concurrency proof is claimed during DECIDE.

Confirmed inputs: operator selected approach A, technical track, comprehensive in-scope edge cases, exclusion of the full-suite lock, and Medium review depth.

Approved architectural decision: adopt immutable owner-bound successor claims and conservative ambiguity handling as specified above. The operator approved the complete proposal on 2026-09-11. No generic compare-and-delete filesystem operation is assumed.

Verify-claims verdict: CLEAR. All design choices and limits stated here were approved by the operator.
