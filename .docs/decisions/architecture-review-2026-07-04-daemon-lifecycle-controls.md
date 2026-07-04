# Architecture Review: Daemon Lifecycle Controls

**Date:** 2026-07-04
**Inputs reviewed:** PRD `.docs/specs/2026-07-04-daemon-lifecycle-controls.md` (FR-1–21);
diagrams `.docs/architecture/2026-07-04-daemon-lifecycle-controls.md` + sequences
(pre-stories full pass, Tier L)
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new runtime dependencies. tmux features used (remain-on-exit,
  respawn-pane) are core tmux; the pattern was operationally validated 2026-07-03.
  Symlink+rename atomicity is POSIX-guaranteed on the supported substrate (Linux/WSL2;
  EKS posture unaffected — the engine-store seam is filesystem-local and swappable).
- **Prerequisites:** build flow rewire (`npm run build` → publish wrapper) and a
  one-time migration of the real `dist/` dir to the versioned store — both contained in
  the harness repo; consumer-facing paths (`bin/conduct-ts`, `~/.local/bin` symlink)
  unchanged.
- **Integration surface:** daemon loop (one injected predicate + one sweep-boundary
  check), tmux adapter (`restart` reimplementation, `start` dead-pane revival), CLI
  verb table (+`pause`/`resume`, multi-repo selectors), status renderer (enum + engine
  version), pidfile record (additive field), launcher script. No cross-module boundary
  is newly crossed; fleet iteration reuses the `daemon status --all` registry pattern.
- **Data:** no schema/DB. Pidfile record extension is additive and shape-guard
  compatible (adr-010 record already tolerates unknown fields → old/new engines can
  read each other's records during the transition).
- **Worktree isolation:** engine store root and registry path must be env-overridable
  in tests (registry override exists: `AI_CONDUCTOR_REGISTRY`; store override is a
  follow-up in the versioned-store ADR). Real-spawn kill switches
  (`AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH`, `AI_CONDUCTOR_NO_REAL_EXEC`) already guard the
  suite.

## Complexity

Tier L confirmed (matches `.docs/complexity/daemon-lifecycle-controls.md`). High-risk
concentration is in exactly two places — the publish/GC flow and the respawn/pidfile
handoff — both isolated behind existing module boundaries (build wrapper; tmux
adapter + daemon-lock). No split recommended: the three phases are separable in the
plan (versioned store → pause/resume → restart) and each is independently shippable.

## Alignment

- **adr-010 (pidfile-as-truth):** preserved and deliberately exercised — restart
  handoff is the existing reclaim path; GC reads liveness via pidfiles; the registry
  stays enumeration-only. The pause marker adds repo-local state, not mirror state.
- **ADR-005 (launch-not-manage / non-autonomy):** `ensureRunning` unchanged; pause is
  honored by the launched daemon itself. Pending-restart is operator-initiated intent
  deferred to a safe moment — no autonomous trigger is introduced (explicitly noted in
  the pending-restart ADR; the future auto-restart remains a separate gated decision).
- **adr-2026-06-29 (supervisor port, human-only verbs):** verb surface extended
  (`pause`, `resume`), `restart` signature unchanged, implementation swapped. The
  port stays substrate-swappable: pause markers and pidfiles are repo-filesystem
  facts; only the session-preservation mechanics are tmux-adapter-specific, exactly
  where adapter-specific behavior belongs.
- **Self-host guardrails:** untouched. Restarting the harness repo's own daemon is the
  normal path; the new process resolves whatever `current` points at, which is the
  point.
- **Signal-file pattern consistency:** `PAUSED` and `RESTART-PENDING` follow the
  `halt-marker.ts` single-source-module precedent; repo-scoped in `.daemon/` beside
  the pidfile (vs feature-scoped `.pipeline/`), which is the correct scoping split.
- **Diagrams:** planned-state diagrams approved 2026-07-04 and consistent with the four
  ADRs (the "proposed" mechanisms in the diagrams are now decided as drawn).

## Domain Integrity

- Status becomes an explicit enum (running/paused/stopped/stale + session-up/
  process-dead distinction) — no boolean-flag combinations representing invalid states.
- Marker records and the engine version id get typed record shapes parsed at the
  boundary (shape-guard precedent from `readPidRecord`); existence-vs-content authority
  is explicit in both marker ADRs.
- No primitive obsession risks beyond the version id — represent it as a dedicated
  type, not a bare string threaded through status code.
- Exhaustive matching required on the status enum (no `default` swallowing a future
  state) — flag for TDD domain review.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| GC deletes a version dir a live daemon still uses | Data | Low | High | Four-condition fail-closed policy (not-current ∧ no live pidfile ref ∧ min-age ∧ keep-last-K); any enumeration error skips deletion |
| Raw `tsup`/old habits rebuild into the live store | Technical | Medium | High | Build script rewired; wrapper + CI fail loudly if `dist` is a plain dir; migration converts once |
| Respawn fails mid-restart, daemon left down | Technical | Low | Medium | Explicit kill+recreate fallback with reported session loss; pidfile reclaim makes any successful start self-healing |
| Transition window: old-engine daemons ignore PAUSED | Integration | Certain (once) | Medium | Documented rollout: one post-merge restart per daemon (old-style); controls fully effective thereafter |
| Two-layer liveness (session vs process) confuses status consumers | Knowledge | Medium | Low | Status enum renders both layers distinctly; docs updated same PR |
| tmux version lacks respawn flags on some host | Integration | Low | Medium | Degraded fallback path + actionable error (supervised-hosting FR-8 precedent) |

## ADRs Created

1. `adr-2026-07-04-versioned-engine-store-atomic-flip` — versioned engine dirs +
   atomic `current` symlink + launcher realpath pinning + fail-closed GC (closes #215).
2. `adr-2026-07-04-durable-pause-marker` — `.daemon/PAUSED` repo-scoped durable signal
   at the dispatch boundary; registry stays non-authoritative.
3. `adr-2026-07-04-respawn-in-place-restart` — pane respawn inside the existing tmux
   session; pidfile handoff via existing reclaim; explicit degraded fallback.
4. `adr-2026-07-04-pending-restart-queue` — busy-daemon restarts queue durably and fire
   at the idle boundary; consume-once; non-autonomy preserved.

All four require operator approval (DRAFT → APPROVED) before stories.

## Conditions

None beyond the ADRs reaching APPROVED. Implementation-phase obligations already
encoded in the ADRs' follow-ups: env-overridable store root for tests; real-binary
tmux smoke; real-rebuild smoke proving FR-13; exhaustive status-enum matching.
