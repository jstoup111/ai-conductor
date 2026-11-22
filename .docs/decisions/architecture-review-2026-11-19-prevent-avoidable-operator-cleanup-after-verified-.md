# Architecture review of verified rebase recovery

**Verdict:** APPROVED

## Feasibility and alignment

FR-1 through FR-4 fit the existing halted-feature maintenance pass and feature admission checks. The missing capability is durable proof that the live rebase halt and the accepted checkout belong to the same attempt. FR-5 and FR-6 use the existing rebase transition and its interrupted-operation recovery. Git verification stays behind the rebase runner. [Approved sequence](../architecture/verified-rebase-recovery.md) · [Dispatch-boundary decision](adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary.md)

## Wiring Surface

| Production entry | Responsibility |
|---|---|
| Rebase start and conflict halt writer in `engine/rebase.ts` | Capture immutable replay inputs and identify the halt generation. |
| Existing halted-feature maintenance wiring in `daemon-cli.ts` and `engine/daemon-rekick.ts` | Verify candidates and conditionally reconcile the current halt under the shared ownership boundary. |
| Existing rebase transition and daemon scheduler | Restore gate eligibility, finish interrupted recovery, and dispatch eligible work. |

## Concurrency risk

A competing writer could replace a halt between verification and clearing. A second read followed by an unconditional delete still has that race. The implementation must prove that a replacement halt survives and that restart after a partial clear cannot authorize a second continuation. [Approved decision](adr-2026-11-19-verified-rebase-admission.md)
