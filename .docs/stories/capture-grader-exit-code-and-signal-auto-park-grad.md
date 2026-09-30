**Status:** Accepted

# Stories: Capture provider exit code and signal on unclassified subprocess failure

Source: jstoup111/ai-conductor#823 (rescoped: diagnostics only; HALT and retry behavior unchanged).

## Story 1: Claude provider records raw exit facts for an unclassified failure

As an operator reading daemon.log, I want an empty-output claude crash to log its raw exit code and terminating signal so that I can tell a killed process from a silent non-zero exit.

### Acceptance Criteria

#### Happy Path
- Given a claude dispatch whose subprocess exits with code 1, no signal, and empty stdout and stderr, when the dispatch completes, then daemon.log receives one diagnostic line naming provider claude with exitCode=1, stdoutBytes=0, and stderrBytes=0.
- Given a claude dispatch whose subprocess is terminated by SIGKILL with a null exit code and empty output, when the dispatch completes, then the diagnostic line names signal=SIGKILL and omits exitCode rather than reporting exitCode=1.
- Given a claude dispatch that fails without a classifiable result, when the result is returned, then the result carries the same exit facts (exitCode, signal, stdoutBytes, stderrBytes) as structured fields.

#### Negative Paths
- Given a claude subprocess terminated by a signal outside the known set (for example SIGUSR1), when the dispatch completes, then the recorded signal is UNKNOWN and no raw unrecognized string reaches the log.
- Given a claude dispatch that fails with a classified cause (missing binary, auth failure, rate limit, or model unavailable), when the dispatch completes, then the existing classification and its HALT or retry routing are unchanged.
- Given a claude dispatch that succeeds with exit code 0, when it completes, then no exit-facts diagnostic line is written.

### Done When
- [ ] A claude unclassified failure with empty output produces a daemon.log line containing exitCode and/or signal plus stdoutBytes and stderrBytes.
- [ ] A signal-terminated claude subprocess never reports a fabricated exitCode=1 in the exit facts.
- [ ] Existing claude classifier tests (ENOENT/127, auth, rate limit, model unavailable) pass unchanged.

## Story 2: Codex and pi providers record the same exit facts through one shared helper

As an operator, I want every provider to report unclassified subprocess failures the same way so that diagnosis does not depend on which provider ran the step.

### Acceptance Criteria

#### Happy Path
- Given a codex dispatch whose subprocess exits non-zero with empty output and no classifiable cause, when the dispatch completes, then daemon.log receives a diagnostic line naming provider codex with the same exit-fact fields as claude.
- Given a pi dispatch whose subprocess is terminated by SIGTERM with empty output, when the dispatch completes, then daemon.log receives a diagnostic line naming provider pi with signal=SIGTERM.
- Given the codex readiness probe fails, when it logs its readiness diagnostic, then the logged facts are identical in content to what the probe logged before this change.

#### Negative Paths
- Given a process error code outside the known set (not EACCES, EAGAIN, ENOENT, or EPERM), when exit facts are derived for any provider, then processErrorCode is recorded as UNKNOWN.
- Given an exit code that is negative, non-integer, or non-numeric, when exit facts are derived, then exitCode is omitted rather than coerced.

### Done When
- [ ] claude, codex, and pi unclassified-failure paths derive exit facts from one shared helper module, and the codex readiness probe uses the same helper.
- [ ] Unit tests cover known signal, unknown signal, known and unknown process error codes, and invalid exit codes against the shared helper.

## Story 3: Exit facts reach the event spine and the retry and HALT reasons

As an operator diagnosing a stranded build, I want the exit facts on the step's retry and failure events and in the HALT reason so that the cause is visible in events.jsonl and the HALT file, not only in daemon.log.

### Acceptance Criteria

#### Happy Path
- Given a step whose provider dispatch fails without a classifiable result and is retried, when the step_retry event is persisted, then it carries an optional providerExit field with the recorded exit facts.
- Given a step whose provider dispatch fails without a classifiable result and exhausts its retries, when the step_failed event is persisted, then it carries the providerExit field with the exit facts of the final attempt.
- Given a build_review grader dispatch that fails without a result and exhausts its retries, when the HALT is written, then the HALT reason text includes the final attempt's exit code and/or signal.

#### Negative Paths
- Given a step that fails with a real FAIL verdict or a classified provider cause, when its events are persisted, then no providerExit field is present and the HALT class and routing are unchanged.
- Given an events.jsonl written before this change with no providerExit field, when it is read by existing event consumers, then it parses without error.
- Given a grader dispatch failure that exhausts its retries, when the HALT is written, then its HALT class is the same as before this change (no auto-park or auto-retry is introduced).

### Done When
- [ ] step_retry and step_failed in the ConductorEvent union declare an optional providerExit field, populated only for unclassified provider failures.
- [ ] A build_review grader-dispatch HALT file names the final attempt's exit code or signal.
- [ ] No new file, log, or telemetry channel is introduced; HALT class for grader-dispatch exhaustion is unchanged.
