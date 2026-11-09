# Conflict Check: The engine performs FINISH's PR-prose write (#3529)

**Date:** 2026-10-31
**New stories:** `.docs/stories/finish-author-pr-prose-halts-unmoved-provider-has-.md` (Stories 1–5)
**Amended stories:** `.docs/stories/finish-pr-body-publish-fails-on-token-scope-and-ha.md` Stories 2–3 (rewritten in place by this spec)
**Result:** PASSED — 0 blocking, 0 degrading conflicts

## Inventory

- **Stories corpus.** I took all 664 files in `.docs/stories/` and narrowed them by subject:
  `author_pr_prose` and `judge_pr_prose`, prose classification and `revision_required` routing,
  `ai-conductor:step` and captured regions, body-floor placeholders, `github-operation` and
  `pull-request.edit`, the daemon-session guard and its refusal text, and `/pr` title and body
  rewrites. That left 27 files. I read the criteria that touch these surfaces in the 10 files with
  behavioral overlap and compared each against Stories 1–5 and the amended Stories 2–3, in both
  directions. The other 17 match on keywords only: bot identity, co-author trailers, dashboard
  status, Pi containment, temp storage, compose forget, closeout timing, monitor resolution,
  done-when, build-review adjudicators, batch evaluators, stacked restack, and bootstrap. None of
  them asserts behavior for the FINISH prose write or the no-subcommand refusal.
- **ADR corpus.** Every approved `adr-*` in `.docs/decisions/` was scoped by the same subject terms.
  The FINISH publication set and the daemon-session guard set were retained. The rest were narrowed
  out because their matches concern build-review, rebase, stacking, or release gating, none of
  which these stories touch. No retained ADR is fully superseded. adr-2026-10-24 D3 is superseded
  only for `author_pr_prose` and is kept for comparison.

## Pairs examined (no conflict)

| Counterpart | Shared surface | Both directions hold? | Reasoning |
|---|---|---|---|
| adr-2026-10-31-engine-performs-finish-pr-prose-write D1–D7 | All new stories | Yes | Each story cites and restates its decision's observable behavior. |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures D1, D2, D4 (D3 and D5 amended by this spec) | Failure events and `publication_operation_failed` | Yes | CLI emission (D1, D2) is untouched, and #3376 Story 1 is unchanged. D4's reason is now produced by the engine's own failed edit (amended Story 2). The D3 and D5 amendment notes match new Story 1's last negative path and amended Story 3. |
| adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns | The fixed-point guard | Yes (85%) | A missing or invalid handoff is a typed failed effect, like the existing region-restore and publication failures, so the guard never runs on it. Amended Story 3 keeps the guard verbatim for an executed edit that still reads as placeholder. New Story 1 keeps re-observation authoritative for a direct provider edit. |
| adr-2026-08-06-bounded-progress-allowance-for-finish-publication | Progress allowance versus retry budget | Yes | Story 2's retries are `retry_finish` routes on the FINISH step attempt budget, not progress, so the progress allowance is untouched and no new budget is added. |
| adr-2026-08-01-engine-owned-resumable-finish-publication D3, D4 | Who authors and publishes | Yes | The provider still authors title and body (D4) and the engine now also performs that mechanical write (D3). |
| adr-2026-08-08-finish-human-required-halt-rendering | Closed reason union and rendering | Yes | Story 2 extends the closed union with two retry reasons. Their exhaustion halt renders through the existing path. |
| `finish-deadlocks-when-the-prose-judge-asks-for-rev.md` Stories 1–3 | `revision_required` routing and revision guidance | Yes | `prose_not_returned` and `prose_invalid` retries name `author_pr_prose`. Fresh observation of placeholder or `revision_required` prose re-selects it, so retry reconciliation proceeds (that file's criterion 43). Guidance from a judge `detail` (its criterion 64) and from a failed check (new Story 2) both arrive as revision guidance. New Story 3 removes only the judge's write, not its verdict. |
| `preserve-project-owned-pr-body-sections-through-fi.md` (criteria on captured regions through authoring and the judge's repair) | Captured project-owned regions | Yes (85%) | Captured-region restore still runs after every authoring and judgment dispatch. The engine's prose edit re-splices regions from the post-restore PR body, so authored prose keeps captured bytes, which satisfies its criteria 127, 130 and 135. Its criterion 128 (a judge "repair" that drops a region) still holds for a judge that edits despite new Story 3's prompt, because restore still follows judgment. Criterion 131 (no additional edit when authoring kept the region) holds: restore is a no-op and the engine issues only the prose edit. **Plan constraints:** keep the post-dispatch restore for both passes, and take step-region bytes from the body read after that restore. |
| `preserve-project-owned-pr-body-sections-through-fi.md` criterion 60 (a floor-marked body with 1,000 characters of authored prose is authored) | Placeholder classification of returned prose | Yes, after revision | Found during planning. The first draft of new Story 1 called any handoff body carrying the body-floor marker invalid, which contradicted this criterion. Story 1 was revised in place: validation now uses the observer's own prose classification, as ADR D2 states, so a floor-marked body with authored prose is valid. |
| `finish-publication-burns-its-retry-budget-on-an-un.md` | `author_pr_prose` advancement and full-sequence transition count | Yes | Advancing on re-observed non-placeholder prose is unchanged. The full sequence still has one author transition, because the engine write sits inside that transition's effect. |
| `finish-step-completion-becomes-engine-machinery-re.md`, `finish-step-fails-try-1-on-every-daemon-ship-skill.md` | Title and presentation repair after `/pr` rewrites | Yes | Those criteria observe a title already rewritten "by `/pr` or by hand". An engine-published handoff title is observed the same way. |
| `unattended-finish-spends-minutes-before-determinis.md` | One bounded title and body quality pass | Yes | One author pass and one judgment per revision is unchanged. A missing or invalid handoff retries within the existing bound. |
| `engine-prompts-direct-daemon-sessions-to-ai-conduc.md` (criteria 22, 29, 126) | Managed prompts naming blocked commands; refusal events | Yes (90%) | New Story 4 removes the `github-operation` mention from FINISH prompts, which only reduces audited commands. The source audit (`session-command-audit.ts`) always evaluates a concrete subcommand and keys on "blocked subcommand" only for those. A bare-invocation message change (new Story 5) never reaches it. The refusal event keeps the bounded `none` identity, so criterion 126's event content is unchanged. |
| `enforce-ownership-across-all-harness-github-operat.md` | Guarded `pull-request.edit` ownership | Yes | The engine write uses the same guarded operations and feature-ownership checks. |
| `stacked-features-cannot-be-published-reviewed-and-.md` | The unmoved guard on other transitions | Yes | Different transitions, untouched. |

Every conflict type was checked in both directions: contradiction, behavioral overlap, state
conflict, resource contention, sequencing, and oscillation. None was found. No oscillation exists
because no pair has one side requiring a write by the provider and the other requiring that the
provider make no write: only new Stories 1 and 3 speak to provider writes, and they agree.

## Plan constraints carried forward

1. Keep `restoreCapturedRegions` running after both the author and the judgment dispatch.
2. Take the engine's re-spliced step-region bytes from the PR body read after that restore.
