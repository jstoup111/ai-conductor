# Conflict Check: Grade the diff for security defects before ship via a build_review security rubric (#2034)

**Date:** 2026-09-14
**Inventory:** the six new stories against all accepted story files (89 rubric- or build_review-related files read by keyword narrowing, 17 read in full), the active specs for #1805, #1986, and #2033, and the prior conflict reports for the rubric family. ADR corpus: `repo_wide` — all 317 `adr-*.md` files enumerated by title and status; ~45 read in full across the rubric-container, custom-rubric seam, finding identity and vocabulary, plan-binding, adjudication, convergence bound, cache identity, provider selection, containment, event-spine, config-registry, and ADR-governance clusters; the remaining ~500 files (intake ledger, daemon lifecycle, OTel, memory, Codex auth, worktree reaping, release gates, GitHub ownership, rebase resolution, attribution, coherence layers, finish) were narrowed out as not addressing any story's behaviour, entity, field, resource, or gate. Supersession parsing excluded no ADR: every partially superseded ADR (adr-2026-08-29-build-review-remediate-case-adjudication, adr-2026-08-13-engine-managed-build-review-rubric-branches) was retained.
**Result:** **PASS — zero blocking conflicts remain.** One blocking contradiction was found and resolved by a companion main-based story PR; one overlap requiring scoped implementation is recorded; no degrading conflict is accepted.

## Conflict: The #1805 stories assert test-quality is the only runnable rubric

**Stories involved:** "The three overlapping rubrics are removed" vs "Register the security rubric as an opt-in built-in member"
**Files:** `.docs/stories/build-review-re-judges-what-the-plan-architecture-.md` vs `.docs/stories/grade-the-diff-for-security-defects-before-ship-vi.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the historical story's criterion and Done-When checkbox name `test-quality` as the only runnable rubric; the new Story 1 makes `security` dispatchable and registered.

**Historical opposing sentence (verbatim):** "Given the updated repository, when I list the rubrics that can actually run, then the only one is `test-quality` (old rubric names are still accepted in config, but as no-ops — see Story 15)"
**New opposing sentence (verbatim):** "Given a project config with `build_review.rubrics.security.enabled: true`, when the build_review step classifies its branches, then `security` is a dispatchable branch alongside any other enabled member"

**Resolution Options:**

1. Restate the historical criterion in place as the invariant it meant — no retired rubric runs and every runnable rubric is a default-off registry member — through a companion main-based PR, because the engineer land gate rejects foreign-stem story edits inside this spec.
2. Record the historical sentence as a ship-time observation already superseded in substance by #1986's custom members and accept a degrading conflict without editing it.
3. Narrow this feature to a project-declared custom rubric so the built-in list stays `test-quality` only — rejected in `/explore` because the #1986 seam cannot carry a harness-bundled declaration.

**Resolution:** Option 1, selected by the operator on 2026-09-14. Companion PR jstoup111/ai-conductor#2550 (`fix/re-judges-story-runnable-rubrics`) replaces the criterion and its Done-When checkbox in place with no amendment record. This spec's stories are unchanged.

## Overlap requiring scoped implementation (not a conflict)

**Stories involved:** "Bind the security skill contract to the engine and give security one owner" vs "Simplify evaluator model routing to a two-way risk criterion"
**Files:** `.docs/stories/grade-the-diff-for-security-defects-before-ship-vi.md` vs `.docs/stories/simplify-evaluator-model-routing-to-a-two-way-risk.md`
**Type:** overlap
**Severity:** none — both satisfiable together

`skills/code-review/SKILL.md` names security in two structurally separate places. The model-routing bullet ("batches with: concurrency, state mutation, security boundaries, financial calculations, auth logic") is pinned by the routing story's criterion that the Claude cell names "concurrency, state mutation, security, auth, and money"; the Stage 2 checklist, pattern-basis risk clause, and Stage 4 calibration lines are what the new Story 5 removes. Plan Task 14 scopes the removal to the latter three and asserts the routing bullet is unchanged. Confidence 97%.

## Explicitly Compatible Overlaps

- **Mixed-lap preservation:** the adjudicator stories require a valid sibling judged result to survive a peer's infrastructure failure; new Story 4 asserts the same for `security`. Confidence 95%.
- **Every finding accounted for once:** adjudicator Story 3 requires one source outcome per unresolved finding; security sources enter with `sourceId` `security:<findingId>`. Confidence 90%.
- **Content-only cache identity:** the rebase-stability criterion in new Story 2 is the generic guarantee the cache-identity feature already delivers. Confidence 95%.
- **Confidence floor:** new Story 3's suppression criterion is an instance of the operator-configurable floor story's suppressed-set/PASS behaviour. Confidence 95%.
- **Integrity suite in BUILD:** the vocabulary guard and model-table row are additive content inside the suite that already runs in BUILD's verification entries. Confidence 90%.
- **#1986 containment:** a lap with an enabled custom member binds every built-in member to the frozen source view; nothing in #1986's stories assumes exactly one built-in member. Confidence 85%.
- **Generated model table:** `AUXILIARY_MODEL_TABLE_ROWS` is the seam the table story established for auxiliary rubrics. Confidence 90%.
- **ADR versus story:** the five ADRs this spec amends (container D1/D4, one-owner D1, plan-binding D3/D6, vocabularies D1, reference-schema) were compared against every new story after amendment; no opposing sentence remains. adr-2026-08-21 D3's "anything else is `beyond`" instruction is narrowed for `security` by its amendment note, and no engine code implements the `beyond` path (verified: zero matches for `boundTo`, `beyondFindingIds`, `build_review_beyond_filed` under `src/conductor/src`). Confidence 95%.

## Assumptions recorded

- No accepted story asserts `beyond`/non-blocking semantics for all registered rubrics; the "never `beyond`" invariant is novel to this feature and is bound by the plan-binding ADR amendment rather than by any prior story.
- The two-built-in-member confidence-floor behaviour has no prior fixture; plan Task 8 supplies it.

## Re-check

After the companion restatement is merged, all six conflict classes were re-evaluated against the new stories: no contradictory runnable-rubric assertion remains on main, no behavioural overlap is unresolved, no impossible state is created (a security finding is either judged, suppressed, accepted, adjudicated, or an infrastructure failure), no shared resource gains a second semantic, no circular sequencing exists (the companion PR carries no implementation and does not gate BUILD), and no oscillation was found in either direction for any pair sharing a gate.

The conflict check passes with zero blocking and zero degrading conflicts.
