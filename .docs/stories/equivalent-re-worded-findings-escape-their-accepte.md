**Status:** Accepted

# Stories: Equivalent re-worded findings escape their accepted dispositions across laps

**Feature:** ai-conductor#1611 — technical track, Tier M
**Authoritative design:** `.docs/decisions/adr-2026-08-16-closed-build-review-finding-vocabularies.md` (APPROVED),
conforming to decision 1 of `.docs/decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md` (APPROVED)
**Binding conditions:** `.docs/decisions/architecture-review-2026-08-16-equivalent-re-worded-findings-escape-their-accepte.md` (APPROVED WITH CONDITIONS)

Technical track: there is no PRD, so `**Requirement:**` cites the desired outcome from
`.pipeline/intake-outcomes.md` that the story delivers.

Documentation updates are deliberately **not** stories — they accompany functional work and belong
outside the acceptance criteria.

---

## Story 1: A re-worded finding keeps the identity its substance already earned

**Requirement:** outcome-1

As an operator who accepted a build_review finding, I want the finding's identity to be built only
from closed vocabulary members and engine-verifiable references, so that my acceptance keeps binding
however the next lap's grader words the same concern.

### Acceptance Criteria

#### Happy Path
- Given a scope finding accepted with `concernKind: out-of-plan-test-change`, when a later lap
  reports the same offending path and plan relation as `out-of-plan-change`, then both canonicalize
  to the same identity and the acceptance binds without operator action.
- Given any finding whose only change between laps is its `summary`, `evidenceLocations`, or a
  residual prose subject (`exercisedBehavior`, `statedDefect`, `missingOutcome`), when the identity
  is derived, then the identity is byte-identical to the prior lap's.
- Given a value differing from a vocabulary member only by letter case or `_` versus `-`, when it is
  normalized, then it resolves to that member and validates.

#### Negative Paths
- Given two members of any one rubric's vocabulary, when each is normalized, then no two members
  collide — a colliding set fails the test suite rather than resolving ambiguously at runtime.
- Given a finding whose prose subject changes but whose classification member changes too, when the
  identity is derived, then it differs from the prior lap's — a reclassified concern is a new
  concern.
- Given a value that is a prose sentence rather than a vocabulary member, when it is validated after
  normalization, then it is rejected (Story 3 governs what happens next).

### Done When
- [ ] `concernKind` and the classification anchor fields are closed sets in the engine; a test fails
      if any becomes a bare `string` again.
- [ ] The residual prose subjects are absent from the canonical payload and still present on the
      finding for the report.
- [ ] The observed 2026-08-15 pair (`out-of-plan-test-change` → `out-of-plan-change`) is pinned as a
      regression test producing one identity.
- [ ] A normalization-collision test covers all four rubrics' sets.

---

## Story 2: Genuinely different findings at one path still surface

**Requirement:** outcome-2

As an operator, I want an acceptance to cover exactly the concern I accepted, so that a different
defect discovered later at the same path still blocks the gate.

### Acceptance Criteria

#### Happy Path
- Given an accepted scope finding on `src/a.ts`, when a later lap reports a scope finding on
  `src/a.ts` under a different `relation` member, then it canonicalizes to a distinct identity,
  remains unresolved, and the effective verdict is FAIL.
- Given an accepted completeness finding for plan task T under one missing surface, when a different
  missing surface is reported for the same plan task, then the two identities differ and the second
  blocks.
- Given an accepted finding under one rubric, when an equivalent-sounding concern is reported under a
  different rubric, then the identities differ and the second blocks.

#### Negative Paths
- Given any accepted finding, when a new finding shares its path but not its classification member,
  then no path-level, rubric-level, or feature-level suppression occurs — only the exact identity is
  suppressed.
- Given a completeness identity, when it is derived, then it includes a missing-surface reference —
  a test asserts that two different missing deliverables under one plan task do not collapse.

### Done When
- [ ] Same-path different-classification cases are pinned per rubric and remain blocking.
- [ ] The completeness collapse case is pinned explicitly.
- [ ] No suppression path exists that is broader than one exact identity.

---

## Story 3: An out-of-vocabulary value reruns the rubric instead of burning the lap

**Requirement:** outcome-1

As the daemon, I want a grader that emits a value outside its rubric's vocabulary to be told the
allowed members and given the repair turn that already exists, so that closing the vocabulary never
auto-parks a build the way a strict engine bar has before.

### Acceptance Criteria

#### Happy Path
- Given a rubric dispatch, when the engine renders the judged-result schema, then it embeds that
  rubric's allowed vocabulary members, so the model is shown the contract rather than left to infer
  it.
- Given a grader response carrying an out-of-vocabulary value, when it is rejected, then the
  rejection diagnosis names the offending field and lists that rubric's allowed members.
- Given that rejection, when the bounded repair turn runs and returns a valid member, then the lap
  proceeds normally with no kickback consumed.

#### Negative Paths
- Given a rejection that survives the repair turn, when the rubric settles, then it classifies as
  `absent` so build_review reruns; no kickback budget is consumed and no cumulative cap advances.
- Given a rejection that survives the repair turn, when the operator inspects the failure, then the
  bounded raw-output excerpt is present — the finding is visible, never silently dropped.
- Given any rejection path, when it completes, then no finding is coerced into a nearest vocabulary
  member and no `other` catch-all member exists.

### Done When
- [ ] The dispatch schema and the rejection diagnosis both render the vocabulary from the single
      engine source.
- [ ] A surviving rejection is asserted to consume no kickback budget.
- [ ] A test asserts no vocabulary contains an `other`-style catch-all.

---

## Story 4: Every build_review FAIL exit decides on the effective verdict

**Requirement:** outcome-4

As a feature whose findings the operator has already accepted, I want every exit from the daemon's
build_review FAIL block to consult the disposition store, so that a routing composed before the
acceptance cannot halt me over risk that is already accepted.

### Acceptance Criteria

#### Happy Path
- Given a raw FAIL whose findings are all operator-accepted, when the `/remediate` planner refuses
  and the block would HALT needs-human, then the effective verdict is consulted at that decision and
  the run re-lands build_review instead of halting — the 2026-08-15 23:40 occurrence.
- Given the same state, when any other exit in the block is reached — stale-mirage disposition,
  kickback-to-build no-op escalation, cumulative cap, per-gate cap, or the existing race guard —
  then that exit also consults the effective verdict.
- Given an acceptance that lands while the `/remediate` planner is running, when the exit is
  reached, then the predicate is evaluated at the decision rather than reused from an earlier read.

#### Negative Paths
- Given a raw FAIL with any unresolved finding, when each exit is reached, then routing, HALT, and
  cap behavior are exactly as they are today.
- Given a run that trips a cap, when it halts, then the cap's reason is reported and is not masked by
  a later reason, and each of the block's HALT reasons remains distinct and carries its class.
- Given a lap whose effective verdict is PASS, when routing resolves, then no kickback is consumed
  and no cumulative counter advances.
- Given a disposition store that is unreadable or a legacy scalar verdict, when the predicate is
  consulted, then today's raw-aggregate behavior proceeds unchanged — a store failure never invents a
  pass and never blocks routing.

### Done When
- [ ] The exit set is derived by grep over the FAIL block and every exit is covered; a test fails if
      an uncovered exit is added.
- [ ] The `/remediate` refusal HALT case is pinned end to end.
- [ ] Cap-first ordering and all distinct HALT reasons are asserted intact.

---

## Story 5: A disposition that cannot bind is reported, never silently dropped

**Requirement:** outcome-3

As an operator, I want to be told which accepted disposition matched a finding and which stored
disposition could not bind, so that an acceptance that stops working is diagnosable instead of
looking like a fresh defect.

### Acceptance Criteria

#### Happy Path
- Given a lap where an accepted disposition binds, when the result is reported, then the output names
  the matched disposition, not only the finding id.
- Given a stored disposition recorded under a superseded contract version, when the effective verdict
  is resolved, then it is reported as version-invalidated with its finding id and rubric.
- Given that invalidation, when it is reported, then it rides the existing event union and is
  declared in `EVENT_SINKS` as auditable — no sidecar file and no bare log line.

#### Negative Paths
- Given a store containing a superseded-version record, when it is read, then the store still parses
  and the gate reports an honest non-binding disposition rather than "disposition state is
  malformed".
- Given a superseded-version record, when matching runs, then it does not bind — reporting it must
  never resurrect it.
- Given a store that is genuinely malformed, when it is read, then the existing fail-closed behavior
  is unchanged.

### Done When
- [ ] The version parser accepts both contract versions; a single stored superseded record is
      asserted not to make the store unreadable.
- [ ] The invalidation event exists in the union and its sink declaration is asserted.
- [ ] The matched-disposition reporting is asserted on the operator-facing findings output.

---

## Story 6: The vocabulary has one source and cannot drift from the skill contracts

**Requirement:** outcome-1

As a maintainer, I want the four rubric skill contracts bound mechanically to the engine's
vocabulary, so that this repair does not replace one self-contradicting contract with four.

### Acceptance Criteria

#### Happy Path
- Given the engine's vocabulary source, when a rubric's dispatch schema and rejection diagnosis are
  rendered, then both derive from that one source rather than a copy.
- Given the four `skills/build-review-*/SKILL.md` result contracts, when the integrity suite runs,
  then each rubric's enumerated members are asserted equal to the engine set in both directions.
- Given each rubric's initial member set, when it is checked against the observed corpus, then it
  covers every value real graders have already emitted for that rubric.

#### Negative Paths
- Given a member added to the engine set but not to its SKILL.md, when the integrity suite runs, then
  it fails and names the missing member.
- Given a member removed from the engine set but left in a SKILL.md, when the integrity suite runs,
  then it fails.
- Given a SKILL.md that still promises "an enumerated concern kind" without enumerating one, when the
  integrity suite runs, then it fails — the condition that created this defect cannot return.

### Done When
- [ ] One engine source feeds the schema, the diagnosis, and the validator.
- [ ] The integrity check binds all four SKILL.md enumerations bidirectionally and is registered in
      the suite's enumeration.
- [ ] Corpus coverage per rubric is asserted.

---

## Assumption flagged for approval (per `/verify-claims`)

**`.daemon/evals-raw` is representative of production grader output** — 80%, inferred. It carries 337
`concernKind` uses across at least five features, collected off real builds rather than fixtures, and
the drift this feature fixes is directly visible in it. But it skews recent, and tautology and
rootCause show roughly 21 distinct values over only ~23 and ~29 uses respectively — thin evidence
that a closed set covers them.

Impact if wrong: a set that is too narrow sends graders down Story 3's rerun path routinely, turning
a correctness fix into a throughput problem on the daemon's critical path — precisely the failure
`adr-2026-07-07-task-trailer-id-alias` and `adr-2026-07-21-no-diff-task-evidence-stamp` record. The
plan discharges this by deriving each set from the corpus and asserting coverage **before** the
rejection path is armed. If a rubric's observed values cannot be covered by a set small enough to be
meaningful, that is a design fork for the operator — it must halt, not be worked around by widening
the set until it means nothing.
