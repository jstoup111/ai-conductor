# ADR: Per-feature step applicability is a merged base-tree marker honored at daemon dispatch

**Date:** 2026-10-03
**Status:** APPROVED
**Deciders:** operator (James Stoup), via composer DECIDE for #1789
**Spec:** .docs/specs/step-applicability-is-fixed-repo-wide-decide-canno.md

## Context

Step applicability is fixed repo-wide. Per-feature variation exists only through derived markers:
the complexity tier (`.docs/complexity/<stem>.md`) and the track (`.docs/track/<stem>.md`, per
adr-2026-06-29-track-marker-location). The repo-wide opt-out is `steps.<name>.disable`, permitted
for gating steps only when the step sets `configDisableAllowed` (validated by
`stepSkipAuthorityError` in `engine/config.ts`); today `manual_test` and `prd_audit` opt in.

Verified facts this decision rests on:

- The daemon reads feature markers from the base branch, not the worktree: `discoverBacklog`
  uses `BacklogTreeSource` (`engine/backlog-tree-source.ts`, built by `gitTreeSource` in
  `engine/daemon-backlog.ts`) and `readFeatureMarker`. Values flow `BacklogItem` →
  `deriveDaemonBaseState` (`engine/daemon-state.ts`) → `ConductState`.
- Interactive runs read no marker from the base branch (`resolveTrack` reads the worktree).
- The daemon pre-seeds only `worktree` and `memory` as done (adr-2026-08-03-fail-closed-decide-entry
  D2). DECIDE artifacts are authored and validated before the spec lands, and DECIDE composition is
  governed by tier and track at the land gate (`engine/engineer/land-spec.ts`).
- Every skip records `StepStatus 'skipped'`; about 20 consumers read that status, none through an
  exhaustive switch. Only loop gates / kickback targets persist a cause (`recordSkipVerdict`).
  Tier and track skips emit `tier_skip` / `config_skip` (persist-only), so causes are not
  distinguishable today.
- Several SHIP and BUILD gates are mandated to run on every feature by APPROVED ADRs:
  - `prd_audit` (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback D2);
  - `architecture_review_as_built` (adr-2026-08-22-as-built-review-runs-always-with-plan-gap D1);
  - `coverage_binding`'s model-free obligation and slice layers
    (adr-2026-08-31-coverage-binding-judge-step D16-D19, adr-2026-09-29-plan-slice-manifest D6).
- No consumer halts when `acceptance_specs` or `manual_test` is skipped: prerequisites treat `skipped` as satisfied, `finish`
  accepts skipped via `stepDone`, and shipped-record copying tolerates missing audit artifacts.
- `firstAppearanceTime` (`engine/owner-gate/merge-time.ts`) already runs `git log <base>` over a
  `.docs` path; no helper yet returns commit identity.

## Options Considered

### Option A: DECIDE-authored marker, honored from the merged base tree (chosen)
- **Pros:** Reuses the tier/track marker idiom and the daemon's existing base-tree read path; the
  operator's spec-PR merge is the authority; reviewable in the spec PR.
- **Cons:** Interactive runs cannot honor it without a new base read; "who" is git identity, not a
  verified human signal.

### Option B: Operator waiver command (TTY, session-guarded) recorded outside the worktree
- **Pros:** Strong proof of operator identity.
- **Cons:** No DECIDE record; contradicts the PRD's first goal. Rejected in explore.

### Option C: Marker plus operator TTY ratification
- **Pros:** Meets every outcome with the strongest authority.
- **Cons:** Heavier; the operator chose minimal scope. Rejected in explore; revisit if a daemon-run
  DECIDE ever lands on base without a human merge.

### Option D: New `StepStatus` value `inapplicable`
- **Pros:** Distinct at the status layer itself.
- **Cons:** Touches about 20 `'skipped'` consumers (selector, state, rewind, rebase, finish,
  conflicts, decide-entry policy) for no behavioral gain; every one would have to learn that
  `inapplicable` satisfies like `skipped`. Rejected in favor of a persisted cause.

## Decision

1. **Marker.** A feature declares inapplicable steps in `.docs/applicability/<stem>.md`, with the
   same stem contract and undated-stem fallback as the tier and track markers. Each declaration is
   one line `Inapplicable: <step_name> — <reason>`. Other lines are free prose. A parser
   `parseApplicability` in `artifacts.ts` sits beside `parseTrack` and returns the ordered
   declarations or a typed parse error.
2. **Repository toggle, default off.** A project config block `feature_applicability: { enabled:
   boolean }` defaults to `enabled: false`. When it is off, step selection is byte-for-byte today's
   behavior. The key is project-only: a user-level config value is ignored and never inherited, so
   land and the daemon resolve the same answer. The key is registered in the config-consumer
   registry (adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal).
3. **Per-step declarability.** `StepDefinition` gains `featureInapplicableAllowed?: true`. Only
   two built-ins set it: `acceptance_specs` and `manual_test`. No other step is declarable, and
   dispatch never honors a declaration for one. That explicitly covers:
   - any `structural` step;
   - `test_suite`, `build_review`, `finish`;
   - any DECIDE-phase step;
   - `prd_audit` and `architecture_review_as_built`, which APPROVED ADRs mandate on every feature;
   - `coverage_binding`, whose obligation and slice layers must run whatever the judge's state.

   Custom steps cannot opt in. A declaration is not a tier skip, so the S-tier pinned gate set
   (adr-2026-07-21 D4) is unaffected. The flag is a deliberately separate authority from
   `configDisableAllowed`: it is per feature and requires the operator's spec-PR merge.
   `manual_test` keeps its repository-wide `configDisableAllowed` opt-in. For `acceptance_specs`, an
   honored declaration is a skip, not a third completion outcome. The zero-spec contract's two
   completion outcomes apply only when the step runs.
4. **Land-gate validation.** `landSpec` validates an applicability marker when the idea authored
   one. It refuses with typed `landGateError` codes that name the offending line when:
   - the toggle is off;
   - the step name is unknown;
   - the step is not declarable;
   - the reason is empty;
   - a step is declared twice;
   - the line is malformed.
5. **Authority is the merged base.** Only the daemon honors declarations. It reads the marker
   through `BacklogTreeSource` from the base branch alongside tier and track. It carries the marker
   on `BacklogItem` and seeds it into `ConductState.applicability_declarations` through
   `deriveDaemonBaseState`. That field holds either an array of `{ step, reason, decider, commit }`
   or an ignored cause, and it is refreshed on every dispatch. Honored declarations are appended to
   the separate durable record `ConductState.feature_inapplicable` (D8). Interactive runs never
   honor a declaration. An interactive run has no seeded declarations, and that absence is how
   dispatch tells the two kinds of run apart. The marker and decider are read at the base SHA pinned when the feature was
   claimed. These cases are reported, not honored, through `step_inapplicable_ignored`:
   - cause `branch-only`: a worktree marker whose content is absent from, or differs from, the
     base copy;
   - cause `toggle-off`: the toggle is off but the base carries a marker;
   - cause `invalid`: the base copy fails D4's validation, for example after a hand-pushed merge.
     Nothing in that marker is honored, and the event names the first failure;
   - cause `interactive`: an interactive run finds a marker in its checkout.

   Declarations are amended only through DECIDE and an operator-merged spec PR. The marker sits
   outside the protected-artifact seal on purpose: the base-only read is the authority, and the
   existing `.docs/` commit gate still applies.
6. **Decider attribution.** The daemon resolves the decider from the latest first-parent commit on
   the base branch that touched the marker: `git log -1 --first-parent <base> --format=%H%x00%an
   <%ae>%x00%cn <%ce> -- <marker>`. This is a sibling helper to `firstAppearanceTime`. The record
   carries the author, the committer, and the sha. Under squash merges the author is the spec PR's
   author, which can be a configured bot, and the sha links to the PR. `decider` is an audit label
   only: it never feeds owner resolution, authorization, or any gate. When it cannot be resolved, the
   decider is `unknown` and the sha is recorded if available. An unresolved decider does not block
   honoring.
7. **Late declarations are refused.** At dispatch, a declared step whose observed status for this
   feature is anything other than `pending` is not skipped. That includes `in_progress`, `done`,
   `failed`, `refused`, and `stale`. Dispatch emits `step_inapplicable_refused { step, reason,
   priorStatus }`, and the prior outcome stands. A step already recorded in
   `ConductState.feature_inapplicable` is exempt from refusal: it stays skipped across rewind,
   rebase, and post-rebase invalidation, which already preserve `skipped`. Removing a declaration
   from the base after it was honored does not reopen the step.
8. **Recording: keep the status, add a cause and an event.** An honored declaration calls
   `recordStepSkip` with the cause `inapplicable: <reason>`. Status stays `skipped`, and loop gates
   keep the skip verdict. It also emits a new `ConductorEvent` variant `step_inapplicable { step,
   reason, decider, commit }` with sink policy `{ render: true, persist: true, audit: false, otel:
   true }`. `step_inapplicable_ignored` and `step_inapplicable_refused` get `{ render: true,
   persist: true, audit: false, otel: true }` rows in the total sink registry, and the metrics
   listener exports all three. Reasons and identities stay off metric labels. Writes to
   `ConductState.feature_inapplicable` go through the conduct-state mutation port. A declared
   `manual_test` is absent from the parallel validation group's dispatched members. Each honored
   entry is appended to `ConductState.feature_inapplicable`. Distinctness for operators comes from
   that record:
   - the dashboard step line renders it with its own icon and reason;
   - daemon status shows it per feature.

   Tier, track, and config-disable skips are unchanged. The `config_skip` naming of track skips is
   out of scope.
9. **Prerequisite semantics unchanged.** Because the status remains `skipped`, every existing
   prerequisite and `stepDone` consumer treats an inapplicable step as satisfied. No new branch is
   needed in the selector, state, rewind, rebase, or finish.

## Consequences

### Positive
- No change for repos that set nothing; all new behavior sits behind a default-off toggle.
- Reuses the marker idiom, the base-tree read path, `recordStepSkip`, and the event spine. There is
  no parallel channel.
- The operator can see every declaration in the spec PR and audit it afterwards via the event,
  state, and decider identity.
- #1790 lanes can build on a declarable-step mechanism instead of inventing their own.

### Negative
- Interactive runs ignore declarations. An operator hand-driving a feature pays the full gate chain.
- The decider is git identity, not a verified human action. A spec PR authored by a bot identity
  records that bot.
- `skipped` remains the status, so any consumer that wants the cause must read
  `feature_inapplicable` or the event, not the status.

### Follow-up Actions
- [ ] Parser + land-gate validation + typed errors.
- [ ] Config toggle + `featureInapplicableAllowed` metadata + config-validation guard.
- [ ] Backlog read, decider helper, `BacklogItem` / `ConductState` seeding.
- [ ] Dispatch honoring, late-refusal, ignored-event paths, new event variants + sink policy.
- [ ] Dashboard and daemon-status rendering; docs/reference/steps.md and configuration reference.
