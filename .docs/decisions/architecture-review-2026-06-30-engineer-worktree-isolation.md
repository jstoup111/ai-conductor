# Architecture Review: Engineer Worktree Isolation

**Date:** 2026-06-30
**Tier:** L (full review)
**Inputs:** spec `2026-06-30-engineer-worktree-isolation.md`, stories
`engineer-worktree-isolation.md`, conflict-check `2026-06-30-engineer-worktree-isolation.md`,
diagram `architecture/2026-06-30-engineer-worktree-isolation.md`.
**Verdict:** APPROVED — feasible and architecturally aligned, contingent on the ADR amendment
below (now written) and the two coordination requirements from conflict-check.

## Feasibility

- **The mechanism already exists.** `daemon-deps.ts:createWorktree` (lines ~58–95) implements
  `git worktree add -b`, the leftover-branch/detached-worktree reconciliation (FR-11), and
  `git worktree remove --force`. The engineer reuses this — low implementation risk, high parity.
- **The seam is narrow.** `landSpec` (land-spec.ts:64,84,208,220,243) and `openSpecPr`
  (handoff.ts:161,208) hardcode `cwd: target.canonicalPath`. The change threads a `worktreePath`
  cwd while keeping `canonicalPath` as the registry anchor + AuthoringGuard root. The biggest
  deletion is `landSpec`'s `checkout -b … / checkout back` (208/243) — removed, not replaced.
- **Tier-aware guards unaffected.** The artifact/tier mismatch, stub, DRAFT, and DRAFT-ADR
  rejections in `landSpec` operate on `.docs/` under a root path; re-rooting that path at the
  worktree preserves them verbatim.

## Architectural alignment

- **ADR-008 governs this surface** and *documented this exact escalation* (Option B). The change is
  not a contradiction of an APPROVED ADR but the invocation of its sanctioned escalation — for a new
  force (same-repo concurrency) ADR-008 did not weigh. Ratified by
  `adr-2026-06-30-engineer-worktree-authoring-isolation.md` (APPROVED). ADR-008 remains APPROVED and
  gets a cross-reference note.
- **ADR-004's retained rule** (canonical-path resolution, no cwd fallback) and the **path-prefix
  guard** are kept and *strengthened* (a worktree adds a second confinement layer). FR-10 cross-repo
  isolation is reinforced, not weakened.
- **Boundary discipline preserved:** still no build, no merge, one idea per session, in-chat routing
  (ADR-005/ADR-008 boundaries untouched).

## Required coordination (from conflict-check) — folded into the plan

1. **ADR-008 amendment** — DONE (this review's companion ADR).
2. **Engineer-vs-daemon worktree naming must be disjoint** — the engineer worktree dir is
   `engineer`-scoped so a daemon worktree for the same repo cannot collide (the FR-8 scenario).

## Risks & mitigations

- **External-process contract (git).** Injected-runner argv tests can pass against wrong argv —
  require a **real-git smoke test** of the worktree lifecycle (injected-runner-needs-real-binary
  lesson). *In the plan.*
- **Alternate-branch side-effect (no-remote).** The no-remote fallback must still record the
  authored-ledger key (FR-4 negative path) — explicit story + test. *In the plan.*
- **Leftover worktree on retry (FR-11).** Covered by reusing the daemon helper's reconciliation; a
  dirty leftover must never silently land stale artifacts — explicit negative-path test.
- **Removal-orphans-branch.** Removing the worktree on success must leave `spec/<slug>` reachable,
  including the local-only no-remote commit (FR-5 negative path).

## Gate

PASS → proceed to `/plan`. No architectural blockers; the one decision change is ratified by an
APPROVED ADR, and the two coordination items are captured as plan tasks.
