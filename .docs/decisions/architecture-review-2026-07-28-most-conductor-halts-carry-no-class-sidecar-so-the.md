# Architecture Review: Total conductor HALT classification

**Date:** 2026-07-28
**Input reviewed:** Technical intent for jstoup111/ai-conductor#1077; stories and plan not yet authored
**Tier:** M
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** Feasible with existing TypeScript and filesystem primitives. No new package, service, account, or runtime capability is required.
- **Prerequisites:** Existing daemon lock, `worktreeBase`, marker helper, re-kick dependency injection, and `.daemon/` state boundary already exist.
- **Integration surface:** Crosses four established seams: halt writing, daemon startup, re-kick disposition, and repository integrity validation. This is proportionate for Tier M but requires explicit wiring.
- **Data implications:** One idempotent backfill over gitignored per-worktree HALT state plus one daemon-scoped watermark. No committed schema, consumer database, or destructive data rewrite.
- **Performance:** One bounded worktree scan on first startup after upgrade; steady-state startup is a watermark read and the normal sweep remains O(halted worktrees).
- **Worktree isolation:** Migration operates per registered project while its daemon lock is held and writes only that project's `.worktrees` plus main-checkout `.daemon` state.

## Alignment

- **Deterministic-first:** Aligned. Required types and a direct-write integrity check enforce classification mechanically instead of relying on prompt discipline.
- **State modeling:** Aligned. `needs-human`, `mechanical`, `legacy`, and `unclassified` are explicit dispositions; absence is not overloaded as compatibility after migration.
- **Failure direction:** Aligned with existing fail-closed guardrails. Interrupted or corrupt new state retains the HALT.
- **Existing architecture:** The target diagram accurately uses the current halt-marker and re-kick seams; no new container, external integration, or shared service is introduced.
- **ADR authority:** ADR-013 conflicts with current and selected policy. The draft ADR must supersede it while preserving its trigger, clear mechanism, rebase safety, bound, and play-forward ordering.
- **Provider neutrality:** Complete. All behavior is below the provider boundary and applies equally to Claude and Codex execution.

## Wiring Surface

| Production surface | Design-time production caller |
| --- | --- |
| Required `writeHaltMarker(root, body, class)` contract | Every conductor, step-runner, rebase, and self-host HALT funnel; direct writes are removed |
| `migrateLegacyHaltClasses(projectRoot, worktreeBase)` | Daemon startup after successful project-lock acquisition and `worktreeBase` creation, before backlog discovery or re-kick |
| Extended halt disposition reader | Existing `daemon-cli.ts` re-kick dependency passed into `rekickSweep` |
| `legacy` compatibility handling | Existing `rekickSweep` eligibility branch and class-bearing logs |
| Direct-write integrity check | `test/test_harness_integrity.sh`, so local and CI validation reject bypasses |
| Migration and classification documentation | Existing daemon guide, artifact reference, and stalled-feature runbook |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| A current writer is incorrectly classified mechanical | Technical | Medium | High | Per-site inventory and rationale; ambiguous defaults to needs-human; funnel tests pin high-risk classes |
| A stale sidecar classifies a newly overwritten HALT | Data integrity | Medium | High | Shared writer clears stale class before body write; clear path removes both files; interrupted write fails closed |
| Compatibility scan races an older daemon writer | Concurrency | Low | High | Run only after exclusive project-lock acquisition and before dispatch/re-kick |
| Migration crashes before its watermark | Data integrity | Low | Medium | Marker-last ordering and idempotent rescan before any normal work |
| Legacy stamp cannot be written | Operations | Low | Medium | Log the slug; leave it unclassified and fail closed rather than guessing |
| Direct writer is reintroduced later | Architecture drift | Medium | High | Type check plus deterministic integrity scan of production writes |

## ADRs Created

- `adr-2026-07-28-total-halt-classification-legacy-boundary.md` — APPROVED; supersedes ADR-013.

## Conditions

The operator approved the replacement ADR on 2026-07-28. Planning has resolved the inventory condition; the migration-order constraint remains mandatory during implementation:

1. **Satisfied:** The operator approved the new ADR before stories became authoritative inputs.
2. **Satisfied:** The approved implementation plan carries a complete 28-write classification inventory, grouped into reviewed TDD batches rather than a bulk textual rewrite.
3. **Implementation condition:** Migration executes under the daemon lock before normal work and writes its watermark last.
4. **Satisfied:** ADR-013 was marked superseded only after the replacement ADR was approved.

## Blocking Issues

None. The design is technically feasible and aligned; Conditions 2 and 3 are mandatory implementation constraints.
