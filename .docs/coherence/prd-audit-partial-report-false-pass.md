# Coherence Mapping: prd-audit-partial-report-false-pass

**Date:** 2026-08-09
**Tier:** M (session default model; no opus pin — that applies at L)
**Track:** technical

Two of the four row classes are omitted, and omission is correct rather than a gap in both cases:

- **`outcome`** — this idea originated in operator chat, not GitHub intake. No outcomes were
  staged and no `.docs/intake/` marker exists, so the outcome layer is not required.
- **`fr`** — technical track. There is no PRD and therefore no enumerated `FR-N` layer; acceptance
  criteria live directly in the stories.

Every `covered` verdict was confirmed by reading the counterpart's own artifact file —
`.docs/stories/prd-audit-partial-report-false-pass.md` and
`.docs/plans/prd-audit-partial-report-false-pass.md` — not inferred from a phrase match. All 8
declared story ids are cited by at least one task, and all 18 tasks cite exactly one real story id.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-2, task-3, task-4, task-6, task-7 | covered | Manifest shape, registration, assessor, main-path cutover, four malformed-shape rejections |
| story | story-2 | task-8 | covered | Three-valued sweep outcome; spare-as-valid unreachable for an incomplete manifest |
| story | story-3 | task-10 | covered | Completeness re-asked inside the 817 preserve pre-check |
| story | story-4 | task-11 | covered | classifyPrdAuditGaps gains the incompleteness kind; clean and impl-only unchanged |
| story | story-5 | task-1, task-5 | covered | Parser exported by task-1 then consumed by the roster cross-check in task-5 |
| story | story-6 | task-12, task-13, task-14 | covered | Re-dispatch routing, precedence over a co-occurring blocking verdict, exhaustion halt |
| story | story-7 | task-9, task-15, task-16, task-17 | covered | Resume retention, non-accumulation, missing-stamp full re-audit, skill fill-only-missing obligation |
| story | story-8 | task-18 | covered | Clean-path, ACCEPTED divergence, 655 preservation, finish-fence properties |
| task | task-1 | story-5 | covered | Typed infrastructure; serves the roster cross-check by exporting the existing parser |
| task | task-2 | story-1 | covered | Typed infrastructure; manifest shape is the precondition for every completeness check |
| task | task-3 | story-1 | covered | Typed infrastructure; registration puts the manifest under the existing sweep |
| task | task-4 | story-1 | covered | The shared assessor all four read sites consume |
| task | task-5 | story-5 | covered | Cross-check against enumerated ids including the non-enumerable carve-out |
| task | task-6 | story-1 | covered | First behavioral cutover — manifest becomes the main-path pass signal |
| task | task-7 | story-1 | covered | The four malformed-manifest rejections, each an explicit negative-path case |
| task | task-8 | story-2 | covered | Sweep outcome split from verdict validity |
| task | task-9 | story-7 | covered | spare-for-resume retention driven by the existing code-stamp answer |
| task | task-10 | story-3 | covered | Preserve pre-check migration |
| task | task-11 | story-4 | covered | Classifier migration |
| task | task-12 | story-6 | covered | Incompleteness re-dispatches; no BUILD-targeted work order |
| task | task-13 | story-6 | covered | Precedence when incompleteness and a blocking verdict co-occur |
| task | task-14 | story-6 | covered | Exhaustion halt naming the unaudited FRs |
| task | task-15 | story-7 | covered | Repeated partial resumes cannot accumulate a pass |
| task | task-16 | story-7 | covered | Absent code stamp forces a full re-audit |
| task | task-17 | story-7 | covered | Typed infrastructure; the skill contract that produces the manifest the gate requires |
| task | task-18 | story-8 | covered | No-regression properties of the clean path |

## Consistency pass

Coverage is necessary but not sufficient, so each covered row was re-read to ask whether the
counterpart *delivers* the requirement or opposes it. Cross-layer pairs (story to task) were
checked in both directions; same-layer contradictions are `/conflict-check`'s sweep and were
already resolved there. No `fail` rows. The pairs most at risk, and why each holds:

- **story-2 and task-9.** Story 2 forbids an incomplete audit ever reading as valid; task-9 retains
  an incomplete manifest on disk. Under a boolean sweep these oscillate — satisfying either breaks
  the other. They hold only because the sweep is three-valued: `spare-for-resume` keeps the file
  without asserting validity. This is resolved Conflict 1; the ADR amendment and the Story 2 and
  Story 7 amendments are what make the pair consistent rather than mutually exclusive. Verified in
  both directions against the amended story text.
- **story-8 and task-10.** Story 8 requires a complete clean audit to be preserved across a
  no-runtime-delta rebase; task-10 adds a completeness re-check to the preserve path. Preconditions
  are disjoint — the re-check only withholds preservation from an incomplete audit — so satisfying
  task-10 leaves story-8 intact.
- **story-3 and story-8, via task-10 and task-18.** Story 3 requires a one-time re-audit for a
  pre-existing feature holding a stamp and report but no manifest; Story 8 requires no added
  friction on the clean path. Not contradictory: Story 8's happy path is conditioned on a complete
  manifest, which such a feature does not have. The rollout cost is recorded in the ADR's negative
  consequences.
- **story-4 and story-6, via task-11 and task-13.** Story 4 requires both incompleteness and a
  blocking verdict to be reported without either masking the other; Story 6 sends each to a
  different destination. That ambiguity was Conflict 2, resolved by the recorded precedence rule —
  Story 4 reports both facts, Story 6 decides the destination. Verified against both amended texts.

## Assumptions surfaced

- **Anchor strength, not a coverage gap.** `conduct-ts validate-wired-into` reports zero failures,
  but several anchors resolve against comments or registry lines rather than genuine call sites
  (task-3's `findArtifactFiles` matched a doc comment; task-6, task-7 and task-10's `prd_audit`
  matched the artifact-pattern entry; task-12 through task-14's `run` matched a comment). This is
  expected, since the true call sites do not exist until these tasks create them — which is why the
  genuinely-new surfaces use the deferred `none (inert until ...)` form. Recorded so BUILD does not
  read those passing rows as stronger evidence of wiring than they are. Confidence this is benign:
  about 85 percent, basis inferred from the validator's text-resolution behavior.
- **Architecture-review Condition 3 has no plan task, deliberately.** Updating
  `docs/explanation/gates.md` and `docs/reference/steps.md` is required in the same PR by
  `CLAUDE.md`, but `/plan`'s documentation boundary forbids authoring documentation tasks. This
  repository delivers it through the `maintain-documentation` custom step. Not a coherence gap — no
  row class covers review conditions — but named so the condition is not mistaken for dropped scope.
