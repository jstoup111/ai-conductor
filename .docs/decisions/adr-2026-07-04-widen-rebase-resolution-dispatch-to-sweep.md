# ADR: Widen the Rebase-Resolution Dispatch Exception to the Mergeable Sweep

**Status:** APPROVED
**Date:** 2026-07-04
**Amends:** adr-2026-06-29-rebase-conflict-resolution-dispatch
**Related:** adr-001-rebase-insertion-mechanism, adr-2026-07-03-post-rebase-force-with-lease

## Context

adr-2026-06-29-rebase-conflict-resolution-dispatch narrowed ADR-001's engine-native rule with
exactly one sanctioned prompt-dispatch site: the `conflict_halt` sub-path of `runRebaseStep`
(finish time, before a PR first opens). Intake #247 extends conflict resolution to PRs that are
**already open**: the mergeable sweep detects a watched PR gone CONFLICTING and must be able to
run the same bounded resolution.

## Options

- **A. Re-dispatch the whole feature through the daemon loop** — heavyweight; re-runs build
  machinery to fix a merge conflict; conflates "conflicting PR" with "failed build".
- **B. Second sanctioned call site for the existing sub-loop (chosen)** — the sweep's
  CONFLICTING path invokes the same `resolveRebaseConflicts` loop (same cap from
  resolved-config, same short-circuit, same FR-8/FR-9 acceptance guards) inside a dedicated
  resolution worktree, preceded by the deterministic Tier 1 resolvers.
- **C. New independent resolution engine for open PRs** — duplicates a tested, guarded loop;
  two policies to keep in sync.

## Decision

Option B. The dispatch exception now has **two** sanctioned call sites — `runRebaseStep`
(finish time) and the mergeable sweep's CONFLICTING path — and no others. Everything around
the prompt stays engine-native: detection (GitHub merge state via `prMergeState`), the
deterministic Tier 1 resolvers (CHANGELOG re-append — existing; `.docs` keep-both — new,
scoped strictly to `.docs/` paths), the acceptance guards, the suite gate, and the
lease-protected push. Tier 2 dispatch fires only when Tier 1 leaves conflicts, bounded by the
same configured cap (default 3).

## Consequences

- One resolution policy, two entry points; fixes and strategy improvements apply to both.
- ADR-001's principle survives: prompts resolve conflicts, engines decide everything else.
- The sweep gains a minutes-scale work item; bounded to one resolution per tick, after the
  label pass (review Condition 3).
- Any future third dispatch site requires another amending ADR.
