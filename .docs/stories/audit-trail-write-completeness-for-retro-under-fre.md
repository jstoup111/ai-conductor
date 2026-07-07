**Status:** Accepted

# Stories: Audit-trail write-completeness for retro under fresh sessions

**Track:** technical (no PRD — derived from jstoup111/ai-conductor#328 +
adr-2026-07-07-audit-trail-event-sink)
**Tier:** M

---

## Story: AuditTrailWriter appends normalized JSONL records from the event bus

As the conductor engine, I want a single bus-subscribed audit writer so that every
friction event becomes one durable, parseable record without per-site instrumentation.

### Acceptance Criteria

#### Happy Path
- Given a running conductor with the writer subscribed, when a `step_retry` event is
  emitted for step `build` attempt 2 with reason "tests failed", then one line is
  appended to `.pipeline/audit-trail/events.jsonl` parsing to
  `{step:'build', phase:'BUILD', event:'retry', reason:'tests failed', attempt:2, at:<epoch ms>}`.
- Given any audit record, when it is written, then it is a single whole-line
  `appendFileSync` (record + `\n`) and `phase` equals `phaseForStep(step)` for every
  emitted record (engine `Phase` values `SETUP|UNDERSTAND|DECIDE|BUILD|SHIP`).
- Given `.pipeline/audit-trail/` does not exist yet in this worktree, when the first
  record is written, then the directory is created idempotently and the append
  succeeds; given the directory ALREADY exists holding batch artifacts
  (`code-review-satisfied.md`, `batch-N/`), those files are never touched, listed, or
  wiped by the writer (conflict resolution 2026-07-07: shared directory, disjoint
  filenames).
- Given the writer is constructed, when any path is derived, then it is rooted at the
  worktree/projectRoot passed to the writer — NEVER `process.cwd()` — so the suite's
  cwd-`.pipeline` leak guard (conductor-test-suite-leaks stories) cannot trip
  (conflict resolution 2026-07-07).

#### Negative Paths
- Given the events.jsonl path is unwritable (parent directory removed and creation
  fails), when a record append throws, then the writer catches the error, writes a
  message to stderr naming the failed record's `step` and `event`, and creates a
  best-effort `.pipeline/audit-trail/WRITE-FAILED` marker — it does NOT rely on the
  event bus to surface the error (the bus swallows handler errors) and does NOT crash
  the engine loop.
- Given two concurrent appenders (engine loop and daemon watcher) writing 100 records
  each to the same events.jsonl, when all appends complete, then the file contains
  exactly 200 intact lines and every line parses as valid JSON (no interleaved/torn
  lines).
- Given an event type the writer does not map (e.g. a UI-only event), when it is
  emitted, then no record is appended and no error is raised (mapping is an explicit
  allowlist, not a catch-all).

### Done When
- [ ] `src/conductor/src/engine/audit-trail.ts` exports the writer + `AuditRecord` type
      `{step, phase, event, reason?, cause?, attempt?, at}` with
      `event ∈ {gate_pass, gate_fail, kickback, retry, intervention, halt_cleared}`.
- [ ] Unit tests cover the mapped-event append, directory bootstrap, unwritable-path
      loud-failure, and concurrent-append integrity scenarios above, and pass.
- [ ] Grep shows no per-site `writeAuditRecord`-style calls scattered in `conductor.ts`
      beyond bus subscription + the documented `halt_cleared` append seams.

---

## Story: Gate outcomes produce gate_pass/gate_fail records that cannot diverge from the gate verdict

As `/retro`, I want gate records derived from the same in-memory `GateVerdict` the
engine persists so that the audit trail and `.pipeline/gates/` never disagree.

### Acceptance Criteria

#### Happy Path
- Given a verdict step whose `computeAndWriteVerdict` yields `{satisfied:true}`, when
  the `gate_verdict` event is emitted, then a `gate_pass` record for that step is
  appended with `at` ≥ the verdict's `checkedAt`.
- Given a verdict step yielding `{satisfied:false, reason:'stories missing Status: Accepted'}`,
  when the event is emitted, then a `gate_fail` record is appended whose `reason`
  equals the verdict's `reason` string exactly.

#### Negative Paths
- Given a verdict step that fails then passes on retry, when both outcomes are
  recorded, then events.jsonl contains BOTH the `gate_fail` and the later `gate_pass`
  (history preserved) while `.pipeline/gates/<step>.json` contains only the final
  verdict (latest-state) — and the final record's satisfied-ness matches the gate file.
- Given the gate file write succeeds but the audit append fails, when the failure
  occurs, then the loud-failure path fires (stderr + `WRITE-FAILED` marker); the gate
  verdict itself is unaffected.

### Done When
- [ ] A non-divergence test constructs a `GateVerdict`, routes it through the real
      emit path, and asserts the audit record's `event`/`reason` are derived from that
      same object (field-for-field), not re-computed.
- [ ] A fail-then-pass sequence test asserts both records exist in order in
      events.jsonl and the last one agrees with `.pipeline/gates/<step>.json`.

---

## Story: Every executed step leaves positive evidence — including non-verdict steps

As `/retro`, I want a `gate_pass` record even for clean, non-verdict steps so that the
absence of a record for an executed step is provably a bug, not a silent success.

### Acceptance Criteria

#### Happy Path
- Given a clean single-pass run of a step with no verdict gate, when the step
  completes, then exactly one `gate_pass` record for that step is appended (derived
  from the step-completion event).
- Given a full inline run where N steps execute, when the run converges, then the set
  of `step` values with at least one record in events.jsonl is a superset of the set
  of executed steps (executed ⊆ recorded).

#### Negative Paths
- Given a step that is SKIPPED by tier/config (never executed), when the run
  completes, then NO record exists for it — skipped steps must not fabricate evidence
  (the invariant is over executed steps only).
- Given a friction event type added to the engine's event union in the future without
  a writer mapping, when the completeness test enumerates emitted friction fixtures
  against the writer's allowlist, then the test FAILS, forcing the mapping table to be
  extended (coverage drift is caught at test time).

### Done When
- [ ] Completeness test: scripted multi-step run asserts executed ⊆ recorded and
      skipped steps are absent.
- [ ] Drift test: fixture-driven enumeration of friction event types vs the writer's
      mapping allowlist fails on an unmapped friction type.

---

## Story: Kickbacks and retries are recorded with their cause

As `/retro`, I want kickback and retry records carrying reason/cause so that rework
cycles are reconstructable without session recall.

### Acceptance Criteria

#### Happy Path
- Given a kickback verdict (e.g. conflict-check re-opens architecture), when the
  `kickback` event is emitted, then a `kickback` record is appended with `step` = the
  kicked-back-to step, `cause` containing the originating step and its evidence string.
- Given a step retry, when `step_retry` fires, then a `retry` record with the 1-based
  `attempt` and the failure `reason` is appended.

#### Negative Paths
- Given a retry whose failure produced no parseable error text, when the event fires,
  then the record is still appended with `attempt` set and `reason` set to the
  engine's fallback description (never a dropped record because reason was empty).
- Given kickbacks exceeding the per-gate cap so the loop HALTs, when the HALT is
  written, then BOTH the final `kickback` record and the `intervention` record exist
  (the cap-exceeded path does not swallow the kickback that triggered it).

### Done When
- [ ] Tests cover kickback record content (from/evidence), retry record content
      (attempt/reason), empty-reason fallback, and the cap-exceeded double record.

---

## Story: HALT lifecycle is recorded — intervention on write, halt_cleared on clear

As `/retro`, I want HALT write and clear both recorded so operator interventions are
visible as first-class friction events.

### Acceptance Criteria

#### Happy Path
- Given the engine writes a HALT (any `loop_halt` emission), when the event fires,
  then an `intervention` record is appended with `cause` = the halt reason.
- Given a daemon-watched worktree whose `.pipeline/HALT` is removed by the operator,
  when `watchHaltCleared` confirms the unlink, then a `halt_cleared` record with
  `cause: 'operator'` is appended to THAT worktree's
  `.pipeline/audit-trail/events.jsonl` (path derived from the watcher closure, never
  cwd).
- Given the autonomous rekick path renames `HALT` → `HALT.cleared`, when the watcher
  fires, then the `halt_cleared` record carries `cause: 'rekick'` — the presence of
  the `HALT.cleared` sibling distinguishes an autonomous rename from an operator
  unlink, so retro never misattributes an autonomous clear as an operator
  intervention (conflict resolution 2026-07-07 vs daemon-event-driven-wake).
- Given an inline run where the engine clears the HALT itself (`clearHaltMarker`
  caller), when the clear happens, then a `halt_cleared` record is appended.
- Given `halt_cleared` is added as a first-class `ConductorEvent` type, when the
  union is extended, then the event-union validity test (wave-c 4.1-7) and any golden
  event fixtures are updated in the SAME diff, and the emission is documented as an
  intentional new event (conflict resolution 2026-07-07 vs otel-observability's
  no-emission-edit invariant, which bound that feature's diff, not all future work).

#### Negative Paths
- Given the watched worktree was removed between the unlink event and the append, when
  the watcher callback runs, then it logs the failure loudly and does not crash the
  daemon process.
- Given the daemon watcher and the in-process engine append concurrently to the same
  events.jsonl, when both writes land, then both lines are intact (covered by the
  concurrency test in the writer story; asserted here end-to-end via the daemon seam).

### Done When
- [ ] `halt_cleared` emission exists at both seams (daemon watcher callback + inline
      clear path) with tests for each.
- [ ] Watcher-append failure path test passes (no daemon crash, loud log).

---

## Story: The writer is wired in BOTH entry points — inline conduct and the daemon

As the operator, I want daemon runs (retro's primary habitat) to persist audit records
so the feature is not an unwired primitive.

### Acceptance Criteria

#### Happy Path
- Given an inline `conduct-ts` run, when steps execute, then events.jsonl accumulates
  records for front-half AND tail steps (front half executes only inline).
- Given a daemon-hosted conductor run (`runConductorInWorktree`), when BUILD/SHIP
  steps execute with induced friction, then the worktree's events.jsonl contains the
  corresponding records — asserted by a daemon-mode test, not inferred from inline
  coverage.

#### Negative Paths
- Given the daemon entry point with the writer wiring removed (regression guard), when
  the daemon-mode test runs, then it FAILS — proving the test actually exercises the
  daemon seam rather than passing vacuously.
- Given daemon mode where front-half steps are pre-stamped done (never executed), when
  the run completes, then no front-half records exist for that run and the
  completeness invariant still holds (it is scoped to executed steps).

### Done When
- [ ] Writer instantiated in `index.ts` (inline) and `daemon-cli.ts` (daemon) — both
      wirings present with a test each.
- [ ] Daemon-mode test asserts records appear in the worktree's events.jsonl during a
      daemon-hosted run with induced friction.

---

## Story: retro reconstructs friction from the audit trail alone

As the operator reading a retro, I want gate failures and retries surfaced from
events.jsonl so retros are honest under fresh sessions.

### Acceptance Criteria

#### Happy Path
- Given a scripted run with one induced gate failure followed by one successful retry,
  when `/retro`'s Data Collection runs against the worktree, then it surfaces both the
  failure (with its reason) and the retry — without reading `.pipeline/gates/` or git
  history.
- Given `skills/retro/SKILL.md`, when read, then its Data Collection section names
  `.pipeline/audit-trail/events.jsonl` as the gate-history/rework source (existing
  autoheal/pipeline/simplify artifacts remain listed as additional sources), and the
  raw `.pipeline/events.jsonl` REMAINS the source for retry-escalation reporting
  (`escalatedModel`/`escalatedEffort` for retro Part C per retry-as-escalation
  Story 4) — the audit trail is additive, not a replacement source (conflict
  resolution 2026-07-07).

#### Negative Paths
- Given a run where events.jsonl is missing or empty despite executed steps (writer
  failure), when retro's Data Collection runs, then it reports the audit trail as
  INCOMPLETE for that run rather than concluding "nothing went wrong" (absence of
  positive evidence is surfaced, not silently accepted).
- Given a step executed in strict isolation (fresh session, no prior conversation
  turns), when its friction is examined afterward, then it is reconstructable from
  `.pipeline/audit-trail/` alone (the fresh-session reconstructability assertion from
  the issue's acceptance criteria).

### Done When
- [ ] `skills/retro/SKILL.md` Data Collection updated (events.jsonl named; incomplete
      -trail behavior specified).
- [ ] Scripted induced-failure+retry test passes: both events surfaced from
      events.jsonl only.
- [ ] Isolation test passes: single-step fresh-session run's friction reconstructable
      from the audit trail alone.
