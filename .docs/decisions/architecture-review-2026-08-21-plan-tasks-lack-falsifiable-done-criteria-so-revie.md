# Architecture Review: plan-tasks-lack-falsifiable-done-criteria-so-revie
**Date:** 2026-08-21
**Mode:** lightweight (Medium tier) — Feasibility and Alignment only
**Inputs reviewed:** `.docs/track/plan-tasks-lack-falsifiable-done-criteria-so-revie.md`,
`.docs/architecture/plan-tasks-lack-falsifiable-done-criteria-so-revie.md`; full sweep of
`.docs/decisions/` (504 files incl. PR #1734's ADR); source read of PR #1734's branch.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack | No new packages or services. `fileIntakeIssue` and `TrackerClient` exist; `interactive: false` is a supported path. |
| Prerequisites | PR #1734 (#1629) merged — reducer relaxation seam, second-record-kind store pattern, event template. PR #1750 merged — shares `plan-task-parse.ts`. |
| Integration surface | `plan-task-parse.ts`, `engineer/land-spec.ts`, `build-review-domain.ts`, `build-review-aggregate.ts`, `build-review-effective.ts`, `build-review-dispositions.ts`, `build-review-projections.ts`, `build-review-inputs.ts`, `types/events.ts`, `event-sinks.ts`, `daemon-cli.ts` reconciliation, four rubric SKILL.md files, `build-review-cli.ts` findings renderer. Wide but every touch is a field, branch, record kind, or call on an existing seam. |
| Data | Disposition store gains a record kind; `STORE_VERSION` stays `v1` (same as #1734). Contract stays `v3` (absent `boundTo` = blocking). Projection stays `v2` with additive fields → one-lap cache re-judge (precedent adr-2026-08-16-preservation). |
| Performance | None. |
| Worktree isolation | Store is feature-local under the existing lease; filing keys on feature slug + finding id. |

Refuted design claims (corrected in the ADR): `boundTo = «taskId»/«n»` (forbidden coordinate
encoding); `beyond` persisted as a disposition deciding suppression (operator-only authority);
`plan-task-parse.ts` not a seam (three ADRs put the parser there); tracker injected into
`conductor.ts` (daemon already owns one); "one issue per feature" vs "keyed by finding id"
(resolved: per finding id, ledger `sourceRef` agrees).

## Complexity
Skipped — tier M recorded in `.docs/complexity/`.

## Alignment

- **Authority:** `beyond` is the rubric's judgement carried in the verdict; the engine never
  reclassifies and the store never suppresses — adr-2026-08-13 §2/§4 intact.
- **Identity:** `boundTo` excluded from the finding id; identity semantics unchanged, no contract
  bump — adr-2026-08-16.
- **Reference schema:** criterion binding is a `content-region` — adr-2026-08-18, no fourth kind.
- **Plan-task-block pattern:** parser in `plan-task-parse.ts`, clause as snapshot evidence,
  additive projection v2 — adr-2026-08-12/08-15/08-16.
- **DECIDE ownership:** a filed issue is new intake, never an amendment of this feature's sealed
  plan — adr-2026-08-04 §5.
- **Gate split:** mechanical shape at land; the quality-word rule stays prompt — adr-2026-07-22.
- **Cap/counters:** no new counter; no PASS reset — adr-2026-08-12, adr-2026-08-18-rebase.
- **Spine:** one member + sink row — adr-2026-07-26; adr-2026-08-11 noted (OTel does not read sinks).
- **Diagram:** `.docs/architecture/<slug>.md` updated this review to match D1–D6.
- **Production DI:** no in-memory default introduced; store and ledger are the existing file-backed ones.

## Wiring Surface (design-time)

| New surface | Called from |
|---|---|
| `parsePlanTaskDoneWhen` (`plan-task-parse.ts`) | `engineer/land-spec.ts` rung after `validateArtifactContent('plan')`; `build-review-inputs.ts` snapshot read (`doneWhenContext`). |
| `validatePlanDoneWhen` (new pure module) | `engineer/land-spec.ts` only (land gate; deliberately not discovery). |
| `doneWhenContext` + Tautology `planBody` projection fields | `deriveBuildReviewRubricProjections` → all four rubric dispatches. |
| `BuildReviewFinding.boundTo` + parser clause + shape renderer | `parseBuildReviewJudgedResult`, `renderBuildReviewJudgedResultShape`, coordinator dispatch. |
| `beyondFindingIds` on `BuildReviewEffectiveVerdict` | `deriveEffectiveBuildReviewVerdict` loop; `build-review-cli.ts findings` renderer; PR-body / shipped-record renderer. |
| `beyond` record kind: `appendBeyondIfCurrent`, `listBeyond`, `markBeyondFiled` | conductor post-lap write (`conductor.ts` build_review FAIL/PASS block); daemon reconciliation read/stamp. |
| Daemon beyond-filing reconciliation | `daemon-cli.ts` reconciliation loop beside `reconcileHaltPrs`, using the existing `tracker`. |
| `build_review_beyond_filed` event | emitted by the daemon filer; `EVENT_SINKS` row `{render:false, persist:true, audit:true}`. |
| Rubric SKILL.md `boundTo` contract (×4) | `build-review-rubric-skills.test.ts` drift guard. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Rubric marks a real criterion failure `beyond` | Technical | Low | Medium | Filed + rendered, never dropped; `accept` path unchanged for the rest |
| Equal-text `Done when:` lines across tasks | Data | Medium | Low | `occurrence` discriminator (adr-2026-08-18 amendment) |
| Two findings identical except `boundTo` collapse to one id | Data | Low | Low | Already rejected by `canonicalizeBuildReviewFindingSet`; contract prose says one finding per substance |
| Rebase conflicts with #1734 / #1750 | Integration | High | Low | Sequenced after both merge; plan tasks name their seams by symbol, not line |
| One-lap cache re-judge on projection change | Performance | Certain | Low | Accepted, as adr-2026-08-16-preservation did |
| Filing refused by intake ledger | Integration | Low | Low | Record stays `unfiled`, surfaced by `build-review findings` |

## ADRs Created
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` (APPROVED — decisions taken with the
  operator in this session: Approach B, Tautology receives `planBody`, parser in
  `plan-task-parse.ts`, gate engages for all tiers).

## Conditions
1. Builds only after PR #1734 and PR #1750 merge; the plan's first task is a rebase check.
2. The effective-verdict exit list is re-derived by grep at implementation time (adr-2026-08-16 D6).
3. Grammar tolerance for the `Done when:` parser is measured against the landed-plan corpus before
   the rung is wired; the sole existing block must pass.
4. `listReducedCoverage` is narrowed to `kind === 'reduced-coverage'` in the same change.
5. The four rubric contracts, the shape renderer, and the drift-guard test change together.
