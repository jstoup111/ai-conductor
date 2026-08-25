# Conflict Check: Criterion-level coherence coverage

**Date:** 2026-08-23
**Feature:** coherence-rows-assert-story-task-coverage-that-not (intake #1799)
**ADR corpus scope:** `repo_wide` (from `.ai-conductor/config.yml:97`)
**Result:** PASSED CLEAN after one blocking conflict was resolved

## Scope of the scan

Stories scanned: all six in
`.docs/stories/coherence-rows-assert-story-task-coverage-that-not.md`, plus the existing
`.docs/stories/` corpus checked for feature-area overlap. All 15 story pairs were tested in **both**
directions ("if A is fully satisfied, does B still hold?").

Existing-story overlap check: `.docs/stories/decide-artifact-coherence-check.md` (the original
coherence gate, shipped) and `.docs/stories/acceptance-specs-red-evidence.md` were the two candidate
neighbors. Neither conflicts — the first defines the layers this feature extends and asserts nothing
about criterion granularity; the second governs RED evidence, not coverage dispositions.

## ADR corpus (repo_wide)

**Examined** — approved ADRs whose subject overlaps these stories:

| ADR filename stem | Bearing on these stories |
|---|---|
| adr-2026-07-22-coherence-gate-placement-and-validation-split | Land rung must be model-free |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim | Every gap needs a waivable stable id |
| adr-2026-08-09-adr-layer-gated-by-committed-adr-signal | Layer engagement rule (amended 2026-08-23) |
| adr-2026-08-09-adr-contradiction-detection-in-two-halves | Split-not-choose pattern for coherence concerns |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria | Land-only placement precedent |
| adr-2026-08-22-done-when-evidence-at-task-close | Criteria floor applies only to opted-in plans |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback | Stories are the contract; prd_audit is completion authority |
| adr-2026-08-22-one-owner-per-review-question | No re-asking an owned review question |
| adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts | Remedy path stays in DECIDE |
| adr-2026-07-26-daemon-decide-preseed-ownership | No new DECIDE step executed by the daemon |
| adr-2026-08-05-token-first-stories-reference-normalization | Shared `**Stories:**` resolver |
| adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition | Discovery-side precondition pattern |
| adr-2026-07-21-engine-owned-acceptance-red-execution | acceptance_specs predicate stays a pure read |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance | RED marker contract, untouched here |
| adr-2026-07-21-s-tier-pipeline-knobs | Tier-S exemption |
| adr-2026-06-29-track-marker-location | Track marker gates the `fr` layer |
| adr-2026-08-23-criterion-layer-is-structural-at-land | This feature's own |
| adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote | This feature's own |
| adr-2026-08-23-diff-locality-is-an-authored-disposition | This feature's own |

**Narrowed out** — the remaining approved ADRs in the 492-file corpus address subjects these
stories do not touch: daemon lifecycle and parking, PR/merge and release mechanics, rebase and
conflict resolution, provider routing and auth isolation, seal rotation and reseal, tmux/session
hosting, observability and event-spine transport, migration and update gating, and worktree
provisioning. None asserts a behavior about criterion coverage, coherence row classes, or the
`acceptance_specs` coverage message.

**Supersession handling:** applied only at this scope. No ADR in the examined set is fully
superseded. `adr-2026-08-11-wiring-judged-in-build-review` is superseded by
`adr-2026-08-14-retire-build-review-wiring-rubric` and both were retained for comparison; neither
bears on criterion coverage. `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` carries a
2026-08-23 partial amendment and is retained in full, since its original decision still governs
every variable-tracking row class.

## Conflict: A waived gap cannot both reject and succeed at land

**Stories involved:** Story 1 (every criterion owned before the plan lands), Story 2 (coverage claim
rejected when the cited task does not support it), Story 3 (criterion depending on outside state
rejected) vs Story 5 (every new refusal is waivable)
**Files:** `.docs/stories/coherence-rows-assert-story-task-coverage-that-not.md` (internal)
**Type:** oscillating
**Severity:** blocking

**Description:**
Stories 1–3 each asserted unconditionally that a detected gap causes the land to be **rejected**.
Story 5 asserts that a gap named by a fresh waiver with a rationale causes the land to **succeed**.
Tested in both directions: fully satisfying Stories 1–3 as written makes Story 5's waiver path
unreachable, because the rejection fires before any waiver is consulted; fully satisfying Story 5
falsifies the rejection criteria in Stories 1–3, because a waived gap lands. Two "no" answers, so
this is an oscillation rather than an ordinary contradiction — an implementation would satisfy one
gate, be sent back, and trip the other.

This is the costly shape precisely because each story reads as reasonable alone, and the
contradiction would not have announced itself until a `land` test suite asserted both behaviors.

**Resolution Options:**
1. Scope the rejection criteria in Stories 1–3 to the no-waiver case, leaving Story 5 as the sole
   owner of waiver behavior.
2. Move all waiver behavior into Stories 1–3 and delete Story 5, so each rejection story owns its
   own escape.
3. Introduce a mediating story defining waiver evaluation order relative to every rejection class.

**Recommendation:** Option 1. The waiver mechanism is pre-existing
(adr-2026-07-22-coherence-waiver-and-duplicate-claim) and already has one owner; duplicating its
behavior across three stories would create three places to keep in sync, and Option 3 adds a story
for an ordering that the existing validator already fixes.

**Resolution applied:** Option 1. Six negative-path criteria across Stories 1, 2, and 3 were
replaced in place to add the no-waiver qualifier. No amendment record is left in the story artifact,
per the stories-file exception.

## Pairs checked clean

| Pair | Both directions hold because |
|---|---|
| Story 1 × Story 2 | Story 1 governs whether a row exists; Story 2 governs whether an existing row's claim is grounded. Disjoint predicates over the same row. |
| Story 1 × Story 3 | Coverage presence versus disposition validity — independent fields of the same row. |
| Story 1 × Story 4 | Story 1 constrains land only; Story 4 constrains discovery only. `runCoherenceGate` and `hasCoherenceTableDataRow` are distinct code paths. |
| Story 1 × Story 6 | Story 1 removes the gap at DECIDE; Story 6 governs the message when a gap nonetheless reaches BUILD. Story 6 does not assert gaps must reach BUILD. |
| Story 2 × Story 3 | Quote grounding and diff-locality are separate fields; neither's satisfaction changes the other's verdict. |
| Story 2 × Story 4 | Quote grounding runs at land only; legacy specs carry no criterion rows to ground. |
| Story 3 × Story 4 | Same: disposition checking never runs against a legacy artifact. |
| Story 3 × Story 5 | Story 3's closed-vocabulary rejection and Story 5's unknown-verdict rejection are the same principle applied to two fields; consistent, not competing. |
| Story 4 × Story 5 | Story 4 forbids changing the discovery check; Story 5's waivers are evaluated at land. Disjoint. |
| Story 4 × Story 6 | Both assert legacy specs are unaffected; Story 6's legacy branch is the message-level counterpart of Story 4's build-level guarantee. Mutually reinforcing. |
| Story 5 × Story 6 | Waiver evaluation is at land; the conditional halt message is at BUILD. No shared state. |
| Story 2 × Story 6 | Grounding failures are land-time rejections and never become BUILD halts, so no message interaction exists. |
| Story 1 × Story 5 | Resolved above; now disjoint by the no-waiver qualifier. |
| Story 2 × Story 5 | Resolved above. |
| Story 3 × Story 6 | Disposition rejection is land-time; the halt message is BUILD-time. |

## ADR-versus-story checks

No ADR-versus-story conflict was found. Each examined ADR was compared against every story whose
behavior, entity, resource, or gate it addresses. Three pairs were close enough to warrant an
explicit finding of no conflict:

- **adr-2026-08-22-one-owner-per-review-question × Story 2.** The ADR reserves "does the feature
  satisfy its criteria" for `prd_audit`. Story 2 asks only whether a quote occurs in a cited task's
  text. Verified no overlap: no Story 2 criterion inspects implementation or test outcomes.
- **adr-2026-07-22-coherence-gate-placement-and-validation-split × Stories 1–3.** The ADR forbids a
  model at land. No criterion in Stories 1–3 requires a judgement at land; each names a mechanical
  comparison over committed text.
- **adr-2026-08-21-review-bound-by-plan-done-when-criteria × Story 4.** The ADR warns against adding
  a rung to daemon discovery. Story 4 asserts the discovery check is unmodified, which is the same
  constraint stated as an acceptance criterion.

## Re-check

Re-run after the resolution: **zero blocking conflicts, zero degrading conflicts accepted.**
All 15 pairs hold in both directions. Conflict check passed.
