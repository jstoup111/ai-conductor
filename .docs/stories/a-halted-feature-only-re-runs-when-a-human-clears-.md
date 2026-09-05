**Status:** Accepted

# Retry at the raiser, and operator budget recovery

Source: https://github.com/jstoup111/ai-conductor/issues/2190 (folds #1425; absorbs #1760 under adr-2026-08-29)
Track: technical. Tier: M.

## Context

The intake asked for a timer-driven automatic re-dispatch of "retryable" halts plus a one-command
laps grant. Architecture review found every named retryable failure already has a decided,
fail-closed home and that a clock-resumed marker is forbidden by adr-2026-08-05 §4. The operator
chose to reshape: retries happen **at the raiser inside the existing retry ladder**, budget halts
are classified so the base-advance sweep cannot auto-clear them, and the grant is the
`kickback-budget` command family that adr-2026-08-29 already decided, extended with a `--gate`
selector so it reaches the per-gate remediation-lap caps the operator hand-widened this week.
Self-host live-boundary trips and protected-artifact seal errors are **excluded**: they are
fail-closed by adr-2026-08-17 §4, adr-2026-06-30, adr-2026-07-26 §2, and adr-2026-08-05, and this
feature does not retry them. The intake's outcome bullet 1 is therefore delivered as Stories 1–2
(bounded retries where retry is safe) rather than as a backoff timer. Plan-growth allowance is out of
scope (#2119). Halt-reason text for as-built BLOCKED verdicts is owned by spec #2197 and untouched.

## Story 1: Validation-group members get the same attempt budget as the serial path

As the operator running the SHIP validation group in daemon mode, I want each concurrent member (`manual_test`, `prd_audit`, `architecture_review_as_built`) to get the same attempt budget a serial step gets, so that one transient provider error in one member no longer halts the group and discards its siblings' completed verdicts.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode validation group whose `prd_audit` branch throws a transient provider error (HTTP 500) on its first attempt and completes on its second, when the group runs, then the group joins normally, `prd_audit` reaches a verdict, and no HALT marker is written.
- Given a daemon-mode validation group where every member completes on its first attempt, when the group runs, then the observable outcome is byte-for-byte today's: same verdicts, same events, no extra dispatch.

#### Negative Paths
- Given a daemon-mode validation group whose `prd_audit` branch throws on every attempt up to the serial attempt budget, when the budget is spent, then the group halts with the existing no-verdict halt naming the member, the reason, and the number of attempts spent, and the halt class is `needs-human`.
- Given a daemon-mode validation group whose `manual_test` branch fails with an authentication failure, when the group runs, then the existing auth park-and-poll path is taken unchanged and no attempt-budget entry is consumed (adr-2026-07-04 §2).

### Done When
- [ ] Both validation-group member dispatch sites pass the resolved serial attempt budget instead of the literal `1`, and a unit test asserts a member that throws once then completes yields a group join with no HALT.
- [ ] A unit test asserts a member that throws on every attempt halts `needs-human` with a reason containing the member name and the attempt count equal to the serial budget.
- [ ] The existing validation-group join tests pass without edits, and #1425 is referenced in the PR as closed by this change.

## Story 2: A test_suite infrastructure failure gets a bounded, non-charging retry before it halts

As the operator, I want a `test_suite` run that could not establish a verdict (timeout, spawn failure, verifier fault — any reason other than a non-zero suite exit) to be retried a small, fixed number of times inside the step without charging the kickback budget, so that a flaky runner does not page me while a genuinely broken environment still halts after a bounded allowance.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode `test_suite` step whose full-suite verifier returns `FAILED` with reason `timeout` on the first run and a clean pass on the second, when the step runs, then the suite is re-run within the step, the step completes, a `step_retry` event records attempt 1 with an infrastructure reason, and no kickback-ledger `count` or `cumulative` field changes.
- Given a `test_suite` verifier result with reason `nonzero_exit`, when the step evaluates it, then the existing code-repair kickback route is taken unchanged and the infrastructure lane is not entered.

#### Negative Paths
- Given a daemon-mode `test_suite` step whose verifier returns an infrastructure failure on every run up to the fixed allowance, when the allowance is spent, then the feature halts with class `needs-human` and a reason naming the verifier reason and the number of automatic retries spent, and the evidence path `.pipeline/test-suite-evidence.json`.
- Given the infrastructure-lane counter file is unreadable or malformed, when the step evaluates an infrastructure failure, then the lane treats the allowance as spent and halts `needs-human` naming the counter as unreadable (fail-closed, adr-2026-08-31 §1 posture), never as a fresh allowance.
- Given a feature whose infrastructure allowance was partly spent in a previous dispatch, when a later dispatch hits another infrastructure failure, then the counter continues from the persisted value rather than restarting, so the bound is per feature across dispatches.

### Done When
- [ ] A named constant bounds the suite-infrastructure allowance, its counter persists in the feature's kickback ledger gate entry beside the existing mechanical-fault fields, and a unit test asserts the counter survives a simulated re-dispatch.
- [ ] A unit test asserts the retry path emits `step_retry` with an infrastructure reason and leaves `count` and `cumulative` unchanged, and a second test asserts exhaustion writes a `needs-human` HALT whose body contains the verifier reason and the retries spent.
- [ ] A unit test asserts a malformed counter halts `needs-human` rather than retrying.

## Story 3: Budget exhaustion is a human halt, and judgement halts are never retried automatically

As the operator, I want every halt that means "a budget ran out" or "a human must decide" to survive every automatic sweep, so that the daemon never spends money re-running something only I can resolve.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `manual_test` FAIL survives the per-gate kickback cap, when the cap halt is written, then its class is `needs-human`, and a subsequent base-advance re-kick sweep skips the feature and logs the retained disposition.
- Given a feature whose `test_suite` failure survives the per-gate kickback cap, or whose per-gate remediation budget is exhausted at a build kickback, when that halt is written, then its class is `needs-human` and the re-kick sweep retains it.
- Given a halt of class `needs-human`, `plan-gap`, `over-scope`, or `kickback-cap` and no operator resume authorization in the feature's ledger, when any automatic path runs (base-advance sweep, progress re-kick, episode-end sweep), then the halt is retained and no dispatch occurs.

#### Negative Paths
- Given a feature halted by a self-host live-boundary trip or a protected-artifact seal error, when the daemon runs any automatic retry path this feature adds, then nothing in this feature clears or retries it, and the halt body is unchanged.
- Given a feature halted with class `mechanical` for a reason other than the three reclassified budget halts, when a base advance occurs, then the existing sweep behavior is unchanged: the halt is cleared and the feature re-kicked rebase-first.
- Given a stale `HALT.class` sidecar reading `mechanical` left by an older engine on one of the three reclassified halts, when the daemon starts, then the existing legacy migration leaves it as-is and the sweep's existing behavior applies, so no in-flight worktree is silently converted.

### Done When
- [ ] The three budget-halt writers (manual-test cap, test_suite cap, per-gate remediation budget exhausted) pass `needs-human`, asserted by three unit tests reading `HALT.class` after each halt.
- [ ] A unit test drives `rekickSweep` over a worktree carrying each of `needs-human`, `plan-gap`, and `unclassified` and asserts all are skipped with a logged disposition, and over a `mechanical` worktree and asserts it is cleared.
- [ ] No writer in the diff introduces a new `HaltClass` value, asserted by the type union being unchanged.

## Story 4: `kickback-budget inspect` shows a feature's budget from one renderer

As the operator, I want `ai-conductor kickback-budget inspect --feature <slug>` to show each gate's consumed count, effective limit, remaining allowance, latest reason, and adjustment history, so that I can see what a raise or reset would change before I do it.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree whose kickback ledger has `build_review` cumulative 5 of effective limit 5 and `prd_audit` laps 2 of cap 2, when the operator runs `kickback-budget inspect --feature <slug>`, then the output lists both gates with consumed, limit, remaining 0, and the latest semantic reason, exits 0, and works without a TTY.
- Given the same feature and `--format json`, when inspect runs, then stdout is a single JSON document containing the same fields per gate and an `adjustments` array (empty when no adjustment was ever recorded).

#### Negative Paths
- Given a feature name that does not resolve to a worktree under the main repository, when inspect runs, then it prints a refusal naming the feature and exits non-zero without creating any file.
- Given a ledger whose adjustment history is malformed but whose gate values validate, when inspect runs, then the gate values are shown and the history is reported as unavailable rather than invented or defaulted (adr-2026-08-31 §2).
- Given a legacy ledger entry with no effective-limit or history fields, when inspect runs, then consumed and the default limit are shown as authoritative and adjustment detail is reported unavailable.

### Done When
- [ ] `kickback-budget inspect` is dispatched pre-boot beside `decide-grant` and a unit test asserts it renders both gates' budget view for a fixture ledger.
- [ ] The cumulative-cap halt body and the inspect output are produced by the same renderer, asserted by a test that the halt body contains the renderer's output for the same entry.
- [ ] Unit tests cover the unresolved feature, malformed history, and legacy entry cases above.

## Story 5: `kickback-budget raise` records an attributed, gate-scoped limit increase

As the operator, I want `ai-conductor kickback-budget raise --feature <slug> --gate <gate> --by N --rationale "<text>"` to raise that gate's effective limit by N for this feature only, recording who, why, and when, so that granting one more lap never requires a config edit or a commit on main.

### Acceptance Criteria

#### Happy Path
- Given a feature halted at the `build_review` cumulative cap with typed cap evidence in its ledger, when the operator runs `raise --gate build_review --by 1 --rationale "one more lap"` from an interactive terminal, then the ledger's `build_review` effective limit increases by 1, `cumulative` is unchanged, an adjustment record with id, kind, before/after, operator, rationale, and timestamp is appended, a `kickback_budget_adjustment_authorized` event is written to the feature's sibling event ledger, a resume authorization bound to the adjustment id and halt generation is installed, and the command exits 0 printing the new budget view.
- Given a feature halted at the `prd_audit` remediation-lap cap (`laps` equals the configured cap), when the operator runs `raise --gate prd_audit --by 1 --rationale "…"`, then the ledger's `prd_audit` entry gains a feature-local effective lap cap of configured+1 that the gate's append-budget resolution honors on resume, and `laps` consumed is unchanged.
- Given a feature with no operator park, when raise runs, then it creates a temporary park for the exact slug before mutating, and releases only that park after the adjustment is durable.
- Given a feature reaching the `build_review` cumulative cap, the `prd_audit` remediation-lap cap, or the `architecture_review_as_built` remediation-lap cap, when the cap halt is written, then the ledger's gate entry already carries typed cap evidence (gate, consumed, effective limit, latest reason, halt generation) persisted before the marker, so a later raise or reset can bind to it without parsing halt prose.

#### Negative Paths
- Given a feature whose live halt is not a cap halt (class `plan-gap`, `over-scope`, `needs-human` without typed cap evidence, or no HALT at all), when raise runs, then it refuses naming the reason, changes nothing in the ledger, and exits non-zero.
- Given raise invoked without an interactive terminal, or with an empty `--rationale`, or with `--by 0`, `--by -1`, or a non-integer, or with an unknown `--gate`, when it runs, then it refuses before touching the park or the ledger and exits non-zero.
- Given the ledger lease is held by a live or ambiguous owner, when raise runs, then it refuses toward halted, leaves the park as it found it, and exits non-zero.
- Given the process crashes after the staged adjustment is written but before the event append succeeds, when the operator re-runs any `kickback-budget` command for that feature, then reconciliation discards the pending record and leaves active budget fields unchanged.
- Given the process crashes after the event append succeeds but before the apply, when the operator re-runs any `kickback-budget` command, then reconciliation finds the event by adjustment id, completes the apply exactly once, and does not append a second event.
- Given a feature that was already operator-parked before raise ran, when raise completes, then the pre-existing park is preserved and the output prints the existing unpark action instead of releasing it.

### Done When
- [ ] `kickback-budget raise` is dispatched pre-boot, requires an interactive TTY, a resolved machine-scoped operator identity, exactly one feature, a known `--gate`, a positive safe-integer `--by`, and a non-empty rationale, with a unit test per refusal.
- [ ] A unit test asserts a raise on `build_review` changes only that entry's effective limit and appends one history record and one event, and a second test asserts a raise on `prd_audit` yields a feature-local lap cap that `remediationGateAppendBudget` resolves to configured+N.
- [ ] Unit tests cover both crash windows above and assert exactly-once apply keyed on the adjustment id.
- [ ] The ledger's own validator accepts every value raise writes, asserted by re-reading the ledger through `readKickbackLedger` after each test (adr-2026-08-31 §5).
- [ ] All three cap terminals persist typed cap evidence with a fresh halt generation before writing the halt marker, asserted by one unit test per terminal reading the ledger after the halt.

## Story 6: `kickback-budget reset` clears consumption and keeps the authorized limit

As the operator, I want `ai-conductor kickback-budget reset --feature <slug> --gate <gate> --rationale "<text>"` to declare a gate's previous laps obsolete for this feature, so that a feature whose earlier failures are no longer relevant can converge without me raising the limit forever.

### Acceptance Criteria

#### Happy Path
- Given a feature halted at the `build_review` cumulative cap with effective limit 6 from an earlier raise, when reset runs for `build_review`, then `cumulative` becomes 0, the effective limit stays 6, an adjustment record and event are written, and a resume authorization is installed.
- Given a feature halted at the `architecture_review_as_built` lap cap, when reset runs for that gate, then its consumed `laps` becomes 0 and its effective lap cap is unchanged.

#### Negative Paths
- Given reset for one gate, when it completes, then every other gate's entry, the plan-growth record, the mechanical-fault fields, and `count` are byte-for-byte unchanged, asserted by comparing the ledger before and after.
- Given the same refusals as Story 5 (non-cap halt, no TTY, empty rationale, unknown gate, held lease), when reset runs, then it refuses identically and changes nothing.

### Done When
- [ ] A unit test asserts reset on `build_review` zeroes `cumulative` and preserves a raised effective limit, and a second asserts reset on an as-built entry zeroes `laps` and preserves its cap.
- [ ] A unit test asserts the rest of the ledger is unchanged by a reset.
- [ ] Refusal tests are shared with Story 5 through one validation helper, asserted by the helper having a single call site per refusal.

## Story 7: The daemon consumes the authorization, clears the halt, and resumes after the last completed step

As the operator, I want the daemon — never the CLI — to clear a cap halt once a valid authorization exists, so that the halt lifecycle stays atomic and I can see the adjustment in daemon status and on the event spine before the feature moves.

### Acceptance Criteria

#### Happy Path
- Given a feature with a valid, unconsumed resume authorization whose halt generation matches the live cap halt and no operator park, when the daemon reaches its halted-feature boundary, then it clears the halt marker, its class sidecar, and the `needs-remediation` presentation as one operation, resolves the committed halt record, marks the authorization consumed, emits the existing halt-clear evidence on the spine, and dispatches the feature so it resumes after its last completed step.
- Given a feature whose authorization was consumed, when the raised or reset gate next runs, then it enforces the new effective limit or zeroed consumption from the ledger, not from repository config.
- Given a feature with an adjustment recorded, when the operator runs `daemon status`, then the feature's row shows the gate, the adjustment kind, and the remaining allowance.

#### Negative Paths
- Given an authorization whose halt generation does not match the live halt (the halt was rewritten since), when the boundary runs, then the authorization is refused as stale, the halt is retained, and nothing is dispatched.
- Given a feature that is operator-parked, when the boundary runs, then the park wins: the authorization is left unconsumed and the feature stays parked until an explicit unpark.
- Given the atomic halt clear reports `partial` (marker removed but presentation repair failed), when the boundary runs, then the feature stays halted, the authorization is not consumed, and the partial result is logged.
- Given a ledger that cannot be validated at the boundary, when the boundary runs, then the read fails closed: no authorization is honored and the existing `needs-human` retention branch is taken (adr-2026-08-31 §1).

### Done When
- [ ] A unit test drives the daemon halted-feature boundary with a fixture ledger carrying a matching authorization and asserts the clear, the consumed flag, the spine event, and a dispatch, in that order.
- [ ] Unit tests cover stale generation, operator park precedence, partial clear, and unreadable ledger, each asserting no dispatch and an unconsumed authorization.
- [ ] `daemon status` renders the adjustment kind and remaining allowance for a feature with an adjustment, asserted by a renderer test, and the resumed feature's first dispatched step is the step after its last completed one, asserted by an existing resume-entry test extended with a ledger fixture.
