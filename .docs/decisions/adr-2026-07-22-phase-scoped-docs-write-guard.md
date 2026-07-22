# ADR: Phase-scoped .docs write-guard — separate marker, engine-resolved allowlist, dumb hook

**Date:** 2026-07-22
**Status:** APPROVED
**Deciders:** James Stoup (operator, in-chat approval during engineer DECIDE for #788)

## Context

`.docs/` holds the approved DECIDE-phase spec artifacts — the spec-as-contract the daemon
builds against. Nothing mechanically prevents a BUILD or SHIP session from rewriting a
plan, story, PRD, or ADR to match its own output. The existing session mutation gate
(`MUTATION_GATE_HOOK`, `session-hook-assets.ts`) keys on attribution (the
`.pipeline/current-task` stamp under `.pipeline/build-step-active`), never on paths; the
`build-step-active` marker is written only for the single `build` step
(`conductor.ts` step dispatch, guarded by `step.name === 'build'`). Verified claims:

- Remediate's plan append runs in the conductor's own Node process
  (`conductor.ts:1205` → `appendRemediationTasks`) — a PreToolUse hook never sees it.
  (verified, 100%)
- `conduct-ts shipped-record` writes `.docs/shipped/` via Bash from the finish session —
  outside the write-tool surface. (verified, 100%)
- Non-daemon retro sessions legitimately write `.docs/retros/` and may create
  `.docs/stories/` (skills/retro/SKILL.md:114,151); daemon retros route narratives to the
  engineer store instead (daemon-runner.ts:88). (verified, 100%)
- Session hooks are wired per-worktree by `worktree-prepare.ts` into
  `.claude/settings.local.json`; primary checkouts get harness PreToolUse hooks via
  `bin/install`'s settings merge. (verified, 100%)

Constraints: write-surface-only scope (Edit|Write|NotebookEdit) was explicitly accepted
by the operator — Bash-mediated writes are out of scope, matching the attribution gate's
posture. The attribution gate must remain untouched.

## Options Considered

### Option A: Extend MUTATION_GATE_HOOK and broaden build-step-active
- **Pros:** One hook, one marker, smallest diff.
- **Cons:** The marker means "attribution stamps required"; writing it for all 12
  BUILD/SHIP steps forces stamp enforcement onto steps whose skills produce no stamps —
  they would break. Overloading one marker with two meanings makes both guards harder to
  reason about.

### Option B: Separate phase marker + sibling hook, engine-table allowlist (CHOSEN)
- **Pros:** Single meaning per marker; docs-guard testable in isolation; a bug cannot
  regress attribution gating; mirrors the proven marker+hook idiom.
- **Cons:** Second marker lifecycle and second hook script to maintain.

### Option C: Phase-scoped permission deny rules injected into .claude/settings.json
- **Pros:** Declarative, no hook code.
- **Cons:** Settings churn at every step boundary; crash leaves deny rules stuck in
  shared config; generic denial gives the blocked agent no reason/redirect (the pattern
  that historically causes destructive retries).

### Option B′ (deferred): allowlist declared in skill frontmatter
- Elegant, but today's allowlist has exactly one entry; a YAML resolver + integrity rule
  is not yet justified. Promoting the engine table to frontmatter later is non-breaking:
  the marker format and hook do not change. Deferred, documented here.

## Decision

Option B, with these specifics:

1. **Marker:** `.pipeline/phase-active`, written by the conductor step dispatch loop for
   any step whose `steps.ts` `phase ∈ {BUILD, SHIP}` — keyed off `step.phase`, never
   step names, so future steps inherit the guard automatically. Cleared in the same
   `finally` that clears `build-step-active` (`conductor.ts` ~3010). Content: step name,
   phase, ISO timestamp, and the resolved allowed `.docs/` prefixes — line-oriented so
   bash reads it without a JSON parser.
2. **Stale handling — clear-on-every-step-entry:** every step entry (any phase)
   rewrites-or-removes the marker before dispatch, so a marker leaked by a crashed run
   is corrected by the next conduct invocation deterministically. No age/PID
   heuristics. The residual case (crash, then manual authoring with no conduct run) is
   handled by the hook's self-describing rejection: it names the writing step, the
   marker path, and the manual remedy (`rm .pipeline/phase-active` when no build is
   running).
3. **Allowlist:** a typed engine-side constant table with two parts, both resolved into
   the marker at step entry: (a) per-step prefixes — today exactly
   `retro → [.docs/retros/, .docs/stories/]`; (b) ALWAYS-ALLOWED prefixes active during
   any BUILD/SHIP step — today exactly `[.docs/release-waivers/]`. Waivers are a
   ship-time compliance artifact that MUST land inside the feature's own diff
   (fail-closed freshness, adr-2026-07-06-migration-gate-waiver) and are authored by the
   implementing BUILD session; they are self-host-only and cannot express spec drift.
   (Amended 2026-07-22 during this spec's conflict-check, operator resolution — see
   .docs/conflicts/block-edits-to-docs-spec-artifacts-during-build-an.md.) Default-deny
   for every other `.docs/` path during BUILD/SHIP.
4. **Hook:** `DOCS_GUARD_HOOK` (`docs-guard.sh`) exported from `session-hook-assets.ts`
   as a sibling of `MUTATION_GATE_HOOK`, matcher `Edit|Write|NotebookEdit`, its OWN
   settings entry (never chained to the mutation gate's entry, so either can be removed
   independently). Marker absent → exit 0. Marker present and target under `.docs/` and
   not prefix-allowed → exit 2 with reason + redirect. Non-`.docs/` targets always pass.
5. **Wiring:** (a) `worktree-prepare.ts` writes + wires the hook in daemon worktrees;
   (b) `bin/install` merges the same hook into primary-checkout settings (scope 2,
   closes the manual-conduct gap), shipped with a CHANGELOG `## Migration` block —
   hook-wiring is a canonical breaking surface. The hook must have a SINGLE source of
   truth (the TS const); the install-time copy is obtained from it (mechanism decided in
   /plan: generated file with drift check, or `conduct-ts` emit) — never two
   hand-maintained copies.
6. **Bypasses (by design):** engine-process writers (`appendRemediationTasks`) and
   Bash CLI writers (`shipped-record`) are outside the write surface — the accepted
   scope. DECIDE/UNDERSTAND/SETUP steps write no marker, so authoring is unaffected.

## Consequences

### Positive
- Spec drift during BUILD/SHIP fails at the point of the edit with an actionable reason.
- New `.docs/` subdirectories are protected automatically (prefix default-deny).
- New BUILD/SHIP steps are covered automatically (phase-keyed marker).
- Attribution machinery untouched; either guard can evolve or be removed independently
  (relevant: the pending demote-task-stamping spec touches evidence gating).

### Negative
- Bash-mediated `.docs` writes remain unblocked (accepted write-surface-only scope).
- A future legitimate `.docs` writer is blocked until its allowlist entry lands —
  fail-closed by intent, but it is a real friction point.
- Adding a new file-mutation tool to the harness requires extending the hook matcher
  (same maintenance property as the existing gates).
- One more marker lifecycle to keep correct across crash/resume paths.

### Follow-up Actions
- [ ] Implement marker write/clear in the conductor step dispatch loop (phase-keyed)
- [ ] Implement `DOCS_GUARD_HOOK` in `session-hook-assets.ts` + worktree-prepare wiring
- [ ] Wire into `bin/install` harness hooks + CHANGELOG migration block
- [ ] Single-source mechanism for the install-time hook copy (decided in /plan)
- [ ] Consider B′ (frontmatter-declared allowlist) if the writer set grows past ~3
