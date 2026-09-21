**Status:** Accepted

# Stories: Custom steps without engine-reserved names or paths

**Track:** Technical
**Source:** jstoup111/ai-conductor#1344
**Architecture:** `.docs/decisions/architecture-review-2026-09-20-custom-steps-work-only-in-this-repo-engine-hardcod.md`; `adr-2026-07-25-custom-step-completion-artifacts` D3.1 and D6

A "gating custom step" below is a `steps.«name»` entry whose key is not a built-in step and whose
`enforcement` is `gating`. "Marker" is the file named by that step's `completion_artifact`.

## Story 1: Any gating custom step with a marker is a FINISH prerequisite

As a maintainer of any repository, I want a gating custom step I declare to block FINISH until it
has passed in this feature run, so that my own gate is enforced without an engine change or a step
name chosen by ai-conductor.

### Acceptance Criteria

#### Happy Path

- **Given** a repository other than ai-conductor declares gating custom step `compliance-gate` with `completion_artifact: .pipeline/compliance-pass`, the step is `done`, and the marker was written during this feature run, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid and publication proceeds.
- **Given** a repository declares two such gating custom steps and both are `done` with markers written during this feature run, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid.
- **Given** a gating custom step's marker was written during this feature run and the conductor process restarted before FINISH, **When** the resumed FINISH observes its publication prerequisites, **Then** the marker is still accepted as fresh and release readiness is valid.

#### Negative Paths

- **Given** gating custom step `compliance-gate` is declared with a marker and its state is `pending`, `in_progress`, or `failed`, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing and publication does not proceed.
- **Given** two such gating custom steps where one is `done` with a fresh marker and the other's marker file is absent, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing and publication does not proceed.
- **Given** a gating custom step is `done` and its marker's modification time is earlier than this feature run's start, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid and publication does not proceed.
- **Given** a gating custom step is `done` and its marker path is a directory or symbolic link rather than a regular file, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid and publication does not proceed.
- **Given** a gating custom step is `done` with a marker and the feature run start is unavailable in state, **When** FINISH observes its publication prerequisites, **Then** release readiness is indeterminate and publication does not proceed.

### Done When

- [ ] A fixture repository whose only custom step is named something other than `release-disposition` has FINISH blocked until that step is `done` with a fresh marker, and unblocked afterward.
- [ ] A marker older than the feature run start is rejected, and the same marker is accepted after a simulated process restart within the same feature run.
- [ ] ai-conductor's own configuration, with `maintain-documentation` and `release-disposition` both declared, reaches valid release readiness when both are `done` with fresh markers.

## Story 2: Steps that are not prerequisites never block FINISH

As a maintainer, I want FINISH to require only the custom gates that can gate it, so
that widening the prerequisite cannot block or deadlock a repository.

### Acceptance Criteria

#### Happy Path

- **Given** a repository declares no custom steps, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid exactly as before this change and no marker is read.
- **Given** a gating custom step with a marker that is ordered after `finish`, **When** FINISH observes its publication prerequisites, **Then** that step is not required and FINISH can complete.

#### Negative Paths

- **Given** a custom step declared with `enforcement: advisory` and a marker that is absent, **When** FINISH observes its publication prerequisites, **Then** that step is not required and release readiness is valid.
- **Given** a gating custom step declared without `completion_artifact` whose state is `done`, **When** FINISH observes its publication prerequisites, **Then** that step is not required and release readiness is valid.
- **Given** a gating custom step with a marker whose recorded status is `skipped`, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing because of that step, since a gating custom step can never be legitimately skipped.
- **Given** a gating custom step ordered after `finish` and a gating custom step ordered before `finish` whose marker is stale, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid because of the step ordered before `finish` only.

### Done When

- [ ] A repository with no custom steps produces the same FINISH observation as on the pre-change engine.
- [ ] A fixture with a gating step ordered after `finish` reaches FINISH completion, and a fixture whose gating step is recorded `skipped` is blocked naming that step.
- [ ] Mixed fixtures show that an excluded step never masks an unsatisfied required step.

## Story 3: An unsatisfied custom gate names itself

As an operator, I want a FINISH refusal caused by a custom gate to tell me which step, so that I
can fix that gate instead of guessing.

### Acceptance Criteria

#### Happy Path

- **Given** gating custom step `compliance-gate` is the only unsatisfied prerequisite, **When** FINISH reports the blocked release-readiness condition, **Then** the operator-visible reason contains the step key `compliance-gate` and the existing condition code is unchanged.
- **Given** gating custom steps `compliance-gate` and `notes-gate` are both unsatisfied, **When** FINISH reports the blocked release-readiness condition, **Then** the operator-visible reason names both step keys.

#### Negative Paths

- **Given** every gating custom step prerequisite is satisfied, **When** FINISH completes publication, **Then** no blocked release-readiness condition is reported and no step key appears in a refusal.
- **Given** release readiness is indeterminate because the feature run start is unavailable, **When** FINISH reports the blocked condition, **Then** the reason names the affected step keys and keeps the indeterminate condition code rather than reporting missing or invalid.
- **Given** a custom step key that is not a built-in step name is named in a refusal, **When** the refusal is emitted and persisted as an event, **Then** the event is accepted by the existing event pipeline without the key being recorded as a built-in step.

### Done When

- [ ] Each of the three blocked release-readiness conditions carries the unsatisfied step key or keys in its operator-visible reason.
- [ ] The set of FINISH condition codes and dispositions is unchanged from before this work.
- [ ] A refusal naming a custom step key round-trips through `.pipeline/events.jsonl`.

## Story 4: A custom step runs the skill its configuration names

As a maintainer, I want a custom step to invoke the skill its `skill` setting points at, whatever I
call the step, so that my step key and my skill directory are mine to name.

### Acceptance Criteria

#### Happy Path

- **Given** custom step `docs-gate` whose `skill` points at a valid skill file named `maintain-documentation`, **When** the step is dispatched to Claude, **Then** the provider is asked to run the `maintain-documentation` skill and pipeline state stays keyed by `docs-gate`.
- **Given** the same custom step is routed to Codex, **When** the step is dispatched, **Then** the provider is asked to run the `maintain-documentation` skill using Codex's invocation form rather than Claude's.
- **Given** ai-conductor's own `maintain-documentation` and `release-disposition` steps, whose keys equal their skill names, **When** each is dispatched, **Then** the provider receives the same invocation it received before this change.
- **Given** a custom step dispatched through provider fallback to a second provider, **When** the second candidate is tried, **Then** it is asked for the same configured skill in that provider's own invocation form.

#### Negative Paths

- **Given** custom step `docs-gate` whose configured skill is named differently from the step key, **When** the provider prompt is built, **Then** the step key is never substituted as the skill to run.
- **Given** a custom step whose configured skill file exists but declares no skill name, **When** configuration is validated or the step is dispatched, **Then** the run fails closed with a reason naming both the step key and the configured skill path, and no provider call is made.
- **Given** a custom step whose configured skill file is removed after configuration was loaded, **When** the step is dispatched, **Then** the run fails closed with a reason naming both the step key and the configured skill path, and no provider call is made.
- **Given** a built-in step with a `skill` override, **When** it is dispatched, **Then** its invocation is unchanged by this work.

### Done When

- [ ] A fixture custom step whose key differs from its skill name dispatches that skill on Claude and on Codex, each in its native form.
- [ ] The prompts sent for ai-conductor's two existing custom steps are byte-identical to the pre-change prompts.
- [ ] Both fail-closed cases stop before any provider invocation and name step and skill.

## Story 5: This repository's release flow no longer depends on a file path

As an ai-conductor maintainer, I want our release-metadata handling to stay on through a rename and
to stop loudly when it cannot run, so that the release gate can never go quiet.

### Acceptance Criteria

#### Happy Path

- **Given** an ai-conductor self-build with the release-artifact gate enabled and the `release-disposition` step declared, **When** `finish` rewrites the retained draft pull request body, **Then** the `Release-*` metadata block written by the step is present afterward, byte-for-byte.
- **Given** the same self-build and the `release-disposition` skill directory has been renamed with the step's `skill` setting updated to match, **When** `finish` rewrites the body, **Then** the `Release-*` metadata block is still preserved and the release gate still receives it.
- **Given** the same self-build, **When** the self-host finish gates run, **Then** the release gate receives the retained draft's release metadata as it does today and the draft is not marked ready before those gates pass.

#### Negative Paths

- **Given** an ai-conductor self-build with the release-artifact gate enabled and no `release-disposition` step declared, **When** the self-host finish gates run, **Then** the run halts for a human with a reason naming the `release-disposition` step, a committed halt record is produced, and the pull request is not marked ready.
- **Given** a repository that is not an ai-conductor self-build and that declares a step named `release-disposition`, **When** `finish` runs, **Then** no release-metadata snapshot or restore is attempted and FINISH treats that step only as an ordinary gating custom step.
- **Given** an ai-conductor self-build with the release-artifact gate disabled, **When** `finish` runs, **Then** no release-metadata snapshot or restore is attempted and no halt is raised for a missing step.
- **Given** an active release flow whose retained draft body holds a malformed `Release-*` block, **When** the pre-finish snapshot is taken, **Then** the run refuses as it does today rather than publishing without metadata.

### Done When

- [ ] A self-build fixture with a renamed release skill directory preserves the metadata block across `finish`.
- [ ] A self-build fixture with the step removed halts `needs-human`, names the step, and leaves `.docs/halted/` holding the record.
- [ ] A non-self-build fixture declaring a `release-disposition` step makes no release-metadata GitHub calls.

## Story 6: The package's main entry offers only what a consumer can use

As a consumer of the conductor package, I want its advertised API to contain only things I can call,
while ai-conductor's own release workflows keep working from a repository-local entry.

### Acceptance Criteria

#### Happy Path

- **Given** the built conductor package, **When** its main entry point's exports are listed, **Then** they equal the recorded consumer-facing export list, which contains no ai-conductor release-policy action.
- **Given** the built package, **When** each of `release-metadata.yml`, `release-pr.yml`, and `release.yml` resolves its import, **Then** the imported file exists in the build output and exports every name that workflow uses.
- **Given** a pull request in this repository with valid release metadata, **When** the release-metadata check runs from its repository-local entry, **Then** it passes exactly as before.

#### Negative Paths

- **Given** a change that adds a new export to the main entry point without updating the recorded consumer-facing list, **When** the export-list check runs, **Then** it fails naming the unexpected export.
- **Given** a change that renames or drops a name one of the three release workflows imports, **When** the pre-merge workflow-import check runs, **Then** it fails naming the workflow and the missing name, before merge.
- **Given** a pull request in this repository with missing or malformed release metadata, **When** the release-metadata check runs from its repository-local entry, **Then** it fails closed exactly as before.
- **Given** a freshly bootstrapped consumer repository, **When** its generated pull request template is inspected, **Then** it contains no `Release-Disposition` contract, as today.
- **Given** a registered repository whose own pull request template opts into release metadata, **When** the composer opens a spec pull request there, **Then** the release disposition is still injected as it is today.

### Done When

- [ ] A recorded export list for the main entry exists and a check fails on drift in either direction.
- [ ] A pre-merge check proves every release workflow import resolves against the build output, covering the two workflows that only run after merge.
- [ ] The release-metadata required check passes on the implementation pull request itself.
