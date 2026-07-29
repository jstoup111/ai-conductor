**Status:** Accepted

# Stories: daemon-mode DECIDE kickbacks HALT instead of re-running (#551)

Technical track (no PRD — acceptance criteria live here).
Tier: M.
Source: `.docs/decisions/adr-2026-07-27-daemon-decide-kickback-halt.md` (APPROVED),
architecture review 2026-07-27, conflict report 2026-07-27,
`.docs/track/daemon-mode-kickbacks-route-human-judgment-gaps-in.md`.

## Context

In daemon mode the conductor must never move the run index backward into a DECIDE-phase step —
those artifacts are operator-approved and the daemon only builds merged specs (ADR-008). Two
seams can move it backward. `planRemediation` is already guarded (#644,
`conductor.ts:1722-1737`). `scanKickbackVerdicts` (`conductor.ts:6189`) is not, and **every one
of its possible targets is DECIDE-phase** — `kickbackTarget: true` is set only on `prd`,
`architecture_review`, `stories` and `plan` (`steps.ts:61, 85, 96, 117`). This feature closes
that half and expresses the rule once, as a pure predicate consulted at both seams.

---

## Story S1: A daemon-mode kickback aimed at a DECIDE step HALTs instead of re-opening it

As a daemon operator, I want an autonomous kickback that would re-open a DECIDE step to stop the
run and park for me, so that operator-approved stories, plans and ADRs are never re-authored
without a human.

### Acceptance Criteria

#### Happy Path
- Given a `Conductor` constructed with `daemon: true` and `verifyArtifacts: true`, and a gate
  verdict written to `.pipeline/gates/plan.json` of shape
  `{satisfied: false, kickback: {from: '<the running SHIP gate>', evidence: '<architectural gap text>'}}`,
  when the loop's tail scan processes that verdict, then the run terminates as a HALT and `plan`
  is **never** dispatched.
- Given that HALT, when the operator inspects it, then `.pipeline/HALT` exists and its first
  non-empty line names the refused target step and states that DECIDE is operator-only in daemon
  mode, and the body carries the kickback evidence text from the verdict.
- Given that HALT, when the run ends, then a `loop_halt` event was emitted carrying that reason.

#### Negative Paths
- Given the same seeded verdict but a target that is **not** DECIDE-phase, when the tail scan
  runs, then no phase HALT is produced (covered in full by S2).
- Given a DECIDE-targeted kickback verdict whose `kickback.from` does **not** match the step that
  just ran, when the scan runs, then it is not matched at all — the guard must not fire on
  verdicts belonging to another step's kickback, and no HALT is written.
- Given the predicate is asked about a step name absent from the passed `steps` table, when it
  resolves phase, then it does not treat "unknown" as DECIDE and does not halt (fail-open on an
  unresolvable name is correct here — an unknown target cannot be a DECIDE re-author).

### Done When
- [ ] `src/conductor/src/engine/kickback-policy.ts` exports a pure, I/O-free
      `decideKickbackDisposition({target, steps, daemon})` returning
      `{kind:'route'} | {kind:'halt', reason}`, resolving phase from the passed `steps` table.
- [ ] `scanKickbackVerdicts` (`conductor.ts:6189`) consults it before `navigateBack` and returns
      `'halt'` on a halt disposition.
- [ ] The halt follows the canonical emit pair: marker → `writeState` → `surfaceRemediationPr` →
      `emit({type:'loop_halt', ...})`.
- [ ] An acceptance spec drives a real `Conductor` (daemon-shaped options, seeded verdict) and
      asserts HALT + no dispatch of the DECIDE step.

---

## Story S2: BUILD-phase kickback targets stay fully autonomous

As a daemon operator, I want code-level gaps to keep being fixed by the machine, so that adding
the DECIDE guard does not stall every feature on ordinary rework.

### Acceptance Criteria

#### Happy Path
- Given `daemon: true`, when a deterministic kickback targets `build` (the hardcoded target of
  `manual_test`, `test_suite`, `wiring_check` and non-completeness `build_review`), then the run
  navigates back to `build` and dispatches it — no HALT, no change from today's behavior.
- Given `daemon: true` and a `planRemediation` route whose target is `build` or
  `acceptance_specs`, when the route is taken, then it proceeds exactly as before.

#### Negative Paths
- Given the predicate is called with `daemon: true` and each BUILD- and SHIP-phase step name in
  turn, then it returns `{kind:'route'}` for every one of them — the guard is scoped to DECIDE
  and to nothing else.
- Given `daemon: false` and a DECIDE target, then it returns `{kind:'route'}` — the daemon flag
  is a required conjunct, not a default.

### Done When
- [ ] A table-driven unit test over `ALL_STEPS` asserts `route` for every non-DECIDE step and
      `halt` for every DECIDE step, under `daemon: true`.
- [ ] The existing deterministic-kickback tests pass unmodified.

---

## Story S3: Interactive `/conduct` kickbacks are provably unchanged

As a developer running `/conduct` by hand, I want amendment kickbacks to keep working, so that
the legitimate human-present re-entry paths added by ADR 2026-06-29 are not collateral damage.

### Acceptance Criteria

#### Happy Path
- Given a `Conductor` constructed **without** `daemon: true`, when a gate writes a kickback
  verdict targeting `plan` or `architecture_review`, then the run navigates back and dispatches
  the amendment pass exactly as it does today.

#### Negative Paths
- Given the interactive front-half amendment kickback (a pre-loop step such as `conflict_check`
  writing a kickback onto `architecture_review`), when the front-half scan runs with
  `navigate: false`, then behavior is unchanged and no HALT is written.
- Given `daemon: true` on that same front-half path, then the guard **does** fire and HALTs —
  the front-half call site is not exempted (architecture review F6).

### Done When
- [ ] `test/integration/gate-loop.test.ts` — including `:224` ("re-opens plan on kickback") and
      the front-half amendment suite at `:479` — passes **without any edit to those files**.
      Their unmodified passing is the regression proof; a diff touching them fails this story.

---

## Story S4: The anti-ping-pong cap keeps precedence and its behavior is byte-identical

As a maintainer, I want the existing kickback cap to be evaluated before the new phase rule, so
that a capped run still reports the ping-pong reason and outcome 4 holds.

### Acceptance Criteria

#### Happy Path
- Given `daemon: true` and a DECIDE-targeted kickback that has already been counted
  `MAX_KICKBACKS_PER_GATE` times, when the scan runs again, then the HALT reason is the existing
  `kickback ping-pong: <target> re-opened <n> times (cap 2)` string — not the new phase reason.
- Given a daemon-mode DECIDE kickback below the cap, when the scan runs, then the per-gate
  counter is still incremented and the `kickback` event is still emitted before the phase HALT,
  so the audit trail records the attempt.

#### Negative Paths
- Given the interactive path, when a kickback target exceeds the cap, then the existing HALT
  fires with its existing reason and class — unchanged.

### Done When
- [ ] The order inside `scanKickbackVerdicts` is: counter bump → `kickback` event → cap check →
      phase check → `navigateBack`.
- [ ] `test/integration/gate-loop.test.ts:1599` ("retry cap HALTs at exactly
      `MAX_KICKBACKS_PER_GATE`") passes unmodified.

---

## Story S5: The HALT is `needs-human`, so no sweep ever auto-clears it

As a daemon operator, I want this HALT classified `needs-human`, so that the automatic rekick
sweep cannot clear the guard and walk the daemon back into DECIDE.

### Acceptance Criteria

#### Happy Path
- Given a phase HALT from S1, when it is written, then `.pipeline/HALT.class` exists and contains
  exactly `needs-human` — asserted on the sidecar's content, not merely on `HALT` existing.
- Given that halted worktree, when `rekickSweep` runs, then it skips the worktree and neither
  `.pipeline/HALT.cleared` nor `.pipeline/REKICK` is created.
- Given the same worktree at a **new** HEAD sha, when `rekickSweep` runs again, then it is
  skipped again — the skip is not SHA-bounded.

#### Negative Paths
- Given the halt is written via a bare `writeFile` instead of `writeHaltMarker` (the defect this
  story guards), then `readHaltClass` returns `'unclassified'` and the sweep retains it under
  #1077's fail-closed policy, but the exact sidecar assertion still fails because no
  `needs-human` class exists — so the story cannot pass vacuously on skip behavior alone.

#### Resume (the intake's stated negative path)
- Given a human has edited the DECIDE artifacts and cleared the HALT, when the daemon resumes,
  then the verdict-aware resume clamp (#532) re-enters at the earliest unsatisfied gate rather
  than re-walking the whole sequence from the front, and the resolved DECIDE step is not
  re-dispatched.

### Done When
- [ ] The new halt uses `writeHaltMarker(body, 'needs-human')` (`halt-marker.ts:37`).
- [ ] A spec asserts the `HALT.class` sidecar content and the `rekickSweep` skip across two shas,
      in the shape of `test/engine/daemon-rekick.test.ts:157` / `:176`.
- [ ] A resume spec, in the shape of `test/engine/resume-verdict-clamp.test.ts`, proves
      re-entry at the earliest unsatisfied gate after a human clear.

---

## Story S6: The `planRemediation` guard is refactored without behavior change

As a maintainer, I want #644's inline check replaced by the shared predicate, so that the rule
exists once and cannot drift between the two seams.

### Acceptance Criteria

#### Happy Path
- Given `daemon: true` and a `planRemediation` route targeting `architecture_review` or `plan`,
  when the planner decides, then it returns `{kind:'halt'}` with the same detail text and the same
  shape as before the refactor.

#### Negative Paths
- Given the halt-wins-over-fix ordering (`conductor.ts:1706-1713`) and the #647 D1 no-op guard
  (`:1738-1760`), when the refactor lands, then both still fire in their existing order relative
  to the phase check.
- Given the interactive path, when `planRemediation` routes to a DECIDE target, then it routes —
  no halt.

### Done When
- [ ] `conductor.ts:1722-1737` delegates to `decideKickbackDisposition` and contains no inline
      phase test.
- [ ] `test/engine/conductor-remediation-noop-guard.test.ts` and
      `test/acceptance/kickback-build-noop-escalation.acceptance.test.ts` pass unmodified.

---

## Story S7: The new behavior is documented

As a reader of the docs, I want the daemon DECIDE-kickback rule written down where gate
behavior is explained, so that the invariant is discoverable without reading the engine.

### Acceptance Criteria

#### Happy Path
- Given `docs/explanation/gates.md`, when the change lands, then it states the invariant
  ("in daemon mode a kickback targeting a DECIDE-phase step HALTs `needs-human` rather than
  re-opening it"), names both enforcement seams, and notes that interactive amendment kickbacks
  are unaffected.
- Given `CHANGELOG.md`, when the change lands, then `[Unreleased]` carries an entry — this is a
  notable reader-visible behavior change.

#### Negative Paths
- Given no `settings.json` schema, hook wiring, skill symlink target or `bin/conduct` CLI surface
  is touched, then **no** `## Migration` block and **no** release waiver are added.

### Done When
- [ ] `docs/explanation/gates.md` updated.
- [ ] `CHANGELOG.md` `[Unreleased]` entry added. VERSION is **not** bumped (pre-v1 policy).
- [ ] `test/test_harness_integrity.sh` passes.
