**Status:** Accepted

# Stories: Codex Safety and Self-Host Parity (#907)

**Track:** Product
**Complexity:** Medium
**Source:** `.docs/specs/2026-07-25-codex-safety-and-self-host-parity-907.md`

These stories cover the cross-provider parity delta. They amend older task-stamping and
Claude self-host stories where explicitly noted below. Task identity is concurrent,
non-authoritative attribution telemetry; existing judgment gates remain responsible for
completion and wiring decisions.

## Story: Carry accurate task-local attribution concurrently

**Requirement:** FR-1

As a daemon operator, I want every autonomous build task to carry its own known identity so
that concurrent work remains attributable regardless of the selected provider.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given an autonomous build with a known pending task and either Claude or Codex
  selected, when that task is dispatched, then its exact plan-task id is validated and carried
  in that dispatch's attribution context.
- **HP-2:** Given independent mutation-bearing tasks are ready concurrently, when pipeline
  overlap/dependency rules permit both, then both may be `in_progress` and neither task's
  attribution clears, replaces, or serializes the other.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a dispatch claims an empty, malformed, or unknown task id, when
  scheduling validates it, then the identity is rejected rather than guessed or recorded.
- **NP-2 (covers HP-2):** Given two tasks are active concurrently, when either task commits with
  an explicit valid `Task:` trailer, then no workspace-global value overwrites that trailer with
  the other task's id.

### Done When

- [ ] Provider-parity tests prove exact known ids are carried for Claude and Codex dispatches.
- [ ] A concurrent overlap test proves both task rows remain active and attribution is independent.
- [ ] A commit-hook test proves a valid explicit trailer is preserved under concurrent dispatch.

## Story: Retire only the matching task's active telemetry

**Requirement:** FR-2

As a daemon operator, I want an ended task removed from the active set without disturbing
concurrent tasks so that progress telemetry remains accurate.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a task is active, when it completes, fails, is cancelled, or is interrupted,
  then only that task id leaves the active telemetry set.
- **HP-2:** Given another task remains active concurrently, when the first task ends or is replaced,
  then the other task's row and attribution context remain unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given telemetry cleanup cannot record the ended state, when terminal
  handling continues, then the failure is reported but does not become mutation or completion
  authority.
- **NP-2 (covers HP-2):** Given a replacement id is missing or unknown, when replacement is
  attempted, then no other active task is cleared or relabeled as the replacement.

### Done When

- [ ] Lifecycle tests cover completion, failure, cancellation, and interruption under both
      providers and observe only the matching row retired.
- [ ] A replacement test preserves every unrelated concurrent active row.
- [ ] A telemetry-write failure test proves no mutation or completion verdict depends on it.

## Story: Keep task attribution out of mutation authorization

**Requirement:** FR-3

As a harness operator, I want mutation safety enforced by the applicable artifact and workspace
boundaries so that missing task telemetry cannot serialize or wedge concurrent work.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a build mutation is allowed by the protected-artifact and workspace policies,
  when task attribution is present, absent, or concurrent, then that telemetry does not change
  the mutation decision.
- **HP-2:** Given task telemetry is missing, when otherwise permitted implementation work mutates
  the feature workspace, then work may proceed and the attribution gap is reported non-blockingly.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a supplied task id is stale, unknown, or mismatched, when an
  otherwise forbidden protected-artifact or live-checkout mutation is attempted, then the id
  neither authorizes the mutation nor changes the independent safety verdict.
- **NP-2 (covers HP-2):** Given no task trailer is produced, when judgment gates assess wiring and
  completeness, then they judge plan versus implementation directly rather than failing solely
  because attribution telemetry is absent.

### Done When

- [ ] Claude/Codex tests prove mutation decisions are identical with present, absent, and
      concurrent task telemetry.
- [ ] Protected-artifact and live-checkout tests remain fail-closed independently of task ids.
- [ ] A completeness test proves missing task telemetry alone cannot fail or pass judgment.

## Story: Validate supplied attribution without guessing or replacement

**Requirement:** FR-4

As a harness operator, I want supplied task identities validated as telemetry so that incorrect
attribution is rejected without turning attribution into mutation authority.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a dispatch id or explicit commit trailer exactly matches a seeded plan task,
  when attribution is recorded, then the exact value is preserved for that task.
- **HP-2:** Given the same valid task is reported more than once, when telemetry is updated, then
  the update is idempotent and does not alter another active task.

#### Negative Paths

- **NP-1 (covers HP-1):** Given the supplied identity is empty, unknown, stale, malformed, or
  mismatched, when telemetry is processed, then it is not recorded and the diagnostic identifies
  the invalid value without guessing a replacement.
- **NP-2 (covers HP-2):** Given an explicit valid commit trailer differs from another active task,
  when the commit hook runs, then it validates and preserves the explicit value rather than
  replacing it from workspace-global state.

### Done When

- [ ] A table-driven provider-parity test covers empty, unknown, stale, malformed, and mismatched
      identities with rejected telemetry and no mutation-authority side effect.
- [ ] Idempotent and concurrent-task tests prove valid task-local attribution is preserved.

## Story: Keep protected DECIDE artifacts frozen

**Requirement:** FR-5

As a product owner, I want approved requirements and delivery artifacts frozen during BUILD and
SHIP so that implementation cannot rewrite its own definition of done.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given BUILD or SHIP is active under Claude or Codex, when work changes application or
  harness implementation files, then approved product, architecture, story, and plan artifacts
  remain byte-identical to their approved baseline.
- **HP-2:** Given the active lifecycle step explicitly permits a bounded artifact prefix, when it
  writes within that prefix, then the permitted update is accepted without unfreezing any sibling
  protected path.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a protected artifact is changed, deleted, or recreated through a
  file tool, shell command, or uncovered mutation surface, when protection is evaluated, then the
  run cannot advance and the changed artifact is not adopted as a new baseline.
- **NP-2 (covers HP-2):** Given one step has permission for a bounded artifact prefix, when it
  targets a sibling path or a later step attempts to reuse that permission, then the mutation is
  rejected and the exception does not leak across paths or steps.

### Done When

- [ ] Claude/Codex tests cover changed, deleted, recreated, and newly added protected artifacts
      across BUILD and SHIP.
- [ ] Allowed-prefix tests prove only the exact active-step exception succeeds.
- [ ] Resume coverage proves protected drift cannot become the next run's accepted baseline.

## Story: Fail closed when a protected target is indeterminate

**Requirement:** FR-6

As a harness operator, I want ambiguous protected-artifact targets rejected so that parsing or
tool differences cannot create an accidental allow path.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a mutation target is deterministically resolved outside the protected artifact
  set and all other mutation protections pass, when the mutation is evaluated, then protected-
  artifact policy does not block it.
- **HP-2:** Given a target resolves to a permitted protected prefix for the active step, when the
  mutation is evaluated, then the exact resolved target is allowed.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a target is missing, malformed, dynamically ambiguous, outside
  the evaluable workspace, or otherwise cannot be classified, when protected-artifact policy may
  apply, then the mutation is rejected rather than classified as unprotected.
- **NP-2 (covers HP-2):** Given a path initially appears allowed but canonical resolution escapes
  the permitted prefix through traversal, indirection, or replacement, when it is evaluated, then
  the resolved target is rejected.

### Done When

- [ ] Target-classification tests distinguish known unprotected, exact allowed, protected, and
      indeterminate targets under both providers.
- [ ] Missing-target, malformed-target, traversal, and indirection tests all produce a fail-closed
      verdict.

## Story: Confine self-host writes to the feature workspace

**Requirement:** FR-7

As a self-host maintainer, I want a harness build to modify only its isolated feature workspace
so that the live harness checkout remains safe for concurrent operator sessions.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a Claude or Codex self-host run with verified isolation, when it edits and tests
  harness code, then changes appear in the feature workspace and the live harness checkout remains
  unchanged.
- **HP-2:** Given the self-host run exits normally, when its terminal checks complete, then they
  confirm no feature-created live-checkout drift.

#### Negative Paths

- **NP-1 (covers HP-1):** Given self-host work targets the live checkout by absolute path, parent
  traversal, symlink/indirection, or shell command, when the write is attempted, then it is rejected
  and a live-checkout sentinel remains byte-identical.
- **NP-2 (covers HP-2):** Given live-checkout integrity cannot be verified or unexpected drift is
  detected, when the run reaches a terminal path, then it does not report safe completion and gives
  an actionable isolation failure.

### Done When

- [ ] Representative Claude and Codex self-host tests prove feature-workspace writes succeed while
      live-checkout writes fail.
- [ ] Absolute, traversal, indirection, and shell-write attempts cannot yield an accepted run.
- [ ] A live-boundary verification failure prevents a successful terminal verdict.

## Story: Isolate unrelated operator provider state

**Requirement:** FR-8

As a self-host maintainer, I want only the selected authentication source exposed to a self-host
run so that personal provider configuration cannot affect or be affected by the build.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a supported authentication source is selected (#905 for Codex or the existing
  Claude credential source), when a Claude or Codex self-host run starts, then it can use that
  source without inheriting unrelated live preferences, extensions, lifecycle customizations,
  histories, sessions, or mutable provider state.
- **HP-2:** Given unrelated live provider configuration exists, when a self-host run completes,
  then that configuration remains byte-identical except for the explicitly selected auth source's
  provider-owned behavior.

#### Negative Paths

- **NP-1 (covers HP-1):** Given the selected authentication source cannot be made available without
  also exposing unrelated state, when isolation is prepared, then substantive self-host work does
  not begin and the run identifies the unsupported isolation condition.
- **NP-2 (covers HP-2):** Given self-host work attempts to read for inheritance or modify an
  unrelated live preference, extension, hook, plugin, history, or session, when the boundary is
  enforced, then that state is unavailable to the run and its live sentinel remains byte-identical;
  if either outcome cannot be verified, substantive work stops.
- **NP-3 (covers HP-1):** Given Claude self-host preparation would copy operator `settings.json`,
  preserve personal hooks, propagate general operator state, or relink live global skills, when
  the isolated home is provisioned, then those legacy inheritance/global-mutation paths are not
  invoked; required engine hooks and worktree skills come from the minimal isolated home.
- **NP-4 (covers HP-1):** Given Codex cached login is selected, when its credential is handed into
  the isolated home, then only the selected native credential artifact is copied opaquely with
  restrictive permissions; it is never parsed, logged, hashed, symlinked to live state, or retained
  after the run, and the live source remains byte-identical.
- **NP-5 (covers HP-1):** Given #904 installed skills under the operator's
  `$HOME/.agents/skills`, when Codex self-host starts, then it discovers the feature worktree's
  catalog through a child-only discovery home and neither loads nor mutates the live catalog.

### Done When

- [ ] Claude and Codex auth tests prove only the selected source is available to the self-host run.
- [ ] Sentinel preferences, extensions, lifecycle customizations, histories, and sessions remain
      unchanged and unavailable for inheritance.
- [ ] Claude tests prove no operator-settings copy, personal-hook preservation, general state-file
      propagation, or live global skill relink occurs.
- [ ] Cached-login tests prove opaque selected-credential handoff, restrictive permissions,
      unchanged source, confidentiality, and cleanup on every terminal path.
- [ ] #904 integration coverage proves self-host `$skill` invocation resolves the worktree catalog
      while ordinary Codex sessions retain the installed user-scoped catalog.
- [ ] An unisolatable auth-source test proves no model work begins under broadened access.

## Story: Remove self-host isolation residue on every exit

**Requirement:** FR-9

As a daemon operator, I want self-host isolation state cleaned on every terminal path so that a
failed or interrupted build cannot contaminate later work.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a self-host run provisioned isolated provider state, when it completes, fails,
  is cancelled, times out, is interrupted, exhausts retries, or is replaced, then feature-created
  provider state and child-only environment changes are absent afterward.

> **Amended 2026-08-10 by #1223:** for the **interruption** case only, absence is *eventual*, not
> immediate. Abrupt termination — `SIGKILL`, OOM, power loss — ends the process before any
> handler, `finally`, or exit hook can run, so no in-process mechanism can make feature-created
> state absent afterward; #1223 reports fifteen orphaned `self-host-codex-*` directories as
> evidence that it did not. Absence on that path is discharged by the reclamation path in
> `adr-2026-08-09-worktree-local-provider-scratch`: a dead-owner sweep at the daemon dispatch
> boundary, with worktree removal as the final backstop. Every other terminal path listed above —
> completes, fails, is cancelled, times out, exhausts retries, is replaced — continues to assert
> immediate absence via the existing teardown, unchanged.
- **HP-2:** Given cleanup is invoked more than once for the same run, when terminal handling repeats,
  then cleanup is idempotent and unrelated live configuration remains unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given provisioning fails partway because of permissions, disk exhaustion,
  or another resource error, when failure is handled, then no substantive work launches and every
  feature-created partial isolation artifact is removed or reported as an unresolved safety failure.
- **NP-2 (covers HP-2):** Given repeated cleanup encounters an absent temporary resource or an
  earlier partial cleanup, when it runs again, then it does not touch the live provider home or
  broaden the deletion target.

### Done When

- [ ] Terminal-path tests cover success, failure, cancellation, timeout, interruption, retry
      exhaustion, and provider replacement with no feature-created residue.
- [ ] Partial-provisioning and disk/permission failure tests prove no model work starts and cleanup
      remains path-bounded.
- [ ] Repeated cleanup tests prove idempotency and unchanged live configuration.

## Story: Stop when a required protection is unavailable

**Requirement:** FR-10

As a harness operator, I want required protections verified before and during work so that safety
is never inferred from missing machinery.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given task identity, mutation authorization, protected-artifact freezing, and applicable
  self-host isolation are all verifiably active, when affected autonomous work begins or continues,
  then the run records a passing protection state for the selected provider.
- **HP-2:** Given a non-self-host run does not require self-host isolation, when required protection
  checks run, then the inapplicable protection is distinguished from a missing required protection.

#### Negative Paths

- **NP-1 (covers HP-1):** Given any required protection is missing, corrupt, stale, disabled,
  unverifiable, or becomes unavailable mid-run, when work is about to begin or continue, then the
  affected work stops without consuming the uncertainty as a passing state.
- **NP-2 (covers HP-2):** Given a required protection is incorrectly reported as inapplicable, when
  its applicability is validated, then the mismatch fails closed and work does not continue.

### Done When

- [ ] A required-protection matrix covers missing and unverifiable task, mutation, artifact, and
      self-host protections for Claude and Codex.
- [ ] Pre-dispatch and mid-run failures both prevent a passing work result.
- [ ] Applicability tests distinguish a legitimate non-self-host case from a misclassified required
      self-host protection.

## Story: Report non-critical capability gaps without false parity

**Requirement:** FR-11

As a harness maintainer, I want diagnostic-only provider gaps reported explicitly so that safe work
can continue without claiming capabilities the provider does not have.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a provider lacks a declared non-critical lifecycle or observability capability
  while all required protections pass, when work runs, then the gap is visibly reported and safe
  work may continue.
- **HP-2:** Given the same non-critical gap recurs on retry or resume, when it is reported again,
  then the message remains classified as non-critical and does not claim full native parity.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a missing capability weakens task identity, mutation rejection,
  artifact freezing, or self-host isolation, when it is classified, then it is treated as required
  and work stops rather than continuing under a warning.
- **NP-2 (covers HP-2):** Given capability classification is missing, contradictory, or cannot be
  verified on retry/resume, when work would continue, then the uncertainty is not silently reduced
  to a non-critical warning.

### Done When

- [ ] A non-critical-gap test continues only when every required protection remains passing and
      emits an explicit provider-labelled gap.
- [ ] Required-gap and unknown-classification tests stop work and cannot emit a false parity claim.
- [ ] Retry/resume coverage preserves the same capability classification.

## Story: Preserve protections across initial, retry, and resume paths

**Requirement:** FR-12

As a daemon operator, I want every attempt to re-enter the same safety boundary so that recovery
cannot become an escape hatch.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given an initial, retried, resumed, grouped, auxiliary BUILD/SHIP, or replacement-
  provider attempt, when it begins or continues mutation-bearing work, then the same applicable
  task, mutation, artifact, and self-host protections are verified before acceptance.
- **HP-2:** Given a same-task retry has valid durable protection state, when it resumes, then it may
  reuse only state that still matches the current task, provider, phase, workspace, and protected
  baseline.

#### Negative Paths

- **NP-1 (covers HP-1):** Given any recovery or auxiliary path bypasses a required protection check,
  when it returns work, then that result cannot receive a passing safety verdict.
- **NP-2 (covers HP-2):** Given resumed state belongs to another task, provider, phase, workspace,
  baseline, or prior terminal run, when reuse is attempted, then it is rejected as stale or
  mismatched and does not authorize mutation.

### Done When

- [ ] One matrix test exercises initial, retry, resume, grouped, auxiliary BUILD/SHIP, and provider-
      replacement paths under Claude and Codex.
- [ ] Bypass-injection tests prove no listed path can return an accepted result without protection
      validation.
- [ ] Cross-task/provider/phase/workspace/baseline reuse tests all reject stale state.

## Story: Explain protection failures actionably

**Requirement:** FR-13

As a harness operator, I want protection failures to explain what stopped and how to recover so
that I can fix the boundary without guessing or weakening safety.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a required protection is rejected or unavailable, when diagnostics are emitted,
  then they identify the actual provider, affected protection, sanitized reason, stopped work, and
  a concrete recovery action.
- **HP-2:** Given recovery requires an external dependency or operator action, when the message is
  emitted, then it distinguishes retryable recovery from restart, configuration repair, or manual
  inspection without promising automatic recovery.

#### Negative Paths

- **NP-1 (covers HP-1):** Given provider or protection metadata is missing or contradictory, when a
  failure is reported, then the system does not name a guessed provider/protection and does not
  continue; it reports that the protection failure itself is unverifiable.
- **NP-2 (covers HP-2):** Given no safe automatic recovery exists, when diagnostics are produced,
  then they do not recommend bypassing the protection, broadening permissions, or retrying
  indefinitely.

### Done When

- [ ] Diagnostic-contract tests assert provider, protection, sanitized reason, stopped scope, and
      recovery fields for each required protection class.
- [ ] Unknown-metadata tests remain fail-closed and explicitly label unverifiable context.
- [ ] Non-recoverable cases provide bounded operator guidance without a safety-bypass suggestion.

## Story: Keep safety diagnostics confidential

**Requirement:** FR-14

As an operator, I want safety diagnostics sanitized so that investigating a stopped run cannot leak
credentials or personal provider configuration.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given safety and isolation checks inspect authentication or provider configuration,
  when they emit diagnostics, logs, markers, or persisted artifacts, then only sanitized provider,
  source class, protection, state, and remediation metadata is visible.
- **HP-2:** Given a run succeeds or fails, when repository history and feature artifacts are
  inspected, then they contain no copied credential material or sensitive operator configuration.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a provider error includes a token, secret, authorization header,
  credential payload, sensitive configuration value, or raw diagnostic body, when it crosses the
  safety boundary, then the sensitive content is removed before any operator-visible or persisted
  output.
- **NP-2 (covers HP-2):** Given partial provisioning or cleanup fails after sensitive auth material
  was made available to the isolated run, when terminal handling completes, then that material is
  neither left in the feature workspace nor added to source-control-visible state; unresolved
  cleanup is reported without echoing the material.

### Done When

- [ ] Canary-secret tests cover diagnostics, logs, halt markers, audit artifacts, and repository
      history with zero canary matches.
- [ ] Raw provider-error tests prove secrets and sensitive config values are redacted before output.
- [ ] Partial-provisioning/cleanup tests prove selected auth material never becomes a project artifact.

## Story: Preserve Claude compatibility outside intentional self-host isolation

**Requirement:** FR-15

As a Claude user, I want provider parity without an authentication migration or safety regression,
while self-host runs intentionally stop inheriting my unrelated live configuration.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given an existing Claude-selected autonomous build, when it runs after #907, then
  concurrent task scheduling, task-local telemetry, protected-artifact behavior, authentication,
  recovery behavior, and non-self-host outcomes remain compatible with the amended contracts.
- **HP-2:** Given Codex is unavailable or not configured, when Claude is selected, then Claude work
  does not depend on Codex configuration, hooks, auth, state, or executable availability.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a Claude self-host run has personal settings, hooks, extensions, or
  global skill links in the live provider home, when the run starts, then those are neither
  inherited nor modified; only selected auth, engine controls, and worktree harness assets enter
  the throwaway home.
- **NP-2 (covers HP-2):** Given Codex-specific isolated state is missing, malformed, or inaccessible,
  when a Claude-only workflow runs, then that unrelated Codex condition neither changes Claude
  behavior nor produces a Codex remediation message.

### Done When

- [ ] Existing Claude non-self-host, authentication, recovery, and provider-output suites remain
      green; self-host expectations are updated only for strict isolation and concurrent telemetry.
- [ ] Claude-only tests pass with Codex executable/config/auth/state absent.
- [ ] Claude self-host tests prove minimal isolated configuration, unchanged live sentinels, and
      no global relink on every terminal path.

## Traceability

| Requirement | Story |
|---|---|
| FR-1 | Carry accurate task-local attribution concurrently |
| FR-2 | Retire only the matching task's active telemetry |
| FR-3 | Keep task attribution out of mutation authorization |
| FR-4 | Validate supplied attribution without guessing or replacement |
| FR-5 | Keep protected DECIDE artifacts frozen |
| FR-6 | Fail closed when a protected target is indeterminate |
| FR-7 | Confine self-host writes to the feature workspace |
| FR-8 | Isolate unrelated operator provider state |
| FR-9 | Remove self-host isolation residue on every exit |
| FR-10 | Stop when a required protection is unavailable |
| FR-11 | Report non-critical capability gaps without false parity |
| FR-12 | Preserve protections across initial, retry, and resume paths |
| FR-13 | Explain protection failures actionably |
| FR-14 | Keep safety diagnostics confidential |
| FR-15 | Preserve Claude compatibility outside intentional self-host isolation |
