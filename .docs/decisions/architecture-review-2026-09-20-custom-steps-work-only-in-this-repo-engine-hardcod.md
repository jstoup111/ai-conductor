# Architecture Review: Custom steps without engine-reserved names or paths (#1344)

**Date:** 2026-09-20
**Mode:** Pre-stories, lightweight (Tier M) — Feasibility and Alignment only
**Input reviewed:** `.docs/track/custom-steps-work-only-in-this-repo-engine-hardcod.md` (technical
track, operator-confirmed scope), intake jstoup111/ai-conductor#1344, and
`.docs/architecture/custom-steps-work-only-in-this-repo-engine-hardcod.md`
**Verdict:** APPROVED WITH CONDITIONS

## Scope under review

Operator-confirmed on 2026-09-20. Four engine bindings tie custom-step behavior to this repository;
the spec removes all four, adds no configuration key, and documents custom steps end to end.

1. The FINISH release-readiness observer finds its step by the reserved name `release-disposition`.
2. `releaseDispositionFlowActive()` activates on a self-build plus a skill-path string literal.
3. Five release action modules are re-exported from the package entry point although only this
   repository's workflows call them.
4. **Added during this review, operator-approved.** A custom step's configured `skill` is validated
   at config load and never used to dispatch. The provider prompt is the step key.

Out of scope, filed separately: step packages and installed step identity (#2615, blocked by
#1986), and PR-body customization for custom steps (#2616).

## Feasibility

Every claim below was read directly from source on `main` at `fb0f10a8e` unless marked inferred.

| Element | Finding | Basis | Confidence |
|---|---|---|---|
| FINISH prerequisite | `createProductionReleaseReadinessObserver` reads `config.steps['release-disposition']`, requires state `done`, and compares the marker's mtime to `state.run_started_at`. Generalizing it is an iteration over declared custom steps feeding the same four-value verdict. | verified — `finish-publication-production.ts` | 95% |
| Step status vocabulary | `StepStatus` includes `skipped`, but configuration cannot produce it for a gating custom step: `when:` and `disable: true` are rejected at config load for gating custom steps, and custom steps have no tier skip. | verified — `types/steps.ts`, `steps.ts`, shipped story `when-bypasses-gating-enforcement-while-disable-is-` | 90% |
| Naming the step in a refusal | FINISH's blocked conditions are a closed set with fixed message literals. Carrying a step key needs an additive field on the observation and the condition, not a new disposition. | verified — `finish-publication.ts` `release_readiness_missing` / `_invalid` / `_indeterminate` | 90% |
| Self-host activation | The release gate already runs only inside `runSelfHostFinishGates` under `sh.releaseArtifactGate`. Dropping the path literal leaves an activation of "self-build and the gate is on". | verified — `conductor.ts`, `resolved-config.ts` | 95% |
| SHIP draft PR reach | `openShipDraftPr` runs for every project, not only self-builds. The `Release-*` snapshot/restore is what is self-host-only, because `snapshotReleaseMetadataBlock` accepts only this repository's schema. | verified — `conductor.ts`, `release-metadata.ts` | 90% |
| Second build entry point | The package is bundled by tsup with hashed chunks, so a workflow cannot import an arbitrary module. `tsup.config.ts` already declares a second entry, `src/engine/build-review-test-declarations.ts`, emitted at a stable path. A release-actions entry follows the same pattern. | verified — `tsup.config.ts`, built `dist/` listing | 90% |
| Workflow atomicity | `release-metadata.yml`, `release-pr.yml`, and `release.yml` trigger on `pull_request` or `push` and check out the commit they run from; none use `pull_request_target`. Workflow edits and the module move are atomic in one PR. | verified — the three workflow files | 90% |
| Shared parser stays | `engine/release-metadata.ts` is imported by `engine/engineer/release-metadata-inject.ts`, which runs for any registered repository whose PR template opts in. It was never exported from `index.ts`. It does not move. | verified — import graph by grep | 95% |
| Dispatch by step key | `step-runners.ts` builds the prompt as the registry invocation for built-ins and the literal `/` plus the step key otherwise. `resolveSkill()` in `skill-resolver.ts` has no production caller. This repository's two steps dispatch only because `.claude/skills/` holds symlinks named exactly like their step keys. | verified — `step-runners.ts`, `skill-resolver.ts`, `.claude/skills/` listing | 90% |
| Codex prefix | The custom-step prompt hardcodes `/`; `renderSkillInvocation` uses `$` for Codex. A custom step routed to Codex is mis-invoked today. | verified by reading; not exercised | 80% |

**Stack compatibility:** no new package, service, or infrastructure. **Data implications:** none —
no persisted schema changes. **Performance:** the prerequisite check is one `lstat` per declared
custom step. **Worktree isolation:** markers stay under the per-worktree `.pipeline/`; nothing
shared is introduced.

**Prerequisites:** none outside the diff. **Integration surface:** FINISH publication, step
dispatch, self-host gates, the bundler config, three workflows, and reference docs — four module
boundaries, which is why this is Medium rather than Small.

## Alignment

Repo-wide ADR sweep: all 340 non-review records under `.docs/decisions/` were opened by two
delegated readers with non-overlapping halves, without keyword narrowing. **No record contradicts
the design.** The governing quote from the first half was re-verified against the file here.

### Governing decision — amended in this spec

`adr-2026-07-25-custom-step-completion-artifacts` (APPROVED) defines `completion_artifact`. Its
decision 3 sets the non-dispatch freshness floor to the conductor session start, while the FINISH
observer deliberately uses the feature run start so a resumed FINISH does not reject a marker
written earlier in the same run. Generalizing the observer would put every custom step under that
unreconciled pair, so the ADR is amended in place (D3.1) and gains D6, which records the
generalized prerequisite and its ordering exclusion. No new ADR: the structural decision — an opt-in
completion artifact as the gate — already exists and is reused.

### Constraints the stories and plan must honor

| ADR (APPROVED) | Constraint on this work |
|---|---|
| `adr-2026-08-01-engine-owned-resumable-finish-publication` | The prerequisite stays an observed input to the observe-then-advance coordinator and resolves to its closed dispositions. No bespoke failure path, no independent progress ledger. |
| `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` | `verify_release_readiness` keeps owning the `releaseReadiness` dimension; the generalized check must not add a second dimension that can report progress. |
| `adr-2026-06-30-self-host-detection-seam` | Self-host activation goes through the `SelfHostDetector` seam. No hand-rolled path comparison replaces the literal being removed. |
| `adr-2026-06-30-halt-based-release-gates` | A self-host gate that cannot self-satisfy fails closed with a distinct HALT reason. An active flow whose step is absent or renamed is exactly that case. |
| `adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-08-23-committed-halt-record` | The self-host halt is written through `writeHaltMarker` with class `needs-human`, which also yields the committed halt record. No direct write to `.pipeline/HALT`. |
| `adr-2026-08-11` halt events on the persisted spine | The halt is emitted through the central `emitLoopHalt` stamp, not a per-site message. No new event type is required; if one is introduced it needs an `EVENT_SINKS` row (`adr-2026-07-26-event-sink-registry-exhaustiveness`). |
| `adr-2026-09-10-shared-step-lifecycle-telemetry` | Custom step keys are never cast into the closed `StepName` telemetry type while iterating declared steps. |
| `adr-2026-07-29-ship-start-draft-pr` | `runSelfHostFinishGates` still runs before `finish` is dispatched; the draft-to-ready flip still waits on it. |
| `adr-2026-09-05-gh-cli-version-floor-and-environment-gate`, `adr-2026-09-11-github-operation-ownership` | Relocating the snapshot/restore must keep its `gh pr edit` calls behind the typed-error seam and inside the guarded GitHub-operation inventory. Moving code must not create a second unguarded write path. |
| `adr-2026-08-04-unresolved-step-command-fails-by-name`, `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | Custom-step dispatch renders through the shared provider-aware invocation (`/` for Claude, `$` for Codex), and an unresolvable skill fails by name. |
| `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` | `steps.<custom>.skill` gains a real consumer at dispatch; the key registry entry must reflect it. No new key is added. |
| `adr-2026-07-27-project-config-scaffolder` | The scaffolded consumer config must still contain no harness-internal self-host key. |

### Pattern basis

- **Secondary bundle entry.** Role: a stable, importable built file outside the main entry.
  Precedent: the `build-review-test-declarations` entry in `tsup.config.ts`. Traits to preserve: a
  named entry in the bundler config, emitted at a path mirroring its source path, imported by
  absolute workspace path. Allowed variation: the module's contents and location under
  `engine/self-host/`.
- **Table-driven instead of name-driven.** Precedent: `adr-2026-07-27-daemon-decide-kickback-halt`
  — "Phase is resolved from the passed `steps` table, never from a hardcoded name list, so a
  config-added custom DECIDE step is covered without edits." The prerequisite iteration follows it.
- **Removing a public re-export.** Precedent: `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`
  justified a removal on "no third-party plugin exists" and no published consumer. The same test
  applies to the five release exports: their only callers are this repository's workflows.
- **Dispatch identity.** Verified no-fit for resolving a path-addressed skill against an installed
  catalog — that mechanism is #1986's and is out of scope. This spec identifies the skill by the
  `name` in the configured file's frontmatter, which the existing override validation already
  requires, and renders it through the shared invocation helper.

### Diagram accuracy

The component diagram predates the dispatch finding. It must gain the dispatch edge
(`steps.«name».skill` → frontmatter name → provider-aware invocation) before the plan is written;
see Conditions.

## Wiring Surface

| New or changed production surface | Where it is called from in production |
|---|---|
| Generalized FINISH prerequisite observer | Constructed at the two existing sites that build the production observer today — the CLI entry and the daemon CLI — and consumed by the FINISH coordinator's `observeReleaseReadiness` port. |
| Step key on the blocked release-readiness condition | Produced by the FINISH coordinator's condition mapping; surfaced through the existing blocked-condition rendering and event emission. |
| Self-host release-metadata flow module (activation, snapshot, restore) | Called from `Conductor` at the four sites that call `releaseDispositionFlowActive()` today, and from `runSelfHostFinishGates`. |
| Self-host halt for an absent release step | `writeHaltMarker` via the existing self-host halt writer, emitted through `emitLoopHalt`. |
| Release actions entry module | A named tsup entry; imported by `release-metadata.yml`, `release-pr.yml`, and `release.yml`. No engine code imports it. |
| Custom-step skill invocation | The provider step runner's prompt construction, on both the direct path and the provider-candidate path that re-renders the prompt per candidate. |

Candidate paths for the overlap scan: `src/conductor/src/engine/finish-publication-production.ts`,
`src/conductor/src/engine/finish-publication.ts`, `src/conductor/src/engine/conductor.ts`,
`src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/skill-resolver.ts`,
`src/conductor/src/index.ts`, `src/conductor/tsup.config.ts`, the five `release-*.ts` action
modules, and the three release workflows.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A gating step ordered after `finish` becomes a prerequisite and deadlocks FINISH | Technical | Medium | High | ADR D6 excludes it; it has its own criterion. A `skipped` gating step is deliberately not excluded — see the amendment note under Conditions. |
| `maintain-documentation` newly becomes a FINISH prerequisite and blocks this repository's builds | Technical | Low | High | In normal flow it is already `done` with a fresh marker before `finish`; an explicit criterion proves no behavior change for it |
| A recreated worktree loses `.pipeline/` markers, so a `done` step reads as `missing` at FINISH | Data | Low | Medium | Pre-existing for `release-disposition` today; the refusal now names the step, which makes it diagnosable. Not widened beyond markers that already gate. |
| PR #2523 (#1986) edits `conductor.ts`, `step-runners.ts`, and `types/config.ts` concurrently | Integration | High | Medium | Advisory overlap scan before `/plan`; tasks scoped to small, named regions; whichever merges second rebases |
| Release workflows break after the import path moves | Integration | Medium | High | Same-PR atomic change; `release-metadata.yml` runs on the implementation PR itself and is a required check, so a broken import fails before merge. `release.yml` and `release-pr.yml` only run after merge — see Conditions. |
| Deriving dispatch identity from frontmatter `name` diverges from the directory name for some consumer skill | Technical | Low | Medium | Fail closed naming step and skill when the name is absent; document that the provider must be able to resolve that name |
| The migration gate has no vocabulary for removed package exports | Knowledge | Medium | Low | Not one of the four canonical breaking surfaces; no consumer can call the exports. Declared as a `Removed` release note. Operator to confirm semver at PR time. |

## ADRs Created

None. **Amended:** `adr-2026-07-25-custom-step-completion-artifacts` — D3.1 (FINISH freshness floor
is the feature run start) and D6 (every gating, artifact-declaring, pre-`finish`, non-skipped
custom step is a FINISH prerequisite; no reserved name). Status remains APPROVED.

## Conditions

1. **Update the component diagram** with the custom-step dispatch edge before `/plan`.
2. **Post-merge workflows need a pre-merge proof.** `release-pr.yml` and `release.yml` cannot run
   on the implementation PR. The plan must include a check, runnable before merge, that each
   workflow's import specifier resolves to a file the build emits and that the emitted module
   exports every symbol the workflow destructures.
3. **Both prerequisite exclusions are acceptance criteria**, not implementation notes: a `skipped`
   gating step, and a gating step ordered after `finish`.

   > **Amended 2026-09-20 by #1344:** conflict-check found that the `skipped` exclusion contradicts
   > the shipped rule that gating custom steps can never be disabled or made conditional. Only the
   > after-`finish` exclusion stands. A gating custom step recorded `skipped` leaves FINISH
   > blocked, naming the step; that is an acceptance criterion instead.
4. **No step key enters `StepName` telemetry** by cast while iterating custom steps.
5. **The self-host halt uses `writeHaltMarker` with class `needs-human`** and the central halt
   event; no direct marker write and no new halt class.
6. **Run the advisory overlap scan** over the Wiring Surface paths before `/plan` and carry its
   report into task scoping, given PR #2523.
