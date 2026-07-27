# DECIDE-phase coherence ownership at the daemon boundary (#971)

Status: Accepted

## Context

`coherence_check` is declared `phase: 'DECIDE'` (`steps.ts:119-131`) yet is the only one of the
nine DECIDE steps missing from the daemon's hand-maintained `PRESEEDED_DONE`
(`daemon-cli.ts:285-296`), so a daemon-dispatched build resumes onto a DECIDE authoring step.
Production-observed on eight features; one M-tier run exhausted its retry budget on a provider
rate limit and halted the build (`.daemon/daemon.log:7906-7911`). Design per
`adr-2026-07-26-daemon-decide-preseed-ownership.md` (APPROVED).

## Story 1 — A daemon-dispatched run never executes the coherence-check authoring step

As the autonomous build daemon, when I dispatch a merged spec, I must never execute
`coherence_check`, so that semantic DECIDE authoring cannot happen inside the build loop.

### Happy Path

- **Given** a merged M-tier spec with a valid `.docs/coherence/<slug>.md`,
- **When** the daemon dispatches it and the conductor resumes,
- **Then** `coherence_check` is not among the executed steps,
- **And** the first executed step is `acceptance_specs`,
- **And** the run's `conduct-state.json` records `coherence_check` as resolved before the
  conductor's first dispatch, not as the result of an execution.

### Negative Paths

- **Given** an L-tier merged spec (the tier at which the step is least likely to be skipped),
- **When** the daemon dispatches it,
- **Then** `coherence_check` is still never executed — no tier causes the daemon to author it.

- **Given** a feature that is **re-dispatched** after prior BUILD progress (the resume path, not
  a fresh start),
- **When** the daemon re-seeds state and the conductor resumes at its real next step,
- **Then** `coherence_check` is still stamped and still not executed — preseeding applies on
  resume exactly as on fresh start, so a re-kick cannot reintroduce the authoring step.

## Story 2 — The preseed set is derived from the step table, so it cannot drift

As a maintainer adding a future DECIDE step, when I declare a step `phase: 'DECIDE'`, it must be
preseeded by construction, so that no future step can be silently left out the way
`coherence_check` was.

### Happy Path

- **Given** the step table `ALL_STEPS` with its nine `phase: 'DECIDE'` entries,
- **When** the daemon computes its preseed set,
- **Then** the set is exactly `worktree`, `memory`, and every step whose declared phase is
  `DECIDE`,
- **And** a contract test asserts that every `phase: 'DECIDE'` step in `ALL_STEPS` is present in
  the daemon's preseed set, failing if any is absent.

### Negative Paths

- **Given** a hypothetical new step added to `ALL_STEPS` with `phase: 'DECIDE'` and no other
  change,
- **When** the contract test runs,
- **Then** it passes without any edit to the daemon — because the set is derived, adding a
  DECIDE step requires no daemon change at all.

- **Given** a hypothetical step added with a non-DECIDE phase (`BUILD`/`SHIP`),
- **When** the daemon computes its preseed set,
- **Then** that step is **not** preseeded and remains executable by the daemon — the derivation
  must not over-capture and suppress legitimate build steps.

- **Given** the integration test's previously hand-copied duplicate of the preseed list,
- **When** the test suite runs,
- **Then** no hand-copied duplicate remains — the test imports the production set, so the two
  cannot disagree.

## Story 3 — A preseeded step carries a tier-correct status

As the conductor's state record, when the daemon preseeds a step that is skippable for the run's
tier, the recorded status must say `skipped` rather than `done`, so that tier applicability stays
explicit and testable and no artifact is falsely asserted to exist.

### Happy Path

- **Given** a merged **S-tier** spec (coherence artifact legitimately absent),
- **When** the daemon preseeds and stamps state,
- **Then** `coherence_check` is recorded as `skipped`, not `done`,
- **And** the same tier-correct rule applies to the other tier-skippable DECIDE steps
  (`architecture_diagram`, `architecture_review`, `conflict_check`), which are recorded
  `skipped` at S rather than `done`.

- **Given** a merged **M-tier** spec,
- **When** the daemon preseeds and stamps state,
- **Then** `coherence_check` is recorded as `done` — the artifact was authored during DECIDE.

### Negative Paths

- **Given** a merged spec with **no** resolvable complexity marker, so the tier is unresolved,
- **When** the daemon stamps state,
- **Then** the tier fallback is applied **before** stamping (never after), so no step is stamped
  against an `undefined` tier,
- **And** the stamped status is the non-skipped value, because an unresolved tier must not be
  silently treated as `S` and thereby exempt a spec that was never assessed.

- **Given** any step that is not skippable for the resolved tier,
- **When** it is preseeded,
- **Then** it is stamped `done` — the tier-correct rule must not downgrade non-skippable steps.

## Story 4 — A missing or invalid required coherence artifact is rejected before BUILD begins

As the daemon's discovery pass, when a merged non-S spec lacks a usable coherence artifact, I
must refuse to dispatch it rather than build it, so that removing the daemon's authoring step
does not silently remove the guarantee that the artifact exists.

### Happy Path

- **Given** a merged M-tier spec whose `.docs/coherence/<slug>.md` is present, non-empty, and
  parseable with at least one data row,
- **When** discovery vets it,
- **Then** it enters the backlog and is dispatched normally.

### Negative Paths

- **Given** a merged M-tier spec with **no** `.docs/coherence/<slug>.md`,
- **When** discovery vets it,
- **Then** it is warn-skipped, does not enter the backlog, no worktree is created and no build
  starts,
- **And** exactly one operator-visible log line names the slug, the reason, and the concrete
  remedy (author the coherence artifact on the default branch),
- **And** the warning is emitted once per slug via the existing durable marker channel, not on
  every poll.

- **Given** a merged M-tier spec whose coherence file exists but is empty or whitespace-only,
- **When** discovery vets it,
- **Then** it is warn-skipped for the same reason — presence alone does not satisfy the check.

- **Given** a merged M-tier spec whose coherence file exists but contains no parseable table
  with at least one data row,
- **When** discovery vets it,
- **Then** it is warn-skipped — an unparseable artifact is treated as absent, never as valid.

- **Given** a merged spec whose coherence artifact exists under a stem that does not match its
  plan stem,
- **When** discovery vets it,
- **Then** it is warn-skipped — the check resolves the artifact by plan stem only and must not
  be satisfied by an unrelated file in the same directory.

## Story 5 — The Small-tier exemption is preserved exactly

As an operator shipping a Small feature, when my spec correctly carries no coherence artifact, it
must continue to build, so that the existing tier policy is preserved rather than tightened.

### Happy Path

- **Given** a merged **S-tier** spec with no `.docs/coherence/<slug>.md` at all,
- **When** discovery vets it,
- **Then** it is **not** warn-skipped and enters the backlog normally,
- **And** the build proceeds without ever executing `coherence_check`.

### Negative Paths

- **Given** an S-tier spec that *does* happen to carry a coherence artifact,
- **When** discovery vets it,
- **Then** it is still accepted — the S exemption is about not *requiring* the artifact, and its
  presence is never itself a failure.

- **Given** a spec whose complexity marker is absent or unparseable so the tier cannot be
  resolved,
- **When** discovery applies the coherence check,
- **Then** the spec is **not** treated as S-exempt — an unresolved tier must fail closed toward
  requiring the artifact, so a missing marker cannot be used to bypass the gate.

## Story 6 — Operational documentation reflects the new rejection

As an operator whose spec was warn-skipped, when I consult the daemon operations guide, I must
find the new rejection reason and its remedy, so the skip is diagnosable without reading engine
source.

### Happy Path

- **Given** the change has landed,
- **When** `docs/daemon-operations.md` is read,
- **Then** it documents the coherence rejection alongside the existing discovery warn-skips
  (stories-not-approved, plan-has-no-dependency-tree), states that it applies to non-Small tiers
  only, and names the remedy.

### Negative Paths

- **Given** the implementation lands without the documentation update,
- **When** the repo's documentation-upkeep rule is applied at review,
- **Then** the change is incomplete — new daemon operational behavior requires the guide update
  in the same PR.

## Story 7 — Engineer authoring produces the required coherence artifact

As an operator authoring a non-S spec through the engineer flow, when the plan is approved, the
engine must run `coherence_check` and commit its artifact with the spec so that daemon discovery
can build the merged spec without re-entering DECIDE.

### Happy Path

- **Given** an M- or L-tier `runAuthoring` invocation whose plan and coherence gates are approved,
- **When** it creates the `spec/<slug>` branch,
- **Then** it invokes `coherence_check` immediately after `plan`,
- **And** it writes `.docs/coherence/<slug>.md`,
- **And** that artifact is included in the authoring commit with the other DECIDE artifacts.

### Negative Paths

- **Given** an S-tier `runAuthoring` invocation,
- **When** the plan is approved,
- **Then** it does not invoke `coherence_check` and does not create a coherence artifact.

- **Given** the M- or L-tier `coherence_check` gate is not approved,
- **When** authoring would otherwise write artifacts,
- **Then** authoring fails before creating the spec-branch artifacts or commit.
