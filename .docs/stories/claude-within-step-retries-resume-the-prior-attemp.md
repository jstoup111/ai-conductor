**Status:** Accepted

# Stories: Claude Declares No Resume — No Session Is Ever Resumed (ai-conductor#1071)

Technical track, Medium tier. Acceptance criteria live here (no PRD). Every criterion is
asserted **structurally** — by inspecting the session id and resume flag the conductor hands
the provider, or the argv the adapter constructs — never by convention or by reading a log line.

**This feature depends on #1069 (issue #903) and must build only after it merges.** #1069 adds
the `supportsSessionResume` capability, sets Codex to `false`, and deletes Codex's resume argv.
This feature flips Claude to `false`, deletes Claude's resume argv, and closes the three gaps
#1069 left open by design. The combined end state: **no session is ever resumed, for either
provider, on any dispatch path.**

Design decisions this file assumes:

- `.docs/track/claude-within-step-retries-resume-the-prior-attemp.md` — technical track.
- `.docs/decisions/adr-2026-07-27-cold-start-within-step-retries.md` — APPROVED; depends on
  `adr-2026-07-27-codex-never-resumes-a-harness-minted-session`.
- `.docs/decisions/architecture-review-claude-within-step-retries-resume-the-prior-attemp.md`
  — APPROVED with four conditions.

**Explicitly not this feature's work** (owned by #1069): introducing `supportsSessionResume`;
setting Codex to `false`; deleting Codex's `exec resume` argv; the `session_policy` diagnostic;
the capability gate in `runProviderInvocation`. Stories here never re-assert those — they
assert that Claude joins Codex, and that the paths the capability gate cannot reach are closed.

> **Supersession note.** ST-1071-1 inverts the Claude half of criteria that #1069 deliberately
> preserves (`per-step-provider-routing-927.acceptance.test.ts:962-964` and the ADR §2 clause
> as #1069 re-qualified it). ST-1071-6 amends those documents rather than leaving them to
> contradict this file.

---

## Story ST-1071-1: Claude declares no resume, and cannot construct one

**Requirement:** `ClaudeProvider.supportsSessionResume` is `false`, and the `--resume` branch is
removed from `buildArgs` so a Claude resume argv is not constructable — mirroring what #1069 did
to Codex.

As the conductor, I want a retried Claude attempt to carry no conversational memory of the
attempt that just failed, so that its reasoning comes from committed artifacts and the retry
prompt rather than from the failure it is meant to correct.

### Acceptance Criteria

#### Happy Path

- Given a Claude step that fails and is retried within the same step, when the second attempt
  dispatches, then the provider receives `resume: false` and the argv contains
  `--session-id «id»` and never `--resume`.
- Given a step that escalates model or effort between attempts (#188 retry-as-escalation), when
  each escalated attempt dispatches, then every attempt is a cold start, and the escalation
  still applies the intended model and effort for its rung.
- Given the capability gate added by #1069, when a Claude dispatch is prepared, then the gate
  reads `supportsSessionResume === false` and suppresses resume by the same path it already
  suppresses it for Codex — no Claude-specific branch is introduced.
- Given both providers now declare `false`, when the harness runs any step with any provider,
  then no dispatch anywhere carries `resume: true`.

#### Negative Path

- Given a caller passes `resume: true` directly to `ClaudeProvider.buildArgs`, when the argv is
  constructed, then it still emits `--session-id` and never `--resume` — the invariant is
  structural, not a runtime check a future call site could bypass.
- Given `supportsSessionResume` is retained with no `true` case, when an adapter omits the
  declaration entirely, then it is still treated as non-resuming (#1069's fail-closed default
  is preserved, not weakened).

### Done When

- [ ] A test asserts `ClaudeProvider.supportsSessionResume === false`.
- [ ] A test asserts `buildArgs` emits `--session-id` and never `--resume`, even when a caller
      passes `resume: true`.
- [ ] `per-step-provider-routing-927.acceptance.test.ts:962-964` — the Claude half #1069
      preserved — is **inverted in place**, not deleted.
- [ ] `retry-as-escalation.acceptance.test.ts:332-342` Claude resume expectations are inverted
      while the ordered model/effort ladder assertions stay untouched.

---

## Story ST-1071-2: Session identity is minted per invocation

**Requirement:** `ProviderSessionScope.prepare()` mints a fresh session id on every call and
returns `resume: false`, so suppressing resume never dispatches against an already-registered
identifier.

As the conductor, I want a cold-started attempt to carry an identifier the CLI has not seen, so
that removing resume does not trade conversational contamination for a session-lock failure.

### Acceptance Criteria

#### Happy Path

- Given a step's first attempt has dispatched and `markCreated` has fired, when attempt 2 calls
  `prepare()` for the same provider key, then the returned id differs from attempt 1's and
  `resume` is `false`.
- Given Codex dispatches after #1069, when it cold-starts, then it too receives a fresh id per
  invocation — the change is at the shared seam, not Claude-specific.
- Given a step whose preferred provider fails over to a fallback candidate, when the fallback
  dispatches, then it cold-starts with its own id, unchanged in observable behavior.

#### Negative Path

- Given the resume flag is suppressed, when the dispatch is constructed, then it does **not**
  reuse the previous identifier — holding the id stable while suppressing the flag is an
  explicit defect, because `--session-id` against an already-registered id is the condition
  `SESSION_IN_USE_RE` exists to catch.
- Given a first attempt that throws at the runtime boundary rather than returning a failure,
  when the retry dispatches, then it still receives a fresh id.
- Given `.pipeline/conduct-session-id` exists, when attempts cold-start, then its contents do
  **not** churn per attempt (see ST-1071-5).

### Done When

- [ ] A test asserts `prepare()` returns a distinct id on consecutive calls for the same
      provider key within one step scope, with `resume: false` on every call.
- [ ] `provider-session.test.ts:178-195`'s expected table is inverted in place.
- [ ] `provider-execution.test.ts:164` (`'still resumes within a step when no isolated self-host
      home is provisioned'`) is inverted; `provider-execution.test.ts:116` (self-host never
      resumes) still passes unchanged.

---

## Story ST-1071-3: The two dispatch paths the capability gate cannot reach are closed

**Requirement:** `group-core.ts:464-469` (`const resume = hasRun`) and `step-runners.ts:529-530`
(`resume = this.sessionStarted`) no longer request a resume, because neither reaches
`provider-execution.ts` where #1069's capability gate lives.

As the conductor, I want every dispatch path to cold-start, so that #1069's capability gate
plus this change leaves no route by which a resume can still be requested.

### Acceptance Criteria

#### Happy Path

- Given a concurrent-group branch member that has dispatched once and is retried, when the retry
  dispatches, then it receives `resume: false` and a fresh id, in both the `providerSessions`
  path and the scalar `mintSessionId` path.
- Given a single-provider run with no session store, when a step's second attempt dispatches,
  then it receives `resume: false` and a fresh id.
- Given a branch member reports `sessionExpired`, when the non-consuming recovery re-runs it,
  then the recovery still does not consume retry budget and the re-run is a cold start.

#### Negative Path

- Given `hasRun` is true for a branch, when the next dispatch is constructed, then `hasRun` does
  not cause a resume — having dispatched before does not entitle a branch to resume.
- Given `.pipeline/session-created` exists on disk from a prior process, when a step dispatches,
  then the marker alone never yields `--resume`; the marker is still **persisted**, only its
  consequence changes.
- Given two concurrent branches A and B, when both retry, then neither receives the other's
  session id, and neither receives its own prior id.

### Done When

- [ ] A test asserts branch-member retries cold-start with fresh ids, in both the
      `providerSessions` and scalar paths, and that cross-branch isolation still holds.
- [ ] A test asserts the legacy scalar path cold-starts and that an inherited `session-created`
      marker cannot produce a resume.
- [ ] `session.test.ts:89` (`'returns --resume when session has been created'`) and
      `step-runners.test.ts:791/843-844, 1472/1481-1482, 1671-1698, 2333/2351-2353` are inverted.
- [ ] The `sessionExpired` non-consuming re-run (`group-core.ts:525-537`) still does not
      decrement retry budget.

---

## Story ST-1071-4: Interactive recovery cold-starts on a session that states what failed

**Requirement:** `runInteractive` takes the failure context as an explicit input and renders it
into its prompt, so the operator's session knows what just failed and why without relying on a
resumed conversation.

As an operator breaking a stall or choosing "interactive fix" from the recovery menu, I want the
session that opens to already state which step failed and with what error, so that I do not have
to reconstruct the failure myself.

### Acceptance Criteria

#### Happy Path

- Given the stall-breaker fires in non-auto mode (`conductor.ts:4785`), when the interactive
  session opens, then its prompt names the failed step **and** carries the failure reason — the
  same content that feeds `retryHint` (`conductor.ts:4076`) — and the dispatch is a cold start.
- Given the operator selects "interactive fix" from the recovery menu (`conductor.ts:5808`),
  when the interactive session opens, then it likewise carries the step name and failure reason
  and is a cold start.
- Given the interactive session completes, when the conductor re-checks step completion, then
  the existing recheck-and-break flow is unchanged.

#### Negative Path

- Given no failure reason is available (blank runner output), when the interactive session
  opens, then it still states which step failed and that no reason was captured — it never falls
  back to the bare 12-word stub with an empty system prompt.
- Given `runInteractive` is invoked, when the dispatch is constructed, then it does not pass
  `resume: true` on either the provider-aware or the legacy path.

### Done When

- [ ] A test asserts the prompt handed to the provider by `runInteractive` contains the step
      name and the failure reason, for both call sites.
- [ ] A test asserts `resume: false` on both `runInteractive` paths.
- [ ] A test covers the missing-reason case producing an explicit "no reason captured" statement
      rather than a silent stub.

---

## Story ST-1071-5: Recovery, diagnostics and telemetry survive intact

**Requirement:** The `sessionExpired` classification, the non-budget-consuming `session_reset`
recovery, and #1069's `session_policy` diagnostic keep working with their widened or narrowed
meanings, and `conductor.run.id` stays stable across a feature's attempts and process restarts.

As the conductor, I want the identifier-rejection safety net and per-feature telemetry
correlation to survive a change that removes their most common trigger, so that a cleanup pass
cannot quietly turn a recoverable condition into a hard failure.

### Acceptance Criteria

#### Happy Path

- Given a Claude provider reports "already in use" or "No conversation found", when the
  conductor classifies it, then `sessionExpired` is still set, a `session_reset` event is still
  emitted, and the retry does **not** consume budget.
- Given the same for Codex (`no rollout found`, `thread/resume failed`), when classified, then
  `CODEX_SESSION_EXPIRED_RE` still matches and the same recovery applies.
- Given both providers now declare `supportsSessionResume: false`, when a step dispatches, then
  #1069's `session_policy` diagnostic is emitted **once per step**, not once per invocation.
- Given a feature run that dispatches many cold-started attempts, when spans are emitted, then
  `conductor.run.id` is identical across all of them, and remains so across a process restart
  mid-feature.

#### Negative Path

- Given cold start is now universal, when the implementation removes resume machinery, then
  `SESSION_IN_USE_RE`, `STALE_SESSION_RE`, `CODEX_SESSION_EXPIRED_RE`, the `sessionExpired`
  signal, and the `session_reset` recovery are **not** deleted as dead code.
- Given per-invocation session identity, when an attempt dispatches, then the provider session
  id is **not** written to `.pipeline/conduct-session-id` — that file remains the step runner's
  run identity, so the run id does not churn per attempt.

### Done When

- [ ] Tests assert `sessionExpired` classification and non-consuming `session_reset` recovery
      for both providers after the change.
- [ ] A test asserts `session_policy` fires once per step, not per invocation.
- [ ] A test asserts `conductor.run.id` is stable across multiple cold-started attempts within
      one feature run.
- [ ] A test asserts `.pipeline/conduct-session-id` is not rewritten per provider invocation.

---

## Story ST-1071-6: One retry contract, documented identically for every provider

**Requirement:** Every place that states the session contract says the same thing, with no
provider qualifier and no within-step resume exception — closing the divergence #1069 named.

As a reader of the harness contract, I want one sentence that describes retry session semantics
for all providers, so that the documented behavior and the implemented behavior cannot drift
apart per provider.

### Acceptance Criteria

#### Happy Path

- Given the contract is documented, when a reader consults any of the following, then each
  states that every dispatch — including every retry — starts a fresh session, with no
  provider-conditional wording:
  - `HARNESS.md:237-241`
  - `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md` §2, which #1069
    re-qualified as capability-dependent and this feature resolves to unconditional
  - `adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md`, whose Consequences
    name a divergence this feature closes
  - `.docs/stories/fresh-session-per-step.md` (the "Within-step retries resume the same
    session" story)
  - `.docs/stories/per-step-provider-routing-927.md` ST-927-7
  - `docs/explanation/architecture.md` near `:143`, which #1069 also touches
- Given the change is notable and reader-visible, when it lands, then `CHANGELOG.md`
  `[Unreleased]` carries an entry describing the completed contract.

#### Negative Path

- Given the documentation is updated, when a reader searches for a resume exception, then no
  document still asserts that a within-step retry resumes for any provider — an amended story
  must not leave its old acceptance criteria stated as current.
- Given #1069 annotated some of these same documents rather than rewriting them, when this
  feature amends them, then it does not revert #1069's annotations — it completes them.
- Given no CLI flag, hook wiring, skill symlink target, or `settings.json` schema changes, when
  the release gate runs, then no migration block is required; if the gate's path classifier
  flags a surface anyway, a `.docs/release-waivers/` entry is committed in the same diff rather
  than an empty migration block.

### Done When

- [ ] All six documents above are updated in the same PR as the implementation.
- [ ] `adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md` carries a forward pointer
      recording that its named divergence is closed here.
- [ ] `CHANGELOG.md` `[Unreleased]` has an entry.
- [ ] `test/test_harness_integrity.sh` passes.

---

## Out of scope

- Everything #1069 owns: the `supportsSessionResume` capability itself, Codex's declaration,
  Codex's argv deletion, the capability gate, the `session_policy` diagnostic.
- `bin/conduct` (the shell conductor).
- Deleting `supportsSessionResume` now that no provider declares `true` — the ADR retains it as
  the fail-closed default for adapters added later.
- Measuring the token-cost delta. The ADR predicts cost falls but does not gate on it.
