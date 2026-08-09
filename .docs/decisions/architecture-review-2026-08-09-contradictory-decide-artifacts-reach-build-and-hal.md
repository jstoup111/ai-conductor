# Architecture Review: ADR contradiction detection across DECIDE

**Date:** 2026-08-09
**Mode:** design-time, lightweight (tier M — Sections 2 and 4 only)
**Track:** technical
**Source:** intake #1391
**Input reviewed:** `.docs/architecture/contradictory-decide-artifacts-reach-build-and-hal.md` (operator-approved)
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | No new dependency. TypeScript edits to one existing file plus Markdown edits to two shipped skills. |
| **Prerequisites** | None. No migration, no config key, no external account, no infrastructure. |
| **Integration surface** | Two modules. `coherence-validator.ts` (self-contained; its only inbound edge is `runCoherenceGate` from `land-spec.ts:51`) and two `skills/*/SKILL.md` files. Does not cross three module boundaries. |
| **Data implications** | None. The coherence artifact is Markdown; a new row class is additive and unparsed by anything else. |
| **Performance risk** | `conflict-check`'s pairwise pass grows with the ADR count. Real but bounded — a tier-M spec carries a handful of ADRs, and the pass is LLM judgment already budgeted at opus tier. No query paths, no N+1 surface. |
| **Worktree isolation** | Unaffected. No ports, no services, no shared state; the gate reads the worktree it is handed. |

**Confidence in the central feasibility claim: ~95%, verified.** The basis is a direct read of
`resolveRequiredLayers` (`coherence-validator.ts:1256-1292`), which already receives `changeSet`
and already derives layers by path prefix. The `adr` layer is the same shape as the two
signal-gated layers beside it. The residual 5% is the unread body of `validateCoherence` (:969)
and `runCoherenceGate` (:1383), where the new layer must be threaded through — mechanical, but not
yet read line by line.

## Alignment

**Convention over precedent.** Checked against `CLAUDE.md`, the approved architecture doc, and the
existing ADR corpus.

- **Design Principle — deterministic where possible, LLM only where necessary.** Satisfied, and it
  is the principle that shaped the design rather than a box ticked afterward. The judgment half
  (does this ADR contradict this story?) stays with the LLM; the accounting half (was every
  approved ADR adjudicated?) becomes machinery. See
  `adr-2026-08-09-adr-contradiction-detection-in-two-halves`.
- **Extend the existing spine; never add a parallel channel.** Satisfied. No new file, no sidecar,
  no second ledger, no new observation channel. The change extends four existing type unions and
  adds one sibling check next to five that already exist (`:325`, `:389`, `:503`, `:601`, `:735`).
  The compatibility question is answered by the mechanism that already answers it for `fr` and
  `outcome` rather than by a new escape hatch.
- **Pattern consistency.** `checkAdrCoverage` mirrors the five existing per-layer checks; the
  gap id `adr-«slug»` follows the established `outcome-<n>` / `fr-<N>` / `story-<id>` /
  `task-<id>` vocabulary in `coherence-check` §4c.
- **Invalid states unrepresentable.** The verdict vocabulary is the existing closed set
  (`covered` / `gap` / `fail`); no new verdict string is introduced. This matters more than it
  looks: `NEGATIVE_VERDICTS` (`:290`) treats every unrecognized string as affirmative, so an
  invented verdict would silently pass the gate. Reusing the closed set avoids that footgun
  entirely.
- **Security boundaries.** Not applicable — no endpoint, no user input, no credential, no
  serialized data crossing a trust boundary.
- **Production DI defaults.** Not applicable — no dependency injection, no store.
- **Scope placement.** `scope-check` returned consumer-facing / no-new-skill / provider-agnostic.
  The deciding test (does the mechanism exist outside this repository?) was confirmed
  independently: `bin/install:52` auto-installs both skills into every consumer catalog, and
  `HARNESS.md:65` declares `.docs/decisions/` and `.docs/coherence/` as the shipped DECIDE
  contract. No `HARNESS.md` rule change and no model-table regeneration are required.

## Wiring Surface

Design-time commitment for each production surface this change introduces or materially alters.

| Surface | Where it is called from in production |
|---|---|
| `checkAdrCoverage` (new exported function) | `validateCoherence` (`coherence-validator.ts:969`), alongside the five existing per-layer checks; reached in production via `runCoherenceGate` (`:1383`) ← `land-spec.ts:51` ← `conduct-ts engineer land`. |
| `adr` member of `CoherenceRowClass` (`:30`) | Consumed by `parseCoherenceArtifact` (`:89`) through the `ROW_CLASSES` membership test at `:130`, and by `crossCheckIds` (`:239`) via its per-class id pool. |
| `adr` member of `CoherenceRequiredLayer` (`:1215`) | Produced by `resolveRequiredLayers` (`:1256`) from the `changeSet` argument it already receives; consumed by `validateCoherence` to decide whether the layer is enforced. |
| `adr` member of `CoherenceGapLayer` + `GAP_LAYER_ORDER` (`:884`) | Consumed by `renderGapReport` (`:926`) for fixed-order rendering, and by the waiver parser via `CoherenceGap` (`coherence-waiver.ts:16`). |
| ADR pool derivation (`.docs/decisions/adr-*` from the change set) | Inside `runCoherenceGate`, from the change-set list `resolveChangedFilesForWaiver` already computes for the waiver freshness check — no new git invocation. |
| `.docs/decisions/` corpus entry in `conflict-check` §1 | Not code. Consumed by the `conflict_check` step runner when the skill executes; no wiring change. |

**Overlap scan (advisory).** Not run as a command. Read directly instead, which is stronger for
this case: `coherence-validator.ts` was last touched by #1401 (`6785664ae`, merged) and #1394
(`03fef171e`, merged) — both already on main, so there is no unmerged dependent work on this file.
The one live conflict risk is the halted `adr-approval-gate-before-build` feature, addressed under
Risks.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Skill prose ships without the engine change, so `:130` rejects every `adr` row and the gate breaks outright | Integration | Low | **High** | Recorded as a binding constraint in `adr-2026-08-09-adr-contradiction-detection-in-two-halves`; both halves land in one PR. Plan must not split them across tasks that could land separately. |
| Collision with the in-flight `adr-approval-gate-before-build` feature, which also touches ADR status handling | Integration | Medium | Medium | That feature is halted needs-human and its `adrApprovalStatus` symbol is **not on main** (verified). This design deliberately takes no dependency on it — approval is inferred from the existing DRAFT-ADR gate running earlier in `land-spec.ts`, not from a status parser. If that feature lands first, the two are additive. |
| ADR pool keyed on `.docs/decisions/` would demand `adr` rows for review reports that live in the same directory | Technical | Medium | Medium | Pool filters on the `adr-` filename prefix. Called out explicitly in `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`, with a required test. |
| An invented verdict string for ADR rows silently passes, because `NEGATIVE_VERDICTS` treats unknown strings as affirmative | Technical | Low | High | Reuse the existing closed `covered`/`gap`/`fail` vocabulary; introduce no new verdict. Already documented as a footgun in `coherence-check` §4b. |
| `conflict-check` cost grows with ADR count | Performance | Medium | Low | Bounded by ADR count per spec (single digits at tier M). Accepted. |
| Stale DECIDE-order comments mislead a later implementer | Knowledge | High | Low | Observed during discovery: `engineer/authoring.ts:359` and `engineer/loop.ts:110` both state an order contradicting `steps.ts` prerequisites (conflict_check before architecture_diagram; loop.ts omits complexity and coherence_check). Out of scope for this change; recorded here so the plan does not trust them. |

No risk carries High likelihood *and* High impact. The one High-impact item is a sequencing
constraint fully controlled by the plan.

## ADRs Created

Both are `Status: Approved`, per the hard gate — no spec lands carrying an unapproved ADR.

1. **`adr-2026-08-09-adr-contradiction-detection-in-two-halves`** — why detection is split across
   `conflict_check` (early, pre-plan, LLM judgment) and `coherence_check` plus the validator
   (late, land-gated, mechanical accounting), rather than either alone.
2. **`adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`** — why the `adr` layer is
   signal-gated on committed `.docs/decisions/adr-*` presence rather than structural, and why that
   needs no new compatibility escape hatch and no ADR-status parser.

Both fall under the **Cross-Cutting Concerns** decision category (gate/enforcement strategy), so
the §7 trigger requires them at tier M.

> **Amended 2026-08-09 by #1391:** a **third** ADR was added later in this DECIDE pass, during
> conflict-check — `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`
> (`Status: Approved`). It stages conflict-check's ADR corpus scope: the default becomes the spec's
> own change-set ADRs, and the repo-wide sweep over all 177 approved ADRs is gated behind
> `conflict_check.adr_corpus: repo_wide`, enabled in this repository only, with a stated exit
> condition. It amends the scope of HALF 1 in
> `adr-2026-08-09-adr-contradiction-detection-in-two-halves` without superseding it.
>
> This adds two registration obligations beyond the two documentation pages recorded in
> *Alignment*: the new `conflict_check.adr_corpus` key must be documented in
> **`docs/reference/configuration.md`** (Documentation Upkeep: "new config keys →
> `docs/reference/configuration.md`"), and this repository's **`.ai-conductor/config.yml`** must set
> `adr_corpus: repo_wide`. The verdict is unchanged: **APPROVED**. The staging strictly reduces the
> risk surface assessed above — it does not introduce a new one, and the Risks table's entries all
> either shrink to the default scope or become confined to this repository.

## Out of Scope (recorded, not re-litigated)

- **BUILD-time amendment route** — intake #1391's fifth outcome, split to **#1411** at operator
  direction.
- **Story-versus-PRD tie-out** — delivered by #1401 (`coherence-check` §4e).
- **Contradiction vocabulary** — delivered by #1394. This change supplies corpus, not vocabulary.
- **Stale DECIDE-order doc comments** — noted in Risks; a separate cleanup.

## Verdict

**APPROVED.**

Feasibility is verified against the real code rather than inferred: the extension point
(`resolveRequiredLayers`) already accepts the argument the design needs and already implements the
identical pattern twice. Alignment with both governing Design Principles is direct. No blocking
issue and no condition — the single High-impact risk is a same-PR sequencing constraint already
recorded as a binding ADR consequence.

No assumption remains unconfirmed that would change the design if wrong. The two that could have
were both checked during this review: whether an ADR-approval parser exists on main (it does not,
and the design avoids needing one), and whether the coherence gate runs after the DRAFT-ADR gate
(it does — `coherence-validator.ts:1297-1298`, which is what makes the file list a sufficient
approved-ADR pool).
