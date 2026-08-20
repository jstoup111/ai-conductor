**Status:** Accepted

# Stories: Clean rubric judgements rejected as invalid-provider-result

**Issue:** #1683
**Track:** technical (no PRD — acceptance criteria live here)
**Design:** [ADR](../decisions/adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md) ·
[Architecture review](../decisions/architecture-review-2026-08-19-clean-rubric-judgements-rejected-as-invalid-provid.md)

On the technical track the **Requirement:** line cites the approved ADR decision the story derives
from (`D1`–`D10`) and the issue outcome it satisfies (`O1`–`O7`, `O9`). Outcome `O8` — the operator
lever for a drained retry budget — is deliberately out of scope and belongs to
`review-infrastructure-failures-are-operator-unreco`.

| Outcome | Statement |
|---|---|
| O1 | A judged result satisfying every contract requirement is accepted, and the rubric that emitted it never reports `invalid-provider-result`. |
| O2 | Staleness protection is preserved: a judgement bound to a different lap or snapshot never settles as current. |
| O3 | A recorded rejection names the requirement that actually failed for the payload being rejected, and never names a field absent from it. |
| O4 | The same rubric produces a consistent judged-result envelope across repeated attempts. |
| O5 | A non-canonical anchor reference is diagnosed by name and by the form it must take. |
| O6 | A repair turn that produces byte-identical output does not consume the remaining allowance. |
| O7 | Reference-scoped rejections are diagnosable — the diagnosis sees what the authoritative check saw. |
| O9 | A parser-enforced reference grammar that the rubric contracts do not state fails the integrity suite. |

---

## Story 1: The provider supplies only findings, and the engine stamps the envelope

**Requirement:** D2 · O1, O4

As the build_review coordinator, I want to construct the judged-result envelope from values I
already hold, so that a completed judgement is never discarded because a model mis-transmitted
engine bookkeeping.

### Acceptance Criteria

#### Happy Path
- Given a dispatched rubric whose provider returns `{"findings": []}` and nothing else, when the
  dispatch settles, then the branch resolves as a judged PASS carrying `kind: "judged"`, the
  dispatched rubric's id, `contractVersion: "v3"`, and the projection's `lapId` and
  `snapshotDigest`.
- Given a provider that returns one well-formed finding and no envelope fields, when the dispatch
  settles, then the branch resolves as a judged FAIL whose single finding is preserved verbatim and
  whose envelope is engine-supplied.

#### Negative Paths
- Given a provider response containing no parseable JSON object at all, when validation runs, then
  the branch settles as an infrastructure failure whose recorded diagnostic detail states that no
  JSON object was found, and the engine does not fabricate an empty findings array. The closed
  branch-reason vocabulary is unchanged — this feature adds no member to it.
- Given a provider response whose `findings` is present but is not an array (an object, a string,
  or null), when validation runs, then the branch is rejected and the diagnosis names `findings`
  and the array form it requires.
- Given a provider response whose `findings` array contains one malformed finding among several
  well-formed ones, when validation runs, then the whole result is rejected — no partial acceptance
  — and the diagnosis names the offending index.

### Done When
- [ ] A judged result assembled from a provider payload of exactly `{"findings": [...]}` settles as
      `kind: "dispatched"` and is persisted as a branch artifact.
- [ ] The persisted artifact's `kind`, `rubric`, `contractVersion`, `lapId` and `snapshotDigest`
      equal the engine-held values, with no provider input to any of them.
- [ ] A test asserts that a payload carrying only `findings` is accepted where the pre-change code
      rejected it.
- [ ] No member is added to the closed infrastructure-failure reason vocabulary; the requirement
      that failed is carried in the diagnostic detail.

---

## Story 2: Lap and snapshot identity are stamped from the projection, never echoed

**Requirement:** D1 · O1, O2

As the build_review coordinator, I want to bind lap and snapshot identity from the projection that
produced the dispatch, so that the fresh path behaves exactly as the cache-hit path already does.

### Acceptance Criteria

#### Happy Path
- Given a dispatched rubric for lap `L` against snapshot digest `S`, when the branch settles, then
  the persisted artifact carries `lapId: L` and `snapshotDigest: S` taken from the projection.
- Given two rubrics dispatched concurrently on the same lap, when both settle, then both artifacts
  carry that lap's identity and neither depends on any value present in a provider response.

#### Negative Paths
- Given a provider response that omits `lapId` and `snapshotDigest` entirely, when the branch
  settles, then it settles successfully with engine-stamped identity and **no**
  `invalid-provider-result` is recorded — this is the `reporting_app` 2026-08-16 shape.
- Given a persisted branch artifact whose stored result carries a lap id different from the
  directory lap it is read back under, when the artifact is re-read, then it is rejected as stale
  rather than served — the at-rest identity check is unchanged.
- Given a cache entry whose stored judgement was authored under an earlier lap, when it is served
  as a hit, then it is stamped into the current lap's artifact with current identity and explicit
  cache provenance, exactly as before this change.

### Done When
- [ ] A test dispatches a rubric whose provider omits both identity fields and asserts a judged
      settlement, not an infrastructure failure.
- [ ] No code path compares a provider-supplied `lapId` or `snapshotDigest` against a projection
      value.
- [ ] Existing cache-hit stamping and at-rest staleness tests pass unchanged.

---

## Story 3: Provider-supplied envelope fields are ignored, never validated

**Requirement:** D4 · O1, O4

As an operator, I want a provider that still emits the old full envelope to keep working, so that
narrowing the contract cannot break a rubric mid-flight.

### Acceptance Criteria

#### Happy Path
- Given a provider response carrying the complete v3 envelope with correct values, when the dispatch
  settles, then it settles as judged and is indistinguishable from a `findings`-only response.
- Given a provider response carrying extra unrecognized top-level keys alongside `findings`, when
  the dispatch settles, then the extra keys are discarded and the judgement settles.

#### Negative Paths
- Given a provider response whose `kind` is `"status"` or `"type"` rather than `"judged"`, when the
  dispatch settles, then it settles as judged with the engine's own `kind` — this is the second
  `reporting_app` 2026-08-16 shape and it no longer rejects.
- Given a provider response whose `rubric` names a different rubric than the one dispatched, when
  the dispatch settles, then the engine's rubric wins and no failure is raised on the mismatch
  alone.
- Given a provider response whose `contractVersion` is `"v1"`, when the dispatch settles, then the
  engine stamps `"v3"` and the findings are parsed under the v3 anchor rules.

### Done When
- [ ] A test asserts each of the three recorded drifted envelopes (`status`, `type`, missing
      identity) settles as judged.
- [ ] No provider-supplied envelope value can cause a rejection by itself.
- [ ] The wire parse extracts `findings` and discards every other top-level key.

---

## Story 4: The engine asserts its own rubric invariant at settlement

**Requirement:** D5 · O2

As the build_review coordinator, I want to assert that a branch's rubric matches its projection's
rubric, so that dropping the provider echo does not depend on an inference that concurrent branch
results cannot cross.

### Acceptance Criteria

#### Happy Path
- Given a branch dispatched for rubric `R` with the projection derived for `R`, when settlement
  runs, then the invariant holds and the branch settles normally with no added event or diagnostic.

#### Negative Paths
- Given a branch whose projection's rubric does not equal the branch's own rubric, when settlement
  runs, then the branch settles as an infrastructure failure naming the invariant violation, and no
  artifact is written under either rubric.
- Given four rubrics dispatched concurrently, when all settle, then each artifact is written under
  its own rubric and no rubric's findings appear under another's artifact.

### Done When
- [ ] The invariant is checked against two engine-held values and never against provider output.
- [ ] A test constructs a mismatched branch/projection pair and asserts the infrastructure failure.
- [ ] A concurrent four-rubric test asserts per-rubric artifact isolation.

---

## Story 5: The contract version stays v3 and no judgement is invalidated

**Requirement:** D3 · O2

As an operator with features in flight, I want the narrowed wire contract to cost no re-judge lap,
so that the fix does not spend provider budget across every open feature.

### Acceptance Criteria

#### Happy Path
- Given a rubric cache entry written before this change, when the same projection is graded after
  it, then the entry is served as a cache hit and no fresh dispatch occurs.
- Given a branch settled after this change, when its artifact is persisted, then the stored result
  is a full envelope carrying `contractVersion: "v3"`, unchanged in shape from before.

#### Negative Paths
- Given a persisted `v1` or `v2` result in the cache or an artifact, when it is parsed at rest,
  then it parses successfully under the version it declares, exactly as before.
- Given a projection whose content changed, when cache identity is computed, then the entry misses
  — the provenance keys `lapId` and `snapshotDigest` remain excluded from the digest and do not
  become identity inputs as a side effect of this change.

### Done When
- [ ] `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION` is unchanged at `v3`.
- [ ] A test proves a pre-change cache entry is served as a hit after the change.
- [ ] A test proves `v1` and `v2` records still parse at rest.

---

## Story 6: A rejection never asserts a cause it did not test

**Requirement:** D6 · O3

As an operator reading a halted build, I want the recorded reason to describe the payload actually
rejected, so that I am not sent to fix a field the payload does not contain.

### Acceptance Criteria

#### Happy Path
- Given a rejected result whose failure one enumerated check explains, when the diagnosis is
  produced, then it names that requirement and only that requirement.
- Given a rejected result with several independent problems, when the diagnosis is produced, then
  each named problem is one the diagnosis actually evaluated.

#### Negative Paths
- Given a rejected result that carries neither `verdict` nor `passed`, when the diagnosis is
  produced, then it never claims a `verdict`/`passed` contradiction — this is the 2026-08-19
  `completeness` failure and it must be impossible by construction.
- Given a rejected result that no enumerated check explains, when the diagnosis is produced, then
  it reports the rejection as unexplained and names no cause.
- Given a rejected result that genuinely carries a `verdict` contradicting its findings, when the
  diagnosis is produced, then the contradiction IS named — the honest case must not be lost with
  the fabricated one.

### Done When
- [ ] The fall-through branch reports an unexplained rejection instead of asserting a cause.
- [ ] A test replays the recorded 2026-08-19 payload and asserts the diagnosis does not mention
      `verdict` or `passed`.
- [ ] Every rejection cause enumerated before this change retains a test that fails if that specific
      diagnosis stops being produced (architecture-review Condition 1).

---

## Story 7: The diagnosis sees exactly what the authoritative check saw

**Requirement:** D6 · O7

As the dispatch layer, I want the rejection diagnosis bound to the same projection reference context
as the authoritative predicate, so that reference-scoped rejections can be described at all.

### Acceptance Criteria

#### Happy Path
- Given a rejected result whose anchor cites a path absent from the projection's changed paths, when
  the diagnosis is produced, then it names the field, the value it carried, and that the value is
  not among the projection's references.
- Given a rejected result whose anchor cites a content region whose hash is absent from the
  projection, when the diagnosis is produced, then it names the region field and the mismatch.

#### Negative Paths
- Given a rejected result whose anchor cites a plan task absent from the projection's plan tasks,
  when the diagnosis is produced, then it names `anchor.planTask` and the membership failure — not
  a generic contract message.
- Given a rejected result whose `completeness` anchor cites a surface not owned by the cited task,
  when the diagnosis is produced, then it names the task-ownership failure specifically.
- Given a diagnosis invocation that throws for any reason, when the dispatch continues, then the
  branch still settles with a bounded generic rejection rather than a thrown provider error —
  the existing guard is preserved.

### Done When
- [ ] The diagnosis call receives the same reference context the authoritative predicate receives.
- [ ] A test asserts that each reference-membership failure class produces a specifically named
      diagnosis.
- [ ] The existing throw-guard around the diagnosis is retained and covered.

---

## Story 8: A non-canonical anchor reference is named with the form it must take

**Requirement:** D6 · O5

As a rubric model receiving a repair instruction, I want to be told which reference was malformed
and what shape it must have, so that the repair turn can actually converge.

### Acceptance Criteria

#### Happy Path
- Given a rejected result whose `anchor.planTask` cannot be reduced to a canonical id at all — free
  prose such as `the install channel resolution step` — when the diagnosis is produced, then it
  names `anchor.planTask`, quotes the bounded offending value, and states the canonical form
  required.
- Given a rejected result whose `anchor.path` does not match the canonical path grammar, when the
  diagnosis is produced, then it names the field and the required form.

#### Negative Paths
- Given a rejected result whose `anchor.planTask` is non-empty but non-canonical, when the diagnosis
  is produced, then the presence check alone does not pass it silently — the canonical-form failure
  is detected and reported.
- Given a rejected result whose anchor value is an extremely long string, when the diagnosis is
  produced, then the quoted value is bounded and the diagnosis does not embed unbounded provider
  content.
- Given a rejected result whose anchor omits a required field entirely, when the diagnosis is
  produced, then the absence is reported as absence, not as a form failure.

### Done When
- [ ] Anchor field checks distinguish absent, present-but-wrong-type, and present-but-non-canonical.
- [ ] A test asserts that an `anchor.planTask` carrying free prose with no recoverable task id
      produces a diagnosis naming `anchor.planTask` and the canonical form. The recoverable
      `Task N: <title>` form is Story 9's case and must NOT be a rejection here.
- [ ] Quoted values in the diagnosis are length-bounded.

---

## Story 9: A titled plan-task reference normalizes to its canonical id

**Requirement:** D9 · O1

As the finding-identity parser, I want to accept `Task N: <title>` and reduce it to the bare
canonical id, so that a legible reference produces the same identity a bare id produces.

### Acceptance Criteria

#### Happy Path
- Given an anchor whose `planTask` is `Task 7: The resolved channel and its source are confirmed in
  the output`, when the finding is parsed, then it binds to plan task `7` and the resulting finding
  identity is byte-identical to the identity produced by the bare reference.
- Given an anchor whose `planTask` is already the bare canonical id, when the finding is parsed,
  then normalization leaves it unchanged.

#### Negative Paths
- Given an anchor whose `planTask` normalizes to an id absent from the projection's plan tasks, when
  the finding is parsed, then it is rejected on membership, not silently accepted by normalization.
- Given an anchor whose `planTask` is prose with no recoverable task id, when the finding is parsed,
  then it is rejected and the diagnosis names the required form — normalization must not guess.
- Given two findings whose `planTask` values differ only in title text but share an id, when both
  are canonicalized, then they collide as one identity and the result is rejected as a duplicate,
  preserving the existing collision rule.

### Done When
- [ ] Normalization runs ahead of the existing plan-task reference kind and introduces no new
      reference kind.
- [ ] A test proves the titled and bare forms yield an identical finding identity hash.
- [ ] A test proves an unrecoverable prose reference is rejected rather than guessed.

---

## Story 10: The rubric contracts state the reference grammars they are held to

**Requirement:** D10 · O5

As a rubric model, I want the contract text to state the form each reference must take, so that I
am not held to a grammar I was never shown.

### Acceptance Criteria

#### Happy Path
- Given each of the four rubric result contracts, when its anchor section is read, then every anchor
  field the parser holds to a canonical grammar states that grammar.
- Given the rendered judged-result shape template, when it is assembled for a dispatch, then it
  carries no `lapId` or `snapshotDigest` placeholder and no echo instruction.

#### Negative Paths
- Given a rubric contract that describes an anchor field only as a free reference where the parser
  requires a canonical grammar, when the drift guard runs, then the integrity suite fails naming the
  rubric and the field.
- Given the dispatch prompt, when it is assembled, then it does not instruct the model to echo any
  engine-held value, and the repair prompt does not either.

### Done When
- [ ] All four `skills/build-review-*/SKILL.md` result contracts state the canonical reference
      grammars for their anchor fields.
- [ ] `renderBuildReviewJudgedResultShape` renders a `findings`-only template.
- [ ] Neither the dispatch prompt nor the repair prompt contains an echo instruction.

---

## Story 11: A repair that cannot converge does not spend the remaining retry budget

**Requirement:** D7 · O6

As an operator, I want a repair turn whose output is identical to the output it was asked to repair
to stop, so that an unactionable instruction cannot drain the existing step retry budget into a
terminal halt. This story concerns the step retry counter that exists today — the one that reached
`retries exhausted` after three attempts on 2026-08-19 — and not the mechanical allowance owned by
`review-infrastructure-failures-are-operator-unreco`.

### Acceptance Criteria

#### Happy Path
- Given a rejected result whose repair turn returns a corrected payload, when validation runs, then
  the repaired result settles as judged and no step retry is consumed.

#### Negative Paths
- Given a repair turn whose output is byte-identical to the output it was repairing, when the
  dispatch settles, then the branch settles immediately as an infrastructure failure and the
  remaining step retries are not consumed.
- Given a repair turn whose output differs but still fails validation, when the dispatch settles,
  then the branch settles as an infrastructure failure carrying the repaired payload's own
  diagnosis, not the pre-repair one.
- Given a repair invocation that fails to return output at all, when the dispatch settles, then the
  existing failure path is preserved and the initial diagnosis is recorded.

### Done When
- [ ] The byte-identical comparison is made against the exact output passed to the repair turn.
- [ ] A test replays the recorded three byte-identical repair pairs and asserts the step retry
      budget is preserved.
- [ ] The recorded diagnosis always describes the last payload validated.

---

## Story 12: A parser-enforced grammar cannot ship without its instruction

**Requirement:** D10 · O9

As a future author tightening a reference parser, I want the integrity suite to fail if the rubric
contracts do not state my new grammar, so that I cannot repeat the regression this issue records.

### Acceptance Criteria

#### Happy Path
- Given engine-defined reference grammars that every rubric contract states, when the drift guard
  runs, then it passes and reports the rubric/field pairs it checked.
- Given the drift guard, when the full integrity suite runs, then the guard is invoked as part of it
  and not only when run directly.

#### Negative Paths
- Given a reference grammar tightened in the engine but not stated in the affected rubric contract,
  when the drift guard runs, then it fails naming the rubric, the field, and the unstated grammar.
- Given a grammar stated in a rubric contract that the engine no longer enforces, when the drift
  guard runs, then it fails on the stale direction too, so the contract cannot over-promise.
- Given the engine definition source is unreadable or its grammar block cannot be extracted, when
  the drift guard runs, then it fails closed with a diagnostic rather than passing on an empty
  comparison.

### Done When
- [ ] `test/check_build_review_rubric_skill_vocabularies.sh` covers reference grammars in addition
      to closed vocabularies.
- [ ] The guard fails in both directions and fails closed on an unreadable source.
- [ ] A fixture proves the #1696 shape — parser tightened, contract prose unchanged — is caught.
