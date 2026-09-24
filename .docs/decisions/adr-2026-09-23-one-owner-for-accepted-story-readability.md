# ADR: One owner for accepted-story readability, and one bullet primitive beneath it

**Date:** 2026-09-23
**Status:** APPROVED
**Deciders:** James Stoup (operator), DECIDE architecture review for intake #1744

## Context

Intake #1744 reports that an accepted stories artifact can be perfectly readable to a human,
pass its spec PR review, land, seal, and then make `acceptance_specs` unsatisfiable — a terminal
`needs-human` halt discovered after DECIDE completed and after `conflict_check`, `plan`, and
`coherence_check` all passed on the same file.

Two separate divergences produce this, both verified by reading the source and by running a
faithful port of both parsers over the 519 landed `.docs/stories/**/*.md` files on main.

**Divergence 1 — two notions of a valid accepted story, neither run at authoring time.**
`engineer land` (`src/conductor/src/engine/engineer/land-spec.ts`) checks that the stories artifact
is non-stub, non-DRAFT, approved (`isStoriesApproved`, land-spec.ts:396), and that the plan's
`Stories` reference resolves to it (land-spec.ts:381). It never asks whether the engine can read the
criteria. `GATE_ONLY_PREDICATES.stories` (`src/conductor/src/engine/artifacts.ts:4021`) does ask —
every story needs a Happy Path and a Negative Path(s) section with a Given/When/Then bullet — but it
runs only as a daemon `stories` step gate, and the `engineer` spec-PR path never reaches it. 48 of
the 519 landed files would fail that gate. 93 extract to zero criteria under
`extractAuthoritativeStoryCriteria`, which is the condition that makes disposition-only evidence
unsatisfiable (`artifacts.ts:1973`, and the non-empty/one-to-one requirement at `artifacts.ts:1535`).

Medium and Large specs are partly protected today: `checkCriterionCoverage`
(`engineer/coherence-validator.ts:440`) refuses a zero-criteria stories file as
`unparseable-stories`, and `runCoherenceGate` is called only from `land-spec.ts:573` — verified,
land-only. Small specs author no coherence artifact and get no check at all.

**Divergence 2 — two bullet parsers over the same artifact.**
`extractStoryCriterionIds` (`story-criteria.ts:83`) lists bullets through `listItems`
(`story-criteria.ts:64`), which joins a bullet's indented continuation lines; its own comment records
why ("authors hard-wrap long Given/When/Then rows at ~100 columns"). `extractAuthoritativeStoryCriteria`
(`artifacts.ts:2034`) does not use `listItems` — it matches bullets line by line and drops any
wrapped row. 101 landed files with `## Story <id>` headings yield a different count from the two.

That drift is not latent. `criterionStorySection` (`conductor.ts:947`) resolves an `S<story>.<n>` id
— derived from the `listItems` side — by **positional index** into the authoritative list produced
by the line-by-line side. When the lists differ in length the lookup returns `undefined`, and
`routePrdAuditPlanGaps` fails closed, classifying an edge-case plan gap as a main-path gap that
needs an operator. The two parsers already produce wrong routing at BUILD today.

**Retroactivity is the binding constraint on any fix.**
`adr-2026-08-23-criterion-layer-is-structural-at-land` (APPROVED) settled the shape of this concern
for the coherence `criterion` layer: added strictness is admissible precisely because it lives in
`runCoherenceGate` at land, which is never re-run against a merged or parked spec, and because no
BUILD or SHIP consumer gained a new requirement. 135 of the affected stories files have no
`.docs/shipped/` record, so a change that added a BUILD-side requirement would have a large and
poorly-bounded blast radius.

## Options Considered

### Option A: A non-empty extraction check in `landSpec` only
- **Pros:** Smallest diff; one enforcement point; directly removes the reported halt.
- **Cons:** Leaves `landSpec` and `GATE_ONLY_PREDICATES.stories` as two independent implementations
  of "valid accepted story" — the exact condition the intake asks to remove — so they can drift
  again on the next change. Leaves divergence 2, and therefore the `criterionStorySection`
  misrouting, entirely untouched.

### Option B: Widen the parser to accept the shapes authors actually write
- **Pros:** Makes human-readable stories engine-readable without rejecting anyone; no author has to
  learn a format from engine source.
- **Cons:** Widens what every consumer must understand rather than making the consumers agree; bold
  pseudo-headings and multi-line Given/When/Then blocks both make the positional ordinal ambiguous,
  which is what `criterionStorySection` and `extractStoryCriterionIds` depend on. The operator
  scoped this out.

### Option C: One predicate owned by `story-criteria.ts`, called by both consumers, over one bullet primitive (chosen)
- **Pros:** Agreement between land and the `stories` gate becomes structural rather than a
  convention two files are expected to honor; removes the ordinal drift at its root, which fixes
  the `criterionStorySection` misrouting as a consequence rather than as separate work; the
  strictness lands where `adr-2026-08-23` already established it is safe.
- **Cons:** Changes `extractAuthoritativeStoryCriteria` output for wrapped bullets, so existing
  fixtures asserting the line-by-line behavior must be re-baselined deliberately. Specs mid-DECIDE
  when this ships must fix an unreadable stories file before landing.

## Decision

**Option C.**

1. **`story-criteria.ts` is the single owner of the question "is this accepted story engine-readable".**
   One exported predicate in that module answers it, and both `engineer land` and
   `GATE_ONLY_PREDICATES.stories` reach that answer only by calling it. Neither may hold its own
   notion of a valid accepted story. The module is chosen because it already owns
   `splitStoryBlocks`, `sectionBody`, and `listItems`, so the judgement cannot drift from the
   primitives it is made of. This applies the `adr-2026-08-22-one-owner-per-review-question` D1
   principle — exactly one owner per question — to artifact-shape judgement rather than to review
   gates.

2. **`extractAuthoritativeStoryCriteria` and `extractStoryCriterionIds` list bullets through the
   same primitive.** Both route through `listItems`, so the criterion id alphabet and the
   authoritative criterion list are ordinal-aligned by construction. Positional resolution between
   the two — which `criterionStorySection` performs — is only sound when one primitive produces
   both sequences. No consumer may reimplement bullet listing.

3. **The new strictness engages at land and at the DECIDE `stories` gate, and nowhere later.**
   No BUILD or SHIP consumer gains a requirement it did not have: a merged spec whose stories file
   the predicate would reject continues to build exactly as it does today. This is the bound
   `adr-2026-08-23-criterion-layer-is-structural-at-land` established for the coherence `criterion`
   layer, applied here for the same reason — the affected corpus is large (135 affected stories
   files carry no shipped record) and it is never re-graded at land. Decision 2's parity fix is
   deliberately exempt from this confinement: it changes derivation rather than adding a
   requirement, and it corrects BUILD-side routing that is already wrong.

## Consequences

### Positive
- The `acceptance_specs` deadlock is removed upstream, at the point where the artifact is still
  cheap to fix, rather than tolerated after the artifact is sealed.
- `engineer land` and the `stories` gate cannot disagree, because there is nothing for them to
  disagree about.
- `criterionStorySection`'s positional lookup becomes sound, so `prd_audit` plan-gap routing stops
  failing closed to a main-path gap on wrapped-bullet stories.
- A future consumer of story shape inherits the check instead of writing a third answer.

### Negative
- Fixtures that assert the current line-by-line extraction behavior must be re-baselined, and that
  re-baselining is a judgement call a reviewer has to make deliberately rather than mechanically.
- A spec mid-DECIDE when this ships must fix an unreadable stories file before it can land; there
  is no automatic migration, and the 93 zero-extraction and 101 drifting files already on main are
  deliberately left alone.
- Two readability notions still exist at different depths for a brief window — the predicate at
  land and the older, laxer acceptance of already-merged specs at BUILD. That is the bound in
  decision 3, and it is intentional.

### Follow-up Actions
- [ ] Export the readability predicate from `story-criteria.ts`
- [ ] Call it from `landSpec` with a refusal that names the story and the required shape
- [ ] Route `GATE_ONLY_PREDICATES.stories` through the same predicate
- [ ] Route `extractAuthoritativeStoryCriteria` through `listItems`
- [ ] Re-baseline fixtures asserting line-by-line extraction, and pin the ordinal-parity invariant
- [ ] Pin by test that a merged spec with an unreadable stories file still builds
