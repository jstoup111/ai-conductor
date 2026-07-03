# Architecture Review: Daemon auto-restart on stale engine code
**Date:** 2026-07-03
**Mode:** Lightweight (tier M) — feasibility + alignment
**Inputs reviewed:** .docs/track/2026-07-03-daemon-auto-restart-stale-engine.md, .docs/architecture/2026-07-03-daemon-auto-restart-stale-engine.md, .docs/architecture/sequences/daemon-stale-engine-auto-restart.md
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** Pure TypeScript inside `src/conductor`; node `crypto` for the content hash. No
  new dependencies, services, or infrastructure.
- **Prerequisites:** Issue #215's restart transport for the respawn half. Detection,
  intent-marker, and clean exit are buildable now; the feature is blocked_by #215 via the
  native issue-dependency link on #256, so dependency-ordered dispatch holds the build —
  correct by design, not a risk.
- **Integration surface:** Three seams touched — `daemon-cli.ts` startup (capture +
  handshake), `engine/daemon.ts` idle branch (check + request), `types/config.ts` +
  `engine/config.ts` (new `auto_restart_on_stale_engine` key, default false). All inside
  the engine module; no cross-repo or external API surface.
- **Data:** One new marker file family under `.daemon/` (`RESTART_PENDING` + suppression
  lineage). No schema, no migration.
- **Performance:** One stat+hash of `dist/index.js` per idle poll (5s default) — negligible;
  may be debounced to every Nth idle tick if desired (non-blocking condition).
- **Worktree isolation:** `.daemon/` is per-repo primary checkout, owned by the single
  daemon (ADR-010 one-per-repo lock); no shared-resource contention between worktrees.

## Alignment

- **adr-2026-07-03-harness-daemon-profile (APPROVED):** conflicts with the "new code goes
  live only on `bin/install`" clause — resolved by a **narrow amendment** in the new ADR;
  the mid-build invariant ("not swapped mid-build") is preserved because the check lives
  exclusively in the idle branch.
- **ADR-005 launch-never-manage / ADR-010 pidfile-as-truth:** preserved. The daemon only
  self-terminates (a path that already exists for ceilings) and releases its own lock via
  the existing backstop; `ensureRunning` remains fire-and-forget; no signals to other
  processes; registry stays a non-authoritative mirror.
- **ADR-001 no-dispatch sweep boundary:** untouched — deterministic filesystem work only,
  no prompt dispatch.
- **Self-host guardrails (adr-2026-06-30-self-host-detection-seam):** reuses
  `classifySelfHost` verbatim; positive-only detection means uncertainty ⇒ non-harness ⇒
  feature inert. Non-harness daemons are byte-for-byte unchanged.
- **Fail-closed pattern consistency:** indeterminate-never-acts mirrors the blocker
  resolver; SHA-tracked-trigger-at-boundary mirrors ADR-013 (base-advance rekick).
- **State management:** restart intent is an explicit marker with from/target identity —
  no boolean flags; suppression is derivable from marker lineage, invalid states not
  representable.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Restart fires with work in flight | Technical | Low | High | Check only in the idle branch; re-verify `inFlight.size === 0` immediately before exit |
| Restart loop on non-converging identity | Technical | Medium | High | Startup handshake + suppression until on-disk identity changes; covered by a mandatory negative-path story |
| Daemon left down until nudge (pre-#215) | Integration | High (pre-#215) | Medium | blocked_by #215 holds the build; flag defaults off |
| Hash of entry misses a changed chunk | Technical | Low | Medium | tsup chunk hashes are content-derived and imported by name from the entry; acceptance spec must prove a rebuild-with-changes flips the identity |
| Marker file corrupt/unreadable at boot | Data | Low | Low | Treat as absent + log; fail-closed (no suppression state ⇒ default gates still apply) |

## ADRs Created

- `adr-2026-07-03-daemon-auto-restart-stale-engine.md` (DRAFT → pending approval) — amends
  adr-2026-07-03-harness-daemon-profile narrowly.

## Conditions

1. Stories MUST include negative paths for: work-in-flight suppression, non-converging
   restart-loop suppression, indeterminate identity (hash failure), non-self-host repo,
   flag off/absent, and `once` (non-continuous) mode.
2. The acceptance spec MUST prove real staleness detection against an actual rebuilt dist
   fixture (identity flips) and a byte-identical rebuild (identity stable) — not only
   injected fakes (real-binary smoke rule).
3. The `RESTART_PENDING` write → lock release → exit ordering must be asserted (a crash
   between steps must not strand a held lock: the existing exit backstop covers it — keep
   it on this path).
