# Halt record

Status: halted
Slug: interrupted-intake-claim-still-strands-high-priori
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-interrupted-intake-claim-still-strands-high-priori
Head SHA: 31ba6bc9601f353c2e3237fdd3ec8e197a054e1f
Halted at: 2026-10-03T03:22:38.067Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given the inbox holds no strands, when the operator runs `compose claim`, then no file in the inbox is renamed before the walk and no recovery line is printed
Task ids: 4
Done when checks: Driving `dispatchEngineer` `claim` over an inbox whose pending-ledger envelopes are all `.claimed` (a killed drain) with a `priority: critical` strand and a claimable `priority: low` entry, every recovered sourceRef is among the refs passed to the label read and the claim JSON names the critical sourceRef. | With strands and no `inbox.lease` directory ever created, the first `claim` recovers every strand with no manual rename, and each recovered entry other than the claimed winner keeps ledger status `pending` with `attempts` unchanged. | With an `inbox.lease` owned by a non-live pid plus strands, `claim` recovers the lease and the strands without operator action and exits 0 with a claim. | When strands were recovered, stderr carries exactly one line `released N stranded intake claim(s)` with N equal to the recovered count. | With no strands in the inbox, the inbox listing after `claim` equals the seeded listing minus the claimed winner and stderr carries no `stranded` line.
Missing assertion: No cited check explicitly requires that no inbox file is renamed before the walk when no strands exist.

Criterion: Story 2 negative: Given the claim lease cannot be acquired because its owner metadata is invalid or ambiguous, when the operator runs `compose claim`, then the claim fails closed with a non-zero exit naming the lease problem and never walks without the lease
Task ids: 6
Done when checks: With a strand plus a same-named claimable `.json` copy, `claim` hands that sourceRef out once and afterwards no claimable envelope for it remains in the inbox. | When one strand's recovery rename fails with a non-ENOENT error (its target `.json` path is a non-empty directory), `claim` exits 1 naming that envelope, the injected gh runner receives no call, and a second `claim` after removing the obstruction recovers every other strand. | When a strand's `.claimed` file is deleted between listing and release through the `intakeFileQueue` seam, `claim` skips it and recovers the remaining strands. | When `inbox.lease` holds invalid owner metadata, `claim` exits 1 with stderr naming the intake claim lease problem, the injected gh runner receives no call, and no inbox file is renamed. | With an unparseable `ledger.json` and seeded strands, `claim` exits non-zero with the existing corrupt-ledger error and every seeded `.claimed` file is still `.claimed`.
Missing assertion: The cited check covers invalid owner metadata, but does not explicitly cover ambiguous owner metadata.

Criterion: Story 3 happy: Given recovery runs, when it inspects ledger state, then it reads ledger entries without changing any entry's status, attempts or timestamps
Task ids: 7
Done when checks: Seeding `.claimed` envelopes with `pending`, `claimed`, `done` and absent ledger entries, `claim` returns only the `pending` one to `.json`, and the `claimed`, `done` and absent envelopes remain byte-identical `.claimed` files. | The `claimed`- and `done`-ledger envelopes' sourceRefs never appear in the claim JSON or in the refs passed to the label read. | When a claim run's only effects are recovery and an `empty` or `all-blocked` outcome, `ledger.json` is byte-identical before and after the claim. | Stale-claim reaping of `claimed` ledger entries is unchanged: `engineer-cli-claim-stale-reap.acceptance.test.ts` passes unmodified.
Missing assertion: Recovery runs that hand out a pending envelope leave every ledger entry's status, attempts, and timestamps unchanged.
```
