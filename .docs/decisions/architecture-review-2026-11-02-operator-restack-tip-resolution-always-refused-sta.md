# Architecture Review: Operator restack --tip resolution always refused stale (#3582, folding #3557 and #3576)
**Date:** 2026-11-02
**Mode:** Full (Large tier)
**Inputs reviewed:** the explore output and track marker `.docs/track/operator-restack-tip-resolution-always-refused-sta.md`, the diagram `.docs/architecture/operator-restack-tip-resolution-always-refused-sta.md`, and the amended ADRs named below.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Technical intent | Assessment | Confidence / basis |
|---|---|---|
| Resolver loses the post-rewrite hook in production | `resolveRebaseConflict` has no environment parameter in its provider call. A real-git probe of `rebase --continue` without the environment finished and wrote no rewritten list | 95%, verified |
| HEAD can be the tip authority | FR-8 and FR-9 read `HEAD` in the temporary checkout through the same runner, and the checkout is removed only in `finally` | 90%, verified |
| The tree can be masked without touching the worktree | `haltRecordTree` with `{kind: 'write', record: undefined}` already produces a tree without the path through a temporary index | 95%, verified |
| A halt-record-only commit can be recognized | `isHaltRecordOnlyCommit` exists, excludes merges, and is exact on the path | 95%, verified |
| A fresh conflict record can replace an old one | `writeConflictRecord` replaces the record and parent pin together by compare-and-swap | 95%, verified |
| A provider overlay is possible on all three adapters | Claude `buildEnv`, Codex `invocationEnv` and Pi each merge `options.selfHost?.env` at one point | 90%, verified |
| The record has one production content reader | `hasOutstandingHalt` is the only reader of record content; the other `.docs/halted` sites match the path only | 90%, verified |

- **Stack compatibility.** No new dependency.
- **Prerequisites.** None. #3438 is blocked by this spec.
- **Integration surface.** Restack, halt seam, child lifecycle, step runner and provider adapters.
- **Data implications.** One new per-feature ref, added to teardown. No migration: readers fall back to the committed record.
- **Performance.** A few extra Git plumbing calls on halt and on consumption.
- **Worktree isolation.** Refs are per slug and shared safely across worktrees.

## Complexity

High for its size, because the halt seam serves every feature and a wrong tip loses work. Estimated 15 to 17 plan tasks, under the 20-task split threshold. No split proposed.

## Alignment

- **Governing ADRs.** `adr-2026-08-23-committed-halt-record`, `adr-2026-10-07-per-child-build-region`, `adr-2026-10-10-stacked-restack-journaled-replay` and `adr-2026-10-25-operator-recorded-restack-conflict-resolution` each have a falsified assertion, so each gets an amendment. `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts` is unaffected, because a decision never compares trees and the fresh record gives it the live halt it requires.
- **Local pattern.** The ref store follows `restack-conflict-record.ts`: role, durable hand-off state; traits, compare-and-swap in one transaction and an explicit teardown entry; variation, a commit chain instead of a blob, to keep the record's audit trail.
- **Event spine.** Occurrences stay on `halt_record_written` and `restack_resolution`, which gains `retired`. The ref is state read by name, exception C of the event-spine skill.
- **Scope check.** Consumer-facing: stacked delivery exists in consumer projects, and #3576 came from one. The HARNESS.md rule on branch-visible halts changes through a plan task. Provider-neutral: all three adapters change.
- **State.** Staleness stays a typed field, and the new action extends a closed union.
- **Production DI.** No in-memory store is introduced.

## Domain Integrity

Commit identifiers stay `CommitSha`. The record's location is decided in one place, the halt-record seam, not at each caller.

## Wiring Surface

| Surface | Production caller |
|---|---|
| Ref-backed record write and read | `recordHalt` and `supersedeHaltRecord`, reached through `writeHaltMarker`, `halt clear`, `daemon-deps` and the stack preflight |
| Record reader rule | `hasOutstandingHalt`, used by `cleanClearedAbortedRestackJournal` |
| Masked comparison | `consumeRecordedResolution`, called from `runRestack` and `resumePlanned` |
| Fresh record on staleness | The stale branches of `runRestack` and `recoverRestackJournal` |
| `restack_resolution` action `retired` | Emitted at those same sites, persisted by `EventPersister` |
| Environment overlay | `resolveRebaseConflict` through `restackResolverForStepRunner` and the conductor preflight, then each adapter's environment builder |
| Tip authority and candidate guard | `resolveRestackConflict`, called from `runRestack` and recovery |
| Default-branch helper | `moveLeaf` and `resolveBaseCore` |

## Overlap Scan

`spec/claude-steps-re-run-forever-when-their-own-output-` also touches `claude-provider.ts`. This is advisory; the change here is one line in `buildEnv`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A settled tip is wrong and work is lost | Data | Low | High | HEAD is what the guards read, and a missing candidate subject halts with nothing moved |
| A false halt when a resolver legitimately empties a commit | Technical | Low | Medium | The halt carries a fresh record, and `--tip` or `--decision` settles it |
| A provider strips `GIT_CONFIG_KEY_*` | Integration | Medium | Low | Decision 7 needs no hook; only the stamp and merge driver are lost |
| An in-flight stack reads a stale committed `Status: halted` | Data | Low | Medium | The ref wins over HEAD, and supersede always writes the ref |
| Off-host pickup loses a stacked leaf's record | Knowledge | Low | Medium | Operator-approved assumption A5; the ref stays readable on the host |
| Fresh-record write fails after the resolution is deleted | Technical | Low | Low | The shipped halt path reports the record failure, and the next replay writes a new one |

## ADRs Created

- `adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref`

## Conditions

1. The plan closes the dropped-commit defect first, per the operator's sequencing.
2. Real-git tests run the production resolver wiring with a resolver that calls `rebase --continue` without the environment, so the failure that reached production is covered.
3. The HARNESS.md rule changes through a plan task; runbook and reference updates go through the pre-finish documentation gate.
