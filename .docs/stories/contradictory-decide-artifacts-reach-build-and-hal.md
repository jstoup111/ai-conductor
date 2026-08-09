# Stories: ADR contradiction detection across DECIDE

**Status:** Accepted

Source: intake #1391. Track: technical (no PRD — acceptance criteria live here).
Tier: M. Governing decisions: `adr-2026-08-09-adr-contradiction-detection-in-two-halves`,
`adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`.

Requirement citations reference intake #1391's desired outcomes (`outcome-1` … `outcome-4`) and
the two approved ADRs. There is no `FR-N` layer on the technical track.

---

## Story 1: conflict-check reads approved ADRs as a comparison party

**Requirement:** outcome-1, outcome-3; adr-2026-08-09-adr-contradiction-detection-in-two-halves

As an operator running DECIDE, I want the conflict scan to compare approved ADRs against stories
so that a contradiction between them is reported before the plan is approved, rather than
surfacing mid-BUILD as a needs-human halt.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `.docs/decisions/` holds an approved ADR requiring a warning emitted once
  per discovery pass, and whose `.docs/stories/` holds a story requiring that warning not repeat
  on the next poll, when conflict-check runs, then it reports a **blocking** conflict naming that
  ADR and that story as the two sides.
- Given a feature with approved ADRs and stories that do not contradict, when conflict-check runs,
  then the ADR-versus-story sweep reports zero conflicts and the step proceeds to plan.
- Given an ADR-versus-story pair where satisfying either fully breaks the other, when
  conflict-check applies the existing two-directional heuristic, then the conflict is classified
  with the existing `oscillating` type rather than a newly invented type name.

#### Negative Paths
- Given a feature with an empty `.docs/decisions/` directory, when conflict-check runs, then the
  ADR sweep contributes no conflicts and no error is raised for the missing corpus.
- Given a feature with no `.docs/decisions/` directory at all, when conflict-check runs, then the
  step completes normally rather than failing on a missing path.
- Given an ADR whose status is superseded, when conflict-check builds its comparison corpus, then
  that ADR is excluded, because a superseded decision is not binding and would raise a conflict
  against a story that correctly implements its replacement.
- Given a `.docs/decisions/` directory containing `architecture-review-*.md` and `review-*.md`
  report files alongside ADRs, when conflict-check builds its corpus, then only the ADRs are
  treated as decision statements and the review reports raise no conflicts.

> **Amended 2026-08-09 by #1391 (first amendment — superseded 2026-08-09, see below):** the corpus
> **scope** is configurable and defaults to this spec's own change-set ADRs, with the repo-wide
> sweep over all approved ADRs gated behind `conflict_check.adr_corpus: repo_wide` (default-off,
> enabled in this repository only) — see
> `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`. ~~The scenarios above hold at
> both scopes.~~ The two scenarios below apply to `repo_wide` **only**, where the corpus is 177
> approved ADRs and the risks of narrowing and superseded-status ambiguity actually arise; at the
> default scope neither a narrowing step nor superseded parsing is needed.

> **Amended 2026-08-09 by #1391 (second amendment — oscillation fix):** the struck sentence above
> asserted that the base scenarios "hold at both scopes", and that was **false in two ways**. An
> oscillation check found both, and this amendment replaces the claim rather than restating it.
>
> **(a) Which ADRs the base happy path covers.** It reads "a feature whose `.docs/decisions/`
> *holds* an approved ADR". At `change_set` scope an ADR the directory holds but which is **not in
> this spec's change set** raises no conflict, so the base scenario as literally written is only
> satisfiable at `repo_wide`. Implementing it broadly contradicts the default; implementing the
> default fails the scenario — each fix trips the other gate, which is the non-terminating shape.
> **Resolution:** the base happy and negative paths above are hereby scoped to **the ADRs in the
> spec's own change set**, which is the default. Read every base "`.docs/decisions/` holds …" as
> "the change set carries …". The #1391 failure this spec was filed for is covered at that scope,
> because its contradicting ADR was authored in the same spec.
>
> **(b) Superseded parsing.** The struck sentence claimed the base scenarios — which include the
> superseded-exclusion negative path — hold at both scopes, while the same amendment said "at the
> default scope neither a narrowing step nor superseded parsing is needed". Both cannot be true.
> **Resolution:** superseded-exclusion is a **`repo_wide`-only** concern and is restated below with
> the conservative rule. At `change_set` scope a spec's own freshly-approved ADRs are never
> superseded, so no status parsing is required.
>
> The `repo_wide` scenarios below are additive on top of the change-set base, not a replacement.

#### Happy Path (`repo_wide` only)
- Given `adr_corpus: repo_wide` and a corpus of 177 approved ADRs, when conflict-check runs, then it
  first narrows to the ADRs whose subject overlaps this spec's stories, runs the two-directional
  heuristic on that subset, and **records both the examined set and the narrowed-out set** in the
  conflict report — so a sweep that examined nothing is distinguishable from one that found nothing.
- Given `adr_corpus: repo_wide` and an **inherited** approved ADR that is not in this spec's change
  set but contradicts one of its stories, when conflict-check runs, then that contradiction is
  reported as a blocking conflict. This is the coverage the change-set default does not provide,
  and the reason the repo-wide mode exists.

#### Negative Paths (`repo_wide` only)
- Given an ADR whose status reads as a *partial* supersession — for example
  `SUPERSEDED in part by <a> (BUILD-tail ordering only)` or `APPROVED; finish-boundary behavior
  amended by <x>` — when the corpus is built, then that ADR is **retained** for comparison, because
  only an unambiguous full supersession excludes an ADR: a false conflict costs one adjudication
  while a false clean costs a mid-BUILD halt.
- Given an ADR whose status is an unambiguous **full** supersession, when the `repo_wide` corpus is
  built, then that ADR is excluded — this is the sole scope at which superseded-status parsing runs
  at all, per amendment (b) above.
- Given `adr_corpus` is unset in a consumer repository, when conflict-check runs, then it uses the
  change-set scope and performs no narrowing and no superseded parsing.

### Done When
- [ ] `skills/conflict-check/SKILL.md` §1 Inventory lists `.docs/decisions/` as a loaded input
      alongside `.docs/stories/`, `.docs/specs/`, and `.docs/conflicts/`.
- [ ] The skill's conflict-type list is unchanged in membership — the ADR sweep reuses the existing
      six types, adding no seventh.
- [ ] The skill states that superseded ADRs are excluded from the comparison corpus.
- [ ] `skills/conflict-check/SKILL.md` Verification section covers the ADR-versus-story sweep.
- [ ] The `conflict_check.adr_corpus` key exists with default `change_set`, is documented in
      `docs/reference/configuration.md`, and is set to `repo_wide` in this repository's
      `.ai-conductor/config.yml`.
- [ ] The skill scopes the narrowing requirement and the conservative superseded rule to
      `repo_wide` explicitly, so the default path carries neither.

---

## Story 2: a blocking ADR conflict names both sides verbatim

**Requirement:** outcome-2

As an operator adjudicating a blocking conflict, I want the report to quote what each artifact
actually requires so that I can decide without re-reading the whole corpus.

### Acceptance Criteria

#### Happy Path
- Given a blocking ADR-versus-story conflict, when the conflict report is written to
  `.docs/conflicts/`, then it contains the ADR's filename stem, the story's id, and a verbatim
  quotation of the specific opposing sentence from each side.
- Given that same report, when an operator reads it without opening any other file, then the
  report alone states which artifact requires what, and offers ranked resolution options with a
  recommendation.

#### Negative Paths
- Given a suspected contradiction that cannot be grounded in quoted text from both artifacts, when
  the scan completes, then it is surfaced as an assumption for the operator rather than recorded
  as a conflict finding — an ungrounded suspicion is never reported as a verdict.
- Given a conflict whose opposing text spans several sentences, when the report quotes it, then
  the quotation is elided with an explicit marker rather than silently truncated or reworded.

### Done When
- [ ] The skill's conflict report format requires a verbatim quotation from each side of an
      ADR-versus-story conflict, attributed to its source artifact.
- [ ] A worked ADR-versus-story example appears in the skill showing both quoted sides.

---

## Story 3: coherence-check authors `adr` rows using the existing verdict vocabulary

**Requirement:** outcome-3; adr-2026-08-09-adr-contradiction-detection-in-two-halves

As a DECIDE author, I want each approved ADR to get an adjudicated row in the coherence artifact
so that the adjudication is recorded rather than merely requested.

### Acceptance Criteria

#### Happy Path
- Given a spec carrying two approved ADRs, when coherence-check authors
  `.docs/coherence/<plan-stem>.md`, then it emits one `adr` row per ADR, cited as
  `adr-<filename-stem>`, with the implementing story or task ids as counterparts.
- Given an ADR that a story implements faithfully, when the row is written, then its verdict is
  `covered`.
- Given an ADR whose implementing story contradicts it, when the row is written, then its verdict
  is `fail` and its Notes begin with `CONTRADICTS:` naming the counterpart and quoting the
  opposing text.
- Given an ADR that no story or task implements, when the row is written, then its verdict is
  `gap` and its Notes restate the gap id as `adr-<filename-stem>`.

#### Negative Paths
- Given an ADR row whose true state is a contradiction, when the author is tempted to record a
  more descriptive verdict such as a new "contradiction" string, then the artifact uses `fail`
  instead — because `NEGATIVE_VERDICTS` treats every unrecognized string as affirmative, so an
  invented verdict would silently pass the gate rather than block.
- Given a spec on the technical track with no PRD, when the artifact is authored, then `adr` rows
  are still emitted and the `fr` row class remains omitted — the two are independent.
- Given an ADR whose coverage is genuinely ambiguous, when the author cannot confirm it, then the
  row is surfaced to the operator for confirmation in an interactive run, and recorded as `gap` in
  an autonomous run — never silently marked covered.

### Done When
- [ ] `skills/coherence-check/SKILL.md` §4a declares `adr` as a fifth row class with its cited-id
      form and counterpart definition.
- [ ] §4b's verdict vocabulary is unchanged in membership — no new verdict string is introduced.
- [ ] §4c's gap-id scheme lists `adr-<filename-stem>`.
- [ ] §4d's consistency pass names ADR-versus-story as a cross-layer pair to check.

---

## Story 4: the validator accepts and cross-checks the `adr` row class

**Requirement:** adr-2026-08-09-adr-contradiction-detection-in-two-halves

As the land-time gate, I want to parse `adr` rows so that the row class the skill emits is
recognized rather than rejected.

### Acceptance Criteria

#### Happy Path
- Given a coherence artifact containing a row whose row-class cell is `adr`, when
  `parseCoherenceArtifact` runs, then the row parses and is returned with `rowClass: 'adr'`.
- Given an `adr` row citing an ADR that exists in the change set, when `crossCheckIds` runs, then
  the citation resolves and no fabricated-id rejection is raised.
- Given a mixed artifact with `outcome`, `story`, `task`, and `adr` rows, when the artifact is
  parsed, then all four classes are preserved with their verdicts intact.

#### Negative Paths
- Given an `adr` row citing an ADR filename stem that exists in no file in the change set, when
  `crossCheckIds` runs, then the citation is rejected as fabricated and the gate fails closed — a
  plausible-looking stem is not coverage.
- Given a coherence artifact using an unknown row class such as `decision`, when it is parsed,
  then that row is still rejected — this change widens the closed set by exactly one member and
  does not open it.
- Given skill prose emitting `adr` rows against a validator without this change, when the gate
  runs, then every such row is rejected at parse — which is why both halves must ship in one
  change set and neither may land alone.

### Done When
- [ ] `CoherenceRowClass` includes `'adr'`.
- [ ] The `ROW_CLASSES` set includes `'adr'` and still rejects any other unknown class.
- [ ] `crossCheckIds` derives an ADR id pool and validates `adr` row citations against it.

---

## Story 5: the `adr` layer is required only when the change set carries ADRs

**Requirement:** outcome-4; adr-2026-08-09-adr-layer-gated-by-committed-adr-signal

As a maintainer, I want the new layer gated on a committed signal so that adding it does not
retroactively fail specs that were never asked to author `adr` rows.

### Acceptance Criteria

#### Happy Path
- Given an engaged gate whose change set contains a file matching `.docs/decisions/adr-`, when
  `resolveRequiredLayers` runs, then the returned layer set includes `adr`.
- Given an engaged gate whose change set contains no path starting with `.docs/decisions/adr-`,
  when `resolveRequiredLayers` runs, then the returned layer set omits `adr` and the layer is not
  enforced.
- Given the derivation is added, when the function signature is inspected, then it takes the same
  parameters as before — the existing `changeSet` argument supplies the signal and no new
  parameter is introduced.

#### Negative Paths
- Given a change set containing only `.docs/decisions/architecture-review-2026-08-09-foo.md` and
  `.docs/decisions/review-bar.md`, when layer derivation runs, then `adr` is **not** required —
  the prefix test is `.docs/decisions/adr-`, not the bare directory, because review reports are
  not ADRs and have no counterpart to adjudicate.
- Given a spec at tier S whose change set carries ADRs, when the gate resolves, then it returns
  disengaged with reason `tier-exempt` and the `adr` layer is never derived, because the tier
  check short-circuits before layer derivation.
- Given a change set with ADRs but no `.docs/coherence/` path at all, when the gate resolves, then
  it returns disengaged with reason `legacy-change-set` and the `adr` layer is never derived.
- Given a change set whose only ADR path is a deletion of an existing ADR, when layer derivation
  runs, then the layer requirement reflects the ADRs actually present after the change rather than
  demanding a row for a removed decision.

> **Amended 2026-08-09 by #1391:** the assertion above is preserved as the required *observable
> outcome* (a removed decision never demands a row), but it is delivered at **pool derivation**, not
> at layer derivation. `resolveRequiredLayers` receives paths without status codes, so it cannot
> distinguish a deletion; the layer therefore still engages on a deletion-only change set, over an
> empty pool. The scenario below replaces the mechanism while keeping the outcome, and preserves
> this story's happy-path requirement that the function's signature not change. See
> `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` (amended).

- Given a change set whose only ADR path is a **deletion**, when the gate runs, then layer
  derivation still adds `adr` (the signal cannot see status), the ADR **pool** derived inside
  `runCoherenceGate` from the status-carrying change list **excludes** the deleted file, and the
  spec passes with no row demanded for the removed decision.

### Done When
- [ ] `CoherenceRequiredLayer` includes `'adr'`.
- [ ] `resolveRequiredLayers` adds `adr` to the layer set only when a change-set path starts with
      `.docs/decisions/adr-`, with no signature change.
- [ ] A test proves a change set of review-report files alone does not require the layer.
- [ ] Tests prove tier-S and legacy-change-set specs never reach layer derivation.
- [ ] The ADR pool excludes deleted ADRs, and a test proves a deletion-only change set passes the
      gate with the layer engaged over an empty pool.

---

## Story 6: an unadjudicated or negative-verdict ADR blocks the land

**Requirement:** outcome-1, outcome-3; adr-2026-08-09-adr-contradiction-detection-in-two-halves

As the land gate, I want to reject a spec whose approved ADR was never adjudicated so that a
skipped pass is distinguishable from a clean one.

### Acceptance Criteria

#### Happy Path
- Given a spec whose change set carries two ADRs and whose coherence artifact holds a `covered`
  row for each, when the gate runs, then it passes silently with no operator prompt.
- Given a spec whose change set carries an ADR with **no** corresponding `adr` row in the
  coherence artifact, when the gate runs, then it blocks with a gap whose id is
  `adr-<filename-stem>`, naming the unadjudicated ADR.
- Given an `adr` row with verdict `gap` or `fail`, when the gate runs, then it blocks and the gap
  appears in the rendered report under the `adr` layer.
- Given several gaps across different layers, when the report renders, then `adr` gaps appear in
  the fixed layer order deterministically, so identical input renders byte-identical output.

#### Negative Paths
- Given an `adr` row whose verdict cell holds an unrecognized string, when the gate evaluates it,
  then the row is treated as affirmative by the existing `NEGATIVE_VERDICTS` semantics — the
  skill-side prohibition on inventing verdicts is the control here, and a test documents this
  behavior so the footgun is not rediscovered.
- Given an ADR gap that a `.docs/coherence-waivers/<plan-stem>.md` waiver names by its exact
  `adr-<filename-stem>` id, when the gate evaluates waivers, then the gap is waived through the
  existing waiver mechanism with no ADR-specific waiver path added.
- Given the gate blocks on an ADR gap, when the error is raised, then it names every unresolved
  gap id rather than only the first, matching the existing aggregate-report behavior.
- Given the coherence gate runs, when it evaluates ADR approval, then it performs no status
  parsing at all — approval is already guaranteed by land's existing unapproved-ADR gate, which
  runs earlier in the same land path.

### Done When
- [ ] `CoherenceGapLayer` and `GAP_LAYER_ORDER` include `'adr'` at a fixed position.
- [ ] `checkAdrCoverage` exists as a sibling of the five existing per-layer checks and is wired
      into `validateCoherence`.
- [ ] The ADR pool is derived from the change-set list the gate already computes — no additional
      git invocation is introduced.
- [ ] No ADR status-parsing code is added, and no reference to a symbol absent from the base
      branch is introduced.
- [ ] A blocking run names every unresolved ADR gap id in one error.

---

## Story 7: existing and exempt specs are unaffected

**Requirement:** outcome-4; adr-2026-08-09-adr-layer-gated-by-committed-adr-signal

As a maintainer landing unrelated work, I want this change to add no new failure mode to specs
that agree, so that the gate stays quiet unless it has something real to say.

### Acceptance Criteria

#### Happy Path
- Given a coherence artifact authored before this change, containing no `adr` rows, in a change
  set carrying no ADRs, when the gate runs, then it passes unchanged.
- Given a spec whose ADRs, stories, and tasks genuinely agree, when the full DECIDE sequence runs
  **at the shipped default `adr_corpus: change_set`**, then conflict-check reports zero conflicts,
  the coherence gate passes, and the operator receives no additional prompt beyond what they
  received before this change.

> **Amended 2026-08-09 by #1391 (oscillation fix):** the scenario above originally asserted "no
> additional prompt" **unconditionally**, which contradicted
> `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`. That ADR names operator
> fatigue from false positives under `repo_wide` as "the dominant risk" and accepts it knowingly.
> Satisfying this story strictly would require `repo_wide` to never produce a false positive, which
> the ADR does not promise; satisfying the ADR breaks the story's absolute claim. The scope
> qualifier resolves it: the no-added-prompt guarantee is a property of the **shipped default**,
> which is what consumers get. Under the opt-in `repo_wide` mode — enabled in this repository only —
> added prompts are an accepted, measured cost with a stated exit condition, not a regression.
> The coherence artifact already recorded this qualification in prose ("consistent at the shipped
> default"); the story text had not carried it.
- Given the repository's existing coherence artifacts, when the gate is run against each, then
  none begins failing solely because it lacks `adr` rows.

#### Negative Paths
- Given a spec at tier S, when DECIDE runs, then conflict-check and coherence-check remain skipped
  entirely and no ADR adjudication is demanded.
- Given a change set that touches `.docs/decisions/adr-*` but contains no coherence artifact, when
  the gate resolves, then the legacy-change-set escape still disengages it — the new signal does
  not re-engage a gate that the no-retroactivity rule turned off.
- Given a spec whose ADRs are unchanged but whose stories changed, when the change set is
  computed, then no `adr` row is demanded for an ADR that is not part of this change set.

### Done When
- [ ] A test covers a pre-existing artifact with no `adr` rows and no ADRs in the change set
      passing the gate.
- [ ] A test covers a change set with ADR paths but no coherence artifact remaining disengaged.
- [ ] The full existing coherence-validator test suite passes with no assertion loosened.

---

## Coverage note

Documentation upkeep for this change — `docs/reference/skills.md` (both skill entries) and
`docs/explanation/gates.md` (the coherence gate's layer description) — is deliberately **not** a
story, per the stories skill's documentation boundary. It accompanies functional work and rides as
a plan task rather than acquiring its own acceptance criteria.
