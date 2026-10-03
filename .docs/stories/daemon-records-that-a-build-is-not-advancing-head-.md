**Status:** Accepted

# Stories: act on builds that are active but not advancing HEAD

Technical track (intake #2102). Behaviour follows the approved architecture review
`architecture-review-2026-10-02-daemon-records-that-a-build-is-not-advancing-head-` and decisions
8 and 9 of `adr-2026-07-10-intra-step-build-progress-events`. "Fresh heartbeat" means a step
heartbeat that belongs to the current build dispatch and is younger than `quiet_minutes`. "Movement"
means a HEAD change or a task-progress change observed by a progress tick.

## Story 1: Every progress emission names which of three activity states the build is in

As a daemon operator, I want each build progress line to say whether the provider is quiet, active and committing, or active and not committing, so that I can tell slow real work from busy non-work without reading the event file or the process table.

### Acceptance Criteria

#### Happy Path
- Given a build attempt whose progress tick observes a HEAD change, when the tick emits `build_progress`, then the event carries `activity: "active-committing"`.
- Given a build attempt with no movement since the last tick and a fresh heartbeat, when the heartbeat-period `build_progress` is emitted, then the event carries `activity: "active-not-committing"`.
- Given a build attempt with no movement and a step heartbeat older than `quiet_minutes`, when `build_no_progress` is emitted at the quiet threshold, then the event carries `activity: "quiet"`.
- Given a build attempt with no movement whose step heartbeat is only seconds old when the quiet threshold elapses, when `build_no_progress` is emitted, then the warning still fires exactly once for the episode and carries `activity: "active-not-committing"`.

#### Negative Paths
- Given a build attempt with no movement whose step heartbeat belongs to an earlier dispatch, when the heartbeat-period `build_progress` is emitted, then the event carries `activity: "quiet"`, not `active-not-committing`.
- Given the step heartbeat file is missing or unreadable, when a no-movement tick emits, then the event carries `activity: "quiet"` and the tick still emits its existing resolved, total and lastCommitAt fields.
- Given a tick whose HEAD probe fails, when the tick emits, then the failed probe is not treated as movement and the event does not carry `activity: "active-committing"` on the strength of that probe alone.

### Done When
- [ ] `build_progress` and `build_no_progress` in the `ConductorEvent` union each declare an `activity` field typed as the closed union of the three states.
- [ ] Every `build_progress` and `build_no_progress` the watcher emits carries an `activity` value.

## Story 2: A build that stays active without moving is recorded once as a classified condition

As a daemon operator, I want the daemon to record a named condition when a build has been active but not committing for the configured bound, so that I find it in the run's normal log without inspecting anything by hand.

### Acceptance Criteria

#### Happy Path
- Given `active_stall_action` is unset and `active_stall_minutes` is 45, when a build attempt stays `active-not-committing` for 45 minutes since its last movement, then exactly one `build_active_stall` event is emitted with `action: "warn"`, the elapsed minutes, resolved, total, lastCommitAt, lastActivityAt and featureSlug.
- Given a `build_active_stall` with `action: "warn"` was emitted, when the attempt continues, then the provider attempt keeps running to completion and no `active_stall` stall reason is recorded for it.
- Given a `build_active_stall` event is emitted, when the daemon renders it, then `daemon.log` gains one warning line naming the step, the feature slug, the minutes active without movement and the action taken.

#### Negative Paths
- Given a `build_active_stall` was already emitted for the current episode, when later ticks remain `active-not-committing`, then no further `build_active_stall` event is emitted for that episode.
- Given a build attempt that alternates between quiet and active ticks without movement, when the bound elapses while the latest tick is `quiet`, then no `build_active_stall` is emitted on that tick.
- Given `build_progress.enabled` is false, when a build attempt runs with no movement for longer than the bound, then no `activity` classification and no `build_active_stall` event are produced.

### Done When
- [ ] `build_active_stall` is a member of the `ConductorEvent` union, registered in the event sink table as rendered, persisted and exported to OTel.
- [ ] `build_active_stall` appears in `.pipeline/events.jsonl` for a qualifying attempt; no other file is written for it.
- [ ] The daemon log renderer and the TTY renderer each have a `build_active_stall` case.

## Story 3: With end_attempt opted in, a persistently active-but-not-committing attempt is ended

As a daemon operator, I want to opt a project into ending such attempts, so that a provider doing nothing useful stops spending instead of running unbounded.

### Acceptance Criteria

#### Happy Path
- Given `active_stall_action: end_attempt` and `active_stall_minutes: 30`, when a build attempt stays `active-not-committing` for 30 minutes, then a `build_active_stall` with `action: "end_attempt"` is emitted and the running provider attempt is ended.
- Given an attempt was ended this way and the existing no-task-progress rule does not classify it, when the build dispatch evaluates the attempt's outcome, then exactly one `build_stall` is emitted with reason `active_stall`, and the 30-minute bound is carried by that attempt's `build_active_stall` event.
- Given an attempt was ended this way and retry budget remains, when the dispatch continues, then the next attempt starts under the existing retry rules and its own fresh progress episode.

#### Negative Paths
- Given two consecutive ended attempts in which neither HEAD nor the resolved-task count moved, when the second ends, then the build is classified by the existing no-task-progress stall rule and follows its existing remediation and HALT path, not a new loop.
- Given an attempt was ended this way, when the provider execution has further fallback candidates configured, then no further candidate is invoked for that attempt.
- Given the end request arrives after the attempt has already completed, when it is applied, then the completed attempt's result is unchanged and no `build_stall` is recorded for it.
- Given the end request is issued twice for the same attempt, when the second is applied, then the attempt is ended only once and only one `build_stall` is recorded.

### Done When
- [ ] An ended attempt produces exactly one `build_active_stall` with `action: "end_attempt"` and one `build_stall` naming the active-stall reason in `.pipeline/events.jsonl`.
- [ ] An ended attempt counts as one attempt against the existing build retry budget.
- [ ] `build_stall` reason is the closed union `no_task_progress`, `halt_marker`, `active_stall`; the daemon stall metric counts `active_stall` under that label alone.

## Story 4: Real work is never ended and the bound is the operator's to set

As a daemon operator, I want slow but genuine work to be safe from this mechanism, so that enabling it never costs me a legitimate long step.

### Acceptance Criteria

#### Happy Path
- Given `active_stall_minutes: 120` in a project's config, when that project's build attempt is `active-not-committing` for 60 minutes, then no `build_active_stall` is emitted and the attempt is not ended.
- Given an attempt is `active-not-committing` for 40 minutes against a 45-minute bound, when it then commits, then the next tick carries `activity: "active-committing"` and the bound restarts from that movement.
- Given a `build_active_stall` with `action: "warn"` was emitted, when the attempt later moves and then stays `active-not-committing` for the bound again, then a second `build_active_stall` is emitted for the new episode.

#### Negative Paths
- Given `active_stall_action: end_attempt` and a provider whose heartbeat is stale for longer than the bound, when no movement occurs, then the attempt is not ended, because quiet output never authorises ending an attempt.
- Given `active_stall_action: end_attempt`, when a task-progress change without a new commit is observed before the bound, then the episode is cleared and the attempt is not ended at the original deadline.

### Done When
- [ ] The watcher's bound is read from the resolved `build_progress` config of the project being built.
- [ ] No code path ends a build attempt from a `quiet` classification.

## Story 5: The new build_progress keys are validated and defaulted

As a project maintainer, I want the new settings to be validated like the existing ones, so that a typo cannot silently disable or misconfigure the bound.

### Acceptance Criteria

#### Happy Path
- Given a config with no `active_stall_minutes` or `active_stall_action`, when the build progress config resolves, then the bound is 45 minutes and the action is `warn`.
- Given `active_stall_minutes: 90` and `active_stall_action: end_attempt`, when the config loads, then it loads without error and resolves to exactly those values.

#### Negative Paths
- Given `active_stall_minutes: 0`, `-5`, or a non-number, when the config loads, then validation fails with a message naming `build_progress.active_stall_minutes` as needing a positive number.
- Given `active_stall_action: kill`, when the config loads, then validation fails with a message naming `build_progress.active_stall_action` and its allowed values `warn` and `end_attempt`.
- Given `poll_seconds: 600` and `active_stall_minutes: 5`, when the config loads, then validation fails with a message that `poll_seconds` must not exceed the active-stall bound.
- Given an unknown key such as `active_stall_minuts` in `build_progress`, when the config loads, then it is reported the same way other unknown `build_progress` keys are reported today.

### Done When
- [ ] `build_progress` accepts exactly the two new keys in addition to its existing four.
- [ ] Validation errors name the offending key path.

## Story 6: Claude and Codex build attempts terminate when their attempt is ended

As a daemon operator, I want ending an attempt to actually stop the provider process for every built-in provider, so that the spend stops and no orphaned session keeps running.

### Acceptance Criteria

#### Happy Path
- Given a Claude build invocation receives an abort signal while its subprocess runs, when the signal fires, then the subprocess is sent a termination signal and the invocation returns an unsuccessful result instead of waiting for the session to finish.
- Given a Codex build invocation receives an abort signal while its subprocess runs, when the signal fires, then the subprocess is sent a termination signal and the invocation returns an unsuccessful result.
- Given a Pi build invocation receives an abort signal, when the signal fires, then its existing aborted-invocation behaviour is unchanged.

#### Negative Paths
- Given a provider subprocess ignores the termination signal, when the grace period elapses, then it is forcibly killed and the invocation still returns.
- Given an abort signal that is already aborted before the invocation starts, when a Claude or Codex invocation is requested, then no subprocess is spawned.
- Given a Claude or Codex invocation ended by its abort signal, when its result is classified, then it is reported as neither rate-limited, authentication-failed nor session-expired, so it never takes a recovery path that leaves the retry budget untouched.
- Given an invocation that receives no abort signal, when it runs, then Claude and Codex behave exactly as before, with no cancellation option forwarded.

### Done When
- [ ] Both the Claude and Codex adapters forward an invocation's abort signal to their spawned subprocess.
- [ ] An aborted Claude or Codex invocation resolves with `success: false` and leaves no live child process.
