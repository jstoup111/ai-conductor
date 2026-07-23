# ADR: Fast-forward origin refresh before the quiescent engine rebuild, loud staleness fallback

Status: APPROVED
Date: 2026-07-22
Feature: daemon-stale-engine-origin-advance (intake #598)

## Context

The stale-engine auto-restart chain (adr-2026-07-03-daemon-auto-restart-stale-engine,
adr-2026-07-06-stale-engine-respawn-in-place, adr-2026-07-07-single-generation-stale-respawn)
detects staleness by content-hashing `dist/index.js`. `dist` is untracked (#309), so the hash
only drifts after a *local* rebuild publishes changed content. The quiescent-boundary gate
`rebuildAndMaybeRestartForStaleEngine` (`src/conductor/src/engine/daemon.ts`, pre-dispatch +
drained-idle call sites) does call `rebuildEngine()` — but nothing fast-forwards the daemon's
own checkout on that path. `fastForwardRoot()` (`src/conductor/src/engine/daemon-backlog.ts:149`)
runs only on `refresh:true` discovery paths (startup, fully-drained idle re-kick).

Verified consequence (incident 2026-07-12, intake #598): checkout 1 commit behind
`origin/main` → `npm run build` rebuilds byte-identical content →
`publish-engine.mjs:340` "content unchanged — publish skipped" → checker returns `current` →
`auto_restart_on_stale_engine` never fires → the daemon builds every feature on the pre-fix
engine until an operator manually runs pull + build + restart.

Claim basis (verify-claims): all of the above observed directly in source at review time —
gate chain and quiescence guards (`daemon.ts` `staleGatesArmed`, `inFlight.size` checks),
self-host-only `rebuildEngine` wiring (`src/daemon-cli.ts:1280`), `fastForwardRoot` guards
(no-origin skip, derived default branch, on-default-branch check, dirty-tree triage with
containment), `.engine-source-key` sidecar stamping (`publish-engine.mjs`). Confidence:
verified, ~95%.

## Decision

1. **Fetch before rebuild, same boundary, same gates.** Inside
   `rebuildAndMaybeRestartForStaleEngine`, before invoking `deps.rebuildEngine()`, invoke a
   new injected dep (`refreshEngineSource`, wired self-host-only in `src/daemon-cli.ts`
   alongside `rebuildEngine`) that runs the existing `fastForwardRoot(projectRoot, …)`.
   No new git machinery: reuse its origin/default-branch/dirty-tree guards verbatim.
   A refresh failure is non-fatal (same posture as a failed rebuild: log, continue on the
   current engine, never restart on indeterminate state).

2. **Fetch throttling.** The refresh is rate-limited by a minimum interval (config-derived,
   default on the order of the idle poll — one fetch per interval, not per dispatch), so
   pre-dispatch quiescent boundaries at high backlog churn do not hammer the network. A
   throttled skip is silent (not a staleness warning); the next eligible boundary refreshes.

3. **Source-SHA stamp at publish.** `publish-engine.mjs` stamps the source commit SHA
   (`git rev-parse HEAD` of the conductor package's repo at build time) in a sidecar next to
   `.engine-source-key` for each published version. This gives the verifiable
   "loaded engine's source ≥ merge commit" signal and feeds the advisory probe. Absent or
   unreadable stamp → treated as unknown (fail-closed: no restart decision keys off it).

4. **Loud staleness surfacing on every degraded path.** Whenever the daemon can determine it
   is behind `origin/<default>` but the self-heal chain cannot run — dirty tree, diverged
   branch, fetch failure after a previously-seen advance, non-self-host, or
   `auto_restart_on_stale_engine` disabled — it emits a prominent, throttled warning to the
   daemon log naming (a) the cause, and (b) the exact reload path
   (`git pull --ff-only origin <default>`; `npm run build` in `src/conductor`;
   `conduct daemon restart`). Staleness is never silent. Warnings are deduplicated per cause
   + SHA so a persistent condition does not spam every boundary.

5. **Restart semantics unchanged.** The content-hash checker, non-convergence suppression,
   `requestRestart` marker/exit, and the #400 single-generation handoff are untouched. The
   SHA comparison is observability only — the restart trigger remains the content hash of the
   locally published artifact (fail-closed, proven).

## Invariants preserved (checked against existing APPROVED ADRs)

- **Quiescent-only, never mid-build** (adr-2026-07-03): the refresh runs inside the existing
  `inFlight.size === 0` guard; no new restart points.
- **Fail-closed** (adr-2026-07-03): fetch/rebuild/stamp failures degrade to the current
  engine + warning; indeterminate state never restarts.
- **Non-convergence suppression** (adr-2026-07-03): unchanged; a docs-only merge that
  rebuilds to identical content simply reads `current`.
- **Single-generation handoff** (adr-2026-07-07): restart transport untouched.
- **Launch-never-manage / pidfile liveness** (ADR-005 / ADR-010): no daemon-management
  surface added.
- **`fastForwardRoot` semantics**: reused, not forked — its clean-tree heal containment and
  on-default-branch skip behave identically at the new call site.

## Alternatives considered

- **A: ff-before-rebuild only** — leaves dirty/diverged/non-self-host checkouts silently
  stale; rejected (same failure mode, smaller window).
- **B: advisory surfacing only** — retains the manual pull+rebuild+restart toil that caused
  the incident; rejected.
- **New self-update pipeline (fetch daemon, channel flow per #220)** — rejected as
  over-machinery: every downstream primitive (publish, checker, suppression, restart
  transport) already exists and is ADR-hardened; only the fetch seam is missing.

## Out of scope

- Re-kick backoff / CPU-spin hardening — tracked separately (#681).
- Consumer-install update flow (`bin/update`, #220) — different artifact, different channel.

## Consequences

- Merged engine fixes go live at the next quiescent boundary without operator action
  (self-host + flag on), bounded by the fetch throttle interval.
- Degraded states become observable instead of silent; the warning text is the runbook.
- One new injected dep on the daemon loop; one new sidecar file per published version.
- The fetch adds bounded network activity to the daemon loop (throttled).
