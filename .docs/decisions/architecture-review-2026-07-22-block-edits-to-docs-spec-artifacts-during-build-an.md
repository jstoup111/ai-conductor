# Architecture Review: Phase-Scoped .docs Write-Guard (#788)
**Date:** 2026-07-22
**Stories reviewed:** none yet — pre-stories review (adr-2026-06-29-architecture-before-stories-convergent-kickback); input = explore output + technical intent
**Mode:** Lightweight (tier M): §2 Feasibility + §4 Alignment + Wiring Surface
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** Pure additions to existing surfaces — TS engine code
  (marker lifecycle, allowlist table), one bash hook script const, settings merges.
  No new packages, services, or infrastructure. PASS.
- **Prerequisites:** None at runtime. Ship-time prerequisite: CHANGELOG `## Migration`
  block (hook wiring is a canonical breaking surface per release gates). PASS.
- **Integration surface:** conductor step dispatch (`conductor.ts` — same try/finally
  as `build-step-active` at ~2954/3010), `session-hook-assets.ts`,
  `worktree-prepare.ts`, `bin/install`, `steps.ts` (read-only: per-step `phase` field
  already exists — verified). Four write-touched modules; within tier-M bounds. PASS.
- **Data implications:** None — one gitignored marker file; no schema, no migrations.
- **Performance:** Hook adds one file-existence check per write-tool call when no step
  is active (exit 0 fast path); prefix comparisons in bash when active. Negligible.
- **Worktree isolation:** Marker is per-worktree under `.pipeline/` (gitignored);
  parallel worktrees cannot interact. Primary-checkout wiring is settings-level and
  inert without a marker. PASS.

## Alignment

- **Design principle ("deterministic where possible"):** the guard is machinery at the
  point of violation, replacing prompt discipline — directly implements the CLAUDE.md
  principle. PASS.
- **Pattern consistency:** mirrors the established marker+hook idiom (attribution
  seam); hook exported from `session-hook-assets.ts`, provisioned by
  `worktree-prepare.ts`, primary wiring via `bin/install` — all existing patterns.
  New pattern content (path-scoped gating) is captured in the ADR below. PASS.
- **Orthogonality to attribution machinery:** separate marker, separate hook script,
  separate settings entry. Checked against the unmerged
  `spec/demote-task-stamping-from-gate-to-telemetry` branch: it targets evidence-ledger
  gating (`noEvidenceAttempts`, task-status), not `MUTATION_GATE_HOOK` /
  `build-step-active` — no structural conflict. The own-settings-entry requirement
  keeps docs-guard robust even if that spec later removes the mutation gate. PASS.
- **State management:** marker presence = guard active; content carries step/phase/
  allowlist. Invalid state (marker for a DECIDE step) is unrepresentable by
  construction — the writer only fires when `step.phase ∈ {BUILD, SHIP}`, and
  clear-on-every-step-entry corrects leaked markers deterministically. PASS.
- **Security boundaries:** n/a (no endpoints, no user input beyond file paths already
  mediated by the harness).
- **Diagram accuracy:** components + sequence diagrams for this feature exist at
  `.docs/architecture/block-edits-to-docs-spec-artifacts-during-build-an.md` and
  `.docs/architecture/sequences/` (same stem), parse-checked and operator-approved.

## Wiring Surface (design-time commitments)

| New surface | Will be invoked from |
|---|---|
| `phase-active` marker write/clear (new fns, `attribution-enforcement.ts`-adjacent module or sibling) | Conductor step dispatch loop — marker write beside the existing `writeBuildStepMarker` call site (~`conductor.ts:2954`), clear in the same `finally` (~`conductor.ts:3010`); clear-on-entry at the top of every step dispatch |
| Allowlist table (typed const, engine) | Read by the conductor at BUILD/SHIP step entry when composing marker content |
| `DOCS_GUARD_HOOK` / `docs-guard.sh` (new export, `session-hook-assets.ts`) | Written to `.pipeline/session-hooks/` and wired into `.claude/settings.local.json` by `worktree-prepare.ts` `writeSessionHooks`/`mergeHookEntry` (daemon worktrees); merged into primary-checkout settings by `bin/install` harness_hooks (matcher `Edit\|Write\|NotebookEdit`, own entry) |
| CHANGELOG `## Migration` block | Executed by `bin/migrate` when consumers update past this version |

**Early overlap scan:** run over the surface files. Result: hub-file noise
(`conductor.ts`, `session-hook-assets.ts` overlap with ~every open spec branch — the
endemic pattern, not a signal). The one semantically-adjacent branch
(demote-task-stamping) was inspected directly: spec-only, no mutation-gate removal, no
conflict. Advisory only; does not block.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Leaked marker after hard crash freezes `.docs` authoring in a primary checkout until a conduct run | Technical | Low | Medium | Clear-on-every-step-entry; hook rejection names the marker, writing step, and manual remedy |
| Future legitimate SHIP writer false-blocked until allowlisted | Technical | Medium | Low | Fail-closed by intent; clear reason points at the allowlist table |
| Install-time hook copy drifts from the TS const | Technical | Medium | Medium | Single-source requirement in ADR; mechanism (generated + drift check, or `conduct-ts` emit) fixed in /plan; integrity-suite check |
| New file-mutation tool added to harness escapes matcher | Technical | Low | Medium | Documented maintenance note beside the matcher (same posture as existing gates) |
| Settings merge in `bin/install` collides with user-customized settings | Integration | Low | Medium | Existing idempotent merge pattern; migration block runs it explicitly |

No High-impact risks registered.

## ADRs Created

- `adr-2026-07-22-phase-scoped-docs-write-guard` — Status: APPROVED (operator approved
  the design decision in-chat during this DECIDE session; standing approval for the
  chain granted, no conflict found).

## Conditions

None — clean APPROVED.
