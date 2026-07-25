**Status:** Accepted

# User Stories: Codex Authentication and Autonomous Execution Readiness (#905)

**Source:** Approved PRD FR-1 through FR-22 and the approved provider-neutral auth
park with source-specific readiness ADR

## Traceability

| Requirement | Stories |
|---|---|
| FR-1 | Story 1 |
| FR-2 | Story 2 |
| FR-3 | Story 3 |
| FR-4 | Story 3 |
| FR-5 | Stories 3 and 5 |
| FR-6 | Story 4 |
| FR-7 | Story 4 |
| FR-8 | Story 4 |
| FR-9 | Story 4 |
| FR-10 | Story 5 |
| FR-11 | Story 5 |
| FR-12 | Story 6 |
| FR-13 | Story 7 |
| FR-14 | Story 7 |
| FR-15 | Story 8 |
| FR-16 | Story 8 |
| FR-17 | Story 8 |
| FR-18 | Story 8 |
| FR-19 | Stories 9 and 10 |
| FR-20 | Stories 5 and 9 |
| FR-21 | Story 10 |
| FR-22 | Story 11 |

## Story 1: Use cached Codex sign-in for unattended work

**Requirement:** FR-1

As a harness operator, I want an existing cached Codex sign-in to authorize unattended
work so that I can use my Codex account without creating a separate API key.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given cached Codex sign-in is the only available source and is usable, when
  an unattended Codex step is about to run, then the harness reports `cached-login` as
  `ready` and the substantive Codex dispatch uses that source.
- **HP-2:** Given cached login is selected but is not ready, when the shared auth park
  begins and the operator completes native Codex sign-in before its timeout, then the
  same source is rechecked and only the failed attempt resumes after a `ready` verdict,
  with retry and escalation budgets unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given no API key is supplied and no cached sign-in is
  configured, when the unattended step reaches readiness, then the result is
  `cached-login: missing`, no substantive Codex work starts, and the shared park tells
  the operator to sign in with Codex.
- **NP-2 (covers HP-1):** Given cached sign-in is configured but explicitly expired or
  rejected, when readiness runs, then the result is `cached-login: unusable`, no
  substantive Codex work starts, and the same bounded park begins.
- **NP-3 (covers HP-2):** Given cached login was ready on an earlier invocation but a
  resumed invocation cannot conclusively verify it because the external service is
  unavailable, when recovery rechecks it, then it remains parked as `unverifiable` and
  does not reuse the earlier ready verdict to dispatch.
- **NP-4 (covers HP-2):** Given cached login remains non-ready until the park times out
  or the operator opts out, when recovery ends, then one sanitized Codex/cached-login
  HALT is written without entering normal retry, model escalation, or provider fallback.

### Done When

- [ ] An automated cached-login-only scenario records source `cached-login`, state
      `ready`, and exactly one subsequent substantive Codex invocation.
- [ ] Missing, rejected, and resume-time-unverifiable cached-login scenarios record
      zero substantive Codex invocations while non-ready and source-appropriate park
      remediation.
- [ ] Native sign-in resumes only the failed attempt; timeout and opt-out produce one
      sanitized HALT with every retry and escalation counter unchanged.

## Story 2: Use an operator-supplied API key for unattended work

**Requirement:** FR-2

As a daemon operator, I want to supply a Codex API key for a run so that unattended
work can use API-billed authentication without changing cached account sign-in.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given a usable API key is supplied for the run and no cached login is
  needed, when an unattended Codex step is about to run, then the harness reports
  `api-key` as `ready` and the substantive Codex dispatch uses the supplied key.
- **HP-2:** Given API-key authentication entered a restart-required auth park and the
  daemon restarts with a replacement key, when unfinished-feature recovery runs, then
  it freshly checks `api-key` and resumes the failed work only after a `ready` verdict.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a supplied API key is explicitly rejected, when
  readiness runs, then the result is `api-key: unusable`, no substantive Codex work
  starts, and the shared park reports `restart-required` with replace-and-restart
  remediation that prints no part of the key.
- **NP-2 (covers HP-2):** Given the running daemon inherited a rejected API key, when
  the operator changes a parent-shell value without restarting the daemon, then the
  park does not claim to reload it, create a credential file, or resume substantive
  work.
- **NP-3 (covers HP-2):** Given a restart-required API-key park reaches its timeout
  before daemon restart, when recovery ends, then one sanitized HALT tells the operator
  to replace the key, restart the daemon, and requeue, without consuming retry or
  escalation budget.

### Done When

- [ ] An automated API-key-only scenario proves that the same selected source reaches
      readiness and the initial substantive invocation without entering project state.
- [ ] Invalid and non-ready API-key scenarios produce zero substantive invocations
      while parked and expose no key characters in any captured output.
- [ ] Restart coverage proves recovery uses only the new process environment and a
      fresh preflight; same-process coverage proves no hot reload or key store exists.

## Story 3: Select and report one deterministic authentication source

**Requirement:** FR-3, FR-4, FR-5

As a harness operator, I want deterministic and visible source selection so that a
run cannot silently change billing or account policy after it begins.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given both a supplied API key and usable cached login exist, when a Codex
  run selects authentication, then it selects and reports `api-key` without reporting
  credential material.
- **HP-2:** Given no API key is supplied, when a Codex run selects authentication, then
  it selects and reports `cached-login`, and the same available sources produce the
  same selection on initial and resumed invocations.

#### Negative Paths

- **NP-1 (covers HP-1):** Given both sources exist, the selected API key is rejected,
  and cached login would otherwise be usable, when readiness or execution reports the
  rejection, then the run parks with `api-key` retained and never attempts cached login.
- **NP-2 (covers HP-1):** Given `api-key` was selected and later fails after work has
  begun, when recovery handles the failure, then it does not select cached login or a
  different provider.
- **NP-3 (covers HP-2):** Given cached login was selected because no API key was
  supplied, when cached readiness is missing, unusable, or unverifiable, then the
  shared park retains `cached-login` as the failed source instead of relabeling the
  result as API-key authentication.

### Done When

- [ ] The both-present matrix case records only `api-key` as selected and attempted.
- [ ] The no-key matrix case records only `cached-login` across initial and resumed
      checks.
- [ ] Failure-path attempt records prove that neither the alternate auth source nor a
      fallback provider was invoked.

## Story 4: Fail closed on four-state readiness before every dispatch

**Requirement:** FR-6, FR-7, FR-8, FR-9

As an autonomous daemon, I want a fresh, conclusive readiness verdict before every
unattended Codex dispatch so that unknown authentication state never starts work.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given the selected source is usable, when any normal, grouped, auxiliary,
  initial, model-ladder, or resumed unattended Codex dispatch is requested, then its
  readiness is evaluated immediately beforehand and exactly one substantive dispatch
  may follow a `ready` verdict.
- **HP-2:** Given readiness completes, when its result is shown or recorded, then it is
  exactly one of `ready`, `missing`, `unusable`, or `unverifiable`, identifies Codex and
  the selected source, and supplies source-appropriate remediation for every non-ready
  state.
- **HP-3:** Given readiness is non-ready, when recovery handles the result, then the
  failed work enters the shared bounded auth park and may resume only after the same
  selected source produces a fresh `ready` verdict.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a prior invocation was ready, when a later unattended
  dispatch is requested, then the prior verdict alone cannot authorize it; a new
  readiness evaluation must complete first.
- **NP-2 (covers HP-1):** Given readiness returns `missing` or `unusable`, when any
  normal, grouped, auxiliary, model-ladder, or resumed path attempts dispatch, then no
  substantive model work or project mutation begins.
- **NP-3 (covers HP-2):** Given the external readiness dependency times out, is
  unreachable, or returns a service failure that prevents an authentication decision,
  when the result is classified, then it is `unverifiable`, not `ready` or `unusable`.
- **NP-4 (covers HP-2):** Given readiness output is malformed, has an unsupported
  schema, conflicts about the selected source, or lacks explicit success/rejection
  evidence, when it is classified, then it is `unverifiable`, includes actionable
  verification guidance, and raw diagnostic content is not shown.
- **NP-5 (covers HP-3):** Given repeated park probes remain non-ready until timeout or
  the operator opts out, when recovery ends, then it writes one source-specific HALT
  instead of entering generic retry, escalation, auth-source fallback, or provider
  fallback.

### Done When

- [ ] Instrumented tests prove one readiness evaluation precedes every enumerated
      unattended dispatch shape and that only `ready` reaches substantive invocation.
- [ ] The complete four-state matrix has mutually exclusive results, zero false-ready
      cases, source/provider labels, and specific recovery guidance.
- [ ] Readiness tests prove no model work and no project-file mutation occur merely to
      establish readiness.
- [ ] Park tests prove only a new `ready` verdict resumes work and that timeout or
      opt-out terminates through the bounded auth disposition.

## Story 5: Park post-dispatch authentication rejection without budget or fallback

**Requirement:** FR-5, FR-10, FR-11, FR-20

As an autonomous daemon, I want a selected source's post-dispatch rejection handled as
a Codex authentication failure so that recovery does not waste retries or cross an
account boundary.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given substantive Codex work began with a ready selected source and Codex
  later explicitly rejects that source, when completion is classified, then the
  current work stops and enters the shared auth park with the same Codex/source
  remediation used for pre-dispatch `unusable` state.
- **HP-2:** Given authentication rejection occurs in a serial, grouped, judgment, or
  auxiliary invocation, when the conductor handles it, then provider/source identity
  survives into the parked disposition and task retry, effort escalation, model
  escalation, provider fallback, and auth-source fallback counters remain unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a rate-limit or model-unavailability result contains
  incidental sign-in wording but has authoritative non-auth classification, when the
  result is handled, then it remains in its existing rate-limit or model-availability
  path rather than being mislabeled as authentication rejection.
- **NP-2 (covers HP-1):** Given Codex rejects a selected source, when recovery begins,
  then the shared coordinator invokes only Codex readiness and does not read, poll, or
  emit remediation for Claude credential files, daemon tokens, or operator OAuth.
- **NP-3 (covers HP-2):** Given one grouped member reports Codex auth rejection while a
  sibling already completed, when the group join handles the failure, then the sibling
  is not rerun and the failed member resumes only after its same provider/source is
  ready, never through a different provider or source.
- **NP-4 (covers HP-2):** Given Codex remains non-ready during repeated recovery
  checks, when the park continues, then it stays in the same bounded auth lifecycle
  rather than consuming the normal retry ladder or redispatching substantive work.

### Done When

- [ ] Serial, grouped, judgment, and auxiliary rejection tests end in the same
      sanitized parked Codex/source disposition.
- [ ] Counter assertions remain byte-for-byte unchanged across each auth-rejection
      branch, and provider/auth attempt logs contain only the selected source.
- [ ] Claude credential and readiness collaborators are asserted not called for Codex
      failures even though both providers use the shared park coordinator.

## Story 6: Keep all credential material out of harness output and artifacts

**Requirement:** FR-12

As a security-conscious operator, I want authentication diagnostics to contain no
credential fingerprint so that troubleshooting cannot leak reusable or identifying
secret material.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given any cached-login or API-key readiness or parked state, when the
  harness writes logs, events, audit attempts, state, or timeout-HALT remediation,
  then it includes only the provider, source kind, readiness state, sanitized reason,
  and safe remediation.
- **HP-2:** Given an upstream diagnostic or authentication error contains an exact or
  partially redacted key, token, credential path, prefix, suffix, or hash, when the
  harness classifies and surfaces the result, then none of those fragments appear in
  inherited terminal output or persisted artifacts.
- **HP-3:** Given API-key authentication is used, when Codex runs model-proposed
  subprocess commands, then the key is unavailable to those subprocesses while still
  being usable by the Codex client itself.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a non-ready result is written through every diagnostic
  sink, when all sink contents are searched using exact credentials and recoverable
  substrings, then every search is empty.
- **NP-2 (covers HP-2):** Given raw stderr arrives before completion classification,
  when API-key execution fails authentication, then raw stderr is not live-inherited
  and the operator receives only a canned source-specific message.
- **NP-3 (covers HP-3):** Given user configuration would otherwise disable default
  secret filtering, when an unattended Codex invocation starts, then the effective
  command environment still excludes key/secret/token variables from model-generated
  subprocesses.

### Done When

- [ ] Adversarial fixtures containing full and partially redacted credential material
      leave no match in terminal, log, event, HALT, state, or audit outputs.
- [ ] A subprocess environment probe cannot observe the selected API key.
- [ ] No project or source-control artifact stores the API key or cached credential
      content.

## Story 7: Apply the same explicit bounded policy to every unattended invocation

**Requirement:** FR-13, FR-14

As a daemon operator, I want every unattended Codex invocation constrained to its
feature workspace so that routine automation does not receive unrestricted host
access.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given an unattended initial, grouped, auxiliary, model-ladder, or resumed
  Codex invocation, when it starts, then its effective policy is explicitly
  `workspace-write`, `on-request`, and automatic review, with default secret filtering
  enforced.
- **HP-2:** Given a routine action reads or writes within the feature worktree, when
  Codex executes it, then it can proceed inside the bounded workspace without routine
  unrestricted host access.

#### Negative Paths

- **NP-1 (covers HP-1):** Given user defaults are missing, interactive, or broader
  than the approved unattended policy, when an unattended invocation starts, then the
  explicit harness policy wins and the combined approvals-and-sandbox danger bypass is
  absent.
- **NP-2 (covers HP-1):** Given an initial invocation used the approved policy, when
  its session resumes, then resume carries the same effective policy rather than
  reverting to user or client defaults.
- **NP-3 (covers HP-2):** Given a routine command attempts to write the parent main
  checkout, linked Git metadata, protected provider configuration, or another host
  path outside the feature workspace, when it runs without an approved exception,
  then the boundary blocks it and the outside target remains unchanged.

### Done When

- [ ] Captured initial, grouped, auxiliary, model-ladder, and resume invocations all
      prove the same effective bounded policy and absence of danger bypass.
- [ ] A worktree write succeeds while representative parent-checkout, Git-metadata,
      provider-config, and host-path writes do not occur without an approved exception.

## Story 8: Automatically decide exceptional operations without waiting for a person

**Requirement:** FR-15, FR-16, FR-17, FR-18

As a daemon operator, I want exceptional Git and network operations automatically
reviewed so that ordinary development can finish unattended without silently weakening
the sandbox.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given a required action crosses the default workspace or network boundary,
  when Codex requests it, then an automatic safety review occurs and an approved action
  proceeds without a human permission response.
- **HP-2:** Given a representative unattended feature needs network access plus source-
  control commit and publication, when those actions are approved, then the feature can
  complete them while the bounded policy remains active.
- **HP-3:** Given an exceptional action is denied, when the review completes, then the
  action does not execute and the run stops or finds a materially safer in-boundary
  path with an actionable denial explanation.

#### Negative Paths

- **NP-1 (covers HP-1):** Given automatic review cannot produce a decision because it
  times out, fails, or returns an unknown result, when the exceptional action is
  pending, then the action does not execute and the invocation does not wait for a
  human prompt indefinitely.
- **NP-2 (covers HP-2):** Given one approved exceptional operation completed, when a
  later unrelated operation crosses the boundary, then the earlier approval does not
  grant blanket unrestricted host access; the later action receives its own decision.
- **NP-3 (covers HP-3):** Given an action was denied, when the step retries or the
  session resumes, then the action remains subject to the same bounded policy and the
  harness never adds danger bypass or disables automatic review to force progress.
- **NP-4 (covers HP-3):** Given a denied action was required for completion and no safer
  path exists, when the invocation ends, then the failure is reported as a Codex
  permission denial rather than authentication, model availability, rate limiting, or
  ordinary retry exhaustion.

### Done When

- [ ] An end-to-end unattended scenario completes an approved network and source-
      control lifecycle with zero human approval prompts.
- [ ] Denied, timed-out, failed, and unknown-review scenarios execute no exceptional
      side effect and retain the bounded policy on retry and resume.
- [ ] Diagnostics distinguish permission denial from every other provider failure
      class.

## Story 9: Keep Codex and Claude authentication and diagnostics isolated

**Requirement:** FR-19, FR-20

As an operator using both providers, I want each provider to own its account state and
failure messages so that one provider cannot corrupt or impersonate the other.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given Codex is selected, when readiness, execution, or recovery runs, then
  it neither reads nor modifies Claude credentials/account state and succeeds or fails
  independently of Claude account health; the shared park invokes only Codex's
  source-specific readiness capability.
- **HP-2:** Given Claude is selected, when its existing readiness, execution, or
  recovery runs, then Codex credentials/account state do not affect its behavior and
  the shared park invokes only Claude's existing source-specific checks.
- **HP-3:** Given a Codex readiness, authentication, or permission failure, when it is
  shown in any lifecycle path, then it identifies Codex and the Codex source or policy
  condition rather than naming Claude.

#### Negative Paths

- **NP-1 (covers HP-1):** Given Claude credentials are missing, expired, malformed, or
  inaccessible while Codex auth is ready, when unattended Codex work runs, then no
  Claude credential collaborator is called and the Codex result is unaffected.
- **NP-2 (covers HP-2):** Given Codex credentials are missing or rejected while Claude
  is selected, when the same existing Claude scenario runs, then its invocation,
  credential-source checks, permission flags, remediation, and parked recovery remain
  unaffected.
- **NP-3 (covers HP-3):** Given Codex auth fails in serial, grouped, auxiliary, or
  self-host work, when recovery reports it, then no message mentions Claude login,
  Claude token paths, `ANTHROPIC_API_KEY`, or operator OAuth repair.

### Done When

- [ ] Read/write spies prove zero cross-provider credential access in both directions.
- [ ] Coordinator tests prove both built-in providers use the same parked lifecycle
      while dispatching readiness and remediation only to the provider that failed.
- [ ] Codex failures in every lifecycle shape carry Codex/source terminology only.
- [ ] Existing Claude auth and permission regression fixtures remain unchanged and
      green.

## Story 10: Preserve provider-specific self-host safeguards and Claude compatibility

**Requirement:** FR-19, FR-21

As a self-host maintainer, I want the harness build to apply the selected provider's
own safeguards so that Codex can build the harness without weakening or invoking the
Claude path.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given a harness self-build selects Codex, when its build dispatch begins,
  then the same auth selection, pre-dispatch readiness, credential confidentiality,
  bounded workspace policy, automatic review, and provider-isolation behavior used by
  normal Codex work applies, while provider-neutral self-host release gates remain
  active.
- **HP-2:** Given a harness self-build selects Claude, when its build dispatch begins,
  then the existing Claude relink, auth preflight, throwaway configuration, token
  injection, permission behavior, write fence, and release gates remain unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a Codex self-build has a missing, unusable, or
  unverifiable selected source, when build dispatch is requested, then it enters the
  shared auth park before substantive build work and does not fall back to Claude
  credentials, Claude setup, or another Codex auth source.
- **NP-2 (covers HP-1):** Given a Codex self-build attempts an unapproved write to the
  parent main checkout or protected Git/provider state, when the boundary decision
  denies it, then the target remains unchanged and retry/resume does not weaken the
  policy.
- **NP-3 (covers HP-1):** Given Codex is selected for self-host, when provider-specific
  preparation runs, then no Claude relink, Claude credential preflight, throwaway
  `CLAUDE_CONFIG_DIR`, or Claude token injection collaborator is invoked.
- **NP-4 (covers HP-2):** Given no project opts into Codex, when existing Claude normal
  and self-host test matrices run after #905, then their command arguments, credential
  sources, provider-specific checks, permission flags, remediation, and existing
  parked outcomes show no migration or regression.

### Done When

- [ ] Codex self-host acceptance coverage proves the same source/readiness/policy
      contract and shared parked disposition as normal Codex dispatch, with zero
      Claude-specific setup calls.
- [ ] Parent-main and protected-state denial leaves byte-identical targets and retains
      the same policy on resume.
- [ ] The established Claude normal/self-host suites pass without expectation changes.

## Story 11: Recover every built-in provider through one bounded auth lifecycle

**Requirement:** FR-22

As an autonomous daemon operator, I want equivalent authentication failures to have
the same recovery lifecycle so that switching built-in providers does not change how
I monitor, repair, or resume parked work.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given either built-in provider reports an authentication failure before or
  after substantive dispatch, when recovery begins, then the feature enters the same
  bounded parked lifecycle with the failed provider, selected source, sanitized state,
  and provider/source-appropriate remediation visible.
- **HP-2:** Given the failed provider's selected source becomes ready before timeout,
  when recovery rechecks that source, then only the failed serial attempt or failed
  group member resumes and all retry, effort, model, provider-fallback, and
  auth-source-fallback budgets remain unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given one built-in provider is parked for authentication,
  when the other provider's credentials are healthy or change, then that unrelated
  state neither releases the park nor appears in its readiness checks or remediation.
- **NP-2 (covers HP-2):** Given the selected source remains non-ready until timeout or
  the operator opts out, when recovery ends, then one sanitized provider/source HALT
  is written without entering ordinary retry, model escalation, provider fallback, or
  auth-source fallback.
- **NP-3 (covers HP-2):** Given one concurrent-group member is auth-parked after its
  sibling completed, when the selected source later becomes ready, then recovery does
  not rerun the completed sibling or dispatch the failed member through another
  provider or source.

### Done When

- [ ] A provider-matrix acceptance test proves Claude and Codex produce the same park,
      ready-resume, timeout, and opt-out state transitions and budget effects.
- [ ] Provider/source spies prove each park checks and reports only the failed source,
      including cached-login refresh and restart-required startup-key cases.
- [ ] Serial and grouped recovery tests prove only failed work resumes and completed
      group siblings remain untouched.
