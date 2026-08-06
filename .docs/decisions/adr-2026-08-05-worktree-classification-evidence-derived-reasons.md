# ADR: Worktree dashboard classification and reasons are evidence-derived, never asserted

**Date:** 2026-08-05
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop (#1329)

## Context

`scanInheritedState` in `src/conductor/src/engine/daemon-dashboard.ts` classifies every
directory under `.worktrees/` for the startup dashboard and `conduct daemon status`. Two
different branches — a slug present in the processed ledger (`:437`) and a worktree that has
never written `.pipeline/conduct-state.json` (`:443`) — push the SAME hardcoded
`reason: 'pr-open-awaiting-main'`. No PR lookup happens anywhere in the scan, so the reason
is unfalsifiable by construction.

Observed consequence (#1329, `reporting_app`): six retained rows all claimed a PR was
awaiting main; none had an open PR, and two had never pushed a branch at all. One of them,
`v4-latest-endpoint`, had zero commits against `origin/main` — there was no ship for a PR to
await. An operator reading that dashboard concludes the feature is finished rather than
never-started.

Forces:

- The dashboard is **observational** — `daemon-dashboard.ts` is imported only by
  `daemon-cli.ts`, and dispatch (`pickEligible` over `discoverBacklog().items`) never reads
  the retained classification. So this is a truthfulness problem, not a dispatch mechanism.
  (Verified by import trace, ~95% confidence.)
- `daemon status` is an operator's first diagnostic. Making it depend on network reachability
  would mean an offline or rate-limited operator gets no dashboard at all.
- The processed ledger already stores `prUrl` per shipped slug (`readProcessedEntries`,
  `daemon-dashboard.ts:211-235`), so strong local evidence for the shipped case already
  exists on disk.

## Options Considered

### Option A: Keep one boolean, fix the label wording
- **Pros:** Smallest diff.
- **Cons:** Does not distinguish never-started from shipped-and-reaped — the two cases that
  a single `present` boolean conflates. The operator still cannot tell which lever applies.

### Option B: Look up PR state over the network for every retained row
- **Pros:** Always-accurate reason.
- **Cons:** Makes `daemon status` network-dependent and O(worktrees) `gh` calls per render;
  a rate-limited or offline daemon renders no dashboard, or renders slowly at exactly the
  moment an operator is debugging.

### Option C: Derive from on-disk evidence, with an optional probe that degrades to unknown
- **Pros:** Fully local in the common case (ledger `prUrl` + worktree contents already say
  which case applies); a PR-state probe may refine the reason when a seam is injected and
  reachable; a failed or absent probe yields an explicitly unknown reason, never a positive
  claim. Offline `daemon status` keeps working.
- **Cons:** Some rows report `pr-state-unknown` rather than a definite reason; two code
  paths (with/without probe) to test.

## Decision

**Option C.** Classification and reason are derived from evidence, and no reason may assert
a fact the scan has not established.

Concretely:

1. A worktree that has never written `.pipeline/conduct-state.json` is its own presentation
   bucket, reported distinctly from a retained ship, and is **not** excluded from ELIGIBLE.
2. A retained row's reason is derived: the processed ledger's stored `prUrl` establishes that
   a ship happened; an injected PR-state probe may refine it to open/closed. With no `prUrl`
   and no successful probe the reason is an explicit unknown — never `pr-open-awaiting-main`.
3. A row may state that a PR is awaiting main **only** when an open PR for that slug has been
   established. Absence of evidence renders as unknown, not as a claim.
4. The PR-state probe is injected (the same `gh` seam pattern `daemon-cli` already uses for
   `tracker.getIssueState`), so unit tests exercise both the probe-present and probe-absent
   paths with no network.

## Consequences

### Positive
- The dashboard stops asserting a merge is pending when no PR exists.
- Never-started and shipped-and-reaped become distinguishable at a glance.
- `daemon status` remains fully functional offline.

### Negative
- Rows can read `pr-state-unknown`, which is less satisfying than a definite reason — this is
  deliberate: an honest unknown beats a confident falsehood.
- The scan grows an optional dependency, so its test matrix doubles for the retained branch.

### Follow-up Actions
- [ ] Split the never-started case out of `retainedWorktrees` in `scanInheritedState`.
- [ ] Derive the retained reason from ledger `prUrl` + optional probe.
- [ ] Keep the ELIGIBLE exclusion for genuinely shipped-and-retained slugs (negative path).
