# Architecture: Daemon Halt-Reconciliation

**Last updated:** 2026-06-28
**Scope:** The daemon's startup + poll/dispatch control flow in `src/conductor`, showing this
feature's additions (startup dashboard, base-SHA tracking, main-advance re-kick sweep) and how
they compose with the existing discovery/park/un-park machinery (PR #109) and Phase 9.0's rebase
step. Current-state + additions. New elements marked **[NEW]**.

## Diagram 1 — Daemon control-flow state machine (startup + run loop)

```mermaid
flowchart TD
  start([daemon start]) --> dash["[NEW] scan .worktrees + .daemon/processed<br/>render inherited-state dashboard<br/>HALTED · IN-PROGRESS · ELIGIBLE · PROCESSED<br/>(stdout + daemon.log)"]
  dash --> readSha["[NEW] resolve base SHA via<br/>rev-parse(resolveDiscoveryRef ref)"]
  readSha --> firstRun{".daemon/last-base-sha<br/>present & valid?"}
  firstRun -- "no (absent/empty/garbage)" --> initSha["[NEW] write current SHA<br/>NO re-kick (first-run)"]
  firstRun -- "yes" --> downAdv{"persisted SHA<br/>!= current SHA?"}
  downAdv -- "yes (advanced while down)" --> sweep
  downAdv -- "no" --> initSha2["honor markers (PR #109)"]
  initSha --> loop
  initSha2 --> loop
  sweep["[NEW] re-kick sweep (FR-7)"] --> updSha["[NEW] last-base-sha := current"]
  updSha --> loop

  loop{{"poll loop: slot free?"}}
  loop -- "yes" --> disc["discoverBacklog(refresh:false)<br/>pickEligible"]
  disc --> pick{"eligible item?<br/>(parked w/ live HALT skipped — PR #109)"}
  pick -- "yes" --> dispatch["dispatch → runFeature<br/>(createWorktree · materialize · prepare ·<br/>runConductor · readOutcome)"]
  dispatch --> loop
  pick -- "no, idle" --> refresh["discoverBacklog(refresh:true)<br/>resolveDiscoveryRef → fetch origin"]
  refresh --> liveSha["[NEW] re-read base SHA"]
  liveSha --> liveAdv{"[NEW] SHA advanced<br/>vs last-seen?"}
  liveAdv -- "yes" --> sweep2["[NEW] re-kick sweep (FR-7)"]
  sweep2 --> updSha2["[NEW] last-base-sha := current"]
  updSha2 --> loop
  liveAdv -- "no" --> sleepIdle["sleep idlePollMs"]
  sleepIdle --> loop

  outcome{{"runFeature outcome"}}
  dispatch -. async .-> outcome
  outcome -- "done" --> proc["markProcessed · teardown"]
  outcome -- "halted" --> keepWt["keep worktree<br/>.pipeline/HALT present → parked"]
  proc --> loop
  keepWt --> loop
```

### Re-kick sweep detail (FR-7, both call sites)

```mermaid
flowchart TD
  s([re-kick sweep at SHA = X]) --> each{"for each worktree<br/>with live .pipeline/HALT"}
  each --> guard{"last-rekick SHA<br/>== X already? (FR-9)"}
  guard -- "yes" --> skip["skip (loop bound)"]
  guard -- "no" --> log["log slug + HALT reason"]
  log --> reb{"[Option 1] in-progress rebase?<br/>(.git/rebase-merge / rebase-apply)"}
  reb -- "yes" --> abort["git rebase --abort (best-effort, logged)"]
  reb -- "no" --> mv
  abort -- "abort failed" --> leave["leave HALT intact (no half-clear)<br/>log + skip this worktree"]
  abort -- "ok" --> mv["rename HALT → HALT.cleared (preserve reason)"]
  mv --> rm["rm .pipeline/HALT"]
  rm --> rec["record last-rekick SHA := X"]
  rec --> each
  skip --> each
  leave --> each
  each -- "done" --> ret(["marker gone → next discovery<br/>un-parks via PR #109 → re-dispatch<br/>→ runConductor → 9.0 rebase runs FRESH on new base"])
```

## Diagram 2 — Base-advance re-kick composes with PR #109 un-park + 9.0 rebase

```mermaid
sequenceDiagram
  participant Op as Operator (merges to main)
  participant D as runDaemon (poll loop)
  participant B as resolveDiscoveryRef
  participant FS as worktree .pipeline / .git
  participant RF as runFeature → runConductor
  participant R9 as 9.0 rebase step

  Note over FS: feature parked — .pipeline/HALT present<br/>(e.g. rebase conflict → paused rebase in worktree)
  Op->>D: merge advances origin/main
  D->>B: idle refresh (fetch origin)
  B-->>D: ref origin/main
  D->>D: [NEW] rev-parse → SHA advanced vs last-seen
  D->>FS: [NEW] re-kick sweep — abort paused rebase (Option 1)
  D->>FS: [NEW] HALT → HALT.cleared, rm HALT, record last-rekick SHA
  D->>D: [NEW] last-base-sha := new SHA
  D->>B: next discovery (refresh:false)
  B-->>D: backlog incl. now-unmarked feature
  D->>D: pickEligible — isHalted=false → un-park (PR #109)
  D->>RF: dispatch (reuse clean worktree)
  RF->>R9: rebase step runs FRESH on advanced base
  alt rebase now applies cleanly
    R9-->>RF: clean → continue to finish/PR
  else still conflicts
    R9->>FS: write .pipeline/HALT again (re-park)
    Note over D,FS: not re-kicked again at same SHA (FR-9)<br/>until base advances further
  end
```

## Legend

- **[NEW]** — added by this feature. Unmarked nodes are existing daemon behavior.
- **parked** — a worktree with a live `.pipeline/HALT`; PR #109 skips it at `pickEligible`.
- **un-park** — clearing `.pipeline/HALT` makes `isHalted` false, so the existing discovery path
  re-dispatches the feature. The re-kick sweep performs **no** direct dispatch (FR-8).
- **last-base-sha** — `.daemon/last-base-sha`, the persisted last-seen base SHA driving both the
  startup downtime-advance check and the live-advance check.
- **last-rekick SHA** — per-feature guard (FR-9); bounds re-kick to one attempt per base SHA.

## Composition notes

- The sweep appears at **two** call sites (startup downtime-advance and live idle-refresh advance)
  but is the **same** routine. Both update `last-base-sha` after running so an advance fires once.
- The feature adds **no new dispatch path**: dispatch, teardown, and processed-ledger discipline
  are unchanged. The only new write paths are `.daemon/last-base-sha`, `.pipeline/HALT.cleared`,
  and the rebase abort.
- Phase 9.0 is a **downstream consumer**: re-kick returns the worktree to a clean tip so 9.0's
  rebase runs fresh; 9.0's own re-park-on-conflict then governs whether the feature re-halts.
- **FR-12 rebase-first (sentinel):** the sweep drops a `.pipeline/REKICK` sentinel alongside
  clearing the marker. On re-dispatch, the conductor's worktree run-entry
  (`runConductorInWorktree`) sees the sentinel and runs 9.0's rebase-onto-latest **before** the
  pending gate re-verifies (then deletes the sentinel, one-shot). This is what makes a gate-failure
  halt (e.g. prd-audit) integrate the advanced base before re-running the gate, rather than
  re-failing on the stale base. Re-kick reuses 9.0's rebase; it does not reimplement it, and does
  no gap routing (gate loop / `/remediate` own that).
- **New modules:** `engine/daemon-sha.ts` (SHA parse/read/persist), `engine/daemon-dashboard.ts`
  (scan + render), `engine/daemon-rekick.ts` (sweep). Orchestration in `daemon.ts` `runDaemon` via
  new optional `DaemonDeps` hooks; real I/O wired in `daemon-cli.ts`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-28 | Initial generation | Daemon halt-reconciliation design (startup dashboard + main-advance re-kick), composing with PR #109 and Phase 9.0 |
| 2026-06-28 | Added FR-12 rebase-first (REKICK sentinel) + new-module map | Plan-update: re-kicked feature must rebase onto the advanced base before re-verifying its pending gate (ADR-013) |
