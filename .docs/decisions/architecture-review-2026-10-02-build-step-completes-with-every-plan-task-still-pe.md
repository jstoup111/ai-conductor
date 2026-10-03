# Architecture Review: Build step completes with every plan task still pending

**Date:** 2026-10-02
**Tier:** M — lightweight feasibility and architectural alignment
**Stories reviewed:** None yet; pre-stories review of the approved technical intent and sequence diagram.
**Verdict:** APPROVED WITH CONDITIONS
**Operator approval:** Approach A, the Balanced scope boundary, and three design assumptions were approved in this composer session on 2026-10-02: no recorded digest records a baseline and reopens nothing; a plan change charges no lap; and the digest is whitespace-normalized.

## Feasibility

Root cause, verified by source reading at main `f450169a5` (80%): the BUILD completion predicate resolves a task from either a completed row or any `Task:` trailer in `merge-base..HEAD`. Commits made before an operator amendment therefore keep resolving the rewritten tasks. Repair obligations (`adr-2026-09-06-reopened-task-resolution`) already make pre-boundary trailers ineffective, but only gate remediation and `coverage_binding` admit them. A plan amendment followed by `rewind --to build` admits none.

The fix is internal TypeScript. It needs no new package, service, port, or external API.

- **Detection point.** `seedTaskStatus` runs on every BUILD completion evaluation and before every BUILD attempt (95%). It already reads the obligation store and restages open-obligation rows to pending. Admitting a new obligation before that read reuses the existing restage with no new loop.
- **No recursion.** Seeding must call the obligation store directly. The admit-and-restage helper re-seeds, so calling it from seed would recurse.
- **HEAD boundary.** It is available from the same commit/tree helpers the restage helper uses.
- **Task bodies.** `parsePlanTaskBodies` supplies per-task bodies, but a body currently runs to the next task heading, so a trailing non-task section would be attributed to the last task. The digest must stop at the next heading of the same or higher level (ADR D11).
- **Authority value.** `source.authority` is an unvalidated string, so `plan_amendment` needs no schema change (95%).
- **Settlement.** Settlement is read only by the restart hint restore, so a no-lap obligation is marked settled at admission to keep its restart resume hint. The pending-repair ledger path is not touched.
- **Rebase.** Rebase translation already rewrites obligation baselines.
- **Reconstruction.** When `.pipeline/` is lost, engine-state is lost with it, so digests and obligations are gone and the baseline-only rule applies. This matches the existing D6 recovery claim and is not widened.

Pending-task naming is feasible:
- **Where it changes.** The not-done reason is built in one place, and no code parses it. Its consumers are the retry hint, `step_retry`, the build-stall question, and the HALT text.
- **Titles.** They come from the plan task list or the task-status row name.
- **Format change.** Existing tests assert the current truncated text verbatim and must be updated with it.
- **Daemon output.** The daemon CLI cuts a retry line to 120 characters. The full list must therefore reach operator-visible daemon output through a line that is not truncated (Condition 3).

## Alignment

- **Governing ADR.** `adr-2026-09-06-reopened-task-resolution` already governs the durable reopen and its freshness rule, so this adds no new ADR. It amends that ADR with D11, a new admission source, following the D10 `coverage_binding` precedent. The per-task digest section is durable control state under event-spine exception C; there is no sidecar file and no poller.
- **Trailer-union ADR.** `adr-2026-07-23-trailer-union-build-step-routing` keeps its authority split. D11 adds no second "stale evidence" rule, which is why approach B was rejected.
- **Done-when close.** The task-close gate remains the only evidence-only close path. A task with no `**Done when:**` block can close only through a fresh trailer commit. This qualifies the operator's third assumption: a cosmetic-wording reopen is closable without a commit only when the task has a Done-when block. Current plan authoring requires one.
- **Stale comment.** The predicate comment naming a `build_review` completeness rubric as the backstop is false; that rubric was retired in #1824. Correcting it is in scope and requires no ADR.

## Wiring Surface

| Surface | Production call path |
| --- | --- |
| Per-task plan digest computation | Called from `seedTaskStatus`, which runs from the BUILD completion predicate and the pre-attempt BUILD seed |
| Per-plan digest section in engine-state | Read and written by `seedTaskStatus` through the existing serialized engine-state update seam |
| `plan_amendment` obligation admission and supersession | `seedTaskStatus`, through `RepairObligationStore.admitOrReplay` before its open-obligation read |
| Full pending-task reason (id and title) | BUILD completion predicate not-done result, consumed by the existing retry hint, `step_retry`, build-stall question, and HALT paths |
| Operator-visible full list | Existing daemon retry/stall output path, on a line exempt from the 120-character retry truncation |

Candidate files: `task-seed.ts`, `repair-obligations.ts`, `engine-state-store.ts`, `plan-task-parse.ts`, `artifacts.ts`, and the daemon retry formatter. Names are rediscovery hints; BUILD verifies against its own checkout. The advisory overlap scan over these paths reported no overlap and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Digest instability (parser or normalization change) reopens every task of every in-flight feature | Data | Low | High | Digest is versioned with its section; an unknown digest version records a baseline and reopens nothing |
| A failed admission silently leaves the stale trailer resolving the task | Data | Low | High | Admission failure in the completion predicate returns not-done with a named reason (fail closed, D3) |
| Trailing non-task plan sections falsely reopen the last task | Technical | Medium | Medium | Digest scope stops at the next same-or-higher heading (D11) |
| Seed admission recurses through the restage helper | Technical | Medium | Medium | D11 forbids the helper path; a test proves admission from seed does not re-enter seed |
| Reworded test expectations hide a regression in the clean all-complete pass | Technical | Low | Medium | Dedicated story criterion for the all-complete clean completion |

## ADRs Created

None. `adr-2026-09-06-reopened-task-resolution` is amended with D11 (APPROVED amendment, additive).

## Conditions

1. A plan with no recorded digests, or a digest of an unknown version, records a baseline and reopens nothing.
2. The obligation admission failure path fails the completion predicate closed with a named reason; it never falls back to trailer resolution.
3. When BUILD ends incomplete, every pending task id and title appears in the step retry hint, the build-stall question, any resulting HALT, and in at least one line of operator-visible daemon output that is not truncated.
4. A BUILD with every plan task resolved and no digest change completes exactly as today.
5. The stale "completeness rubric is the backstop" comments in the predicate and task seeding are corrected.
