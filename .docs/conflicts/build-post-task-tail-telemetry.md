# Conflict Check: BUILD post-task tail telemetry

**Date:** 2026-08-08
**Stories checked:** `.docs/stories/build-post-task-tail-telemetry.md` (Stories 1-6) against the
265 story files in `.docs/stories/` and the APPROVED ADRs in `.docs/decisions/`
**Result:** **PASSED — zero blocking conflicts.** One degrading observation accepted (D-1).

## Resource contention — the sharpest question, resolved clean

Story 2 introduces `.pipeline/pipeline-events.jsonl`. Scanned every `.pipeline/*.jsonl` path
referenced anywhere in `src/conductor/src` and `skills/`:

| Existing ledger | Writer |
|---|---|
| `.pipeline/events.jsonl` | `EventPersister` (sole writer) |
| `.pipeline/otel.jsonl` | OTel file transport (`otel-config.ts:5`, configurable via `types/config.ts:257`) |
| `.pipeline/audit-trail/events.jsonl` | `AuditTrail` (`audit-trail.ts:63`) |

**No name collision**, and — more usefully — **the "one ledger" premise this feature was
implicitly checked against is already false.** Two sibling ledgers exist today, each with its own
single writer. Story 2's sibling-ledger model follows established practice rather than
introducing a new pattern, which materially lowers the risk the architecture review assigned to
it. Confidence 95%, *verified* by direct path scan.

**Event-union collision:** the `ConductorEvent` union has 68 members; none is named for closeout,
and neither `tickReason` nor `headMoved` appears anywhere in `types/events.ts`. Stories 1 and 2
add names that are free. Confidence 95%, *verified* by grep.

## Contradiction check against APPROVED ADRs

**`adr-2026-07-10-intra-step-build-progress-events` — no contradiction.** That ADR rejected
"runner-push" because `task-cli` runs in a separate process with no bus access and pushing would
require "an IPC channel or an append file the conductor must still poll/read". Stories 2 and 3
introduce no IPC and no protocol: an append-only file in the same event schema, polled by a tail.
The ADR's own stated objection describes the accepted cost, not a prohibition. Story 1 is an
additive extension of that ADR's chosen watcher. Confidence 85%, *inferred* — the ADR does not
speak to this case directly, so this is a reading of its rationale rather than an explicit
allowance; the new ADR records the reconciliation and does not supersede.

**`adr-2026-07-05-engine-owned-task-status` — supporting precedent, not conflict.** `task-cli`
already writes engine-consumed `.pipeline` state from inside the build worktree.

**`session-fresh-verdict-artifacts` stories — checked, distinct.** Those stories establish
verdict *freshness* by comparing artifact mtime against an attempt/session floor. This feature's
ADR **rejects mtime as a duration source**. These are not in tension: mtime is fine as a
"was this rewritten during the current attempt" signal and unfit as a "how long did this take"
signal, because it does not survive worktree recreation (issue #497) and changes on copy.
Recorded explicitly because a careless later reader could mistake the ADR's rejection for a
contradiction of established practice. Confidence 90%, *verified* against both artifacts.

## Behavioural overlap — Story 4's gate

Story 4 extends the batch-boundary gate that stat-checks
`.pipeline/audit-trail/batch-N/review.json`. Five existing story files mention a `review.json`,
but every one of them refers to **`.pipeline/build-review.json`** — the `build_review` *step*
artifact, a different file owned by a different gate. No existing story claims ownership of the
pipeline batch-boundary gate. No overlap. Confidence 90%, *verified* by grep across the cited
files.

## Sequencing

Story 4 (gate) depends on Story 2 (emitter) and must not precede it, or an in-flight build blocks
on an event nothing yet produces. This is not a conflict between stories — it is an ordering
constraint, already recorded as Condition 1 in the architecture review and restated in Story 4's
Done When. `/plan` must honour it in task order.

## State conflict — Story 3's lifecycle

Story 3's tail attaches to the same `build` dispatch scope as `BuildProgressWatcher`. No story or
in-flight spec found that restructures that scope; the risk is ordinary rebase contention on a
hot file, not a semantic conflict.

## Degrading observations (accepted, non-blocking)

**D-1 — Two malformed-line policies already coexist in this codebase.**
`timing-rollup.ts`'s `parseLedger` fails closed (one bad line ⇒ the whole rollup degrades to
`partial`), while `report-renderer.ts:33` explicitly *skips* malformed lines and continues. Story
5 follows the `timing-rollup` policy, which is correct for a measurement artifact — silently
skipping lines would understate durations, the exact class of error this feature exists to fix.
The inconsistency is pre-existing and out of scope; recorded so the divergence is a known choice
rather than an accident a later reviewer flags as drift. **Accepted.**

## Overlap-scan assessment

`conduct-ts overlap-scan` reports both `build-progress-watcher.ts` and `types/events.ts` as
overlapping with ~35 open spec branches each. Sampling the branch list, the hits are ordinary
co-touching of two of the most central files in the repository, not semantic collisions. Treated
as **uninformative for this feature** rather than as 35 warnings. The operative mitigation is
already binding: keep both edits strictly additive (review Condition 4, Story 1's Done When).

## Verdict

**Zero blocking conflicts. Proceed to `/plan`.** Carry forward: Story 2 before Story 4; both
central-file edits stay additive.
