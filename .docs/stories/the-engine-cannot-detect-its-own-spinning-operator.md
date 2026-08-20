**Status:** Accepted

# Stories: The engine cannot detect its own spinning

**Feature:** ai-conductor#1652 — technical track, Tier M
**Authoritative design:** `.docs/decisions/adr-2026-08-17-build-review-rubric-repetition-short-circuit.md` (APPROVED)
**Binding conditions:** `.docs/decisions/architecture-review-2026-08-17-the-engine-cannot-detect-its-own-spinning-operator.md` (APPROVED WITH CONDITIONS)

Technical track: there is no PRD, so `**Requirement:**` cites the desired outcome from
`.pipeline/intake-outcomes.md` that the story delivers.

Documentation updates are deliberately **not** stories — they accompany functional work and belong
outside the acceptance criteria.

**Partial delivery of outcome-1, stated up front.** outcome-1 asks for three signals "at minimum":
(a) the same site failing N times across rounds, (b) finding substance recurring under drifted keys,
(c) kickback rate over a window. This feature delivers a **measured replacement for (a)** and
excludes (b) and (c).

Signal (a) as literally written — per-site repetition — was implemented in an earlier draft and
withdrawn on evidence: over 11 features it fired on 2 of the 5 that actually spun, and missed
`finish-publication`, the very episode #1652 reports. Sites move as remediation fixes them. The
delivered signal is **per-rubric failure repetition**, which on the same corpus fires on 5 of 5
spinning features and 0 of 6 healthy ones. (b) is jstoup111/ai-conductor#1611's territory — spec
landed, unimplemented. (c) is forbidden: `adr-2026-07-10-intra-step-build-progress-events` confines
the engine's only wall-clock threshold to observability, and a rate trigger is not reproducible
run-to-run.

---

## Story 1: A repeatedly-failing rubric is counted in durable state

**Requirement:** outcome-1

As the engine, I want each consumed `build_review` kickback to record which rubrics it was spent on,
so that a rubric failing over and over is visible as a count rather than reconstructible only by hand
from lap archaeology.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` FAIL whose effective verdict leaves findings unresolved, when the kickback
  is consumed, then each contributing rubric increments by one on the gate's ledger entry.
- Given one rubric contributes unresolved findings across four consumed kickbacks, when the fourth is
  consumed, then that rubric's tally reads 4.
- Given a rubric contributes on kickbacks 1 and 3 but not 2, when the third is consumed, then its
  tally reads 2 — the count is cumulative, not a consecutive run.
- Given a `build_review` PASS, when the gate settles, then the tally resets alongside `cumulative`.

#### Negative Paths
- Given every finding a rubric raised carries an accepted operator disposition, when the kickback is
  consumed, then that rubric does **not** tick — accepted is neither skipped nor passed.
- Given a rubric settled as an infrastructure failure rather than a judged FAIL, when the kickback is
  consumed, then it does **not** tick — a mechanical fault is not semantic churn.
- Given a ledger entry written before this change with no tally field, when it is loaded, then it
  reads clean and yields an empty tally — never a parse rejection and never a spurious halt for a
  feature in flight.
- Given a lap the fresh-base disposition discarded as graded against a stale base, when routing
  continues, then no rubric ticks for that lap.

### Done When
- [ ] `KickbackGateEntry` carries the per-rubric tally; `count` and `cumulative` keep their exact
      current semantics and values, including `cumulative`'s PASS reset.
- [ ] `isKickbackGateEntry` folds an absent tally to empty, mirroring its existing legacy
      `cumulative` tolerance, pinned by a regression test.
- [ ] The tally resets on PASS through the same path that resets `cumulative`.
- [ ] The tally is keyed by rubric name only, so it is bounded by the four-rubric registry with no
      capacity or eviction rule.

---

## Story 2: The key is engine-supplied, and cache re-stamps never count

**Requirement:** outcome-1, outcome-3

As the engine, I want the tally keyed on the rubric and ticked once per real backward move, so that
the signal measures convergence rather than grader wording or rubric cache behaviour.

### Acceptance Criteria

#### Happy Path
- Given a lap where a rubric contributes unresolved findings, when the tally advances, then the key
  is that rubric's registry name — never a finding, a site, an anchor, or any grader-authored text.
- Given two laps whose findings differ entirely in wording, sites, and concern kinds but come from
  the same rubric, when the tally advances, then both count toward that rubric.

#### Negative Paths
- Given a lap whose rubric artifacts are all cache re-stamps, when routing continues, then **no tally
  advances** — a tick is one consumed kickback, never one artifact.
- Given any implementation that derives repeat counts by enumerating
  `.pipeline/build-review/lap-*` directories, when the test suite runs, then it fails — the directory
  count is content-addressed by input digest and is not a chronology.
- Given the tally, when it is read anywhere in the system, then it does not influence finding
  identity, dispositions, or any immunity decision.

### Done When
- [ ] The tick derives from the current lap's effective verdict, exhaustive over the rubric registry
      rather than a hardcoded rubric list.
- [ ] No grader-authored field — `concernKind`, any anchor field, `summary`, `evidenceLocations` — is
      read by the counting path.
- [ ] A regression test pins that repeated cache-hit laps do not advance the tally (condition C5).

---

## Story 3: A repeatedly-failing rubric short-circuits the build

**Requirement:** outcome-1

As an operator, I want a build whose same rubric keeps failing to stop with a human-required halt, so
that spin ends earlier instead of running until I notice.

### Acceptance Criteria

#### Happy Path
- Given a rubric whose tally reaches the configured threshold, when the FAIL block routes, then the
  run takes a halt classified `needs-human` and does not kick back.
- Given that halt, when the daemon's re-kick sweep runs, then it is skipped on every pass and never
  auto-cleared.
- Given the historical corpus replayed against this bound, when it runs, then every feature with
  reported or cap-terminated spin halts and no feature that converged does.

#### Negative Paths
- Given a lap where the cumulative cap is also exceeded, when both conditions hold, then the
  **cumulative cap halt wins** and keeps its own distinct reason — the ping-pong signal is never
  masked.
- Given a FAIL whose findings are spread across rubrics with none reaching the threshold, when
  routing continues, then the run kicks back exactly as today.
- Given every finding in the lap carries an accepted disposition, when the effective verdict resolves
  to PASS, then no kickback is consumed and no halt is taken.
- Given the fresh-base disposition discards the lap, when routing continues, then the short-circuit
  is not reachable for that lap.

### Done When
- [ ] The new exit sits after the fresh-base disposition, after the D2 no-op escalation, after budget
      consumption, and after the cumulative-cap check.
- [ ] The FAIL block's exit set is derived by grep at implementation time and the effective-verdict
      predicate is consulted at each exit rather than hoisted once (condition C1).
- [ ] The halt reuses the exact sequence beside it: `writeHaltMarker` with its result consumed and a
      failed write logged, then remediation-PR surfacing, then the central loop-halt emit
      (condition C2).
- [ ] The new halt's reason string is distinct from every other exit's.

---

## Story 4: Every convergence halt names what repeated

**Requirement:** outcome-2

As an operator, I want a convergence halt to tell me which rubric kept failing, how often, and where
it last pointed, so that I rule on substance immediately instead of reconstructing it from logs.

### Acceptance Criteria

#### Happy Path
- Given the short-circuit halt fires, when its body is read, then it names the rubric, its failure
  count, the sites that rubric most recently flagged, and the cumulative budget state.
- Given the **existing cumulative-cap halt** fires, when its body is read, then it carries the same
  rendered table alongside its own distinct reason — the diagnosis ships on the cap path even where
  the new bound never fires.
- Given a halt body, when an operator reads it, then no lap archaeology is needed to answer "what
  repeated?".

#### Negative Paths
- Given a halt body, when it is rendered, then it states only what the tally established — it never
  asserts that the run "is spinning", "cannot converge", or will not resolve (condition C5).
- Given the rendered sites, when the tally is computed, then those sites are **reported only** and
  never counted — the count is per-rubric.
- Given a tally that is empty, when the cumulative cap halt renders, then it degrades to its existing
  reason rather than emitting an empty or malformed table.
- Given site names long enough to bloat the marker, when the body renders, then the table is bounded.

### Done When
- [ ] Rendering is a pure function over the ledger entry and the current lap's findings, returning
      prose to the existing halt-marker call sites.
- [ ] Both halt paths render it; a test pins the cap path specifically.
- [ ] A test pins that the body asserts no conclusion the tally did not establish.

---

## Story 5: The bound is config-gated and inert when disabled

**Requirement:** outcome-3

As an operator, I want the short-circuit behind a validated switch with a default, so that a
threshold that proves wrong in production can be relaxed or disabled without a release.

### Acceptance Criteria

#### Happy Path
- Given no configuration for this bound, when config resolves, then it is enabled at the default
  threshold — absent means on, mirroring the cumulative bound's block.
- Given the bound is configured with a different threshold, when a rubric's tally reaches it, then
  the halt fires at that value.

#### Negative Paths
- Given the bound is disabled, when a rubric fails any number of times, then behaviour is
  byte-identical to today: no tally is consulted and the new halt path is unreachable.
- Given a threshold that is not a positive integer, or is out of range, when config is validated,
  then loading **fails closed** with an error naming the key — a typo must never silently disable the
  guard.
- Given the config block is absent entirely, when validation runs, then it passes.

### Done When
- [ ] The block resolves through the existing merged-config path, under the `build_review` subtree,
      and is registered in the config type and validator in the same change.
- [ ] `enabled: false` is proven byte-identical to pre-change behaviour by test.
- [ ] The default threshold and the evidence behind it are recorded in the configuration reference.

---

## Story 6: The repetition signal is observable on the event spine

**Requirement:** outcome-1, outcome-3

As an operator or downstream consumer, I want the rubric tallies to ride the existing event spine, so
that a feature failing to converge is legible without reading a per-worktree file — and so the
threshold stays checkable against real runs.

### Acceptance Criteria

#### Happy Path
- Given a kickback that advanced one or more rubric tallies, when the `kickback` event is emitted,
  then it carries those tallies as an additive optional field.
- Given the short-circuit halt fires, when the loop-halt event is emitted, then its reason carries the
  same figures, stamped through the central emit path.
- Given a run's persisted event ledger, when it is read back offline, then the repetition history is
  reconstructible without opening the worktree's ledger file.

#### Negative Paths
- Given a kickback that advanced no tally, when the event is emitted, then the field is absent rather
  than an empty object.
- Given the new field, when the event sink registry is compiled, then it carries an explicit
  render/persist/audit decision and must persist — a new signal cannot be born dead (condition C3).
- Given any design that adds a new halt event variant for this, when reviewed, then it is rejected:
  the halt rides the existing central path.

### Done When
- [ ] The field is additive and optional on the existing `kickback` member; no new event variant is
      introduced.
- [ ] The sink registry entry is explicit and persists.
- [ ] A test pins that the persisted ledger is sufficient to reconstruct which rubrics repeated and
      how often.

---

## Notes for the plan

**The threshold is measured, and the measurement is replayable.** Over 11 features reconstructed from
persisted event ledgers, a per-rubric threshold of 4 fires on 5 of 5 spinning features and 0 of 6
healthy ones, avoiding 14 kickbacks; 3 fires on 2 healthy features and 5 misses one spinning feature.
The same sweep run with and without the PASS reset gave identical results, which is why Story 1 keeps
`adr-2026-08-12` D2's reset untouched. The plan's first task re-runs that sweep against the corpus so
the number is derived in-tree rather than inherited from this document.

**The bound names a rubric, not a defect.** That is deliberate: the operator rules on substance, which
is exactly what outcome-2 asks for. An implementation that tries to make this tally finer — per
finding, per site, per anchor — reintroduces the key that measured 2 of 5 and must fail review.
