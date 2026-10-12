# Architecture Review: Source-grounded adversarial plan review before land (#3038)
**Date:** 2026-10-10
**Mode:** Lightweight (Tier M): §2 Feasibility and §4 Alignment only
**Inputs reviewed:** `.docs/track/source-grounded-plan-defects-pass-every-decide-gat.md`,
`.docs/complexity/source-grounded-plan-defects-pass-every-decide-gat.md`,
`.docs/architecture/source-grounded-plan-defects-pass-every-decide-gat.md` (approved). This is a
technical track, so there is no PRD. Stories and plan do not exist yet.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All claims below were verified by reading source on the spec branch, unless marked otherwise.

| Check | Finding |
|---|---|
| Stack | No new packages. Dispatch reuses `executeProviderCandidates` (`engine/provider-execution.ts`). It already runs outside `StepRunner` in `engine/project-prelude.ts`, which assembles `PluginRegistry`, `createProviderRuntimeSet` and `ProviderSessionStore` the same way `src/index.ts` does. |
| Structured output | Every built-in provider declares `nativeSchema`. claude passes `--json-schema`. codex passes `--output-schema`, using the strict rewrite in `codex-strict-schema.ts`, so optional fields become nullable-required. pi passes `--conduct-output-schema` with a `submit_result` tool. The findings schema must therefore be written in the codex-strict-compatible subset. |
| Read-only | `readOnlyReview: true` is honoured by each adapter: claude uses its read-only policy args, codex uses `sandbox_mode="read-only"`, and pi uses only the read, grep, find, ls and git_read tools. Note that prd_audit and as-built use `dangerouslySkipPermissions`; plan_review must use `readOnlyReview` instead. |
| Authoring host | No env var exists today (`engineer-cli.ts:571-577` spawns with no env overlay). Host markers exist in the provider catalog (`CLAUDECODE`, `CODEX_THREAD_ID`/`CODEX_SESSION_ID`). Whether Codex exports its markers to tool shells is **unverified (inferred, ~50%)**. ADR D4 makes that non-load-bearing: it records the host as `unknown` and never blocks. |
| Step registration | Adding a step id breaks compilation of every exhaustive `Record<StepName,…>` map: `types/steps.ts`, `provider-model-policy-defaults.ts` (`CLAUDE_STEP_MODELS`, `CODEX_STEP_MODELS`, `STEP_EFFORTS`), `model-table-metadata.ts` `STEP_RATIONALE`, `resolved-config.ts` (`DEFAULT_STEP_RETRIES`, `DEFAULT_STEP_REVIEW`), and `artifacts.ts` contracts. It also needs entries in `skill-invocation.ts` and `steps.ts`, and the step-enumerating tests and goldens change (`steps.test.ts` length, the n1-golden conduct-state fixtures, the decide-entry fast-forward acceptance list). Precedents: `coherence_check` (98eb7ef939) and `coverage_binding` (b8c8d54b12). |
| Daemon entry | `decideEntryDisposition` halts a contracted DECIDE step that has no artifact and no grant. ADR D9's legacy fast-forward is required in the same diff that registers the step, or merged-unbuilt M/L specs halt. |
| Parsers | Reusable: `parsePlanTaskBodies`, `parsePlanTaskDoneWhen`, `parsePlanTaskPaths`, `planTaskDigests` (`engine/plan-task-parse.ts`). The `**Dependencies:**` parser is private inside `validatePlanSlices` (`engine/plan-slices.ts:130`, `:449-490`) and must be extracted and exported. There is no parser for a `## Wiring Surface` section or for exported identifiers, so the candidate builder adds one. |
| Land path | `landSpec` already stages `.docs` (`land-spec.ts:754`). The new artifact family must be added to the idea-file / stem resolution near `:571-580` and `:789-795`. |
| Worktree isolation | No ports, databases or shared services are involved. The reviewer reads only the spec worktree. Events go to the existing per-ledger files. |
| Performance | Two reviewer dispatches at most per spec. The candidate builder is linear text search over the worktree's tracked files. |

## Alignment

- **Design Principle (CLAUDE.md):** consistent. The candidates, round bound, digests, schema
  validation, provider selection and land rung are all machinery. Only the source-grounded
  question of whether a candidate is a real defect is model judgement. Candidates never block on
  their own (D2), which avoids the over-mechanization failure the principle warns about.
- **`adr-2026-07-22-coherence-gate-placement-and-validation-split` D3** (semantic at authoring,
  mechanical at land): consistent. The judgement runs at DECIDE, and the land rung stays
  model-free (D7).
- **`adr-2026-08-31-coverage-binding-judge-step`** (retired by #3164): the lesson is applied. The
  review has a hard bound (D6), an operator lever through recorded acceptance (D6), and
  same-provider fallback that never blocks (D4). §7a, which this ADR's judge reused, is unchanged.
- **`adr-2026-08-09-adr-contradiction-detection-in-two-halves` D4:** **conflicts**. D4 names
  coherence-check §4d as the late LLM contradiction judgement, and this feature removes §4d at the
  operator's direction. Resolution: amend D4 additively to name `plan_review`. D1–D3 are unchanged.
  Because the amendment brings that ADR into the change set, the plan's Architecture Obligation
  Coverage must carry rows for all of its decisions, D1–D4.
- **Event spine (`.agents/skills/event-spine`):**
  - The findings artifact is durable gate state (exception C).
  - Occurrences become `ConductorEvent` variants emitted through existing emitters (exception B
    for `composer-events.jsonl`).
  - No sidecar or bespoke log is added.
  - The round count in the artifact is gate state that the bound and land enforce. It is not
    timing reconstruction.
- **As-built §12:** unaffected. That is SHIP reachability against shipped code. This is
  design-time candidate review, so both remain.
- **Scope-check:** consumer-facing. The DECIDE flow (`plan`, `coherence-check`, `composer`) and the
  engine exist in every consumer install. The reviewer brief belongs in the shipped `skills/`
  catalog as `skills/plan-review/`, with full frontmatter, a model-table row and the
  provider-contract audit. It is provider-agnostic: it must work with claude, codex and pi
  reviewers and with claude and codex hosts.
- **Diagram accuracy:** the approved diagram matches D1–D10.
- **Security:** the reviewer is read-only, and intake text stays tracker evidence. The reviewer
  prompt must keep the inbound-neutralization framing for any intake-derived text.
- **Pattern basis (local precedent):**
  - *Role:* one-shot schema review dispatched by the engine.
  - *Precedent:* `prd_audit` (`StepRunner` one-shot path and the `skills/prd-audit/` brief).
  - *Traits to preserve:* a fresh session, a native schema, engine-side validation, and an engine
    write of the verdict artifact.
  - *Allowed variation:* `readOnlyReview` in place of skip-permissions, and a provider choice that
    excludes the authoring host.
  - *Rediscovery seeds:* `executeProviderAwareOneShotCore`, `ProviderAwareSkillOneShotStep`, and
    `executeProviderCandidates`.

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| `ai-conductor compose plan-review` subcommand | The `engineer-cli.ts` compose dispatcher, alongside `land`/`handoff`. `skills/composer/SKILL.md` step 3 calls it after `/coherence-check`. |
| `plan_review` step (`ALL_STEPS`) | The conductor's forward walk. Interactive `conduct` dispatches it through the step runner. The daemon fast-forwards it through `decideEntryDisposition` (D9). |
| Plan-review engine module (candidate builder, reviewer dispatch, schema validation, bound, artifact writer) | Called by both entry points above. |
| Exported plan dependency-graph parser | Called by the dependency-order candidate lens, and by `validatePlanSlices` (which is refactored onto it). |
| Wiring Surface / exported-identifier parser | Called by the reachability candidate lens. |
| Plan-review land rung | `landSpec` ladder, after the coherence gate. |
| `AI_CONDUCTOR_AUTHORING_PROVIDER` env var | Exported by the `compose` launcher spawn; read by plan-review provider selection. |
| `steps.plan_review.*` config keys | Read through the existing per-step provider and model config resolution. |
| `ConductorEvent` variants `plan_review_dispatched` / `_completed` / `_finding_accepted` | Emitted by the plan-review module; persisted by the existing `EventPersister`s. |
| `skills/plan-review/SKILL.md` reviewer brief | Loaded by the one-shot reviewer dispatch. |

Early overlap scan (advisory) over the candidate paths found no overlap and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Grep-level candidates flood the reviewer with false positives | Technical | Medium | Medium | Candidates are inputs only (D2). The reviewer filters them, and the candidate count is capped per lens with a truncation note. |
| A reviewer finding that isn't fixable inside the bound stalls land | Technical | Medium | Medium | Recorded operator acceptance (D6). No third round. |
| Codex host not detected, giving a same-provider review | Integration | Medium | Low | D4 records `unknown-host` with a notice. The compose launcher env var covers the normal path. |
| Adding the step without D9 halts merged-unbuilt specs in the daemon | Data | High if missed | High | Condition 1. |
| Removing §4d drops a contradiction class the reviewer brief fails to carry | Technical | Low | High | Condition 2: the brief enumerates every §4d lens. |
| Codex strict schema rejects the findings schema shape | Integration | Medium | Medium | Author the schema in the strict-compatible subset, and test it through `codex-strict-schema`. |

## ADRs Created

- `adr-2026-10-10-source-grounded-adversarial-plan-review-step` (D1–D10).
- Amendment to `adr-2026-08-09-adr-contradiction-detection-in-two-halves` D4 (additive note).

## Conditions

1. The legacy daemon fast-forward (ADR D9) ships in the same task, or an earlier one, as the step
   registration.
2. The reviewer brief carries every lens §4d defined: static contradiction, oscillation,
   task-vs-task, preserved behaviour and criterion conflict. Plan §7b's inputs and conflict rule
   are preserved for the tier-S path.
3. The plan carries Architecture Obligation Coverage rows for the new ADR D1–D10 and for
   `adr-2026-08-09` D1–D4.
4. The findings schema is exercised through the codex strict rewrite and through pi's
   `submit_result` path in tests.
