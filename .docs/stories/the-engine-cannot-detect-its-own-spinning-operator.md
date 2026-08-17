**Status:** Accepted

# Stories: The engine cannot detect its own spinning

**Feature:** ai-conductor#1652 — technical track, Tier M
**Authoritative design:** `.docs/decisions/adr-2026-08-17-build-review-site-repetition-short-circuit.md` (APPROVED)
**Binding conditions:** `.docs/decisions/architecture-review-2026-08-17-the-engine-cannot-detect-its-own-spinning-operator.md` (APPROVED WITH CONDITIONS)

Technical track: there is no PRD, so `**Requirement:**` cites the desired outcome from
`.pipeline/intake-outcomes.md` that the story delivers.

Documentation updates are deliberately **not** stories — they accompany functional work and belong
outside the acceptance criteria.

**Partial delivery of outcome-1, stated up front.** outcome-1 asks for three signals "at minimum":
(a) the same site failing N times across rounds, (b) finding substance recurring under drifted keys,
(c) kickback rate over a window. This feature delivers **(a)** only. (b) is jstoup111/ai-conductor#1611's
territory — its spec is landed and unimplemented, and duplicating its identity work here would
re-derive a contract that ADR is mid-flight on. (c) is **forbidden**: no approved decision sanctions a
wall-clock signal in a control path, `adr-2026-07-10-intra-step-build-progress-events` confines the
engine's only time-based threshold to observability, and a rate trigger is not reproducible
run-to-run; `cumulative` already answers the volume question from the state file. The exclusions are
carried into the coherence mapping rather than left implicit.

---

## Story 1: A repeated unresolved site is counted in durable state

**Requirement:** outcome-1

As the engine, I want each consumed `build_review` kickback to record which unresolved sites it was
spent on, so that a site failing over and over is visible as a count rather than reconstructible
only by hand from lap archaeology.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` FAIL whose effective verdict leaves findings unresolved, when the kickback
  is consumed, then each unresolved finding's site increments by one on the gate's ledger entry.
- Given the same site is unresolved across three consumed kickbacks, when the third is consumed,
  then that site's tally reads 3.
- Given a `build_review` PASS, when the gate settles, then the tally resets to empty alongside
  `cumulative`.

#### Negative Paths
- Given a finding whose identity carries an accepted operator disposition, when the kickback is
  consumed, then its site does **not** tick — accepted is neither skipped nor passed, and is not a
  repeat.
- Given a ledger entry written before this change with no tally field, when it is loaded, then it
  reads clean and yields an empty tally — never a parse rejection and never a spurious halt for a
  feature in flight.
- Given more distinct sites than the tally's fixed capacity, when a new site is recorded, then the
  lowest-count entry is evicted (ties by insertion order) and the record never grows unbounded.
- Given a lap the fresh-base disposition discarded as graded against a stale base, when routing
  continues, then no site ticks for that lap.

### Done When
- [ ] `KickbackGateEntry` carries the per-site tally; `count` and `cumulative` keep their exact
      current semantics and values.
- [ ] `isKickbackGateEntry` folds an absent tally to empty, mirroring its existing legacy
      `cumulative` tolerance, pinned by a regression test.
- [ ] The tally resets on PASS through the same path that resets `cumulative`.
- [ ] Capacity and eviction are pinned by test.

---

## Story 2: The site key is engine-verifiable, and cache re-stamps never count

**Requirement:** outcome-1, outcome-3

As the engine, I want a site identified by the rubric's typed anchor subject and counted once per
real backward move, so that the signal measures convergence rather than grader wording or rubric
cache behaviour.

### Acceptance Criteria

#### Happy Path
- Given a `scope` finding, when its site is derived, then it is `anchor.path`; for `tautology`,
  `anchor.changedTest`; for `rootCause`, `anchor.locus`; for `completeness`, `anchor.planTask`.
- Given two laps whose findings at one site differ only in `summary`, `evidenceLocations`, or a
  prose subject (`exercisedBehavior`, `statedDefect`, `missingOutcome`), when sites are derived,
  then both resolve to the same site and the tally advances.

#### Negative Paths
- Given a lap whose rubric artifacts are all cache re-stamps, when routing continues, then **no
  tally advances** — a tick is one consumed kickback, never one artifact.
- Given repeated laps that produce cache-hit artifacts for one site, when the tally is read, then it
  reflects only the consumed kickbacks, not the artifact count.
- Given any implementation that derives repeat counts by enumerating
  `.pipeline/build-review/lap-*` directories, when the test suite runs, then it fails — the
  directory count is content-addressed by input digest and is not a chronology.
- Given a finding whose anchor subject is absent or empty, when its site is derived, then it is
  skipped rather than counted under a placeholder key.

### Done When
- [ ] Site derivation is a pure function with no I/O, exhaustive over the four rubrics.
- [ ] `evidenceLocations` is not read by the derivation — it is presentation, excluded from identity
      by `adr-2026-08-13-stable-build-review-finding-dispositions` and absent from
      `adr-2026-08-16`'s engine-verified reference list.
- [ ] A regression test pins that repeated cache-hit laps do not advance the tally (condition C5).

---

## Story 3: A repeated site short-circuits the build before the cap is spent

**Requirement:** outcome-1

As an operator, I want a build that keeps failing at one site to stop early with a human-required
halt, so that spin ends at roughly half the spend instead of running the cumulative budget to
exhaustion.

### Acceptance Criteria

#### Happy Path
- Given a site whose tally reaches the configured threshold, when the FAIL block routes, then the
  run takes a halt classified `needs-human` and does not kick back.
- Given that halt, when the daemon's re-kick sweep runs, then it is skipped on every pass and never
  auto-cleared.
- Given the threshold is 3 and the cumulative cap is 5, when a feature repeats one site, then it
  halts strictly before the cumulative cap would fire.

#### Negative Paths
- Given a lap where the cumulative cap is also exceeded, when both conditions hold, then the
  **cumulative cap halt wins** and keeps its own distinct reason — the ping-pong signal is never
  masked.
- Given a FAIL whose findings are spread across distinct sites with none reaching the threshold,
  when routing continues, then the run kicks back exactly as today.
- Given every finding in the lap carries an accepted disposition, when the effective verdict
  resolves to PASS, then no kickback is consumed and no halt is taken.
- Given the fresh-base disposition discards the lap, when routing continues, then the short-circuit
  is not reachable for that lap.

### Done When
- [ ] The new exit sits after the fresh-base disposition, after the D2 no-op escalation, after
      budget consumption, and after the cumulative-cap check.
- [ ] The FAIL block's exit set is derived by grep at implementation time and the effective-verdict
      predicate is consulted at each exit rather than hoisted once (condition C1).
- [ ] The halt reuses the exact sequence beside it: `writeHaltMarker` with its result consumed and a
      failed write logged, then remediation-PR surfacing, then the central loop-halt emit
      (condition C2).
- [ ] The new halt's reason string is distinct from every other exit's.

---

## Story 4: Every convergence halt names what repeated

**Requirement:** outcome-2

As an operator, I want a convergence halt to tell me which site kept failing and how often, so that
I rule on substance immediately instead of reconstructing it from logs.

### Acceptance Criteria

#### Happy Path
- Given the short-circuit halt fires, when its body is read, then it names the site, its repeat
  count, the rubrics that raised it, and the cumulative budget state.
- Given the **existing cumulative-cap halt** fires, when its body is read, then it carries the same
  rendered repetition table in addition to its own distinct reason — the diagnosis ships on the cap
  path even where the new bound never fires.
- Given a halt body, when an operator reads it, then no lap archaeology is needed to answer "what
  repeated?".

#### Negative Paths
- Given a halt body, when it is rendered, then it states only what the tally established — it never
  asserts that the run "is spinning", "cannot converge", or will not resolve (condition C5).
- Given a tally that is empty, when the cumulative cap halt renders, then it degrades to its
  existing reason rather than emitting an empty or malformed table.
- Given a site name long enough to bloat the marker, when the body renders, then the table is
  bounded rather than unbounded.

### Done When
- [ ] Rendering is a pure function over the ledger entry and the current lap's findings, returning
      prose to the existing halt-marker call site.
- [ ] Both halt paths render it; a test pins the cap path specifically.
- [ ] A test pins that the body asserts no conclusion the tally did not establish.

---

## Story 5: The bound is config-gated and inert when disabled

**Requirement:** outcome-3

As an operator, I want the short-circuit behind a validated switch with a default, so that a
threshold that turns out to be too tight can be relaxed or disabled without a release.

### Acceptance Criteria

#### Happy Path
- Given no configuration for this bound, when config resolves, then it is enabled at the default
  threshold — absent means on, mirroring the cumulative bound's block.
- Given the bound is configured with a different threshold, when a site's tally reaches it, then the
  halt fires at that value.

#### Negative Paths
- Given the bound is disabled, when a site repeats any number of times, then behaviour is
  byte-identical to today: no tally is consulted and the new halt path is unreachable.
- Given a threshold that is not a positive integer, or is out of range, when config is validated,
  then loading **fails closed** with an error naming the key — a typo must never silently disable
  the guard.
- Given the config block is absent entirely, when validation runs, then it passes.

### Done When
- [ ] The block resolves through the existing merged-config path, under the `build_review` subtree,
      and is registered in the config type and validator in the same change.
- [ ] `enabled: false` is proven byte-identical to pre-change behaviour by test.
- [ ] The ADR's written exit condition is recorded in the configuration reference alongside the key.

---

## Story 6: The repetition signal is observable on the event spine

**Requirement:** outcome-1, outcome-3

As an operator or downstream consumer, I want the sites that repeated to ride the existing event
spine, so that a feature failing to converge is legible without reading a per-worktree file — and so
the threshold can later be re-derived from real data.

### Acceptance Criteria

#### Happy Path
- Given a kickback that advanced one or more site tallies, when the `kickback` event is emitted,
  then it carries those sites and their counts as an additive optional field.
- Given the short-circuit halt fires, when the loop-halt event is emitted, then its reason carries
  the same figures, stamped through the central emit path.
- Given a run's persisted event ledger, when it is read back offline, then the repetition history is
  reconstructible without opening the worktree's ledger file.

#### Negative Paths
- Given a kickback that advanced no tally, when the event is emitted, then the field is absent
  rather than an empty object.
- Given the new field, when the event sink registry is compiled, then it carries an explicit
  render/persist/audit decision and must persist — a new signal cannot be born dead
  (condition C3).
- Given any design that adds a new halt event variant for this, when reviewed, then it is rejected:
  the halt rides the existing central path.

### Done When
- [ ] The field is additive and optional on the existing `kickback` member; no new event variant is
      introduced.
- [ ] The sink registry entry is explicit and persists.
- [ ] A test pins that the persisted ledger is sufficient to reconstruct which sites repeated and
      how often.

---

## Notes for the plan

**The threshold is the least-evidenced part of this feature and must not be quietly hardened.** The
ADR records it at 55% confidence because the corpus that would calibrate it does not exist: of the
two features with persisted laps on disk, one carries two fresh rubric judgements and the other
zero — every other `lap-*` directory is a cache re-stamp. Story 5 is therefore not optional polish;
it is the mitigation the architecture review names as load-bearing, and the exit condition in the
ADR (re-derive from ten features' telemetry) is what Story 6's persistence exists to serve.

**The site key is deliberately coarser than finding identity**, so two materially different findings
at one site count as one repeat. `adr-2026-08-16` rejected that collapse for *identity*, where it
would grant an acceptance blanket immunity over a file. The consequence runs the other way here — a
conservative human-required halt rather than silent over-acceptance — and that asymmetry is the only
thing licensing the reuse. An implementation that lets this key influence identity, dispositions, or
any immunity decision breaks that argument and must fail review.
