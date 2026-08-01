# Architecture Review: conduct-state mutation port

**Date:** 2026-08-01
**Stories reviewed:** Pre-story technical intent for issue #1167
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** Verified feasible in the existing Node/TypeScript engine. Filesystem exclusivity and atomic rename can be implemented without a hosted dependency; the precise lease primitive remains an implementation detail constrained by the ADR.
- **Prerequisites:** No database, account, network service, or schema migration is required. Existing JSON must remain readable.
- **Integration surface:** High. `state.ts`, the conductor loop, finish-record, daemon/recovery CLIs, state helpers, and tests all touch the persistence boundary.
- **Data implications:** The JSON schema remains backward compatible. Write semantics change from whole-object replacement to explicit mutation, with privileged replacement for reset.
- **Performance:** One read and atomic replacement per mutation under a local lease. This is expected to be negligible beside step execution, but contention and bounded wait behavior require tests.
- **Worktree isolation:** Each feature worktree owns its `.pipeline/conduct-state.json` and lease, so independent worktrees do not contend. Tests must use unique temporary roots and no real daemon or third-party calls.

## Complexity

High/Large: core control-flow state, cross-process concurrency, broad caller migration, explicit conflict semantics, and reset compatibility. The hosted service is excluded.

## Alignment

- Aligns with the repository principle that correctness is enforced mechanically at the mutation boundary.
- Preserves the flat JSON read contract required by the conductor rewrite and parallel-workflow ADRs.
- Extends the finish-record primitive's field ownership into a general state authority rather than retaining the field-specific `pr_url` exception.
- Does not assign generic precedence to step statuses; intentional invalidation remains representable.
- Creates the adapter seam requested for a future authoritative service without introducing production in-memory state.

## Domain Integrity

- Mutations, intents, conflicts, and outcomes require semantic types and exhaustive matching.
- Reset/replace is a distinct operation, so omission cannot accidentally mean deletion.
- Conflict resolution is a closed field-specific policy; there is no catch-all last-writer-wins branch.
- Atomic batches are restricted to named invariants rather than arbitrary whole-state rewrites.

## Wiring Surface

- `ConductStateStore` port: injected into the conductor and production CLI composition roots that currently call state helpers.
- Filesystem state-store adapter: the default production adapter for local/open-source execution; owns lease, read-under-lease, conflict evaluation, and atomic persistence.
- State mutation/result domain types: consumed by conductor transitions, finish-record, daemon/recovery commands, and state helper functions.
- Explicit replace/reset operation: called only from `--reset` and interactive start-over composition paths.
- Conflict diagnostics: emitted through each caller's existing logger/error surface and propagated as typed failures; no silent catch converts a conflict to success.
- Bypass audit: deterministic test/static inventory proves production modules do not directly write `conduct-state.json` outside the adapter.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| One direct writer remains and bypasses serialization | Data | Medium | High | Inventory all production writes and add a deterministic bypass audit. |
| Lease owner dies and blocks future writes | Technical | Medium | High | Bounded acquisition, owner metadata, conservative stale recovery, and fail-closed diagnostics. |
| Lease recovery permits two live owners | Data | Low | High | Recover only with deterministic proof; otherwise refuse and surface operator action. |
| Generic status precedence preserves inaccurate state | Data | Medium | High | No generic ordering; exhaustive field-specific rules only. |
| Multi-field transition becomes partially visible | Data | Medium | High | Atomic mutation batch for named invariants such as step status with `last_step`. |
| Reset becomes unable to clear preserved values | Integration | Low | High | Separate privileged replace operation with reset/start-over acceptance coverage. |
| Local adapter is mistaken for multi-host authority | Architecture | Medium | Medium | Document the single-host boundary and require the hosted adapter for multi-host deployment. |

## ADRs Created

- `adr-2026-08-01-conduct-state-mutation-port` — APPROVED by the operator on 2026-08-01.

## Conditions

1. Every production writer must route through the port; a deterministic bypass audit is mandatory.
2. Lease recovery must fail closed unless exclusive ownership can be proven.
3. Conflict logs must name fields and dispositions without leaking sensitive values.
4. Atomic batches are limited to explicit multi-field invariants; arbitrary whole-state save is not exposed.
5. The hosted service and network protocol remain out of scope.

## Blocking Issues

None after ADR approval.
