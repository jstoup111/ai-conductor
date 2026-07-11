# Architecture Review: Inline Build-Work Attribution Enforcement (#505)
**Date:** 2026-07-10
**Mode:** Lightweight (tier M) — Technical Feasibility + Architectural Alignment
**Input reviewed:** intake jstoup111/ai-conductor#505, operator-approved A+B+net approach
(.memory/decisions/2026-07-10-inline-commit-attribution-enforcement.md), architecture
diagrams (.docs/architecture/inline-build-work-commits-unattributed-session-hoo.md)
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | All surfaces extend existing engine assets: `git-hook-assets.ts` (A), `session-hook-assets.ts` + `wireSessionHookSettings` (B), conductor build-step seam (net). No new deps, services, or infrastructure. |
| Prerequisites | One additive config key (`attribution_enforcement_cutover`, `owner_gate_cutover` validation pattern). Engine marker file `.pipeline/build-step-active` written/removed at the existing `step.name === 'build'` seam (conductor.ts:818/:1494). |
| Integration surface | Contained to the attribution seam (git hooks, session hooks, build gate ledger). No cross-domain reach. |
| Data implications | None — no schema; two new gitignored `.pipeline/` sentinels (marker, dispatch-count). |
| Performance risk | Hook-time checks are file-existence + `git interpret-trailers` — negligible. |
| Worktree isolation | Marker and sentinels are per-worktree under `.pipeline/`; no shared state; parallel worktrees unaffected. |

**Load-bearing assumptions — all adjudicated (see ADR evidence ledger):** the previously
unverified one (PreToolUse mutation-tool matcher fires + blocks in headless sessions) was
**verified by a live probe this session** (`probe.log`: `PROBE-FIRED tool=Write`; write
blocked; message surfaced). Build-step seam and merge-commit detection verified by source
read. No unconfirmed load-bearing assumption remains.

## Alignment

- **Deterministic-first (CLAUDE.md):** replaces failing SKILL prose with machinery that
  rejects at the moment of violation — the exact precedent pattern (#426, #433, #477).
- **Merged-ADR consistency:** abstain-not-misstamp governs stamping and is preserved —
  A/B reject, never guess an id; the evidence gate remains sole completion authority;
  fail-open provisioning retained; #485 stays separate (documented in the ADR).
- **Pattern consistency:** embedded pure-bash engine assets (no dist/stale-engine risk,
  #403 class), merge-preserving settings wiring, cutover-flag validation — all existing
  patterns reused, no novel pattern without an ADR.
- **State management:** activation is a single engine-owned marker with `finally`-scoped
  removal; invalid states (enforcement active outside a build step) are unrepresentable
  because only the build-step spawn path writes the marker.
- **Security boundaries:** no new inputs or endpoints; hooks read engine-owned files.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Marker leaks (not removed on crash) → enforcement active in a later non-build session | Technical | Low | Medium | `finally`-scoped removal + `seedTaskStatus`-style defensive clear at step entry; stories cover the leak path |
| Mis-scoped predicate blocks a legitimate flow (/rebase, remediation, plan authoring) | Technical | Low | High | Marker written ONLY around `step.name === 'build'`; adversarial stories per exempt flow; cutover flag allows instant disable |
| Bash `git commit` string matching misses exotic quoting | Technical | Medium | Low | Best-effort by design; A backstops all hook-honoring commits; gate remains final authority |
| Consumer update surprise (new blocking hook) | Integration | Medium | Medium | Cutover flag defaults OFF (absent = advisory today); Migration block documents opt-in |

## ADRs Created

- `adr-2026-07-10-inline-work-attribution-enforcement.md` — presented to operator and
  **APPROVED** 2026-07-10.

## Conditions

None beyond the ADR's follow-up actions (negative-path story matrix, real-session probe
test shipping with the feature, CHANGELOG Migration block).
