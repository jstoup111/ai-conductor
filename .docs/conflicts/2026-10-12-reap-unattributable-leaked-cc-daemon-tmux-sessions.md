# Conflict Check: Dispatch process-tree teardown and leak status surface (#544)

**Date:** 2026-10-12
**Inventory:** all 594 story files and the prior `.docs/conflicts/` reports, narrowed by keyword (SIGHUP, SIGTERM, `respawn-pane`, process group or tree, orphan, `daemon status`, `cc-daemon-`, `kill-session`, descendant). 21 candidate story files were read in full, including daemon drain and lock release, respawn-in-place and stale-engine restart, supervised hosting, daemon concurrency and parallel validation fan-out, tmux test isolation and leak guards, intra-step progress events, the deterministic test-suite step, the gated-snapshot status, lock exclusivity, the preflight deadline, operator park, and OTel observability.
**ADR corpus:** repo-wide. All 349 `adr-*.md` files were examined, and 64 matched the subject keywords. These 19 were read in full and compared:
`adr-2026-07-04-respawn-in-place-restart`, `adr-2026-07-06-stale-engine-respawn-in-place`, `adr-2026-07-07-single-generation-stale-respawn`, `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`, `adr-2026-07-03-gated-snapshot-status-read-model`, `adr-2026-07-30-provider-preparation-lifecycle-supervision`, `adr-2026-07-10-intra-step-build-progress-events`, `adr-2026-08-07-project-teardown-hook-contract-and-containment`, `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`, `adr-2026-08-27-daemon-dispatcher-executor-seam`, `adr-2026-10-01-daemon-session-command-contracts`, `adr-2026-09-20-operator-launched-sessions-retain-conductor-authority`, `adr-2026-08-19-live-provider-stream-observation`, `adr-2026-06-30-sandbox-build-isolation`, `adr-2026-08-09-worktree-local-provider-scratch`, `adr-2026-07-13-park-all-dispatch-paths`, `adr-2026-07-04-pending-restart-queue`, `adr-2026-07-05-daemon-rate-limit-episode-coordinator`, `adr-014-otel-observability-exporter`.
The other 45 keyword matches, and the 285 ADRs that did not match, were narrowed out as off-subject: intake, ledgers, gates, rubrics, rebase, release, park reconciliation and docs. None was excluded as superseded. `adr-2026-07-06` was read together with its narrowing in `adr-2026-07-07`.
**Result:** **PASS. Zero blocking conflicts remain.** Five degrading conflicts were found. All five were resolved on 2026-10-12 by operator-selected revisions to this spec's own unlanded ADR (`adr-2026-10-12-daemon-owns-provider-dispatch-process-trees`) and its Stories 3 and 6. No existing artifact was changed.

## Conflict: `daemon stop` does not send SIGTERM

**Stories involved:** "Stop a repo's daemon on demand" vs Story 3
**Files:** `.docs/stories/daemon-supervised-hosting.md` and `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` vs `.docs/stories/reap-unattributable-leaked-cc-daemon-tmux-sessions.md`
**Type:** contradiction
**Severity:** degrading
**Confidence:** 95%. Verified in `daemon-tmux.ts`, where `stop()` calls `killSession(name, run)`.

**Existing (verbatim):** "when I run `daemon stop`, then the daemon host is torn down and the repo's daemon lock is released."
**New, before resolution (verbatim):** "when it receives SIGTERM from `ai-conductor daemon stop` and the drain completes, then every open dispatch is torn down before the process exits."

**Resolution Options:** 1. Attribute `daemon stop` to the SIGHUP path and keep the SIGTERM criterion for an external `kill -TERM`. 2. Change stop to SIGTERM with a drain, which changes hosting behavior and is out of scope.
**Selected:** Option 1. Story 3 now names stop, restart and the restart fallback as SIGHUP sources.

## Conflict: Story 3 assumed a restart lands mid-dispatch

**Stories involved:** Story 3 vs restart gating
**Files:** `adr-2026-07-04-respawn-in-place-restart`, `adr-2026-07-04-pending-restart-queue` vs `.docs/stories/reap-unattributable-leaked-cc-daemon-tmux-sessions.md`
**Type:** sequencing
**Severity:** degrading
**ADR filename stem:** adr-2026-07-04-respawn-in-place-restart
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "restart proceeds only when the daemon is idle or paused"
**Story opposing sentence (verbatim, before resolution):** "Given a daemon with an open dispatch whose provider has started test workers, when `ai-conductor daemon restart` respawns the pane, then before the old daemon exits every member of that dispatch is torn down and no member is left with parent pid 1."

**Description:** Today the scenario can only be reached because the production busy probe is not wired. `daemon-supervisor-cli.ts` defaults `isBusy` to `{ busy: false }`, and `daemon-cli.ts` does not inject it. That gap is consistent with #544's evidence of restarts stranding workers.
**Resolution Options:** 1. Restate the trigger as SIGHUP from any source, and record this path as defense in depth for the unwired busy probe and for provider calls outside the dispatch pool. 2. Add a dependency on wiring the busy check.
**Selected:** Option 1, recorded in ADR decision 5 and Story 3.

## Conflict: Teardown and the OTel flush share the SIGHUP budget

**Files:** `adr-014-otel-observability-exporter` D16 vs ADR decision 5
**Type:** resource-contention
**Severity:** degrading
**ADR filename stem:** adr-014-otel-observability-exporter
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "the daemon flushes its providers into the spool and releases the lease on SIGTERM and on SIGHUP (the tmux respawn path)"
**Story opposing sentence (verbatim, before resolution):** "Given exit-path teardown that still has surviving members when the SIGHUP handler's existing budget runs out, when the budget expires, then the daemon records the survivors and still re-raises SIGHUP without waiting longer."

**Resolution Options:** 1. Fix the order: persistence first, then teardown with a grace of at most 2 s, then the OTel stop. 2. Run teardown concurrently with independent caps.
**Selected:** Option 1. Persisting first also keeps an interrupted step recorded as an interruption, not a provider failure.

## Conflict: Two unrelated "dispatch ids"

**Files:** `adr-2026-10-01-daemon-session-command-contracts` D3 vs ADR decisions 1, 2 and 8
**Type:** resource-contention
**Severity:** degrading
**ADR filename stem:** adr-2026-10-01-daemon-session-command-contracts
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "A typed managed-session context carries canonical project/worktree identity, feature attribution when present, dispatch identity, provider identity"
**Story opposing sentence (verbatim, before resolution):** "exactly one `dispatch_tree_reaped` event is emitted carrying the dispatch id"

**Description:** The managed `dispatchId` (`CONDUCT_MANAGED_DISPATCH`) is shared by sibling provider subprocesses of one feature dispatch. Reusing it for membership would let one parallel-validation member's settle kill its siblings. Minting a second id under the same name leaves the two uncorrelatable.
**Resolution Options:** 1. Use a per-spawn `processTreeId` (`AI_CONDUCTOR_PROCESS_TREE_ID`) and carry the managed `dispatchId` on the event for correlation. 2. Derive the marker as the managed id plus a spawn sequence.
**Selected:** Option 1. Story 3 gains a sibling-isolation negative path.

## Conflict: Exit-path teardown is not ordered before lock release

**Files:** `.docs/stories/daemon-releases-the-lock-only-after-draining-in-fl.md` and `adr-2026-07-07-single-generation-stale-respawn` D1 vs ADR decision 5
**Type:** sequencing
**Severity:** degrading
**ADR filename stem:** adr-2026-07-07-single-generation-stale-respawn
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "release the pidfile lock (`lock.releaseSync()`) and `process.exit(0)` — explicitly, never relying on `respawn-pane -k`"
**Story opposing sentence (verbatim, before resolution):** "Given a daemon whose SIGTERM drain hits the force-release backstop, when the backstop fires, then every open dispatch is torn down before the process exits with code 1."

**Resolution Options:** 1. Require teardown to be awaited before any lock release, and list the stale-engine and lock-loser exits explicitly.
**Selected:** Option 1.

## Compatible pairs (reasoned in both directions)

- **SIGTERM drain:** settle-time teardown leaves the drain-end pass near empty, and the lock is still held until teardown completes.
- **Lifecycle supervision (D4, D5, and the D8 active-stall amendment):** teardown follows an existing ending authority and feeds nothing to recovery. Story 1 asserts that a silent but unended dispatch receives no signal.
- **Project teardown hook (`adr-2026-08-07`):** `bin/teardown` and `bin/dispatch-start` are spawned by `worktree-prepare`, not by provider adapters. They carry no marker and are never members.
- **Operator-launched sessions (`adr-2026-09-20`):** these are spawned outside the adapters from a foreground terminal, so they are never registered. Story 4 protects tmux servers that host operator sessions.
- **Gated-snapshot status (`adr-2026-07-03`):** its no-rescan rule covers the gated section only. Status already probes tmux live.
- **Lock exclusivity (#554):** the cmdline-match ban covers lock detection. Story 7 attributes by parent pid, cwd and marker, never by cmdline.
- **Parallel validation and daemon concurrency:** per-spawn ids and per-root walks prevent cross-kills. The sibling negative path was added under conflict 4.
- **Dispatcher-executor seam:** the registry tracks process membership, not claims, so `WorkClaims` stays the single dispatch authority. Settle-time events go through a daemon-scoped sink, which the plan must wire.
- **Tmux test-isolation stories:** these are test-only private servers. Story 3's integration check uses `createPrivateTmux`.
- **Worktree-local scratch, sandbox isolation, provider homes, and the vitest temp sweep:** these are filesystem concerns only.
- **Deterministic test-suite step:** the engine-owned detached suite tree is not a provider spawn.
- **Expired-preflight deadline:** a refused permit spawns nothing and registers nothing.

## Assumptions carried to the plan

- **ADR assumption 2 lowered to ~60%.** It must be probed with the real exit-witness wrapper on a private tmux server.
- **Unverified:** whether any step relies on a tool process outliving its dispatch. Manual-test background servers are the place to check before the settle-teardown task.
