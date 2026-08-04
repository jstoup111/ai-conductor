# Architecture Review: Safe multi-version harness migration

**Date:** 2026-08-03
**Feature:** `verify-bin-migrate-handles-a-multi-version-jump-wi` (`jstoup111/ai-conductor#219`)
**Tier:** M — lightweight review
**Verdict:** APPROVED to proceed to stories
**Decision record:** `adr-2026-08-03-ledgered-per-block-migration-execution.md`

## What was reviewed

The PRD's fourteen functional requirements against the current `bin/migrate`, `bin/update`,
`bin/conduct`, `CHANGELOG.md`, and the existing test suite.

## Feasibility

**Feasible as specified.** Every change lands in one 252-line Bash script, its embedded Python
parser, one frozen changelog entry, and the integrity test script. No TypeScript, no engine, no
workflow, and no packaging change is required. `bin/migrate` is invoked from exactly two places
(`bin/update:113` and `bin/conduct:332`) and from no TypeScript path, so the blast radius is
bounded and enumerable.

## Alignment

- **Deterministic where possible.** The ledger replaces prompt-and-prose discipline with machinery
  that decides mechanically what has run. The integrity check rejects bad blocks at authoring time
  rather than at a consumer's expense. Both follow the repository's stated design principle
  directly.
- **Third-party calls are smoke-only.** All new coverage runs against scratch Git repositories with
  an isolated home directory, matching the harness established by `test/test_bin_update.sh`. No
  network, provider, or daemon call is introduced.
- **Daemon operations safety.** Correcting the block that force-removes every worktree in the
  consumer repository directly retires an instance of the exact failure the repository's first
  daemon-safety rule documents. Correcting the unattended `daemon restart` block aligns the queued
  migrations with the operator's standing no-restart-without-confirmation expectation.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| A consumer with no ledger replays its whole history on first run after upgrading | High | First run with an absent ledger stays bounded by the version range, and seeds the ledger from that run's outcome. Pinned by a dedicated story and task. |
| Ledger identity drifts when the changelog is re-rendered, causing replays | High | Identity is release label plus content hash of the block body, not fence ordinal. A re-render that does not change a block body cannot change its identity. |
| Correcting a frozen changelog entry is clobbered by the release PR renderer | Medium | The renderer collects only candidates since the latest tag; `v0.99.20` is tagged. Verified against commit `d7756f0d5`. |
| The new integrity check's patterns reject a legitimate future block | Medium | Patterns are narrow and enumerated in the ADR, and the check reports the offending line and the contract clause it violates so an author can correct or argue it. |
| `bin/conduct`'s duplicated update logic drifts further from `bin/update` | Low | Out of scope by decision; both call the same `bin/migrate` and inherit the fix. #226 owns convergence. |
| The block executor's fail-fast change turns a previously "successful" no-op into an update-blocking failure | Medium | Intended, and the reason the four bad blocks are corrected in the same change. The scratch-consumer acceptance run proves the corrected set completes end to end. |

## Required conditions on the build

1. The ledger's on-disk location and identity scheme are pinned by the first task, before any
   consumer of that state is written.
2. The changelog correction is confined to block bodies inside `## [0.99.20]`. Any diff touching
   `VERSION`, `[Unreleased]`, or release metadata fails the review.
3. The scratch-consumer acceptance test is real: an actual Git repository, an actual isolated home,
   an actual `bin/migrate` invocation. Stubbing `bin/migrate` is the defect this feature exists to
   correct.
4. The change must declare its release disposition in the PR body and, because it alters the
   consumer update path, carry either a runnable migration block or a waiver as the release gate
   determines.

## Verify-Claims Ledger

### Claims

- [verified] `bin/migrate` has exactly two callers, both shell, and no TypeScript caller.
- [verified] No existing test exercises `bin/migrate`'s parser, approval, or executor.
- [verified] `test/test_bin_update.sh` already provides the scratch-repo and isolated-home fixtures
  this feature's tests need, so no new test substrate is required.

### Assumptions

- None pending. Both assumptions raised during design are carried, bounded, and settled in the ADR.

Verdict: CLEAR
