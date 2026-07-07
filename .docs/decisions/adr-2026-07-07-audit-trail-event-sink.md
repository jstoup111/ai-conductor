# ADR: Audit-trail event-sink writer for retro friction records

**Date:** 2026-07-07
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer DECIDE session for jstoup111/ai-conductor#328

## Context

`/retro` reconstructs a run entirely from artifacts and reads `.pipeline/audit-trail/`
for "gate history, rework cycles" (`skills/retro/SKILL.md:21`). Under
fresh-session-per-step (#325, implemented — `conductor.ts:1217-1233`) there is no
conversational recall: any friction not written to disk is unrecoverable, and retro
silently degrades to "nothing went wrong."

Verified current state (all claims file:line-verified, confidence: verified):

- Only three writer classes populate `.pipeline/audit-trail/` today — `autoheal.ts:996`
  (engine), `skills/pipeline`, `skills/simplify` (LLM-instructed) — all BUILD-phase.
- Gate outcomes land in `.pipeline/gates/<step>.json` as `GateVerdict`
  (`gate-verdicts.ts:38-49`), one overwritten file per step: pass/fail transport, no
  history.
- The engine has a real event bus (`ConductorEventEmitter`, `ui/events.ts:13-71`) with
  friction events already emitted: `gate_verdict` (`conductor.ts:2408`), `kickback`
  (`:1657,:1728,:1772,:1855`), `loop_halt` (7 sites), `step_retry`
  (`conductor.ts:1395-1401`, carries step/attempt/maxAttempts/reason).
- An exact subscriber template exists: `EventPersister` (`event-persister.ts:56-101`)
  appends `JSON.stringify(event)+'\n'` to `.pipeline/events.jsonl` — but its
  `ALL_EVENT_TYPES` list (`:24-47`) omits `gate_verdict`/`kickback`/`loop_halt` and
  friends, and **daemon mode wires no persister at all** (`daemon-cli.ts:536-545`
  subscribes only the console renderer).
- Step→phase mapping is first-class: `phaseForStep(step)` (`resolved-config.ts:264-266`)
  over `ALL_STEPS` (`steps.ts:4-229`), `Phase = SETUP|UNDERSTAND|DECIDE|BUILD|SHIP`.
- HALT clear is a bare unlink (`task-progress.ts:86`) observed by the daemon's
  chokidar watcher `watchHaltCleared(worktreeBase, slug, onCleared)`
  (`daemon-deps.ts:294-337`) — same OS process as the daemon-hosted engine, with the
  worktree path derivable in the callback closure. No `halt_cleared` event exists.
- Front-half steps execute only in inline `conduct` mode; daemon mode pre-stamps them
  done (`daemon-cli.ts:209-220`, `PRESEEDED_DONE`) — front-half friction under the
  daemon happens in the separate engineer flow, not the daemon conductor loop.
- Existing append-only convention: single whole-line `appendFile`/`appendFileSync`
  relying on POSIX O_APPEND atomicity (`engineer-store.ts:262-272` states the contract
  explicitly). No lockfiles anywhere.

## Options Considered

### Option A: Bus-subscribed audit writer (event-sink) — CHOSEN
A new `src/conductor/src/engine/audit-trail.ts` exporting an `AuditTrailWriter` that
subscribes to the existing `ConductorEventEmitter` (the `EventPersister` pattern),
normalizes friction events into `AuditRecord` lines, and appends to
`.pipeline/audit-trail/events.jsonl`. Wired at BOTH engine entry points
(`index.ts` inline, `daemon-cli.ts` daemon). The daemon's `watchHaltCleared` callback
additionally appends the `halt_cleared` record directly (no engine session exists at
clear time).
- **Pros:** single deterministic writer; no per-site instrumentation to forget; reuses
  emissions that already exist (`step_retry`, `gate_verdict`, `kickback`, `loop_halt`);
  testable completeness (subscribe list vs emitted types); skills untouched.
- **Cons:** bus handler errors are swallowed (`ui/events.ts:21-43`) — writer must
  fail loudly via its own error record/log, not rely on the bus surfacing failures.

### Option B: Per-site direct writes (issue's literal shape)
Each engine site calls `writeAuditRecord()`; front-half SKILL.mds also self-report.
- **Pros:** explicit at each site.
- **Cons:** scattered writers are this bug's own failure mode; LLM-instructed skill
  writes are untestable; duplicates the event layer.

### Option C: Enrich `.pipeline/gates/` and point retro at it
- **Cons (fatal):** gate files are latest-state, overwritten on recompute — retry and
  kickback history is structurally unrepresentable. Rejected.

## Decision

Option A. Specifics:

1. **Record contract** (`AuditRecord`, one JSON object per line in
   `.pipeline/audit-trail/events.jsonl`):
   `{ step, phase, event, reason?, cause?, attempt?, at }` where
   `event ∈ {gate_pass, gate_fail, kickback, retry, intervention, halt_cleared}` and
   `phase` uses the engine's real `Phase` values (`SETUP|UNDERSTAND|DECIDE|BUILD|SHIP`)
   via `phaseForStep` — a deliberate deviation from the issue's 3-value
   `decide/build/ship` sketch, in favor of the actual topology (retro can coarsen;
   the writer must not).
2. **Event mapping:** `gate_verdict{satisfied:true}` → `gate_pass`;
   `gate_verdict{satisfied:false}` → `gate_fail` (reason from the same in-memory
   `GateVerdict` written to `.pipeline/gates/` — derived from one object, so the two
   cannot diverge); `kickback` → `kickback` (cause = evidence, from/to);
   `step_retry` → `retry` (attempt, reason); `loop_halt` → `intervention`
   (cause = halt reason). A step that completes without a verdict gate emits
   `gate_pass` from its step-completion event so every executed step leaves positive
   evidence — absence of a record for an executed step is provably a bug.
3. **`halt_cleared`:** appended by the daemon's `watchHaltCleared` callback into the
   watched worktree's `.pipeline/audit-trail/events.jsonl` (worktree path from the
   watcher closure). Inline mode: `clearHaltMarker` callers append equivalently.
4. **Dual-mode wiring is mandatory:** instantiate the writer in `index.ts` (inline —
   covers front-half + tail) and `daemon-cli.ts` (daemon — covers BUILD/SHIP; front
   half never executes there by design, so the completeness guarantee is scoped to
   *executed* steps).
5. **Atomicity:** whole-line single `appendFileSync` per record (O_APPEND), matching
   `engineer-store.ts`'s documented contract; records are small (< PIPE_BUF), so
   concurrent daemon-watcher + engine appends yield intact lines. No lockfiles.
6. **Consumers:** `skills/retro/SKILL.md` Data Collection names
   `.pipeline/audit-trail/events.jsonl` as the first-class gate/rework history source
   (existing autoheal/pipeline/simplify artifacts remain additional sources).
   `.pipeline/` stays gitignored run evidence — nothing here is a committed artifact.
7. **Non-coupling:** does not block on #191 (unimplemented verdict schema —
   `gate-verdicts.ts` has a plain interface, verified). When #191 lands, its
   schema-validated verdict becomes the source object for gate records; the record
   contract here is unchanged by that.

Scope guard (operator-approved 2026-07-07): interventions = engine-observable events
only; conversational interactive interventions are out of scope for v1.

## Consequences

### Positive
- Retro reconstructs failure→retry→pass chains, kickbacks, and HALT lifecycles from
  disk alone — honest retros under fresh sessions.
- Clean-pass positive evidence converts "no record" from ambiguous into a detectable
  defect (testable invariant: executed steps ⊆ recorded steps).
- Daemon runs finally persist friction events at all (today they are console-only).

### Negative
- Every step pays one small write on a clean pass (accepted by the issue).
- A second JSONL sink beside `.pipeline/events.jsonl` (raw event log). They serve
  different contracts (raw transport vs normalized retro records); merging them would
  couple the UI event stream to retro's schema.
- Bus handler exceptions are swallowed by the emitter — writer failures must be
  self-reported (stderr + best-effort marker), else silence returns.

### Follow-up Actions
- [ ] `audit-trail.ts` writer module + `AuditRecord` type
- [ ] `halt_cleared` emission at daemon watcher + inline clear paths
- [ ] Wiring in `index.ts` and `daemon-cli.ts`
- [ ] `skills/retro/SKILL.md` Data Collection update
- [ ] Completeness + concurrency + divergence tests (see stories)
