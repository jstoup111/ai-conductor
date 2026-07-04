# ADR: `daemon park <slug>` / `daemon unpark <slug>` — filesystem-direct CLI verbs, no live daemon required

- **Status:** APPROVED
- **Approved by:** operator (James), 2026-07-04
- **Date:** 2026-07-04
- **Feature:** operator park (ai-conductor#236)
- **Related:** adr-2026-07-04-operator-park-marker.md, .docs/specs/2026-07-04-operator-park.md

## Context

The operator needs supported verbs to place and remove a park (FR-1, FR-4) — replacing the
`chmod a-w` workaround. Parking must work whether or not the repo's daemon is running (a park is
most needed exactly when the daemon is misbehaving or stopped). The daemon CLI already has two
verb families: read-only observability (`daemon status|logs`, dispatched pre-boot via
`detectDaemonObserveCommand`) and tmux-supervisor management (`daemon start|stop|restart|...`,
via `detectDaemonSupervisorCommand`) — both declared in `src/cli.ts` and dispatched in
`index.ts` before the pipeline boots.

## Decision

1. **Surface:** `conduct-ts daemon park <slug>` and `conduct-ts daemon unpark <slug>`, declared
   in `src/cli.ts` under the `daemon` command group and dispatched pre-boot in `index.ts` as a
   new non-interactive verb pair (same dispatch pattern as the observe verbs; never falls
   through to the pipeline — the unknown-subcommand guard lineage of #275 applies).
2. **Filesystem-direct:** the verbs write/remove `.daemon/parked/<slug>` via the canonical
   marker module directly. No supervisor port, no tmux, no running daemon involved; a live
   daemon observes the change at its next decision point (FR-7 mid-run clause).
3. **Validation (FR-7):**
   - `park <slug>`: the slug must be **known** — it resolves against current backlog stems or an
     existing worktree directory. Unknown slug → non-zero exit, clear error, nothing written.
   - `park` on an already-parked slug: exit 0, report the existing park (idempotent; marker not
     duplicated or rewritten).
   - `unpark <slug>` when not parked: exit 0, clear "was not parked" message, no-op.
   - Success paths print an explicit confirmation including the marker's effect ("will not be
     dispatched or re-kicked until unparked").
4. **Docs & help:** both verbs appear in `conduct --help` full reference (`renderFullHelp`
   walks the command tree), `README.md`, and `src/conductor/README.md` per the repo's
   docs-track-features rule.

## Alternatives rejected

- **Supervisor/tmux port verb:** would require a running supervisor; parks must not depend on
  daemon liveness.
- **Manual `touch`/`rm` documented as the interface:** no validation, no idempotency reporting,
  no dashboard vocabulary; the chmod-hack era showed ad-hoc filesystem surgery is the failure
  mode, not the fix.
- **Skill/agent-mediated parking (Claude writes the marker):** parking is a deterministic
  operator action; routing it through a model adds cost and failure surface for zero judgment
  value.

## Consequences

- New CLI surface → MINOR semver signal for the harness release flow, README + conductor README
  updates required in the same PR.
- `index.ts` gains one more pre-boot detector; the existing unknown-subcommand guard keeps
  `daemon parkk` (typo) from silently launching the pipeline.
