# Architecture Review: Multi-operator ownership — Slice B (authoring-side)
**Date:** 2026-07-02
**Mode:** Lightweight (Tier M) — Sections 2 (Feasibility) + 4 (Alignment)
**Inputs reviewed:** track + complexity markers, Slice B architecture diagram + sequence,
parent plan Slice B section, parent Stories 4–5, governing ADR
`adr-2026-07-01-machine-scoped-operator-identity` (APPROVED, PR #183)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **B2 gate placement is a small, safe change.** Post-#185 `landSpec`
  (`engineer/land-spec.ts`) already resolves the identity chain (~L275,
  `resolveDaemonOwner`) BEFORE `writeIntakeMarker`, `git add .docs`, and the commit. The
  gate is a flip from `specOwner = null` (stamp un-owned) to a loud throw. No reordering
  needed; every write already sits downstream of the resolution point.
- **Entry-point rewiring is mechanical.** `engineer-cli.ts` (~L591) and
  `engineer/loop.ts` (~L542) both compute `ownerConfig` from
  `loadConfig(target.canonicalPath)` with `ok ? config : {}`. Replacing that with
  `readMachineOwnerConfig()` (`owner-gate/machine-identity.ts`, merged in Slice A) is a
  drop-in: it returns the same `OwnerConfig` shape consumed by `resolveDaemonOwner`.
- **B1 is net-new, and the convergence point is identified.** The plain `/conduct`
  DECIDE path has NO marker writer today — `artifacts.ts` only *parses* markers, and the
  #189/#190 fix was a manual backfill, which is the live evidence of this gap. The
  daemon's discovery unit is the **plan stem** on the base branch
  (`daemon-backlog.ts` L312, L352–354: marker read at `.docs/intake/<plan-stem>.md`).
  Therefore B1 must hook the conductor's DECIDE tail where the plan artifact is
  finalized, and write the marker **keyed by the plan stem**, reusing
  `engineer/intake-marker.ts#writeIntakeMarker` (single writer — no second
  implementation).
- **No new packages, services, ports, schema, or infra.** Worktree-parallel safe.

## Alignment

- **Parent ADR (D3/D4) is implemented, not amended.** Identity stays machine-sourced
  (user config → gh → unresolved) behind the existing `resolveDaemonOwner` seam; the
  future PlatformIdentity (EKS/OIDC) resolver slot is untouched. No new decision
  category is opened — **no new ADR required**.
- **Post-#185 re-anchoring of Story 4 (parent) is REQUIRED.** Parent Story 4 says a
  refused land creates "no `spec/<slug>` branch". Post-#185, the `spec/«slug»` branch is
  created by **worktree creation** (`worktree-authoring.ts`), *before* DECIDE runs — the
  land gate cannot un-create it. The correct post-#185 contract: refusal creates **no
  commit, no intake marker, no staged artifacts**; the worktree (and its empty branch)
  is retained per FR-6 keep-on-failure for inspection. Slice B stories MUST state this
  explicitly rather than inherit the stale wording.
- **Interim tests are contract locks and must be rewritten, not appended to.** The two
  "does NOT honor a project-config spec_owner" tests
  (`engineer-cli-land-owner.test.ts`, `loop.test.ts`) assert the interim
  swallow-to-gh-fallback behavior. Keeping them alongside new tests would freeze a
  contradiction; they are replaced by final-contract assertions.
- **`?? {}` default in `landSpec` remains but changes meaning.** After B2, an
  uninjected/empty `ownerConfig` no longer silently degrades to un-owned — unresolved
  identity throws. All callers must pass the machine chain; the injectable seam is
  preserved for tests.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Operator with no user `spec_owner` AND no gh auth can no longer land at all | Technical | Medium | Medium | Intended fail-closed; error message must name the exact fix (add `spec_owner` to `~/.ai-conductor/config.yml` or `gh auth login`) |
| Full DECIDE authoring wasted before land-time refusal | Technical | Medium | Low | Fail-fast identity check at entry points (loop/CLI start) IN ADDITION to the landSpec gate — the gate is the enforcement, the early check is UX |
| B1 stamps under the wrong key (idea slug vs plan stem) → daemon sees un-owned spec | Integration | Low | High | Contract test: marker path equals `.docs/intake/<plan-stem>.md` for the exact plan filename the daemon discovers |

## ADRs Created

None. All decisions trace to `adr-2026-07-01-machine-scoped-operator-identity`
(APPROVED). The Story-4 re-anchoring is a reconciliation with the post-#185 approved
architecture (engineer-worktree-isolation), not a new decision.

## Conditions

1. **Stories must re-anchor the B2 refusal contract post-#185:** refusal = no commit /
   no marker / no staged artifacts; pre-existing worktree branch retained
   (keep-on-failure), never a "no branch created" claim.
2. **B1 marker is keyed by plan stem** (the daemon's discovery unit) and written via the
   existing `writeIntakeMarker` — no parallel writer.
3. **Refusal error is actionable** — names both remediation paths (user-config
   `spec_owner`, `gh auth login`).
4. **The two interim tests are rewritten** to the final contract (user-config sourced
   identity; unresolved → refuse with no writes), not left alongside new tests.
5. **Fail-fast identity check at the loop/CLI entry** (advisory UX), with `landSpec`
   remaining the enforcement point.
