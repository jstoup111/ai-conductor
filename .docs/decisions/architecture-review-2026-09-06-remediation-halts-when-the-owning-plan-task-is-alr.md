# Architecture Review: Reopened-task resolution

**Date:** 2026-09-06
**Tier:** M — lightweight feasibility and architectural alignment
**Stories reviewed:** None yet; pre-stories review of the approved technical intent and diagrams.
**Verdict:** APPROVED WITH CONDITIONS
**Operator approval:** Explicitly approved in this composer session on 2026-09-06.

## Feasibility

Verified internal TypeScript, local Git, and per-worktree file changes. No new package, external API, service, port, or shared cross-repository resource is required. The integration surface spans admission, task resolution, task close, task-status reconstruction, and restart context. The engine-state schema grows additively and existing-file writers must preserve it atomically. Missing legacy repair state preserves prior behavior; malformed present state cannot silently authorize completion.

## Alignment

The approved scope is shared semantics only for explicit current repairs, preserving untouched-task completion, existing admission and budgets, operator acceptance, and final review authority. The durable transition is novel and warrants the approved `adr-2026-09-06-reopened-task-resolution`. Bounded amendments to the July 23 trailer-union ADR, July 13 no-op ADR, and existing-task restage review are included in this DECIDE change rather than deferred to BUILD.

The event-spine check classifies current repair obligations as durable control state (exception C). All observations use the existing ConductorEvent path. No new telemetry file or polling process is permitted. Local pattern basis and verified no-fit of tolerant direct engine-state writes and fallback evidence ranges are recorded in the ADR.

## Wiring Surface

| Surface | Production call path |
| --- | --- |
| Shared engine-state update/repair-obligation helper | Existing active-plan and appended-task writers, remediation admission, and task-close persistence |
| Strict current-repair routing resolution | `resolveTaskIds`, consumed by build completion, progress counts, and reconstruction |
| Repair admission and stable replay | `Conductor` existing-task route after existing eligibility/budget checks and before restaging/rewind |
| Fresh evidence-only close | Existing `runTaskDone` / `completeTaskDoneWhen` path, bound to the current obligation |
| Recovery and finding context | `seedTaskStatus` and conductor restart/BUILD prompt assembly |
| Distinct diagnostics | Existing route/HALT and ConductorEvent emission paths |
| Accepted-scope exclusion | Existing `classifyOverScopeCriterion` consumers before dispatch; no new acceptance authority |

Candidate files: `src/conductor/src/engine/conductor.ts`, `task-progress.ts`, `task-seed.ts`, `artifacts.ts`, `task-cli.ts`, and `autoheal.ts`, plus a shared state helper if needed. Names and symbols are rediscovery hints; BUILD verifies the current checkout rather than relying on line numbers.

## Risks

- High impact: a lost repair obligation silently restores old completion. Atomic serialized preservation, fail-closed validation, and restart/reconstruction negatives are mandatory.
- High impact: a permissive Git-range fallback admits old evidence. Strict post-reopen range handling and unavailable-boundary coverage are mandatory.
- High impact: acceptance is mistaken for another repair authorization, causing cycles. Accepted-only OVER_SCOPE must advance without BUILD, while a partial acceptance leaves independent defects intact.
- High impact: status reopening/reclosure appears as progress. Retain pre-reopen baselines and existing no-progress and lap bounds; successful effective review terminates even on an unchanged tree.
- Medium integration risk: advisory overlap scan reports many shared-file spec branches, including existing adjudication and trailer-scan work. This broad overlap is not proof of a semantic conflict. The GitHub dependency endpoint was unavailable, so dependency clearance is not claimed. Full rendered output is in `.pipeline/overlap-scan-1831.txt`.

## ADRs Created

`adr-2026-09-06-reopened-task-resolution` — Status: APPROVED by the operator in this session. Existing ADR amendments preserve original text and delimit the freshness exception.

## Conditions

1. Every acceptance criterion receives a concrete lowest-sufficient-layer coverage disposition in the plan/coherence work.
2. A bounded production-flow test proves admitted repair reaches actual BUILD with finding context and can reach a passing review after restart. Providers and third-party boundaries are faithful fakes.
3. Scope acceptance on unchanged code must terminate that blocker without BUILD or another repair charge; invalid/partial/attempt-only grants must not authorize unrelated completion.
4. State corruption, contention, partial persistence, current-vs-old evidence, canonical task aliases, and recovery must not resurrect historical completion or erase sibling obligations.
5. No task assigns this spec's ADR amendments to BUILD. Canonical daemon guidance and recovery documentation accompany the behavior change.

## Verify-Claims

CLEAR. Code behavior was read directly in the authoring worktree; the ADR records the evidence. Scope, classification, architecture, and bounded departures were explicitly approved. The unavailable remote dependency read remains an advisory uncertainty, not a claim of no overlap.
