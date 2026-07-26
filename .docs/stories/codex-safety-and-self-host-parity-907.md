**Status:** Accepted

# Stories: Codex Safety and Self-Host Parity (#907)

**Track:** Product
**Complexity:** Medium
**Source:** `.docs/specs/2026-07-25-codex-safety-and-self-host-parity-907.md`

These stories cover the cross-provider parity delta. They do not supersede the older
Claude-specific task-stamping, documentation-guard, or self-host stories. Task identity
means only the current task in progress; existing judgment gates remain responsible for
completion and wiring decisions.

## Story: Maintain one accurate current-task identity

**Requirement:** FR-1

As a daemon operator, I want every autonomous build task to expose one accurate current
identity so that I can tell which task owns work regardless of the selected provider.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given an autonomous build with a known pending task and either Claude or Codex
  selected, when that task begins mutation-bearing work, then exactly that task id is current
  before its first project mutation.
- **HP-2:** Given task-identity enforcement is active, when autonomous build tasks are ready
  concurrently, then at most one mutation-bearing task is treated as current while read-only
  judgment work cannot acquire a mutation identity.

#### Negative Paths

- **NP-1 (covers HP-1):** Given the selected provider cannot establish the known task identity,
  when the task attempts to begin work, then it is not treated as current and mutation-bearing
  work does not proceed under a guessed identity.
- **NP-2 (covers HP-2):** Given one mutation-bearing task is current, when another task attempts
  to become current before the first releases ownership, then the overlap is rejected and neither
  task is silently attributed to the other.

### Done When

- [ ] A provider-parity test proves the same known task id becomes current before the first
      mutation under Claude and Codex.
- [ ] An overlap test proves a second mutation-bearing task cannot replace or share an active
      current-task identity.
- [ ] A read-only judgment dispatch proves it creates no mutation identity.

## Story: Retire task identity on every terminal transition

**Requirement:** FR-2

As a daemon operator, I want an ended task to stop being current so that later work cannot
inherit stale ownership.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a task is current, when it completes, fails, is cancelled, or is interrupted,
  then that task id is no longer current before any later mutation-bearing work begins.
- **HP-2:** Given one current task is replaced by another known task, when replacement occurs,
  then the old identity is retired and only the replacement identity can become current.

#### Negative Paths

- **NP-1 (covers HP-1):** Given terminal cleanup cannot verify removal of the old identity, when
  the run handles the terminal event, then the old identity authorizes no further mutation and
  affected work stops with recovery guidance.
- **NP-2 (covers HP-2):** Given the replacement id is missing, unknown, or cannot be established,
  when replacement is attempted, then the old id is not retained as a fallback and the new task
  does not begin mutation-bearing work.

### Done When

- [ ] Lifecycle tests cover completion, failure, cancellation, and interruption under both
      providers and observe no current identity afterward.
- [ ] A replacement test proves there is no interval in which the retired task authorizes the
      replacement's mutations.
- [ ] A cleanup-failure test proves forward progress stops instead of accepting stale ownership.

## Story: Reject mutation without current-task ownership

**Requirement:** FR-3

As a harness operator, I want unstamped build mutations rejected so that autonomous work is
never accepted without a current task owner.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a build is active and a valid known task is current, when that task performs an
  otherwise permitted project mutation, then the mutation may proceed under that identity for
  both Claude and Codex.
- **HP-2:** Given a build is active with no current task, when a mutation is attempted through a
  normal file tool, shell command, or another available local mutation surface, then the mutation
  is rejected before it can be accepted as build output.

#### Negative Paths

- **NP-1 (covers HP-1):** Given the visible current-task value was changed without a valid task
  transition, when a mutation is checked, then the visible value alone does not authorize it.
- **NP-2 (covers HP-2):** Given an early lifecycle guard is disabled, skipped, or does not cover
  the mutation surface, when unstamped mutation reaches dispatch validation, then the build does
  not advance or accept that mutation and reports the missing identity protection.

### Done When

- [ ] Claude/Codex tests prove valid current ownership permits an otherwise allowed mutation.
- [ ] File-tool, shell, and uncovered-surface tests prove unstamped durable changes cannot receive
      a passing build outcome.
- [ ] A disabled-guard test proves provider lifecycle coverage is not the sole acceptance signal.

## Story: Refuse invalid task identities

**Requirement:** FR-4

As a harness operator, I want malformed or outdated task identities to fail closed so that an
identity can never authorize the wrong work.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a current identity exactly matches a known active plan task, when mutation
  authorization is evaluated, then that identity is accepted for only that task.
- **HP-2:** Given the same valid task is re-entered through an idempotent lifecycle event, when
  identity is evaluated, then ownership remains accurate without creating a second owner.

#### Negative Paths

- **NP-1 (covers HP-1):** Given the identity is empty, unknown, stale, malformed, or names a
  different task, when mutation is attempted, then authorization is rejected and the diagnostic
  identifies the invalid identity state without guessing a replacement.
- **NP-2 (covers HP-2):** Given a supposedly idempotent event conflicts with another current task
  or a different task-status row, when it is evaluated, then it is treated as a mismatch and no
  ownership state is overwritten.

### Done When

- [ ] A table-driven provider-parity test covers empty, unknown, stale, malformed, and mismatched
      identities with a rejected mutation verdict.
- [ ] Idempotent same-task and conflicting-task tests prove only the same valid owner is preserved.

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

- **HP-1:** Given #905 selects a supported API-key or cached-login source, when a Codex self-host
  run starts, then it can use that selected source without inheriting unrelated live preferences,
  extensions, lifecycle customizations, histories, sessions, or mutable provider state.
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

### Done When

- [ ] API-key and cached-login tests prove only the #905-selected auth source is available to the
      self-host run.
- [ ] Sentinel preferences, extensions, lifecycle customizations, histories, and sessions remain
      unchanged and unavailable for inheritance.
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

## Story: Preserve existing Claude behavior

**Requirement:** FR-15

As a Claude user, I want Codex parity added without changing my established workflow so that the
new provider option carries no Claude migration or safety regression.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given an existing Claude-selected autonomous build, when it runs after #907, then its
  current-task lifecycle, permitted mutations, protected-artifact behavior, self-host isolation,
  recovery behavior, and operator-visible outcomes remain equivalent to the approved pre-#907
  contracts.
- **HP-2:** Given Codex is unavailable or not configured, when Claude is selected, then Claude work
  does not depend on Codex configuration, hooks, auth, state, or executable availability.

#### Negative Paths

- **NP-1 (covers HP-1):** Given the provider-neutral safety layer detects a real Claude protection
  failure, when Claude work would otherwise continue, then it still fails closed with the existing
  safety outcome rather than weakening policy for backward compatibility.
- **NP-2 (covers HP-2):** Given Codex-specific isolated state is missing, malformed, or inaccessible,
  when a Claude-only workflow runs, then that unrelated Codex condition neither changes Claude
  behavior nor produces a Codex remediation message.

### Done When

- [ ] Existing Claude task, mutation, documentation, self-host, recovery, and operator-output
      regression suites remain green without changed expected behavior.
- [ ] Claude-only tests pass with Codex executable/config/auth/state absent.
- [ ] A genuine Claude protection failure remains fail-closed and provider-correct.

## Traceability

| Requirement | Story |
|---|---|
| FR-1 | Maintain one accurate current-task identity |
| FR-2 | Retire task identity on every terminal transition |
| FR-3 | Reject mutation without current-task ownership |
| FR-4 | Refuse invalid task identities |
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
| FR-15 | Preserve existing Claude behavior |
