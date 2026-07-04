# ADR: Harness daemon profile — build-to-PR on the harness repo, human merge

**Date:** 2026-07-03
**Status:** APPROVED
**Amended by:** adr-2026-07-03-daemon-auto-restart-stale-engine (narrow: gated stale-engine auto-restart at an idle boundary may also bring new code live, in addition to `bin/install`)
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#174

## Context

Historically the harness repo was kept out of the daemon registry by tribal rule ("JSA is
unregistered / won't auto-build"). The objections behind that rule have been re-evaluated
(issue #174) and are mitigated by machinery that has since shipped:

- **Live skills are safe** — `~/.claude/skills/*` symlinks point at main's `skills/`; a daemon
  build runs in an isolated worktree under a sandboxed throwaway `CLAUDE_CONFIG_DIR`
  (adr-2026-06-30-sandbox-build-isolation), so a self-build never mutates the live harness.
- **The running daemon is not swapped mid-build** — it executes the `dist/` loaded at start;
  new code goes live only on `bin/install`.
- **Serial daemon** — concurrency is clamped to 1; no self-collision.
- **HALT-based release gates** — version approval + integrity/CHANGELOG/migration gates run
  before any PR opens and fail closed (adr-2026-06-30-halt-based-release-gates).

The repo was daemon-registered on 2026-07-02 with a committed `.ai-conductor/config.yml`
(`owner_gate_cutover: 2026-07-02T11:00:00Z`). What remained unrecorded was the *decision* and
its guardrails, and two gaps: build worktrees get no `src/conductor` toolchain (no `bin/setup`),
and stale README guidance still said the cutover "MUST NOT be set on the harness repo."

## Options Considered

### Option A: Keep the harness unregistered (status quo ante)
- **Pros:** Zero self-build risk; simplest mental model.
- **Cons:** Tribal, undocumented rule; every harness change hand-built; the shipped guardrail
  machinery (built precisely to make self-hosting safe) goes unused.

### Option B: Daemon build-to-PR with human merge (chosen)
- **Pros:** Harness features flow through the same spec→build→PR pipeline as consumer repos;
  every existing self-host gate applies; the human merge is the final safeguard.
- **Cons:** Accepts a residual risk (below); adds a committed `bin/setup` to maintain.

### Option C: Full autonomy (daemon merges its own PRs)
- **Pros:** None worth the risk here.
- **Cons:** Violates the standing non-autonomy invariant (adr-005-non-autonomy-and-read-only-governor,
  adr-010); removes the human review that mitigates the residual risk. Not considered viable.

### Rejected sub-option: runtime-file guard
Issue #174 floated an optional guard routing auto-builds away from changes touching the
daemon's own runtime (`daemon.ts`, `conductor.ts`, `selector.ts`, gate logic). **Rejected:**
human review-before-merge already covers exactly this class of change, the guard would add a
second path-classification mechanism to keep in sync, and the issue itself marked it optional.

## Decision

The harness repo is daemon-registered for **build-to-PR with human merge**:

1. **The daemon builds merged specs and stops at PR-open.** No auto-merge — this repo relies on
   the standing invariant (adr-005, adr-2026-06-30-halt-based-release-gates: "the daemon never
   merges"), restated here as an explicit property of the harness profile.
2. **A committed `bin/setup`** gives daemon build worktrees a working toolchain: `npm install`
   and `npm run build` in `src/conductor` (tsup outputs to the worktree-local `dist/`). It is
   the repo's implementation of the existing `prepareWorktree` → `bin/setup` convention
   (worktree-prepare.ts) — no new engine seam.
3. **Version bumps escalate instead of always halting** — see
   adr-2026-07-03-version-gate-semver-escalation.
4. **Docs are reconciled**: the README guidance that the grandfather cutover "MUST NOT be set on
   the harness self-host repo" is retired (it predates this decision and contradicts the
   committed config); README + `src/conductor/README.md` document running the daemon against
   the harness repo. This ADR retires the "JSA is unregistered" tribal rule.

## Accepted residual risk — self-referential test blind spot

The harness's own test suite gates changes to that same suite. A latent bug in gate/loop logic
that also sits in a test blind spot would pass green, ship in a merged PR, and — after
`bin/install` — run *as the builder*. This cannot be fully configured away: any additional
automated gate is itself harness code subject to the same blind spot. The accepted mitigation
is **human review-before-merge** (no auto-merge), which is why Option C is off the table.

## Consequences

### Positive
- Harness work flows through the same daemon pipeline as every consumer repo.
- The decision and its guardrails are recorded; the tribal rule is retired.
- Build worktrees become self-sufficient (`bin/setup`), fixing the current silent gap where a
  daemon build worktree has no compiled `src/conductor`.

### Negative
- The residual risk above is now accepted policy, not an open question.
- `bin/setup` run by a *human in the primary checkout* rebuilds the shared `dist/` with
  `clean: true` and can ENOENT-crash daemons lazily importing from it (tracked as issue #215);
  the script is for worktree prep and the docs must say so.

### Follow-up Actions
- [ ] Commit `bin/setup` (worktree toolchain prep).
- [ ] Reconcile README §self-host + cutover guidance; add daemon-on-harness note to
      `src/conductor/README.md`.
- [ ] Implement adr-2026-07-03-version-gate-semver-escalation.
