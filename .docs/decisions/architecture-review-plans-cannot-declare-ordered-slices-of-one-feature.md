# Architecture Review: Plans declare ordered slices of one feature for stacked publication

**Date:** 2026-09-29
**Mode:** lightweight (Medium tier: only §2 Feasibility and §4 Alignment are run)
**Track:** technical (no PRD; acceptance criteria live in stories)
**Source:** intake jstoup111/ai-conductor#2723
**Stories reviewed:** none yet. This is the pre-stories pass. Its input is the explore output, the
confirmed scope boundary in `.docs/track/plans-cannot-declare-ordered-slices-of-one-feature.md`,
and the diagram `.docs/architecture/plans-cannot-declare-ordered-slices-of-one-feature.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. The validator is a pure function over plan text. |
| **Prerequisites** | None missing. `TASK_HEADER_PATTERN`, `resolvePlanTaskReference`, `normalizePlanTaskId` (`plan-task-parse.ts`), `isEngineAppendedRemediationTaskId` (`remediation-append.ts`), the D17 ADR-obligation layer in the `coverage_binding` runner (`step-runners.ts`), the D16 reseal void (`coverage-binding-void.ts`, called from `reseal-cli.ts`), and the `mergeable_autoresolve` validator (`config.ts`) all exist at `4d850beb9`. The formal blockers #1700 and #1744 are closed. |
| **Integration surface** | New `plan-slices.ts`, plus `engineer/land-spec.ts` (new rung and gate id), `step-runners.ts` (the `coverage_binding` slice layer), `coverage-binding-envelope.ts` (optional membership field), `types/events.ts` with its sink registry (one event), `config.ts` (one block), the consumer registry test, the project config template, the configuration reference, and `skills/plan/SKILL.md`. That is one engine domain (plan grammar and its two gates) plus config. No external API. |
| **Data implications** | One optional envelope field under `.pipeline/`, per worktree. Legacy envelopes parse as having no membership and are treated as a baseline. No migration and no committed schema change. |
| **Performance risk** | Negligible. It is one linear pass over one plan file, at land and once per `coverage_binding` run. |
| **Worktree isolation** | Unaffected. No ports, services, or shared state. |

**Verified claims** (read at `4d850beb9`; confidence 95% unless noted):

- `planHasDependencyTree` (`artifacts.ts`) is a presence regex. No engine code parses
  `**Dependencies:**` values. *Verified.*
- A task body runs until the next task heading (`parsePlanTaskBodies`). A section placed after the
  first task is therefore inside a task body. *Verified.* This is why Decision 1 places `## Slices`
  before the first task.
- `resolvePlanTaskReference` splits on `,`, strips a trailing parenthetical, tests each segment
  against the H9 grammar `[A-Za-z0-9._-]+`, and rejects the whole citation on one bad segment.
  *Verified.* Because hyphens are legal inside ids, `1-5` is a valid id, not a range. Decision 4
  accordingly refuses ranges.
- `LandGateIdentifier` in `land-spec.ts` is a closed union that `landGateError` consumes. Adding a
  `plan-slices` member is the established way to add a land refusal class. *Verified.*
- The `coverage_binding` step has `skippableForTiers: []` (`steps.ts`), so it runs at every tier.
  Its D17 layer already runs before the judge-disabled early return and refuses needs-human through
  the step's refusal result. *Verified.*
- The envelope already carries an optional `adrLayer` field alongside `entries`. An optional
  membership field follows the same shape. *Verified.*
- The self-host release gate's breaking-surface classifier flags only `settings(.local).json` for
  the settings surface (`self-host/release-gate.ts`). A new `.ai-conductor/config.yml` key is not a
  breaking surface, so no migration block or waiver is needed. *Verified.*
- `collectPlanCoverage` splits the plan on `###` headings and reads only task `**Story:**` lines.
  A `## Slices` table with no Story line contributes nothing and cannot be misread. *Verified.*

**Corpus measurement:** 5,383 `**Dependencies:**` lines across 512 plans; 229 (about 4%) do not
match a bare id-list or `none` shape. None of these plans declares slices, so Decision 4's
strictness reaches none of them. *Verified* by a regex tally. It is an upper bound: some of the 229
would pass the annotation-tolerant grammar.

## Alignment

**Governing-ADR check.** A delegated repo-wide pass read all 325 ADRs. It found no ADR that governs
plan-section grammar, slices, or a strict Dependencies grammar, and none that contradicts the
design. A new ADR is warranted under §7's structural prerequisite. The slice manifest is a durable
machine-consumed data contract that five follow-up tickets (#2724–#2727, #2716) build on, and it
assigns one owner module with two enforcement points. That makes it a state/data-architecture and
component-ownership decision that no existing ADR owns. The following ADRs are cited and applied,
not amended:

- `adr-2026-08-30-shared-plan-task-reference-resolver` D1 and its 2026-09-02 multi-id amendment:
  both the `Tasks` column and the Dependencies parser resolve through `resolvePlanTaskReference`.
- `adr-2026-07-05-engine-owned-task-status` H9: the same id grammar. Remediation ids are never
  purely numeric, which makes the `rem-` exemption unambiguous.
- `adr-2026-08-31-coverage-binding-judge-step`:
  - D6: never append, never route to `plan`.
  - D16: the reseal void is the re-validation trigger that already exists.
  - D17: the precedent for a model-free layer before the judge.
  - D19: a legacy envelope is a baseline and emits nothing.
  - D20: the event goes on the union with a sink declaration.

  The #2723 slice layer is recorded in the new ADR instead of as a D21 amendment here. The slice
  layer is one of two enforcement points of the new grammar contract, and keeping both in one ADR
  avoids splitting the contract. It also avoids reopening obligation rows for all 20 existing
  decisions.
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` D4: a reasoned `none`
  with a tracked reference (#2724) is a first-class declaration. Following
  `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`, the exit condition (#2724)
  is stated.
- `adr-2026-07-26-daemon-decide-preseed-ownership` D3/D4: discovery is unchanged, with one
  validator at land.
- `adr-2026-09-23-one-owner-for-accepted-story-readability` D1/D3 and
  `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D1: one predicate, strictness only where
  the author opted in, and no new requirement on existing plans.
- `adr-2026-07-22-coherence-gate-placement-and-validation-split`: the land ladder stays fast,
  offline, and model-free.
- The event-spine chain (`adr-2026-07-26` sink-registry exhaustiveness,
  `adr-2026-08-11` halt events on the persisted spine, the exception-C rule in
  `adr-2026-08-12-cumulative-build-review-convergence-bound` D5): envelope membership is legitimate
  durable state because the occurrence is also emitted on the spine.

**Pattern consistency.**

- **Focused local pattern basis: the land rung.**
  - Role: the plan-shape land rungs `plan-done-when` and `plan-task-count` in `landSpec`.
  - Traits to keep: a pure validator in a sibling module that returns typed violations; a single
    `landGateError(<id>, …)` throw that names every violation; and placement before the
    stories/coherence checks.
  - Why it applies: the slice rung answers the same kind of question, which is whether the plan's
    own declared structure is well-formed.
  - Allowed variation: the message format, and whether the validator also returns the parsed slices.
  - Rediscovery hints: `validatePlanDoneWhen`, `validatePlanTaskCount`, `LandGateIdentifier`.
- **Focused local pattern basis: the `coverage_binding` layer.**
  - Role: the D17 ADR-obligation layer in the `coverage_binding` runner.
  - Traits to keep: runs before the judge-enabled branch; refusal via `writeEnvelope('refused', …)`
    and a `{ kind: 'needs-human' }` refusal result; engine-computed data only.
  - Allowed variation: the slice layer runs at every tier, while D17 is not applicable at tier S.
  - Rediscovery hints: `validateArchitectureObligationCoverage` call site in `step-runners.ts`,
    `CoverageBindingAdrLayerDisposition`.
- **Focused local pattern basis: config.**
  - Role: `validateMergeableAutoresolveBlock` and its `CONFIG_CONSUMER_KEY_SETS` entry.
  - Traits to keep: object-only; allow-list from the key set; `enabled` boolean-only; the error
    names the offending key.
  - Allowed variation: `stacked_prs` has only `enabled`.

**Domain boundaries.** The judgement lives in one new module next to `plan-task-parse.ts`, whose
primitives it reuses. The land rung and the `coverage_binding` layer both import it. Neither
re-implements the rules, so they cannot disagree. No new cross-domain coupling is introduced.

**State management.** The validator result is a discriminated union (`unsliced`, `sliced`,
`invalid`), and violations carry a closed code set, not free-text routing. The config key is a
single boolean with no combinations.

**Diagram accuracy.** The sequence diagram shows both call sites and the config load. It renders
(checked with `render-diagrams --check`).

**Security boundaries.** No new endpoint. The plan text is repository content already trusted by
every plan consumer. No issue text reaches the validator.

**Production DI defaults.** Not applicable. No new injected store.

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| `validatePlanSlices` (`plan-slices.ts`) | `landSpec` in `engineer/land-spec.ts` (reached from `ai-conductor compose land` / engineer land via `engineer-cli.ts`), and the `coverage_binding` step runner in `step-runners.ts` (reached from the conductor loop's step dispatch). |
| `MAX_PLAN_SLICES` constant | Read inside `validatePlanSlices`; named in the land refusal message. |
| Strict Dependencies parser (inside `plan-slices.ts`) | Called only by `validatePlanSlices`. |
| `plan-slices` `LandGateIdentifier` member | Thrown by `landSpec` and surfaced through the existing land-rejection reporting. |
| Envelope slice-membership field | Written and read by the `coverage_binding` runner; kept by `voidCoverageBindingForDecideChange` (`coverage-binding-void.ts`, called from `reseal-cli.ts`). |
| `plan_slices_changed` event | Emitted by the `coverage_binding` runner through `ConductorEventEmitter`; persisted by `EventPersister` to `.pipeline/events.jsonl` via its `EVENT_SINKS` row. |
| `stacked_prs.enabled` config key | Validated by `loadProjectConfig` (`config.ts`). No runtime reader in this feature: consumer declared `none` (reserved, #2724). |
| `skills/plan/SKILL.md` grammar section | Read by the plan skill during DECIDE; its example is parsed by a drift test. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The strict Dependencies grammar surprises plan authors used to ranges or prose | Knowledge | Medium | Low | Applies only to sliced plans. The refusal message lists the accepted forms. The plan skill documents them, and a drift test keeps them in step. |
| An amended plan re-run after a worktree recreate loses prior membership, so a move goes unreported | Data | Low | Low | Baseline rule (D19 precedent). The move is still re-validated, and the plan diff remains visible in the reseal. Only the change event is lost. |
| A remediation re-run emits a spurious `plan_slices_changed` | Technical | Low | Low | `rem-` ids are excluded from recorded membership, and the event requires a real difference. A story covers this. |
| Rebase contention in `land-spec.ts` and `step-runners.ts` | Integration | Medium | Low | Additive edits beside existing rungs and layers. The overlap scan is below. |
| An author places `## Slices` after the first task, and it is absorbed into a task body | Technical | Medium | Low | Decision 1 refuses that placement by name at land. |

No High-impact risk.

## ADRs Created

- `.docs/decisions/adr-2026-09-29-plan-slice-manifest.md`, nine decisions: grammar, single owner,
  membership rules and bound, strict Dependencies for sliced plans, the land rung, the
  `coverage_binding` layer, the event, config, and the skill drift test. APPROVED by the operator
  on 2026-09-29.

## Conditions

1. Every violation class in Decision 3 and Decision 4 has a negative-path story criterion that is
   exercised against the real `validatePlanSlices` and land gate, not against a test-local regex
   (the #1744 lesson).
2. A story proves that a plan with no `## Slices` section lands and runs `coverage_binding`
   exactly as before, with `stacked_prs.enabled` both on and off, and that a legacy free-form
   Dependencies line in an unsliced plan is still accepted.
3. A story proves that a membership change across an operator reseal emits `plan_slices_changed`
   with the moved task, and that a first run or legacy envelope emits nothing.
4. The consumer-registry reason for `stacked_prs` names #2724 as the exit.

## Overlap scan (advisory)

`ai-conductor overlap-scan` over the Wiring Surface paths (land-spec.ts, step-runners.ts,
coverage-binding-envelope.ts, coverage-binding-void.ts, types/events.ts, config.ts,
plan-task-parse.ts, the project config template, skills/plan/SKILL.md, the consumer registry):
"No overlap detected; no open blockers." (2026-09-29). This is advisory only.
