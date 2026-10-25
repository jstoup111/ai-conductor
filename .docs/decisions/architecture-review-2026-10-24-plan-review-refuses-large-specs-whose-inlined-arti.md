# Architecture Review: plan review prompt carries an index, not every cited ADR

**Date:** 2026-10-24
**Mode:** Lightweight (Tier M): Feasibility and Alignment only
**Inputs reviewed:**
- `.docs/track/plan-review-refuses-large-specs-whose-inlined-arti.md`
- `.docs/complexity/plan-review-refuses-large-specs-whose-inlined-arti.md`
- `.docs/architecture/plan-review-refuses-large-specs-whose-inlined-arti.md` (operator approved 2026-10-24)
- `adr-2026-10-10-source-grounded-adversarial-plan-review-step` (APPROVED)

**Verdict:** APPROVED

## Feasibility

| Intent | Assessment | Basis |
|---|---|---|
| Inline only changed decisions | Feasible. `resolveIdeaFiles` (`engineer/spec-change-set.ts`) already runs `git merge-base HEAD <default branch>` and diffs `.docs/` paths against it. The merge-base text of a changed ADR is one `git show <base>:<path>` away, and `parseAdrDecisions` (`artifacts.ts`) yields per-decision passages from both texts for comparison. An amendment note written beside a decision is parsed into that decision's passage, so an amended decision counts as changed. | Verified: source read, and the D3 note added by this spec parses into passage 3 of the amended ADR. |
| The narrowing is enough for the motivating spec | Yes, with margin. At the #2945 land commit (`4efcb5bede`), every one of its 16 cited ADRs was also changed (15 amended or added). Inlining whole changed ADRs keeps 140,644 characters of decision JSON; inlining changed decisions only keeps 58,497. With plan 125,635, stories 33,183 and candidates 53,413 from the recorded refusal, the round-1 prompt is about 270k plus the index, against the 400,000 default. | Verified by measurement with the production parser. The index size, estimated at about 20k, is inferred. |
| Reviewer can open indexed items | Yes. Every built-in reviewer has worktree read tools under `readOnlyReview`: Claude through `Read`, `Grep` and `Glob` (`claude-read-only-review-policy.ts`), Codex through its read-only sandbox (`codex-provider.ts`), Pi through `read,grep,find,ls` (`pi-provider.ts`). | Verified: source read. |
| Finding validation unaffected | Yes. `validatePlanReviewResult` grounds quotes against `context.adrTexts`, which `reviewInputs` fills with every in-scope ADR's full text, independent of what the prompt inlines. A finding that quotes an indexed decision still validates. | Verified: source read (`plan-review-contract.ts` `hasTwoGroundedQuotes`). |
| Round 2 unchanged | Yes. Round 2 already inlines only the digest-changed tasks, stories and decisions (`diffReviewedDigests`). Only the budget source and the refusal text apply to it. | Verified: source read. |
| Budget override | Feasible. `engineer-cli.ts` parses `plan-review` flags in one place and already threads `config` into `runPlanReview`, whose `maxPromptChars` input exists today with no caller setting it. `step-runners.ts` calls the same runner on the `conduct` path. | Verified: source read. |
| Prerequisites, data, worktree isolation | None. There is no migration, persisted schema, port, service or shared state. The reviewed digest (`computeReviewedDigest`) still covers every in-scope ADR text, so the land rung is unchanged. | Verified. |
| Performance | One extra `git show` per changed ADR at review time, at most a few dozen. Negligible next to a provider dispatch. | Inferred. |

## Alignment

- **Governing ADR.** `adr-2026-10-10-source-grounded-adversarial-plan-review-step` governs the
  step. D3 listed every in-scope ADR decision section and the coherence artifact as inline
  inputs. That assertion is falsified by this change, so it carries an additive
  `> **Amended 2026-10-24 by #3278:**` note beside it. D5 (evidence rules), D6 (bounded rounds,
  round-2 scope), D7 (artifact, digest and land rung) and D8 (events) are unchanged.
- **No new ADR.** The change revises what one prompt carries and adds a size override. It
  establishes no new boundary, component, integration pattern, state or data architecture, or
  technology, so the structural prerequisite for an ADR is not met.
- **Machinery for bookkeeping, judgement for the model.** Which decisions are inline is decided
  by the engine from git and the parser, deterministically. The reviewer only chooses which
  indexed items to open.
- **Cost control.** On #3291 the operator rejected handing a judge files by reference because
  cost would track the judge's discipline. Here the inline set is engine-bounded, and the
  reviewer already reads source on its own for the feasibility lens, so reading indexed ADRs adds
  to an existing read budget rather than replacing an engine-owned one. The operator chose this
  approach knowingly (2026-10-24).
- **Config placement.** `steps` keys are one closed list shared by every step in
  `CONFIG_CONSUMER_KEY_SETS.steps`, so a budget there would validate on every step. Step-owned
  policy already lives in top-level blocks (`prd_audit`, `architecture_review_as_built`,
  `coverage_binding`). The budget therefore goes in a new top-level `plan_review` block with one
  key, `max_prompt_chars` (positive integer), validated and resolved the way `validatePrdAuditBlock`
  and `resolvePrdAuditBlock` handle `prd_audit`.

Focused local pattern basis (config block):
- Role: a step-owned, validated, top-level config block with a resolved default.
- Traits to keep: a closed key list in `CONFIG_CONSUMER_KEY_SETS`, a `validate…Block` that rejects
  a non-positive or non-integer value with a named error, and a `resolve…Block` default.
- Why it applies: `prd_audit` is the nearest step-owned policy block; `build_review.rubrics.max_projection_bytes` is the nearest size-budget validation.
- Allowed variation: a single key, and no `materializeDefaults` output beyond the default budget.
- Hints: `engine/config.ts` `validatePrdAuditBlock`, `resolvePrdAuditBlock`, `CONFIG_CONSUMER_KEY_SETS`; `types/config.ts` `HarnessConfig`.

## Wiring Surface

| New surface | Production caller |
|---|---|
| Changed-decision selection in `plan-review-adr-scope.ts` | `reviewInputs` in `plan-review-runner.ts`, reached from `runPlanReview` |
| Merge-base ADR text read in `engineer/spec-change-set.ts` | `reviewInputs` in `plan-review-runner.ts`, beside its existing `resolveIdeaFiles` call |
| Index section of the reviewer prompt | `runPlanReview` prompt assembly, dispatched through `executeProviderCandidates` |
| Actionable size refusal | `runPlanReview`; surfaced by the `plan-review` case in `engineer-cli.ts` and by the `plan_review` branch in `step-runners.ts` |
| `plan_review.max_prompt_chars` config key | read in the `plan-review` case of `engineer-cli.ts` and the `plan_review` branch of `step-runners.ts`, passed as `maxPromptChars` |
| `--max-prompt-chars` flag | the `plan-review` flag parser in `engineer-cli.ts`, overriding the config value for that run |
| Index semantics in `skills/plan-review/SKILL.md` | the `$plan-review` brief loaded by the dispatched reviewer |

Documentation that names these surfaces: `docs/reference/configuration.md`, `docs/reference/cli.md`,
the `plan-review` help text in `engineer-cli.ts`, and `skills/composer/SKILL.md` §3 step 10.

Early overlap scan (advisory): `src/conductor/src/engine/step-runners.ts` overlaps
`spec/untracked-root-node-modules-symlink-gets-committed`; `src/conductor/src/engine/config.ts` and
`src/conductor/src/types/config.ts` overlap `origin/spec/daemon-self-host-guardrails`. Both are
additive edits to shared files; expect rebase work, not a design conflict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The reviewer does not open an indexed decision and misses an ADR-versus-plan contradiction | Technical | Medium | Medium | Changed decisions, which are what the spec amends, stay inline. The brief states that indexed items must be opened before a ruling depends on them. Index entries carry titles so the reviewer can choose. |
| A spec whose plan, stories and changed decisions alone exceed the budget is still refused | Technical | Low | Medium | The refusal names each section's size and the override. The operator raises the budget once with `--max-prompt-chars` or persistently in config. |
| A raised budget exceeds a provider's context window and every reviewer fails | Integration | Low | Low | The default stays 400,000. An over-window failure falls through the provider chain and reports dispatch failure, as today. |
| The merge base cannot be resolved (no default branch, detached state) | Technical | Low | Low | Treat every in-scope decision as changed, which is today's behavior, so the review is never weaker than now. |

## ADRs Created

None. `adr-2026-10-10-source-grounded-adversarial-plan-review-step` is amended in place beside D3
with an additive note; its status stays APPROVED.
