# Architecture Review: Dependency-Ordered Intake and Dispatch

**Date:** 2026-07-03
**Mode:** lightweight (tier M) — pre-stories full pass
**Inputs reviewed:** PRD `.docs/specs/2026-07-03-dependency-ordered-intake-and-dispatch.md`
(FR-1…FR-12), diagrams `.docs/architecture/dependency-ordered-intake-and-dispatch.md`
**Verdict:** APPROVED

## Feasibility

- **External API (the load-bearing unknown): VERIFIED by live probe on this repo (2026-07-03,
  gh 2.87.3).** Read: `GET repos/jstoup111/ai-conductor/issues/229/dependencies/blocked_by` →
  200, JSON array. Write: bodyless `POST` to the same path → 422 validation error citing
  `rest/issues/issue-dependencies#add-a-dependency-an-issue-is-blocked-by` (endpoint exists;
  probe mutated nothing). GitHub's native issue-dependencies surface works on a personal repo
  via `gh api`. Pinned in adr-2026-07-03-issue-dependencies-api-surface.
- **Stack:** no new packages, services, or infra. All new code sits behind the existing `gh`
  CLI boundary, in the existing conductor TypeScript tree, following existing seam patterns
  (IntakeSource/OwnerGate precedents).
- **Insertion points confirmed in source:** `discoverBacklog` gauntlet (owner-gate block as
  the pattern), `scanInheritedState`/`renderDashboard` groups, intake ledger/queue claim path,
  `parseSourceRef`/intake-marker provenance — all mapped with line-level evidence during
  explore.
- **Prerequisites:** none beyond merge; migration is operator-invoked post-ship.
- **Data implications:** none — no schema, no new persisted state (per-scan cache is
  in-memory; deliberate, see adr-2026-07-03-dependency-fail-closed-and-cache).
- **Performance:** one REST call per Source-Ref'd, otherwise-eligible spec per scan, memoized
  per pass; 5000 req/hr authenticated ceiling vs single-digit gated specs — ample headroom.
- **Worktree isolation:** no ports, DBs, or shared files; feature is safe for parallel
  worktrees.

## Alignment

- **Boundary discipline:** only the resolver (and migration) talk to GitHub, matching the
  "adapter is the only component that talks to GitHub" invariant from the intake subsystem
  (adr-009/011 lineage). Daemon core and intake core consume the shared `BlockerResolver`
  seam.
- **Gate pattern consistency:** DependencyGate mirrors the owner-gate's gauntlet placement
  (after content filters; here, after owner-gate too — cheapest-first). Divergence from the
  owner gate's fail-open posture is deliberate and documented
  (adr-2026-07-03-dependency-fail-closed-and-cache) — not silent drift.
- **#208 gap-class:** the waiting-items channel is a structural fix (structured reasons
  through the existing `discover()` call graph), shaped so owner-gate visibility (#208) can
  adopt it later. Not a side-channel file (rejected explicitly).
- **#200 concurrency (checked):** an active sibling worktree
  (`spec/priority-list-for-daemon-execution-of-features-iss`) is authoring the #200 priority
  spec today. Composition holds by construction: this feature *filters* the backlog before
  `pickEligible`; priority *reorders* surviving items. Both may touch `pickEligible`/
  `discoverBacklog` signatures → mechanical merge conflict risk, flagged for
  `/conflict-check` to examine that spec branch directly.
- **State modeling:** waiting reasons are a closed union (blocked-by / indeterminate / cycle),
  not booleans; every spec appears in exactly one dashboard bucket (explicit precedence).
- **Security:** no new inputs beyond issue bodies already consumed by intake; migration writes
  require the operator's existing `gh` auth and explicit confirmation.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Wrong auto-created link enforces wrong build order | Data | Low | High | Two-confidence-class parser; heuristic edges human-confirmed; dry-run before write (adr-…-prose-to-link-migration) |
| GitHub outage stalls intake-originated specs | Integration | Medium | Medium | Fail-closed is visible (WAITING + reason); non-Source-Ref specs unaffected (FR-3) |
| `discoverBacklog` return-shape change collides with concurrent #200 spec | Technical | Medium | Medium | conflict-check reads the #200 spec branch; channel design is additive (widen, don't replace) |
| Issue-dependencies API availability regression (newer GH surface) | Integration | Low | Medium | Degrades to indeterminate/fail-closed, never wrong-order builds |
| Warn-once state-change keying spams or under-reports | Technical | Low | Low | Keyed on (slug, reason/blocker-set); dashboard is the continuous surface |

## ADRs Created (all DRAFT → require operator approval)

1. adr-2026-07-03-issue-dependencies-api-surface — REST blocked_by read/write via `gh api`;
   cross-repo = enforce-as-returned, migration writes same-repo only
2. adr-2026-07-03-dependency-gate-backlog-waiting-channel — gate last in gauntlet; discovery
   result widened with structured waiting entries; WAITING dashboard group
3. adr-2026-07-03-dependency-fail-closed-and-cache — fail-closed indeterminate (documented
   inversion of owner-gate precedent); per-scan memoization, no persistent cache
4. adr-2026-07-03-prose-to-link-migration — two confidence classes, dry-run + confirm,
   GET-before-POST idempotent, additive-only

## Conditions

None beyond ADR approval (hard gate: no DRAFT ADR may survive into land).
