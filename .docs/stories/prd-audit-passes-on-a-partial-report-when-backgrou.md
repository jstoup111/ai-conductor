**Status:** Accepted

# Stories: prd_audit FR-coverage gate

Track: technical. Source: jstoup111/ai-conductor#1398.
Tier: S (happy and negative paths per story).

## Background

`prd_audit` scores its report by scanning for verdict rows that are *present and blocking*
(`findUnalignedFrRows`). It never asks whether every functional requirement has a row at all, so a
report that is missing rows entirely — because the per-FR auditors that would have written them
never returned — reads as clean and the gate returns `done: true`. The same coverage-blind
predicate is applied at three sites, so a pass recorded from an incomplete run is also preserved
and reused:

- `src/conductor/src/engine/artifacts.ts:2303` — the completion predicate itself.
- `src/conductor/src/engine/artifacts.ts:2257` — the `gate-code-validity` preserve path.
- `src/conductor/src/engine/artifacts.ts:681` — the sweep-spare path.

The denominator is available deterministically. `extractPrdFrIds`
(`src/conductor/src/engine/engineer/coherence-validator.ts:184`) already parses the `FR-N` ids
declared under a PRD's `## Functional Requirements` heading, and land-time coherence already gates
FR coverage with it. `prd_audit` is `skippableForTracks: ['technical']`
(`src/conductor/src/engine/steps.ts:223`), so whenever it runs the feature is product-track and a
PRD exists — which is what makes failing closed on an unresolvable PRD safe rather than
regression-prone.

---

## Story 1: Every functional requirement must carry a verdict row

**Requirement:** TI-1 — the completion predicate compares the report's verdict rows against the
approved PRD's enumerated FR ids, and blocks when any id has no row.

As the SHIP gate, I want an FR with no verdict at all to block exactly as an un-ALIGNED FR does,
so that a report which never audited a requirement cannot be recorded as a pass.

### Acceptance Criteria

#### Happy Path

- Given an approved PRD enumerating FR-1..FR-5 and a fresh report carrying an ALIGNED verdict row
  for each of FR-1..FR-5, when the `prd_audit` completion predicate runs, then it returns
  `done: true` exactly as it does today, with no added prompt and no added wall-clock.
- Given an approved PRD enumerating FR-1..FR-5 and a fresh report carrying rows for FR-1..FR-5
  where FR-3 is `DIVERGED` and marked `ACCEPTED`, when the predicate runs, then it returns
  `done: true` — human-accepted divergence is unaffected by the coverage check.

#### Negative Paths

- Given an approved PRD enumerating FR-1..FR-5 and a fresh report carrying rows for only FR-1,
  FR-2 and FR-4 — every one of them ALIGNED — when the predicate runs, then it returns
  `done: false` and the reason names FR-3 and FR-5 as the requirements with no verdict.
- Given the same missing-row report, when the predicate returns `done: false`, then
  `writePrdAuditCodeStamp` is NOT called, so no pass is persisted for an incomplete run.
- Given an approved PRD enumerating FR-1..FR-5 and a fresh report carrying no verdict rows at all,
  when the predicate runs, then it returns `done: false` naming all five requirements — the
  empty-report case must never read as clean.
- Given a report that both omits FR-3 and carries a blocking `MISSING` row for FR-2, when the
  predicate runs, then it returns `done: false` and the reason surfaces both the blocking row and
  the absent verdict, so neither failure masks the other.

### Done When

- [ ] A shared helper returns the FR ids present in the approved PRD but absent from the report's
      verdict rows, reusing the existing per-cell row parser (`parseFrVerdictRow`) for row ids.
- [ ] The `prd_audit` predicate at `artifacts.ts:2303` consults that helper before its pass path
      and before `writePrdAuditCodeStamp`.
- [ ] A test asserts the clean full-coverage report still passes (no regression).
- [ ] A test asserts the code stamp is not written when coverage is incomplete.

---

## Story 2: A pass from an incomplete run is never preserved or reused

**Requirement:** TI-2 — the `gate-code-validity` preserve path and the sweep-spare path apply the
same coverage requirement as the predicate, so an already-recorded false pass is corrected rather
than carried forward.

As an operator re-running a build, I want a previously recorded `prd_audit` pass to be re-validated
for coverage, so that a false pass stamped before this fix — or by an incomplete run — cannot be
reused to skip the gate.

### Acceptance Criteria

#### Happy Path

- Given a `prd_audit` code-stamp sidecar whose recorded verdict is still code-valid (`preserve`)
  and a present report that carries a row for every FR in the approved PRD with none blocking,
  when the preserve path runs, then the pass is preserved exactly as it is today.

#### Negative Paths

- Given a code-stamp sidecar that would otherwise `preserve`, and a present report that omits a
  verdict row for FR-4, when the preserve path at `artifacts.ts:2257` runs, then it does not
  preserve and falls through to the normal freshness/report path, which blocks naming FR-4.
- Given the same sidecar and coverage-incomplete report, when the sweep-spare path at
  `artifacts.ts:681` decides whether to spare the report, then it returns `false` — a report that
  does not currently read as fully covered is never spared.
- Given a sidecar recorded before this change from a run that audited only 3 of 5 FRs, when the
  gate next evaluates, then the stale false pass is rejected rather than honored.

### Done When

- [ ] Both the preserve path and the sweep-spare path call the same coverage helper as the
      predicate — one implementation, three call sites, no duplicated predicate logic.
- [ ] A test drives each of the three sites with an identical coverage-incomplete report and
      asserts none of them yields a pass.

---

## Story 3: The FR denominator is feature-scoped, derived once, and fails closed

**Requirement:** TI-3 — the approved PRD supplying the denominator is resolved by the existing
feature-identity ladder, never by scanning the whole `.docs/specs/` corpus, and an unresolvable PRD
blocks rather than silently disabling the coverage check.

As the gate, I want the denominator to come from this feature's own approved PRD, so that the
coverage check is neither diluted by 47 unrelated historical specs nor quietly switched off when
the PRD cannot be found.

### Acceptance Criteria

#### Happy Path

- Given a repository whose `.docs/specs/` holds many specs from prior features, when the
  denominator is resolved for a feature whose plan stem is `foo`, then only that feature's own
  approved PRD contributes FR ids — unrelated specs contribute none.
- Given a feature whose PRD file is prefixed `SUPERSEDED-`, when the denominator is resolved, then
  that file is excluded, matching the skill's documented input rule.
- Given an approved PRD that declares no `## Functional Requirements` section, or one that
  enumerates no `FR-N` ids, when the denominator is resolved, then it is empty and the gate's
  behavior is unchanged from today — mirroring the existing coherence FR-10 precedent that an
  underivable denominator is not a failure.

#### Negative Paths

- Given `prd_audit` is running (so the feature is product-track, per `skippableForTracks`) and no
  approved PRD can be resolved for this feature, when the predicate runs, then it returns
  `done: false` with a reason naming the unresolvable PRD — it never falls back to scanning every
  spec in the corpus, and never treats "cannot find the PRD" as "nothing to cover".
- Given the resolved PRD file exists but cannot be read, when the denominator is derived, then the
  error blocks the gate rather than degrading to an empty denominator.
- Given more than one approved PRD resolves to this feature, when the denominator is derived, then
  it is the union of their FR ids, and a row is required for every id in that union.

### Done When

- [ ] `extractPrdFrIds` is lifted out of `engineer/coherence-validator.ts` into a shared module and
      imported by both the coherence validator and the `prd_audit` gate — one parser, no second
      copy of the FR grammar.
- [ ] PRD resolution reuses the existing feature-identity machinery
      (`buildArtifactResolutionContext` / the `resolveFeatureStoriesPath` ladder) rather than a new
      resolution scheme, and carries that helper's documented refusal to validate the whole corpus.
- [ ] A test asserts an unrelated feature's spec never contributes FR ids to this feature's
      denominator.
- [ ] A test asserts an unresolvable PRD blocks rather than passing.
