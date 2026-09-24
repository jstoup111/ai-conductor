# Conflict Check: One owner for accepted-story readability (#1744)

**Date:** 2026-09-23
**Tier:** M
**Stories checked:** `.docs/stories/accepted-stories-are-never-checked-against-the-eng.md` (Stories 1–4)
**Result:** PASSED — zero blocking conflicts, zero degrading conflicts accepted

## ADR corpus

`conflict_check.adr_corpus` is unset, so the default scope is `change_set` — which here is the
single ADR this spec adds. That corpus was deliberately **broadened** beyond the default, because
this feature changes shared gate and parser surfaces that several approved ADRs govern and a
change-set-only sweep would have examined none of them.

**Corpus used:** all 318 approved ADRs were listed, then narrowed to the 32 whose text names a
surface this feature touches (`GATE_ONLY_PREDICATES`, `acceptance_specs`, `landSpec` / `land-spec`,
`story-criteria`, `extractAuthoritativeStoryCriteria`, `extractStoryCriterionIds`,
`criterionStorySection`, `listItems`, the stories gate, or Happy Path sections).

**Examined in full** (decision text read and compared against all four stories):

| ADR | Relationship |
|---|---|
| adr-2026-08-23-criterion-layer-is-structural-at-land | Governing precedent; its land-confinement rule is carried into the new ADR's decision 3. No conflict. |
| adr-2026-07-22-coherence-gate-placement-and-validation-split | Establishes semantic-at-authoring / mechanical-at-land and the tier-S coherence exemption. No conflict — see Examined pair 5. |
| adr-2026-07-26-daemon-decide-preseed-ownership | D1 settles the S2/S4 interaction. See Examined pair 4. |
| adr-2026-07-21-s-tier-pipeline-knobs | "No new land primitive" clause examined. See Examined pair 5. |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance | D4 requires backward compatibility by re-run, never a hard fail. Consistent with Story 4. |
| adr-2026-08-05-token-first-stories-reference-normalization | Governs stories-reference normalization, not criterion shape. No overlap. |
| adr-2026-08-31-coverage-binding-judge-step | `coverage_binding` reads criterion claims where present and requires none. See Examined pair 6. |
| adr-2026-08-22-one-owner-per-review-question | D1's one-owner principle; the new ADR's decision 1 applies it rather than contradicting it. |
| adr-2026-08-09-adr-layer-gated-by-committed-adr-signal | Variable/invariant test; points the same way (every accepted story necessarily has criteria). |
| adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts | Governs amending *this* spec's accepted artifacts, not other features' landed stories. No conflict with Story 4's no-corpus-modification criterion. |

**Narrowed out** (matched a surface keyword but address an unrelated concern — worktree isolation,
operator identity, rate limiting, commit gating, halt rendering, task stamping, post-rebase
verification, ADR approval parsing, pattern replication, and the remaining keyword matches):
adr-2026-06-30-engineer-worktree-authoring-isolation, adr-2026-06-29-track-marker-location,
adr-2026-07-03-engineer-checkpoint-commits-idempotent-land, adr-2026-07-01-machine-scoped-operator-identity,
adr-2026-08-21-review-bound-by-plan-done-when-criteria, adr-2026-07-21-engine-owned-acceptance-red-execution,
adr-2026-07-21-demote-task-stamping-to-telemetry, adr-2026-07-22-coherence-waiver-and-duplicate-claim,
adr-2026-07-27-daemon-decide-kickback-halt, adr-2026-08-08-single-adr-approval-parser-three-rungs,
adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts, adr-2026-08-08-finish-human-required-halt-rendering,
adr-2026-07-05-daemon-rate-limit-episode-coordinator, adr-2026-07-21-owner-stamped-at-authoring,
adr-2026-07-22-gate-evidence-code-validity-on-redispatch, adr-2026-07-13-session-fresh-verdict-artifacts,
adr-2026-09-02-adr-decision-citability-contract, adr-2026-08-03-uncommitted-work-floor-under-build-completion,
adr-2026-08-09-recorded-red-exception-for-remediation, adr-2026-08-09-declared-pattern-replication-in-build,
adr-2026-09-11-selective-post-rebase-verification, adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.

No ADR was excluded on supersession grounds; none of the examined set is fully superseded.

## Examined pairs

All six story pairs were tested in both directions ("if A is fully satisfied, does B still hold?"),
plus the ADR-versus-story pairs above. The non-obvious ones are recorded here; a pair is listed
because its interaction was reasoned through, not because it produced a finding.

**1. Story 1 versus Story 2 — both make land refuse.** Story 1 requires a land refusal naming the
failing story; Story 2 requires that refusal to come from the same predicate the `stories` gate
uses. Satisfying either leaves the other intact: Story 2 constrains *where the verdict comes from*,
Story 1 constrains *what the refusal says*. Complementary, not overlapping.

**2. Story 1 versus Story 3 — refusal versus derivation.** Story 3 makes the authoritative
extractor accept hard-wrapped bullets, which strictly *increases* what Story 1's predicate reads as
valid. A file Story 1 would have refused for a wrapped bullet is accepted after Story 3; that is the
intended direction and neither story asserts the opposite.

**3. Story 2 versus Story 3 — one predicate, one primitive.** Both push derivation into
`story-criteria.ts`. Satisfying Story 3 (one bullet primitive) is a precondition for Story 2's
verdicts agreeing on wrapped-bullet files rather than an obstacle to it.

**4. Story 2 versus Story 4 — the oscillation candidate, resolved by verification.** Story 2
requires `GATE_ONLY_PREDICATES.stories` to refuse an unreadable file; Story 4 requires a merged spec
with exactly such a file to keep building. These would oscillate if the daemon ever evaluated that
gate for a composer-landed merged spec — satisfying Story 2 would then break Story 4, and the fix
for Story 4 would disable Story 2's gate.

It does not. `adr-2026-07-26-daemon-decide-preseed-ownership` D1 makes phase membership the
governing contract: the daemon's preseed set is every step whose declared phase is `DECIDE`, and
"a step declared `phase: 'DECIDE'` is owned by DECIDE and is never executed by the daemon."
`stories` is a DECIDE step, so it is preseeded and its gate never runs against a merged spec.
*Verified against the ADR's decision text, 95%.* Corroborating evidence: 48 stories files already on
main would fail that gate today, and their features build — which is only possible if the gate never
runs for them. This is the same mechanism the intake itself identified ("that gate never ran,
because the story landed through `engineer`'s spec PR path"). **Not an oscillation.**

**5. Story 1's Small-tier criterion versus the tier-S exemptions.**
`adr-2026-07-22-coherence-gate-placement-and-validation-split` exempts Small specs from the
coherence gate entirely, and `adr-2026-07-21-s-tier-pipeline-knobs` D1 states that smallness is
expressed entirely through existing resolution knobs with "no new land primitive". Story 1 requires
land to refuse an unreadable Small-tier stories file, which engages a new land rung at tier S.

Examined and judged compatible, *80% confidence*. The s-tier clause governs how **smallness** is
expressed — it forbids building an S-specific land path — and the readability rung is tier-agnostic,
applying identically at S, M, and L, exactly as the existing `isStoriesApproved` and
plan-reference rungs already do. The coherence exemption is scoped to `runCoherenceGate`, which the
new rung sits beside rather than inside. **Recorded rather than silently passed** because the
reading is a judgement: if the operator intends the S-tier clause to forbid *any* new land rung at
S, Story 1's fourth negative path is the criterion to change, and the root would live in
architecture, not story phrasing.

**6. Story 3 versus Story 4 — derivation change reaching merged specs.** Story 3 changes what
`extractAuthoritativeStoryCriteria` returns, and that function runs at BUILD for merged specs
(`artifacts.ts:1973` for `acceptance_specs`, `conductor.ts:961` for plan-gap routing). Story 4
requires merged specs to keep building.

Compatible. At `acceptance_specs` both the authoritative list and the evidence the step must produce
are derived at BUILD from the same file, so they move together — a longer criterion list changes what
must be covered, not whether the step can be satisfied. `criterionStorySection`'s positional lookup
becomes *more* likely to resolve, not less. The only artifact authored against the older derivation
is a merged spec's coherence table, and `adr-2026-08-31-coverage-binding-judge-step` keeps
`coverage_binding` requiring no criterion row, so a stale row set cannot fail it. This is the
derivation-versus-requirement distinction the new ADR's decision 3 draws explicitly.

## Conflicts

None. No blocking conflicts, and no degrading conflicts were accepted.

## Notes carried forward

Examined pair 5 is the one judgement in this check that a reasonable reader could decide the other
way. It is recorded here so the plan and the operator see it rather than discovering it at land.
