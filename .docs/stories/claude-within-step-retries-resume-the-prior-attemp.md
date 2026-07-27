**Status:** Accepted

# Stories: Cold-Start Within-Step Retries (ai-conductor#1071)

Technical track, Medium tier. Acceptance criteria live here (no PRD). Every criterion is
asserted **structurally** — by inspecting the session id and resume flag the conductor
hands the provider — never by convention or by reading a log line.

Design decisions this file assumes:

- `.docs/track/claude-within-step-retries-resume-the-prior-attemp.md` — technical track.
- `.docs/decisions/adr-2026-07-27-cold-start-within-step-retries.md` — APPROVED; supersedes
  §2 of `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`.
- `.docs/decisions/architecture-review-claude-within-step-retries-resume-the-prior-attemp.md`
  — APPROVED with three conditions (three resume authorities; mint-with-suppress; interactive
  context).
- Scope is **provider-neutral**: Claude and Codex both cold-start. #903 has not landed and
  Codex resume is live today, so a Claude-only change would create the divergence this work
  exists to remove.

> **Supersession note.** ST-1071-1 through ST-1071-3 invert accepted criteria in
> `.docs/stories/fresh-session-per-step.md` ("Within-step retries resume the same session")
> and `.docs/stories/per-step-provider-routing-927.md` ST-927-7. Those stories are amended
> by ST-1071-6, not left to contradict this file.

---

## Story ST-1071-1: A provider-scoped retry starts a fresh session with a fresh identifier

**Requirement:** `ProviderSessionScope.prepare()` returns a newly minted session id and
`resume: false` on **every** invocation, including the second and later attempt of the same
step on the same provider.

As the conductor, I want a retried attempt to carry no conversational memory of the attempt
that just failed, so that its reasoning is derived from committed artifacts and the retry
prompt rather than from the failure it is supposed to correct.

### Acceptance Criteria

#### Happy Path

- Given a step dispatched to Claude that fails and is retried within the same step, when the
  second attempt dispatches, then the provider receives `resume: false` **and** a session id
  different from the first attempt's, so the Claude adapter emits
  `--session-id «new-id»` and never `--resume`.
- Given the same scenario with Codex as the provider, when the second attempt dispatches,
  then it receives `resume: false` and a fresh id, so the adapter emits `exec` (with `--cd`)
  and never `exec resume`.
- Given a step that escalates model or effort between attempts (#188 retry-as-escalation),
  when each escalated attempt dispatches, then every attempt is a cold start with its own id,
  and the escalation still applies the intended model and effort for its rung.
- Given a step whose preferred provider fails and whose fallback candidate is invoked, when
  the fallback dispatches, then it is a cold start with its own id — unchanged from today's
  behavior, and now for the same reason as every other dispatch.

#### Negative Path

- Given attempt 1 has dispatched and `markCreated` has fired, when attempt 2 calls
  `prepare()` for the same provider key, then the returned id is **not** equal to attempt 1's
  id — a test asserting equality (today's
  `per-step-provider-routing-927.acceptance.test.ts:964`) must fail against the new behavior.
- Given the resume flag is suppressed, when the dispatch is constructed, then it does not
  reuse the previous identifier — suppressing the flag while holding the id stable is an
  explicit defect, because `--session-id` against an already-registered id is the condition
  `SESSION_IN_USE_RE` exists to catch.
- Given a first attempt that throws at the runtime boundary rather than returning a failure,
  when the retry dispatches, then it is still a cold start with a fresh id.

### Done When

- [ ] A test asserts attempt 2 of a same-step, same-provider retry receives `resume: false`
      and an id `!==` attempt 1's, for Claude and for Codex.
- [ ] A test asserts the emitted CLI argv contains `--session-id` (Claude) / `exec` without
      `resume` (Codex) on attempt 2.
- [ ] `per-step-provider-routing-927.acceptance.test.ts:962-964` and
      `provider-session.test.ts:178-195` are **inverted** in place, not deleted.
- [ ] `provider-execution.test.ts:164` (`'still resumes within a step when no isolated
      self-host home is provisioned'`) is inverted; `provider-execution.test.ts:116`
      (self-host never resumes) still passes unchanged.

---

## Story ST-1071-2: A concurrent-group branch member retry starts a fresh session

**Requirement:** The branch executor's own resume authority (`group-core.ts:464-469`,
`const resume = hasRun`) no longer resumes a branch member's prior attempt.

As the conductor, I want concurrent group members to get the same retry isolation as
sequential steps, so that a fix to the sequential path does not leave a second live
contamination route that is harder to observe.

### Acceptance Criteria

#### Happy Path

- Given a concurrent group member that has dispatched once and is retried, when the retry
  dispatches, then it receives `resume: false` and an id different from its prior attempt,
  in both the `providerSessions` path and the scalar `mintSessionId` path.
- Given a branch member reports `sessionExpired`, when the non-consuming recovery re-runs it,
  then the recovery still does not consume retry budget and the re-run is a cold start.

#### Negative Path

- Given `hasRun` is true for a branch, when the next dispatch is constructed, then `hasRun`
  does not cause a resume — a branch that has dispatched before is not thereby entitled to
  resume.
- Given two concurrent branches A and B, when both retry, then neither receives the other's
  session id, and neither receives its own prior id.

### Done When

- [ ] A test asserts branch-member retries are cold starts with fresh ids, in both the
      `providerSessions` and scalar paths.
- [ ] A test asserts branch isolation still holds across the change (no cross-branch id).
- [ ] The `sessionExpired` non-consuming re-run (`group-core.ts:525-537`) still does not
      decrement retry budget.

---

## Story ST-1071-3: The legacy scalar single-provider path retries cold

**Requirement:** `resume = this.sessionStarted` (`step-runners.ts:529-530`) and the
`.pipeline/session-created` marker no longer cause a within-step retry to resume.

As the conductor, I want the no-session-store path to follow the same contract, so that the
documented behavior is true of every configuration rather than only the provider-aware one.

### Acceptance Criteria

#### Happy Path

- Given a single-provider run with no session store, when a step's second attempt dispatches,
  then it receives `resume: false` and a fresh id.
- Given `.pipeline/session-created` is present from an earlier dispatch, when the next attempt
  of the current step dispatches, then the marker does not produce a resume.

#### Negative Path

- Given `session-created` exists on disk from a prior process, when a step dispatches, then
  the marker alone never yields `--resume` — a stale marker cannot reintroduce resume.
- Given `.pipeline/conduct-session-id` exists, when attempts cold-start, then the file's
  contents do **not** churn per attempt (see ST-1071-5).

### Done When

- [ ] `session.test.ts:89` (`'returns --resume when session has been created'`) and
      `step-runners.test.ts:791/843-844, 1472/1481-1482, 1671-1698, 2333/2351-2353` are
      inverted to assert cold start.
- [ ] A test asserts an inherited `session-created` marker cannot produce a resume.

---

## Story ST-1071-4: Interactive recovery cold-starts on a session that states what failed

**Requirement:** `runInteractive` takes the failure context as an explicit input and renders
it into its prompt, so the operator's session knows what just failed and why without relying
on a resumed conversation.

As an operator breaking a stall or choosing "interactive fix" from the recovery menu, I want
the session that opens to already state which step failed and with what error, so that I do
not have to reconstruct the failure myself.

### Acceptance Criteria

#### Happy Path

- Given the stall-breaker fires in non-auto mode (`conductor.ts:4785`), when the interactive
  session opens, then its prompt names the failed step **and** carries the failure reason
  (the same content that feeds `retryHint` at `conductor.ts:4076`), and the dispatch is a
  cold start.
- Given the operator selects "interactive fix" from the recovery menu
  (`conductor.ts:5808`), when the interactive session opens, then it likewise carries the
  step name and failure reason and is a cold start.
- Given the interactive session completes, when the conductor re-checks step completion, then
  the existing recheck-and-break flow is unchanged.

#### Negative Path

- Given no failure reason is available (blank runner output), when the interactive session
  opens, then it still states which step failed and that no reason was captured — it never
  falls back to the bare 12-word stub with an empty system prompt.
- Given `runInteractive` is invoked, when the dispatch is constructed, then it does not pass
  `resume: true` on either the provider-aware or the legacy path.

### Done When

- [ ] A test asserts the prompt handed to the provider by `runInteractive` contains the step
      name and the failure reason, for both call sites.
- [ ] A test asserts `resume: false` on both `runInteractive` paths.
- [ ] A test covers the missing-reason case producing an explicit "no reason captured"
      statement rather than a silent stub.

---

## Story ST-1071-5: Stale/in-use recovery and telemetry correlation survive intact

**Requirement:** The `sessionExpired` classification and the non-budget-consuming
`session_reset` recovery keep working with their narrowed meaning, and `conductor.run.id`
stays stable across a feature's attempts and process restarts.

As the conductor, I want the identifier-rejection safety net and per-feature telemetry
correlation to survive a change that removes their most common trigger, so that a cleanup
pass cannot quietly turn a recoverable condition into a hard failure.

### Acceptance Criteria

#### Happy Path

- Given a provider reports an "already in use" or "no conversation found" message, when the
  conductor classifies it, then `sessionExpired` is still set, a `session_reset` event is
  still emitted, and the retry does **not** consume budget.
- Given the same for Codex (`no rollout found`, `thread/resume failed`), when classified,
  then `CODEX_SESSION_EXPIRED_RE` still matches and the same recovery applies.
- Given a feature run that dispatches many cold-started attempts, when spans are emitted,
  then `conductor.run.id` is identical across all of them.
- Given the conductor process restarts mid-feature, when spans resume, then
  `conductor.run.id` still resolves to the same value from `.pipeline/conduct-session-id`.

#### Negative Path

- Given cold start is the default, when the implementation removes resume machinery, then
  `SESSION_IN_USE_RE`, `STALE_SESSION_RE`, `CODEX_SESSION_EXPIRED_RE`, the `sessionExpired`
  signal, and the `session_reset` recovery are **not** deleted as dead code.
- Given per-invocation session identity, when an attempt dispatches, then the provider
  session id is **not** written to `.pipeline/conduct-session-id` — that file remains the
  step runner's run identity, so the run id does not churn per attempt.

### Done When

- [ ] Tests assert `sessionExpired` classification and non-consuming `session_reset`
      recovery for both providers after the change.
- [ ] A test asserts `conductor.run.id` is stable across multiple cold-started attempts
      within one feature run.
- [ ] A test asserts `.pipeline/conduct-session-id` is not rewritten per provider
      invocation.

---

## Story ST-1071-6: One retry contract, documented identically for every provider

**Requirement:** Every place that states the session contract says the same thing, with no
provider qualifier and no within-step resume exception.

As a reader of the harness contract, I want one sentence that describes retry session
semantics for all providers, so that the documented behavior and the implemented behavior
cannot drift apart per provider.

### Acceptance Criteria

#### Happy Path

- Given the contract is documented, when a reader consults any of the following, then each
  states that every dispatch — including every retry — starts a fresh session, with no
  provider-conditional wording:
  - `HARNESS.md:237-241`
  - `.docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md` §2
    (marked superseded by the new ADR)
  - `.docs/stories/fresh-session-per-step.md` (the "Within-step retries resume the same
    session" story, amended with a supersession note)
  - `.docs/stories/per-step-provider-routing-927.md` ST-927-7
- Given the change is notable and reader-visible, when it lands, then `CHANGELOG.md`
  `[Unreleased]` carries an entry describing the new retry semantics.

#### Negative Path

- Given the documentation is updated, when a reader searches for a resume exception, then no
  document still asserts that a within-step retry resumes — an amended story must not leave
  its old acceptance criteria stated as current.
- Given no CLI flag, hook wiring, skill symlink target, or `settings.json` schema changes,
  when the release gate runs, then no migration block is required; if the gate's path
  classifier flags a surface anyway, a `.docs/release-waivers/` entry is committed in the
  same diff rather than an empty migration block.

### Done When

- [ ] All four documents above are updated in the same PR as the implementation.
- [ ] The superseded ADR §2 carries an explicit pointer to
      `adr-2026-07-27-cold-start-within-step-retries`.
- [ ] `CHANGELOG.md` `[Unreleased]` has an entry.
- [ ] `test/test_harness_integrity.sh` passes.

---

## Out of scope

- `bin/conduct` (the shell conductor).
- Introducing a `supportsSessionResume` provider capability — rejected by the ADR;
  reintroduce only against a real second case.
- Measuring the token-cost delta. The ADR predicts cost falls (a cold start sends the step
  prompt; a resume re-sends the failed transcript) but does not gate the change on it.
