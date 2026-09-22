# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-22T15:56:39.368Z
Slug: custom-steps-work-only-in-this-repo-engine-hardcod
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-custom-steps-work-only-in-this-repo-engine-hardcod
Head SHA: 12f51dfef450674abae27957020820da476bad28
Halted at: 2026-09-22T13:05:53.541Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: **Given** a repository other than ai-conductor declares gating custom step `compliance-gate` with `completion_artifact: .pipeline/compliance-pass`, the step is `done`, and the marker was written during this feature run, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid and publication proceeds.
Task ids: 3
Done when checks: For a fixture repository whose single gating custom step `compliance-gate` is `done` with a marker newer than the feature run start, the production observer returns `present` with no unsatisfied steps. | For a fixture declaring two gating custom steps, both `done` with fresh markers, the production observer returns `present`. | For a configuration with no custom steps the production observer returns `present` and a spy on the filesystem stat call records zero calls. | Loaded from this repository's own checked-in project configuration with `maintain-documentation` and `release-disposition` both `done` and fresh, the production observer returns `present`.
Missing assertion: No cited check explicitly asserts FINISH validates release readiness and proceeds with publication.

Criterion: Story 1 happy: **Given** a repository declares two such gating custom steps and both are `done` with markers written during this feature run, **When** FINISH observes its publication prerequisites, **Then** release readiness is valid.
Task ids: 3
Done when checks: For a fixture repository whose single gating custom step `compliance-gate` is `done` with a marker newer than the feature run start, the production observer returns `present` with no unsatisfied steps. | For a fixture declaring two gating custom steps, both `done` with fresh markers, the production observer returns `present`. | For a configuration with no custom steps the production observer returns `present` and a spy on the filesystem stat call records zero calls. | Loaded from this repository's own checked-in project configuration with `maintain-documentation` and `release-disposition` both `done` and fresh, the production observer returns `present`.
Missing assertion: No cited check explicitly asserts release readiness is valid when FINISH observes the two completed steps.

Criterion: Story 1 happy: **Given** a gating custom step's marker was written during this feature run and the conductor process restarted before FINISH, **When** the resumed FINISH observes its publication prerequisites, **Then** the marker is still accepted as fresh and release readiness is valid.
Task ids: 5
Done when checks: A marker whose modification time is earlier than the feature run start makes the production observer return `stale`, which the coordinator maps to invalid release readiness. | A marker path that is a directory, and one that is a symbolic link, each make the production observer return `malformed`. | With a `done` step and no finite feature run start in state, the production observer returns `unavailable` naming the step. | A second observer instance constructed after the first is discarded, reading the same persisted state, returns `present` for a marker written after the feature run start and before the restart.
Missing assertion: The cited restart check asserts the observer returns present, but does not explicitly assert FINISH release readiness is valid.

Criterion: Story 1 negative: **Given** gating custom step `compliance-gate` is declared with a marker and its state is `pending`, `in_progress`, or `failed`, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing and publication does not proceed.
Task ids: 4
Done when checks: The production observer returns `missing` naming `compliance-gate` for each of the recorded statuses `pending`, `in_progress`, and `failed`, asserted by a table-driven test. | With one step `done` and fresh and a second step whose marker file is absent, the production observer returns `missing` naming only the second step. | With a gating custom step whose recorded status is `skipped`, the production observer returns `missing` naming that step.
Missing assertion: The cited checks assert an observer result of missing, but do not explicitly assert release readiness is missing and publication does not proceed.

Criterion: Story 1 negative: **Given** two such gating custom steps where one is `done` with a fresh marker and the other's marker file is absent, **When** FINISH observes its publication prerequisites, **Then** release readiness is missing and publication does not proceed.
Task ids: 4
Done when checks: The production observer returns `missing` naming `compliance-gate` for each of the recorded statuses `pending`, `in_progress`, and `failed`, asserted by a table-driven test. | With one step `done` and fresh and a second step whose marker file is absent, the production observer returns `missing` naming only the second step. | With a gating custom step whose recorded status is `skipped`, the production observer returns `missing` naming that step.
Missing assertion: The cited check asserts an observer result of missing, but does not explicitly assert release readiness is missing and publication does not proceed.

Criterion: Story 1 negative: **Given** a gating custom step is `done` and its marker's modification time is earlier than this feature run's start, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid and publication does not proceed.
Task ids: 5
Done when checks: A marker whose modification time is earlier than the feature run start makes the production observer return `stale`, which the coordinator maps to invalid release readiness. | A marker path that is a directory, and one that is a symbolic link, each make the production observer return `malformed`. | With a `done` step and no finite feature run start in state, the production observer returns `unavailable` naming the step. | A second observer instance constructed after the first is discarded, reading the same persisted state, returns `present` for a marker written after the feature run start and before the restart.
Missing assertion: The cited check explicitly asserts invalid release readiness, but does not explicitly assert publication does not proceed.

Criterion: Story 1 negative: **Given** a gating custom step is `done` and its marker path is a directory or symbolic link rather than a regular file, **When** FINISH observes its publication prerequisites, **Then** release readiness is invalid and publication does not proceed.
Task ids: 5
Done when checks: A marker whose modification time is earlier than the feature run start makes the production observer return `stale`, which the coordinator maps to invalid release readiness. | A marker path that is a directory, and one that is a symbolic link, each make the production observer return `malformed`. | With a `done` step and no finite feature run start in state, the production observer returns `unavailable` naming the step. | A second observer instance constructed after the first is discarded, reading the same persisted state, returns `present` for a marker written after the feature run start and before the restart.
Missing assertion: The cited check asserts an observer result of malformed, but does not explicitly assert invalid release readiness and publication does not proceed.

Criterion: Story 1 negative: **Given** a gating custom step is `done` with a marker and the feature run start is unavailable in state, **When** FINISH observes its publication prerequisites, **Then** release readiness is indeterminate and publication does not proceed.
Task ids: 5
Done when checks: A marker whose modification time is earlier than the feature run start makes the production observer return `stale`, which the coordinator maps to invalid release readiness. | A marker path that is a directory, and one that is a symbolic link, each make the production observer return `malformed`. | With a `done` step and no finite feature run start in state, the production observer returns `unavailable` naming the step. | A second observer instance constructed after the first is discarded, reading the same persisted state, returns `present` for a marker written after the feature run start and before the restart.
Missing assertion: The cited check asserts an observer result of unavailable, but does not explicitly assert indeterminate release readiness and publication does not proceed.

Criterion: Story 4 negative: **Given** a custom step whose configured skill file exists but declares no skill name, **When** configuration is validated or the step is dispatched, **Then** the run fails closed with a reason naming both the step key and the configured skill path, and no provider call is made.
Task ids: 8
Done when checks: `resolveCustomStepSkill` returns the frontmatter `name` for a valid skill file whose directory name and step key both differ from that name. | For a skill file with frontmatter but no `name`, `resolveCustomStepSkill` returns a `name-missing` failure carrying both the step key and the configured skill path. | For a configured path whose file does not exist at resolution time, `resolveCustomStepSkill` returns a `file-missing` failure carrying both the step key and the configured skill path.
Missing assertion: No cited check requires dispatch/configuration to fail closed without a provider call.

Criterion: Story 4 negative: **Given** a custom step whose configured skill file is removed after configuration was loaded, **When** the step is dispatched, **Then** the run fails closed with a reason naming both the step key and the configured skill path, and no provider call is made.
Task ids: 8
Done when checks: `resolveCustomStepSkill` returns the frontmatter `name` for a valid skill file whose directory name and step key both differ from that name. | For a skill file with frontmatter but no `name`, `resolveCustomStepSkill` returns a `name-missing` failure carrying both the step key and the configured skill path. | For a configured path whose file does not exist at resolution time, `resolveCustomStepSkill` returns a `file-missing` failure carrying both the step key and the configured skill path.
Missing assertion: No cited check requires post-load file removal during dispatch to prevent provider calls.

Criterion: Story 5 happy: **Given** the same self-build and the `release-disposition` skill directory has been renamed with the step's `skill` setting updated to match, **When** `finish` rewrites the body, **Then** the `Release-*` metadata block is still preserved and the release gate still receives it.
Task ids: 11
Done when checks: `resolveReleaseMetadataFlow` returns `active` for a self-build with the gate enabled and a `release-disposition` step whose `skill` setting points at a renamed directory. | `resolveReleaseMetadataFlow` returns `inactive` for a repository that is not a self-build even when it declares a step named `release-disposition`. | `resolveReleaseMetadataFlow` returns `inactive` for a self-build with the release-artifact gate disabled, with and without the step declared. | `resolveReleaseMetadataFlow` returns `step-missing` for a self-build with the gate enabled and no `release-disposition` step, and the module source contains no skills-directory path literal.
Missing assertion: No cited check requires finish to preserve release metadata or the release gate to receive it after the directory rename.

Criterion: Story 5 negative: **Given** a repository that is not an ai-conductor self-build and that declares a step named `release-disposition`, **When** `finish` runs, **Then** no release-metadata snapshot or restore is attempted and FINISH treats that step only as an ordinary gating custom step.
Task ids: 11
Done when checks: `resolveReleaseMetadataFlow` returns `active` for a self-build with the gate enabled and a `release-disposition` step whose `skill` setting points at a renamed directory. | `resolveReleaseMetadataFlow` returns `inactive` for a repository that is not a self-build even when it declares a step named `release-disposition`. | `resolveReleaseMetadataFlow` returns `inactive` for a self-build with the release-artifact gate disabled, with and without the step declared. | `resolveReleaseMetadataFlow` returns `step-missing` for a self-build with the gate enabled and no `release-disposition` step, and the module source contains no skills-directory path literal.
Missing assertion: No cited check requires finish to skip release-metadata snapshot/restore or treat the step as an ordinary gating custom step.

Criterion: Story 5 negative: **Given** an ai-conductor self-build with the release-artifact gate disabled, **When** `finish` runs, **Then** no release-metadata snapshot or restore is attempted and no halt is raised for a missing step.
Task ids: 11
Done when checks: `resolveReleaseMetadataFlow` returns `active` for a self-build with the gate enabled and a `release-disposition` step whose `skill` setting points at a renamed directory. | `resolveReleaseMetadataFlow` returns `inactive` for a repository that is not a self-build even when it declares a step named `release-disposition`. | `resolveReleaseMetadataFlow` returns `inactive` for a self-build with the release-artifact gate disabled, with and without the step declared. | `resolveReleaseMetadataFlow` returns `step-missing` for a self-build with the gate enabled and no `release-disposition` step, and the module source contains no skills-directory path literal.
Missing assertion: A check that `finish` does not snapshot or restore release metadata, and does not halt for a missing step, when the release-artifact gate is disabled.

Criterion: Story 6 happy: **Given** the built conductor package, **When** its main entry point's exports are listed, **Then** they equal the recorded consumer-facing export list, which contains no ai-conductor release-policy action.
Task ids: 14
Done when checks: The sorted export names of the package main entry module equal the committed recorded export list, asserted by the public-exports test. | Adding an export to the main entry without updating the recorded list makes the public-exports test fail with a message naming the unexpected export, demonstrated by a test that feeds the comparer a synthetic extra name. | The bundler configuration lists the release actions module as an entry, and importing that module yields functions for all seven release action names.
Missing assertion: A check that the recorded consumer-facing export list contains no ai-conductor release-policy action.
```
