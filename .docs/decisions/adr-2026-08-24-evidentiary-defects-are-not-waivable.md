# ADR: The coherence waiver covers coverage gaps, not evidentiary defects

**Date:** 2026-08-24
**Status:** APPROVED
**Deciders:** James Stoup (operator), DECIDE follow-up for intake #1799

## Context

`adr-2026-08-23-diff-locality-is-an-authored-disposition` closes its Decision with a general
clause:

    Gap ids for these rejections join the existing waiver vocabulary rather than forming a new
    one, so every new refusal is waivable. A refusal with no waivable id is a design defect
    under that ADR.

Story 5's last negative-path criterion in
`.docs/stories/coherence-rows-assert-story-task-coverage-that-not.md` restates that clause as a
contract over *every* rejection class the criterion layer introduces. The shipped implementation
does not meet it, and the prd_audit re-audit graded the criterion `PLAN_GAP` with no active task
owning a repair.

Fifteen rejection classes exist. Nine are waivable coverage gaps — `criterion:omitted`,
`criterion:invented`, `criterion:duplicate`, `criterion:task-missing`, `criterion:quote-empty`,
`criterion:quote-ungrounded`, `criterion:disposition-missing`, `criterion:disposition-negative`,
and the shared-verdict path. Six are not:

- Five distinct criterion-row parse defects — wrong cell count, empty criterion text, unknown
  verdict, empty cited-id list, out-of-vocabulary disposition — collapse into the single reason
  `unparseable-criterion-row` (`src/conductor/src/engine/engineer/coherence-validator.ts:168-189`),
  thrown at `:1710-1715` before any gap is constructed.
- `criterion:stories-unparseable` is thrown pre-aggregation at `:1746-1758`.

Both throws sit alongside two pre-existing non-waivable refusals that predate this feature:
`unparseable-coherence-artifact` (the same throw at `:1710`) and the fabricated-id cross-check at
`:1728-1743`, whose code comment already states the governing distinction — "an evidentiary defect,
not a coverage gap."

The question the criterion forces is therefore not whether these six classes were overlooked. It is
whether the waiver mechanism was ever meant to reach defects of this kind at all.

## Options Considered

### Option A: Honor the criterion literally — make all six classes waivable
- **Pros:** Satisfies Story 5's wording without amending a sealed DECIDE artifact. Restores the
  operator capability that commit `f25d8dad4` removed for `criterion:stories-unparseable`.
- **Cons:** A collapsed `unparseable-criterion-row` id is unactionable — an operator cannot tell
  which of five defects they are waiving — so it would have to split back into five ids, all new
  production work. It contradicts two criteria that currently pass: S3.5 requires an
  out-of-vocabulary verdict be *rejected as malformed rather than treated as affirmative*, and S5.3
  requires the same for dispositions. Waiving a malformed value is defaulting it by another route.
  Worst, it lets a waiver be evaluated against an artifact the validator could not read: the set of
  reported gaps is untrustworthy precisely when parsing failed, so "waive the reported gaps" no
  longer means anything.

### Option B: Revert only the `criterion:stories-unparseable` widening
- **Pros:** Closes the audit's OVER_SCOPE/outside-visible finding against `f25d8dad4` by restoring
  the capability it removed under a test-scoped task with no Scope trailer.
- **Cons:** Leaves five classes non-waivable, so the criterion is still unmet and this ADR is still
  needed — it resolves the scope finding without resolving the decision. And the reverted guard has
  the better argument on the merits: a stories file yielding zero extractable criteria would
  otherwise aggregate as *full coverage*, converting a failed check into a clean land.

### Option C: Scope the waiver surface to coverage gaps; refuse evidentiary defects fail-closed
- **Pros:** States the rule the codebase already follows in three places and makes it checkable
  rather than incidental. Keeps S3.5 and S5.3 coherent — malformed values stay refused by every
  route. No production change: the shipped behavior is the decided behavior.
- **Cons:** Requires amending a sealed DECIDE artifact and resealing. Narrows a clause of a
  one-day-old ADR, which is a cost in stability even when the narrowing is right.

## Decision

**Option C.** The coherence waiver mechanism covers **coverage gaps** — a criterion, outcome, FR,
story, or task the record does not account for. It does not cover **evidentiary defects** — a
record the validator cannot read, or one whose citations do not resolve.

Concretely, these four classes are refused fail-closed and are never waivable:

- `unparseable-coherence-artifact`
- `unparseable-criterion-row`
- `criterion:stories-unparseable`
- the fabricated-id cross-check refusal

The governing test is what a waiver asserts. A waiver says: *this named gap is real, I have read it,
and I am accepting it with written rationale.* That assertion is only meaningful when the validator
could read the record well enough to enumerate its gaps truthfully. When parsing fails or a citation
is fabricated, the reported gap set is not evidence of anything, and a waiver over it would launder
an unreadable record into a clean land. The defect is in the evidence, not in the coverage, and the
repair is to fix the artifact — which is always available to the author and costs nothing but an
edit.

This **narrows** the closing clause of `adr-2026-08-23-diff-locality-is-an-authored-disposition`
quoted above. That clause stands for the rejections that ADR is actually about — the diff-locality
dispositions and the coverage rejections joining them — and is hereby scoped to coverage rejections.
A coverage refusal with no waivable gap id remains a design defect. An evidentiary refusal with no
waivable gap id is the intended design.

The widening landed by commit `f25d8dad4` — making `criterion:stories-unparseable` non-waivable — is
retroactively sanctioned by this decision. It is recorded here rather than left implicit because the
audit is correct that it removed an operator capability under a task scoped to tests, with no Scope
trailer: the behavior is ratified, the process defect is not excused.

Story 5's criterion is amended to scope its guarantee to coverage rejections, matching this ADR.

## Consequences

### Positive
- One stated rule replaces three independent fail-closed sites that happened to agree, so the next
  rejection class has a decision procedure instead of a precedent hunt.
- S3.5 and S5.3 stay honest: a malformed verdict or disposition cannot be defaulted, by waiver or by
  any other route.
- No production change ships from this decision; the audit's PLAN_GAP closes against the artifacts
  rather than against the engine.

### Negative
- A genuinely blocked author facing an evidentiary defect has no escape hatch and must fix the
  artifact. This is intended, but it is a real hard stop with no operator override.
- `unparseable-criterion-row` still collapses five distinct defects into one message, so its
  diagnostic quality is poor even though its refusal is correct.
- A sealed DECIDE artifact is amended mid-BUILD, which requires a reseal and leaves the stories file
  differing from the text BUILD started against.

### Follow-up Actions
- [ ] Amend Story 5's final negative-path criterion and its first Done-When line to scope both to
      coverage rejections
- [ ] Record the coverage/evidentiary split in `skills/coherence-check/SKILL.md` alongside the
      waiver vocabulary
- [ ] Split `unparseable-criterion-row` into five distinct diagnostic reasons — refusal stays
      non-waivable, only the message improves (separate intake, not this feature)
