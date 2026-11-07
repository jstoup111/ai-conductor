# Architecture Review: FINISH author_pr_prose halts unmoved — provider has no reliable way to write PR prose (#3529)

**Date:** 2026-10-31
**Mode:** Lightweight (Tier M): §2 Technical Feasibility and §4 Architectural Alignment
**Inputs reviewed:** explore output and track marker
(`.docs/track/finish-author-pr-prose-halts-unmoved-provider-has-.md`, Balanced scope, approach A),
approved diagram `.docs/architecture/finish-author-pr-prose-halts-unmoved-provider-has-.md`, and the
FINISH publication ADR set
**Verdict:** APPROVED

## Feasibility

| Intent item | Assessment |
|---|---|
| Provider returns title/body instead of editing the PR | Feasible on the current stack. The provider pass and the coordinator share `wt.path/.pipeline` (verified: `daemon-cli.ts` builds `DefaultStepRunner` with `wt.path` and `createProductionFinishPublicationCoordinator` with `projectRoot: wt.path`). Under proven containment the feature worktree stays writable. `.pipeline/documentation-delivery.json` (`documentation-delivery.ts`) is a working precedent for a provider-produced payload the engine reads. |
| Engine validates and performs the guarded write | Feasible with existing seams. `executeGithubOperation` with the operations from `resolveShipDraftPublicationDependencies` already performs a guarded `pull-request.edit` in `restoreCapturedRegionsFrom` (`conductor.ts`). `restoreRegion`/`extractRegionBytes` (`pr-body-regions.ts`) re-splice step regions. The `pull-request-edit` payload accepts `title` and `body` together (`github-operations.ts` `payloadFrom`). |
| Judge pass stops writing | Prompt-only change in `step-runners.ts`. The revision route already exists: a `revision_required` verdict is observed as `pr.prose = revision_required` and re-selects `author_pr_prose` with `revisionGuidance` (#2006). |
| Specific authoring-failure reasons | Extends the closed reason union in `finish-publication.ts` and its human-required rendering. Retries are ordinary `retry_finish` routes on the FINISH step attempt budget; the exhaustion halt gains the retry detail. No new state machine. |
| Retire the authorProse bus subscription | Pure deletion inside `finish-publication-production.ts` (`observeFailure`, the pre and post `flushSessionEvents` calls). The CLI emission and the session tail stay for other operations. |
| Skill and prompt contract alignment | Prose edits to `skills/finish/SKILL.md`, `skills/pr/SKILL.md` and the FINISH prompt blocks. No CLI, hook, settings or symlink surface changes. |
| Guard refusal wording | Message-only change in `daemon-session.ts`. The refuse/allow policy is unchanged. |

No new dependency, external service, persisted schema migration, port, or shared resource is
introduced. **Worktree isolation:** the handoff file lives under the per-worktree `.pipeline/`
(gitignored), so parallel features cannot collide on it.

## Complexity

Assessed as M by the complexity step and confirmed by the operator; not re-assessed here.

## Alignment

- **adr-2026-08-01-engine-owned-resumable-finish-publication D3/D4.** Aligned and strengthened. D3
  makes mechanical transitions engine-owned. D4 keeps the provider's task bounded to PR title and
  body, which is still true, because the provider still authors them; only the write moves to the
  engine.
- **adr-2026-08-13 (a transition advances only when it moves its dimension).** Unchanged.
  Re-observation remains the authority after the engine's edit, and the fixed-point guard still
  applies to a completed pass whose valid, published prose somehow fails to move `pr.prose`.
- **FINISH retry budget (`retry_finish` in `conductor.ts`).** Reused for `prose_not_returned` and
  `prose_invalid` unchanged. The only change is that the exhaustion halt appends the retry detail.
  The publication progress allowance (adr-2026-08-06) is untouched, because these are retries,
  not progress.
- **adr-2026-10-24-finish-surfaces-guarded-publish-failures.** D3 is superseded for
  `author_pr_prose` and D5 is narrowed. Both carry additive amendment notes. D1, D2 and D4 are
  unchanged: the engine's own failed edit still maps to `publication_operation_failed`.
- **Event spine (CLAUDE.md, `.agents/skills/event-spine`).** The handoff file is a durable data
  payload consumed once by the engine. It is not read to learn *when* something happened and is
  not polled, so it is not a parallel channel. Authoring outcomes continue to reach the spine
  through the existing `finish_publication_transition` and disposition events.
- **Machinery-by-default principle.** This is the direct application: a repeatedly violated
  mechanical step (performing a GitHub write) moves into the engine.
- **Security boundaries.** The write uses the same guarded operations and feature-ownership checks
  as region restore. The provider handoff is untrusted input: it is decoded against a closed schema,
  its step regions are overwritten from the current PR body, and its size is bounded by GitHub's
  body limit at the write.
- **Diagram accuracy.** The approved diagram matches this review.

**Focused local pattern basis.**
- *Guarded engine PR edit.* Precedent: `restoreCapturedRegionsFrom` in `conductor.ts`. Traits to
  preserve: read the current body through the tracker read, compute the next body purely,
  short-circuit when unchanged, resolve guarded publication dependencies, and call
  `executeGithubOperation` with an actor naming the engine purpose; a non-`executed` result raises a
  typed error. It applies because the same retained PR and operation are involved. Allowed
  variation: the payload adds `title`, and the actor names prose authoring. Rediscover it via
  `restoreCapturedRegionsFrom` and `resolveShipDraftPublicationDependencies`.
- *Provider payload file.* Precedent: `readDocumentationDelivery` in `documentation-delivery.ts`.
  Traits: fixed path under `.pipeline/`, a `version` field, a closed decoder that rejects rather
  than repairs, and stale-file exclusion. It applies because both are one-shot provider-to-engine
  results. Allowed variation: stale exclusion here is a delete-before-dispatch rather than a
  timestamp floor.

## Domain Integrity

Skipped in lightweight mode; the TDD domain reviewer covers it per cycle. The decoded handoff
should be a semantic type (for example `AuthoredPrProse`) produced only by its decoder, and
authoring failures should be an exhaustive discriminated union (`not_returned` | `invalid`), not
strings.

## Wiring Surface

| New or changed production surface | Production caller at design time |
|---|---|
| Handoff decoder (`.pipeline/finish-pr-prose.json` to authored prose or a typed failure) | Called by the production `authorProse` effect in `createProductionFinishPublicationCoordinator` (`finish-publication-production.ts`) after `dispatchAuthoring` returns |
| Prose application (region re-splice, validation, guarded `pull-request.edit`) | Called by the same `authorProse` effect. Guarded operations are injected through the coordinator dependencies built in `daemon-cli.ts` and `index.ts` |
| Stale-handoff deletion before dispatch | Same `authorProse` effect, before `dispatchAuthoring` |
| New retry reasons `prose_not_returned` and `prose_invalid` | Returned by the `author_pr_prose` branch of `advanceFinishPublication` (`finish-publication.ts`) and routed by `routeFinishPublicationDisposition` as `retry_finish`, whose existing exhaustion halt in `conductor.ts` names the reason and gains the detail |
| Author, revision and judge prompt blocks | Built by `DefaultStepRunner`'s FINISH prompt assembly (`step-runners.ts`), reached from `Conductor.runFinishPublication` |
| Missing-subcommand refusal text | Returned by `evaluateDaemonSessionCommandPolicy` (`daemon-session.ts`), reached by the existing daemon-session command shim |
| Removed: `observeFailure` subscription and the flushes around it | No caller remains; deletion |

**Advisory overlap scan** (`ai-conductor overlap-scan` over these paths, 2026-10-31): four unmerged
spec branches touch `conductor.ts` (planner-escalation, routed-leaf-acceptance,
routed-verify-green, stacked-no-op-rebase). None touches the FINISH publication files, the skills
or `daemon-session.ts`. Open PR #3556 edits only `test/execution/daemon-session-enforcement.test.ts`.
Expect a routine merge in `conductor.ts`, not a design conflict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Provider keeps editing the PR directly from habit or a stale skill copy | Integration | Medium | Medium | The engine overwrites title and body from the handoff anyway. With no handoff the pass is `prose_not_returned` and retries with guidance. Prompt and skills state one contract |
| Engine validation rejects good prose (for example a legitimately removed `Closes` line) | Technical | Low | Medium | The check applies only when the current body carries the reference. The failure names the check and retries with guidance before halting |
| Interactive FINISH loses an operator-visible in-place edit by the judge | Integration | Low | Low | Revisions still happen through the author revision pass; the judge's verdict is unchanged |
| A stale handoff from a previous pass is applied | Data | Low | Medium | Delete before every dispatch; read only after that dispatch returns |

No High-impact risk.

## ADRs Created

- `adr-2026-10-31-engine-performs-finish-pr-prose-write` (APPROVED, decisions 1–7).
- Amendment notes added to `adr-2026-10-24-finish-surfaces-guarded-publish-failures` D3
  (superseded for `author_pr_prose`) and D5 (narrowed).
