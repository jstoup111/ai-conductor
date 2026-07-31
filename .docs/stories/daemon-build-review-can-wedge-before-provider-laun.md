**Status:** Accepted

# Stories: Bounded Provider Preparation Lifecycle

## Story TI-1: Every daemon provider step exposes its lifecycle phase

**Requirement:** Technical intent — bounded pre-spawn supervision and phase visibility for every daemon-managed provider step

As a daemon operator, I want each provider step to report whether it is preparing, running, or
recovering so that I can distinguish a pre-launch wedge from a quiet live provider.

### Acceptance Criteria

#### Happy Path

- Given any daemon-managed DECIDE, BUILD, or SHIP step, when provider preparation begins, then
  feature-scoped status and logs identify the step as `preparing` with an attempt identity.
- Given preparation completes and the provider process starts, when the lifecycle transition is
  observed, then status and logs identify the same attempt as `running`.
- Given a preparation deadline expires, when recovery begins, then status and logs identify the
  superseded attempt as `recovering` and include the timeout reason.

#### Negative Paths

- Given a step has not spawned, when its lifecycle record is read, then it is never reported as
  `running` merely because an older heartbeat file exists.
- Given a provider has spawned but emits no output, when status is rendered, then the step remains
  `running` and is not relabeled `preparing` or `recovering`.
- Given a lifecycle evidence write fails, when the provider step continues, then the failure is
  logged as a diagnostic and cannot fabricate completion or silently change the attempt identity.

### Done When

- [ ] A test matrix proves lifecycle transitions for representative DECIDE, BUILD, and SHIP steps.
- [ ] Durable daemon output names phase, step, reason where applicable, and attempt identity.
- [ ] Lifecycle evidence remains separate from step-completion evidence.

## Story TI-2: A pre-spawn wedge is recovered within a bounded time

**Requirement:** Technical intent — a step that stops before provider launch leaves in-flight state without operator intervention

As a daemon operator, I want a provider preparation wedge to time out and receive one automatic
replacement so that a transient failure does not block the daemon’s sole build lane indefinitely.

### Acceptance Criteria

#### Happy Path

- Given any daemon-managed provider step is awaiting candidate, session, self-host, or adapter
  preparation and no process has spawned, when the preparation deadline expires, then the attempt
  is revoked before one replacement attempt begins.
- Given the replacement prepares and runs successfully, when it settles, then the step returns its
  real result and the recovery episode is reset.

#### Negative Paths

- Given the preparation deadline and spawn boundary race, when spawn authorization wins first, then
  the attempt becomes `running` and no replacement begins.
- Given the deadline wins first, when the superseded asynchronous work later resumes, then it cannot
  spawn a provider or publish a step result.
- Given candidate fallback occurs inside a non-expired attempt, when a later candidate is selected,
  then fallback does not consume the one lifecycle replacement or create a second logical attempt.
- Given recovery starts, when host-side process discovery cannot find the old provider, then that
  observation neither authorizes nor suppresses replacement; only the in-process attempt authority
  controls the transition.

### Done When

- [ ] Deterministic clock-controlled tests prove both sides of the timeout-versus-spawn race.
- [ ] A late-resume test proves the superseded attempt cannot invoke a provider or settle the step.
- [ ] Fallback and lifecycle-recovery counters remain independently verifiable.

## Story TI-3: Repeated preparation failure halts durably

**Requirement:** Technical intent — recovery is bounded and repeated failure becomes diagnosable

As a daemon operator, I want repeat preparation failure to park the feature for human diagnosis so
that daemon restarts and rediscovery cannot create an automatic recovery loop.

### Acceptance Criteria

#### Happy Path

- Given one replacement has already been consumed for a logical step, when preparation times out
  again, then the feature receives a `needs-human` HALT naming the step, phase, attempt identity,
  elapsed preparation time, and recovery count.
- Given the daemon restarts between the first timeout and its replacement, when the feature resumes,
  then the persisted recovery count remains one and the next preparation timeout halts.

#### Negative Paths

- Given a repeated-timeout HALT exists, when ordinary mechanical re-kick or backlog discovery runs,
  then the HALT is retained and no provider attempt begins.
- Given a different logical step later starts after a prior step completed cleanly, when its first
  preparation timeout occurs, then it receives its own one-replacement budget rather than inheriting
  the completed step’s exhausted episode.
- Given lifecycle state is malformed or cannot be read after restart, when recovery authority is
  resolved, then the engine fails closed without granting an unbounded fresh replacement budget.

### Done When

- [ ] Restart-oriented tests prove recovery-count persistence and clean-completion reset.
- [ ] The exhaustion HALT is classified `needs-human` and carries all required diagnostic fields.
- [ ] Re-kick and rediscovery tests prove an exhausted feature remains parked.

## Story TI-4: Quiet running providers are never reaped from output silence

**Requirement:** Approved ADR — provider activity is telemetry, not termination authority

As a daemon operator, I want a spawned provider to remain authoritative while it is quiet so that a
long reasoning interval is not mistaken for a dead process.

### Acceptance Criteria

#### Happy Path

- Given a provider has spawned and emits no stdout or stderr beyond any heartbeat threshold, when it
  later returns successfully, then its result is accepted and no replacement was launched.
- Given a running provider emits activity, when heartbeat telemetry is updated, then status may show
  its freshness without changing lifecycle authority.

#### Negative Paths

- Given a running provider’s heartbeat is absent, stale, malformed, or belongs to an older dispatch,
  when supervision evaluates the attempt, then it does not kill, replace, or halt the running
  provider.
- Given an external process scan reports no matching Claude or Codex process, when the in-process
  attempt is still `running`, then no recovery transition occurs.
- Given the existing output-silence timeout is configured positively, when a spawned provider is
  quiet, then that setting cannot regain termination authority.

### Done When

- [ ] A silent-provider regression test advances beyond the former threshold and completes without a kill.
- [ ] No production path converts heartbeat age or external process discovery into post-spawn termination.
- [ ] Status documentation explicitly labels activity freshness as telemetry.

## Story TI-5: Provider lifecycle capability fails closed

**Requirement:** Approved ADR — strict spawn fencing across supported providers

As a harness operator, I want providers to prove they honor spawn fencing before daemon invocation
so that an adapter cannot bypass attempt revocation and create duplicate workers.

### Acceptance Criteria

#### Happy Path

- Given Claude or Codex is selected, when a current attempt reaches process creation, then the
  provider validates its active spawn authority synchronously before creating the process.
- Given a compatible custom provider declares and honors the lifecycle capability, when selected,
  then it follows the same preparation and fencing behavior as built-in providers.

#### Negative Paths

- Given a provider lacks the required lifecycle capability, when daemon execution selects it, then
  invocation fails before process creation and names the provider, missing capability, and concrete
  recovery action.
- Given a provider tries to use a revoked permit, when it reaches its spawn boundary, then no child
  process is created and the stale attempt cannot return a successful result.
- Given one provider candidate is unsupported, when fallback policy considers another candidate,
  then fallback proceeds only under the same still-current lifecycle attempt and cannot bypass its
  preparation deadline.

### Done When

- [ ] Contract tests cover Claude, Codex, compatible custom, and unsupported provider adapters.
- [ ] Unsupported-capability diagnostics satisfy the provider-neutral harness contract.
- [ ] A revoked-permit assertion occurs before the subprocess factory is called.

## Story TI-6: Preparation timeout policy preserves heartbeat opt-outs

**Requirement:** Approved ADR — preparation supervision is configured separately from output heartbeat termination

As an operator who disabled heartbeat reaping, I want preparation supervision to have explicit,
documented configuration so that upgrading cannot silently reactivate output-silence kills.

### Acceptance Criteria

#### Happy Path

- Given preparation supervision uses its default policy, when a provider remains pre-spawn beyond
  the documented deadline, then bounded recovery occurs without consulting heartbeat activity.
- Given an operator configures the preparation deadline, when a new attempt starts, then the
  validated resolved value controls only the `preparing` phase.

#### Negative Paths

- Given `step_heartbeat_stall_minutes` is zero, negative, absent, or positive, when a provider has
  spawned, then none of those values authorizes output-silence termination.
- Given preparation-timeout configuration is invalid, when configuration loads, then validation
  reports the exact field and applies the documented fail-safe behavior rather than silently using
  the heartbeat setting.
- Given an older configuration contains only the heartbeat key, when the upgraded engine loads it,
  then compatibility behavior is deterministic and documented; the old value is not silently
  reinterpreted as a preparation deadline.

### Done When

- [ ] Config validation and resolution tests cover default, override, disabled/invalid, and legacy-only inputs.
- [ ] Configuration reference, daemon guide, and stalled-feature runbook describe distinct preparation and activity semantics.
- [ ] No resolver aliases the legacy heartbeat timeout to the preparation deadline.
