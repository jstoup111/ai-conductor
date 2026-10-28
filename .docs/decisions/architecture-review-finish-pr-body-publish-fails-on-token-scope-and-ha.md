# Architecture Review: FINISH reports the real PR-publish failure instead of "pr.prose unchanged"
**Date:** 2026-10-24
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** `.docs/track/finish-pr-body-publish-fails-on-token-scope-and-ha.md` (technical track, operator-confirmed scope boundary), `.docs/complexity/finish-pr-body-publish-fails-on-token-scope-and-ha.md`, `.docs/architecture/finish-pr-body-publish-fails-on-token-scope-and-ha.md`, intake jstoup111/ai-conductor#3376
**Verdict:** APPROVED

## Feasibility

| Technical-intent item | Assessment |
|---|---|
| Record a failed guarded operation on the spine | Feasible with the current stack. `dispatchGithubOperationCommand` already computes a canonical `failed` result with an `error` string at every exit path (verified, `github-operations-cli.ts`). The existing external writer (`appendCloseoutEvent` in `closeout-events.ts`) appends a `ConductorEvent` to `.pipeline/pipeline-events.jsonl`, so the change adds one variant and one admitted kind. No new package. |
| Engine sees the failure for its own pass | Feasible. The production `authorProse` effect wraps a single awaited dispatch (verified, `finish-publication-production.ts`), so it can record the sibling ledger's byte length before dispatch and read only later records after it returns. The byte-offset read pattern already exists in `CloseoutTailReader` (verified, `closeout-tail.ts`). |
| Halt reason carries the failure | Feasible. `HUMAN_REQUIRED_REASONS` is a closed table of message and next action (verified, `finish-publication.ts`). The author branch already maps typed errors thrown from the effect, region-restore errors, to `human_required` (verified). A new reason plus a new typed error follows the same shape. |
| No false authoring success | Feasible. The fixed-point guard runs only on the success path after `authorProse` resolves. A thrown typed failure bypasses it by construction (verified, author branch). |
| Negative path unchanged | Feasible. With no matching record the effect resolves exactly as today. |

- **Prerequisites:** none. No migration, config key, or external setup.
- **Integration surface:** 3 module boundaries (CLI, event union with external admission, FINISH publication), at the edge of the threshold. Acceptable, because each boundary gets one additive seam.
- **Data implications:** one additive event variant. Existing ledgers are unaffected.
- **Performance:** one bounded read of a small sibling ledger per authoring pass.
- **Worktree isolation:** all writes are worktree-local `.pipeline/` files. No port, database, or shared resource.

## Complexity

Assessed as Tier M during DECIDE and not re-rated here.

## Alignment

- **Event spine.** `.agents/skills/event-spine/SKILL.md` was applied. The concern is an occurrence in time, so it goes on the bus as a new variant (§2). The writer is a separate OS process that would otherwise share `events.jsonl` with the engine's persister, so exceptions A and B apply. The event therefore uses the single-writer sibling ledger in the same union, re-emitted by the existing session tail (§3, §6). This governs the structural decision and requires amending adr-2026-10-12 D3's enumerated admitted set (done in this spec).
- **adr-2026-08-08-pipeline-owned-closeout-timestamps D2** (one writer per ledger) is upheld for the new event. `github_operation_refused` and `github_write_credential_fallback` already write the engine ledger directly through `startOperatorEventSpine`. That pre-existing deviation is recorded but left out of scope by the operator-confirmed boundary.
- **adr-2026-08-13 decision 5** (generalized allowlisted external writer) covers adding a kind without amendment.
- **adr-2026-08-01-engine-owned-resumable-finish-publication D4** is unchanged: the provider still authors and publishes, and the engine only observes. Re-observation remains the authority (D1).
- **adr-2026-08-08-finish-human-required-halt-rendering:** the new reason renders through the existing human-required halt path. No new rendering mechanism.
- **Security boundary:** the event's `error` field strips the `Command failed: <argv>` prefix and is capped at 1000 characters. Tokens reach `gh` through the environment, not argv (A2, operator-approved). This matches the secret-safety posture of `github_write_credential_fallback`.
- **State management:** the new halt reason is a closed-table entry, and the typed failure is a discriminated error, not a boolean flag.
- **Diagrams:** the feature diagram was updated during this review to route the event through the sibling ledger and tail.
- **Production DI defaults:** no new store. The ledger is the filesystem.

## Focused local pattern basis

- **Typed effect error mapped to a human-required reason.** The precedent is the region-restore errors in `advanceFinishPublication`'s `author_pr_prose` branch (`finish-publication.ts`; symbols `isRegionRestoreError`, `region_restore_refused`). Traits to preserve: the effect throws a discriminated error, and the coordinator classifies it inside the existing `coalescePublicationEffect` callback. Allowed variation: unlike region restore, this path must re-observe before deciding (ADR D4).
- **External event append plus tail admission.** The precedent is `appendCloseoutEvent` and `ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES` (`closeout-events.ts`) with `CloseoutEventTail` (`closeout-tail.ts`). Traits to preserve: same `ConductorEvent` schema, one append per record, and admission via the allowlist constant.

## Wiring Surface

| New production surface | Production caller (design-time commitment) |
|---|---|
| `github_operation_failed` `ConductorEvent` variant | Written by `dispatchGithubOperationCommand` (reached from `index.ts`'s `github-operation` command dispatch) on every `failed` result; re-emitted by the existing `CloseoutEventTail` started through `startSessionEventTail`; read by the production `authorProse` effect |
| Admission of `github_operation_failed` in the external allowlist | Consulted by the existing `CloseoutEventTail` poll loop |
| Failure-text bounding helper (argv strip and 1000-character cap) | Called by `dispatchGithubOperationCommand` when building the event |
| Pass-window failure reader (byte offset then filter by PR target) | Called by the production `authorProse` effect in `finish-publication-production.ts` around its `dispatchAuthoring` call |
| Typed publication-operation failure error | Thrown by `authorProse`; classified by `advanceFinishPublication`'s `author_pr_prose` branch |
| `publication_operation_failed` in `HUMAN_REQUIRED_REASONS` | Returned by the author branch; rendered by the existing FINISH human-required halt path |

**Early overlap scan (advisory):** `ai-conductor overlap-scan` over the paths above reported one overlap: `src/conductor/src/types/events.ts` with `spec/daemon-repair-queue-and-maintenance-events-admit-i`. Both changes add union variants, so the merge is additive. Not blocking.

## Domain Integrity

Skipped in lightweight mode (handled per cycle by the TDD domain reviewer).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Provider cwd is not the feature worktree, so the failure is not found | Integration | Low | Medium | Falls back to today's unchanged halt, no regression (A1) |
| Error text carries sensitive output | Security | Low | Medium | Argv prefix stripped and 1000-character cap; token in env (A2) |
| A stale failure from an earlier pass is misattributed | Data | Low | Low | Byte-offset window per pass plus re-observation authority |
| Concurrent CLI invocations interleave in the sibling ledger | Data | Low | Low | Capped records stay far below `PIPE_BUF`, so each append is atomic |

## ADRs Created

- `adr-2026-10-24-finish-surfaces-guarded-publish-failures`: APPROVED (operator-confirmed decisions and assumption ledger).
- Amended: `adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry` D3 (admitted set gains `github_operation_failed`).
