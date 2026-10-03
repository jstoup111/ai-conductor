# Halt record

Status: halted
Slug: interrupted-intake-claim-still-strands-high-priori
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-interrupted-intake-claim-still-strands-high-priori
Head SHA: f8e451be717aa2d848ba8314d7d3254db3e879a1
Halted at: 2026-10-03T08:51:27.656Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 3 negative: Given the intake ledger is corrupt, when the operator runs `compose claim`, then the claim fails closed with the existing corrupt-ledger error before any envelope is recovered or renamed
Task ids: 6
Done when checks: With a strand plus a same-named claimable `.json` copy, `claim` hands that sourceRef out once and afterwards no claimable envelope for it remains in the inbox. | When one strand's recovery rename fails with a non-ENOENT error (its target `.json` path is a non-empty directory), `claim` exits 1 naming that envelope, the injected gh runner receives no call, and a second `claim` after removing the obstruction recovers every other strand. | When a strand's `.claimed` file is deleted between listing and release through the `intakeFileQueue` seam, `claim` skips it and recovers the remaining strands. | When `inbox.lease` holds invalid owner metadata, and separately when it holds ambiguous owner metadata (an owner record naming a live pid whose identity cannot be confirmed), `claim` exits 1 with stderr naming the intake claim lease problem, the injected gh runner receives no call, and no inbox file is renamed. | With an unparseable `ledger.json` and seeded strands, `claim` exits non-zero with the existing corrupt-ledger error and every seeded `.claimed` file is still `.claimed`.
Missing assertion: The cited check requires corrupt-ledger failure and that every seeded file remains `.claimed`, but does not explicitly require that no envelope was recovered or renamed before the failure.
```
