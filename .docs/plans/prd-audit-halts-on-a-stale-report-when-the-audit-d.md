# Implementation Plan: Engine-stamped run identity for SHIP-tail verdict artifacts (#1838)

**Date:** 2026-08-25
**Stories:** .docs/stories/prd-audit-halts-on-a-stale-report-when-the-audit-d.md
**Conflict check:** Clean as of 2026-08-25

## Summary

Adds an engine-stamped per-dispatch run identity to the prd_audit, architecture_review_as_built,
and manual_test verdict sidecars, routes every reader through one identity helper, adds a
post-dispatch write handshake, and makes identity mismatch a typed rerun-then-self-describing-halt.
15 tasks.

## Technical Approach

Design authority: adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity (D1–D9).

- **Identity source (D1/D2):** the conductor mints a run id at the same seam that sets
  `currentAttemptStartedAt` (`src/conductor/src/engine/conductor.ts`, the pre-dispatch capture)
  and holds it as `currentRunId` for the dispatch's lifetime. Task 2 first verifies whether the
  provider-lifecycle `attempt.id` is reachable at that seam; if it is, the conductor adopts it as
  `currentRunId` (single authority); if not, the conductor-minted id is passed down into the
  dispatch so lifecycle logging and the stamp share one value. Either way there is exactly one id
  per dispatch and the provider never supplies it.
- **Stamp carrier:** the existing `GateCodeStampMarker` sidecars
  (`.pipeline/prd-audit-code-stamp.json`, `.pipeline/architecture-review-as-built-code-stamp.json`,
  and a new `.pipeline/manual-test-code-stamp.json` beside the #367 fail-evidence marker) gain an
  additive `runId` field. Unlike `codeStamp` (PASS-path only), `runId` is written at the
  **settle boundary on every terminal outcome**, merging onto existing sidecar content
  (never clobbering `codeStamp`), best-effort-write but loudly logged on failure.
- **One reader (D4):** a new helper in `src/conductor/src/engine/gate-code-validity.ts`
  (`verdictProducedByRun`) answers "was this gate's verdict set produced by run X?" with the
  closed fallback ladder: stamped-and-matching → yes; stamped-and-mismatched → no (typed
  `stale-run-identity`); unstamped/corrupt sidecar → mtime behavior exactly as today. The
  completion predicates, `classifyPrdAuditGaps`, the #817 preserve path, and the stale-artifact
  sweep all consult it.
- **Handshake (D3):** after the dispatch settles and before `checkStepCompletion`, the conductor
  verifies the gate's declared outputs exist and pass `verdictProducedByRun` for `currentRunId`.
  Failure produces a typed completion result (routeClass `absent`) whose reason names each
  missing/stale artifact, the expected run id, and the found id/mtime — never the stale findings.
- **Retry/halt (D5):** `classifyRetryDecision` already maps `absent` ⇒ rerun; the mismatch facet
  rides that mapping unchanged. Exhaustion goes through `writeHaltMarker(..., 'needs-human')`
  with the same artifact+identities reason.
- **Testing pattern:** follow the existing completion-predicate test style in
  `src/conductor/test/` around session-fresh verdict freshness and gate-code-validity (search
  hints: `verdictFreshness`, `gateVerdictStillValid`, `PRD_AUDIT_CODE_STAMP` in test files);
  faithful fakes at the provider boundary, no real LLM calls (repo test-isolation policy).

## Prerequisites

None — no migrations, no new dependencies, no config keys.

## Tasks

### Task 1: Add `runId` to the gate stamp marker type and add the manual_test sidecar path
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `GateCodeStampMarker` round-trips `{ codeStamp, runId }`, and a
   `MANUAL_TEST_CODE_STAMP` constant equals `.pipeline/manual-test-code-stamp.json`
2. Verify test fails (RED)
3. Implement: add optional `runId?: string` to `GateCodeStampMarker`
   (`src/conductor/src/engine/artifacts.ts`), export `MANUAL_TEST_CODE_STAMP`
4. Verify test passes (GREEN)
5. Commit: "feat(artifacts): runId field on gate stamp markers; manual_test sidecar path"

**Done when:**
- [ ] `GateCodeStampMarker` compiles with `runId` optional; existing #817 tests pass unchanged
- [ ] `MANUAL_TEST_CODE_STAMP` exported and covered by the new test

**Files:**
- src/conductor/src/engine/artifacts.ts — marker type + constant
- src/conductor/test — new/updated marker tests

**Dependencies:** none

### Task 2: Conductor holds one run id per verdict dispatch
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Verify (bounded, ~5 min read): whether provider-lifecycle `attempt.id` is reachable at the
   conductor seam that sets `currentAttemptStartedAt`. Record the answer in the commit message.
2. Write failing test: during a verdict-step dispatch, `completionCtx` carries a non-empty
   `attemptRunId` that is stable for the dispatch and differs between two dispatches
3. Verify test fails (RED)
4. Implement: `currentRunId` set beside `currentAttemptStartedAt` (adopting `attempt.id` if
   reachable per step 1, else conductor-minted and passed into the dispatch), cleared in the
   same `finally`; threaded into `completionCtx` as `attemptRunId`
5. Verify test passes (GREEN); commit "feat(conductor): per-dispatch run identity in completion context"

**Done when:**
- [ ] Two sequential dispatches observe two distinct `attemptRunId` values (test asserts inequality)
- [ ] `attemptRunId` is `undefined` outside an in-flight dispatch (resume/backstop path test)
- [ ] Exactly one id authority per dispatch: the lifecycle id and the stamp id are the same value, or the lifecycle seam is proven unreachable in the step-1 note

**Files:**
- src/conductor/src/engine/conductor.ts — currentRunId lifecycle
- src/conductor/src/engine/artifacts.ts — CompletionContext field
- src/conductor/test — dispatch identity tests

**Dependencies:** 1

### Task 3: Stamp `runId` at settle, every terminal outcome, all three gates
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: after a prd_audit dispatch settles (success AND provider-error outcomes),
   the sidecar carries `runId === attemptRunId` while any pre-existing `codeStamp` is preserved
2. Verify test fails (RED)
3. Implement: an engine-authored settle-boundary write for
   prd_audit / architecture_review_as_built / manual_test — merge `runId` onto the sidecar
   (read-modify-write, tolerate missing/corrupt as empty), on the per-branch settle path so
   validation-group branches stamp before the join reads verdicts
4. Verify test passes (GREEN); commit "feat(conductor): engine stamps run identity at verdict settle"

**Done when:**
- [ ] Settle on success, error, and halt outcomes all leave `runId` in the sidecar (three cases enumerated in tests)
- [ ] A pre-seeded `codeStamp` survives the merge byte-for-byte
- [ ] A validation-group test proves each branch's sidecar carries its `runId` before the join evaluates

**Files:**
- src/conductor/src/engine/conductor.ts — settle-boundary stamp call
- src/conductor/src/engine/artifacts.ts — merge-write helper
- src/conductor/test — settle stamp tests

**Dependencies:** 2

### Task 4: Provider echo ignored; unwritable sidecar is loud, not fatal
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: a provider output whose text embeds `"runId": "bogus"` leaves the sidecar
   with the engine's value; an unwritable `.pipeline/` yields a logged warning for the branch and
   no throw, and the verdict is NOT treated as identity-stamped
2. Verify test fails (RED)
3. Implement: ensure the stamp writer never parses provider text for identity; on write failure,
   emit a warning line naming the sidecar and leave the artifact unstamped (which Task 5's
   ladder then treats as mtime-fallback)
4. Verify test passes (GREEN); commit "fix(conductor): identity stamp is engine-only and fails loud"

**Done when:**
- [ ] Doctored-provider-output test passes (engine value wins, no validation of the echo)
- [ ] Unwritable-sidecar test passes: warning emitted, no throw, verdict evaluated on the unstamped path
- [ ] Concurrent-branch test: two branches stamping their own sidecars do not interfere (distinct files)

**Files:**
- src/conductor/src/engine/conductor.ts — stamp failure handling
- src/conductor/test — echo + write-failure tests

**Dependencies:** 3

### Task 5: `verdictProducedByRun` — the single identity reader
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests for the closed ladder: (a) stamped+matching ⇒ `match`; (b) stamped+other
   id ⇒ `stale-run-identity`; (c) no sidecar / no `runId` field / corrupt JSON ⇒ `unstamped`
   (caller falls back to mtime); (d) no expected id supplied (legacy ctx) ⇒ `unstamped`
2. Verify tests fail (RED)
3. Implement `verdictProducedByRun(dir, gate, expectedRunId)` in
   `src/conductor/src/engine/gate-code-validity.ts`, returning the typed three-state result;
   wire the stale-artifact sweep's guard to consult it alongside `gateVerdictStillValid`
4. Verify tests pass (GREEN); commit "feat(gate-code-validity): verdictProducedByRun identity ladder"

**Done when:**
- [ ] All four ladder cases pass as enumerated unit tests (this closes "fail-closed": the ladder's complete case list is (a)–(d); nothing else exists)
- [ ] The sweep consults the helper: a test shows the sweep and the readers agree on the same artifact
- [ ] Helper never throws on corrupt input (corrupt-JSON case returns `unstamped`)

**Files:**
- src/conductor/src/engine/gate-code-validity.ts — helper
- src/conductor/src/engine/artifacts.ts — sweep wiring
- src/conductor/test — ladder tests

**Dependencies:** 1

### Task 6: Post-dispatch write handshake for the three verdict gates
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: a dispatch that wrote its report fresh passes the handshake; a dispatch
   that left prior-lap artifacts (the 2026-08-23 shape) is scored a failed attempt whose reason
   names `.pipeline/prd-audit.md`, the expected run id, and the found id/mtime
2. Verify test fails (RED)
3. Implement: in the conductor step loop, after settle and before `checkStepCompletion`, for the
   three verdict steps evaluate `verdictProducedByRun` over the gate's declared outputs; on
   mismatch produce the typed not-done result with `routeClass: 'absent'` semantics; record the
   handshake observation on every terminal outcome
4. Verify test passes (GREEN); commit "feat(conductor): post-dispatch verdict write handshake"

**Done when:**
- [ ] The 2026-08-23 replay test passes: failed attempt, reason contains artifact path + both identities, and asserts the stale report's finding text ("FR-17"-style rows) appears nowhere
- [ ] Handshake runs for all three gates in serial mode and on validation-group branches (test matrix)
- [ ] Handshake observation recorded on success, error, and halt outcomes

**Files:**
- src/conductor/src/engine/conductor.ts — handshake in step loop + validation-group branch path
- src/conductor/test — handshake tests

**Dependencies:** 3, 5

### Task 7: Handshake negatives — partial write, corrupt input, never-throw
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) report rewritten but marker absent ⇒ reason names specifically the
   marker; (b) corrupt sidecar during handshake ⇒ attempt not verified (fail-closed for the
   verdict) and the engine does not crash; (c) handshake evaluation wrapped so no exception
   escapes the step loop
2. Verify tests fail (RED)
3. Implement the partial-write enumeration (per-artifact check, not all-or-nothing) and the
   catch-to-not-verified wrapper
4. Verify tests pass (GREEN); commit "fix(conductor): handshake partial-write and corrupt-input paths"

**Done when:**
- [ ] Partial-write test names exactly the missing artifact, not the whole set
- [ ] Corrupt-input test: verdict not trusted, process alive, warning emitted
- [ ] Fuzz-ish test over empty/garbage sidecars produces no uncaught exception

**Files:**
- src/conductor/src/engine/conductor.ts — handshake internals
- src/conductor/test — negative handshake tests

**Dependencies:** 6

### Task 8: `classifyPrdAuditGaps` reads only current-run verdicts
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test: a same-session, earlier-lap report (stamped with an older run id) with
   blocking FR rows yields zero blocking classifications; a current-run stamped report with
   blocking rows classifies exactly as today
2. Verify test fails (RED)
3. Implement: `classifyPrdAuditGaps` gains the expected-run-id input (threaded from its
   conductor call sites) and filters files through `verdictProducedByRun` (unstamped files keep
   the existing session-mtime filter)
4. Verify test passes (GREEN); commit "fix(artifacts): classifyPrdAuditGaps is run-identity aware"

**Done when:**
- [ ] Stale-lap regression test passes (zero blocking rows from the old report)
- [ ] Current-run behavior unchanged (existing classify tests green)
- [ ] Both conductor call sites pass the expected run id (diff shows no session-only call remains)

**Files:**
- src/conductor/src/engine/artifacts.ts — classifyPrdAuditGaps signature + filter
- src/conductor/src/engine/conductor.ts — call sites
- src/conductor/test — classify identity tests

**Dependencies:** 5

### Task 9: Completion predicates and the #817 preserve path judge identity
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) prd_audit predicate with a stale-run-identity report returns
   not-done with a reason naming artifact + expected + found identity and quoting no findings;
   (b) the preserve path holding a PASS sidecar over an older-lap blocking report does not
   return done; (c) same for architecture_review_as_built and manual_test predicates
2. Verify tests fail (RED)
3. Implement: predicates consult `verdictProducedByRun` before content parsing; where a stamp
   exists identity supersedes the mtime attempt-floor (amended #817 D5); unstamped keeps
   today's `verdictFreshnessComparand` path verbatim
4. Verify tests pass (GREEN); commit "fix(artifacts): verdict predicates judge run identity first"

**Done when:**
- [ ] The three predicates' stale-identity reasons match the agreed format (artifact, expected id, found id/mtime) in tests
- [ ] Preserve-path stale-read regression test passes
- [ ] Existing session-fresh + #817 test suites pass unchanged for unstamped artifacts

**Files:**
- src/conductor/src/engine/artifacts.ts — predicate wiring
- src/conductor/test — predicate identity tests

**Dependencies:** 5

### Task 10: Retry classifier: mismatch is `absent` ⇒ rerun; matching-adverse still routes
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) handshake/predicate "no verdict for this run" ⇒
   `classifyRetryDecision` returns rerun; (b) a matching-stamp adverse verdict ⇒ route
   (named-route); (c) rewording the reason string does not change either outcome (typed facet)
2. Verify tests fail (RED)
3. Implement: thread the typed identity facet into the classifier inputs
   (`prdAuditNonClean` computed from the identity-aware Task 8 classify; `inputsUnchanged`
   keyed on run identity where stamps exist, mtime otherwise)
4. Verify tests pass (GREEN); commit "fix(retry): stale-run-identity classifies as absent, reruns"

**Done when:**
- [ ] The three classifier tests pass; reason-text mutation test proves no string matching
- [ ] No new retry budget, config key, or event member in the diff
- [ ] Existing #646 classifier tests pass unchanged

**Files:**
- src/conductor/src/engine/artifacts.ts — classifier inputs
- src/conductor/src/engine/conductor.ts — facet threading
- src/conductor/test — classifier tests

**Dependencies:** 6, 8

### Task 11: Exhaustion halt names the artifact and both identities
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing test: retries exhausted with the verdict still missing/mismatched produces a
   `needs-human` halt via `writeHaltMarker` whose reason contains the step, artifact path,
   expected run id, and found id/mtime — and none of the stale report's finding rows
2. Verify test fails (RED)
3. Implement: the exhaustion writer composes the reason from the typed handshake observation
4. Verify test passes (GREEN); commit "feat(conductor): self-describing stale-verdict halt"

**Done when:**
- [ ] Halt-reason content test passes (all four elements present, stale findings absent)
- [ ] Halt goes through the single `writeHaltMarker` seam (no direct HALT write in the diff), so the committed halt record carries the same detail
- [ ] Halt class is `needs-human` in the test

**Files:**
- src/conductor/src/engine/conductor.ts — exhaustion halt writer
- src/conductor/test — halt reason tests

**Dependencies:** 10

### Task 12: Recovery integration — clear the halt, nothing else
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing integration test: seed a worktree with prior-lap stale report+marker+sidecar
   and a cleared halt; re-dispatch runs a fresh audit (fake provider writes stamped outputs)
   and the run completes without any manual `.pipeline/` deletion; a second variant has the
   fresh audit write a stamped blocking verdict and asserts it is honored (routes/halts on the
   FRESH findings)
2. Verify test fails (RED)
3. Implement any residual gap the test exposes (expected: none beyond Tasks 6–11 wiring)
4. Verify test passes (GREEN); commit "test(engine): #1838 recovery is clear-and-rerun"

**Done when:**
- [ ] Recovery test passes with zero deletions of pre-seeded `.pipeline/` files by the test itself
- [ ] Fresh-blocking-verdict variant passes (no whitewash)

**Files:**
- src/conductor/test — recovery integration test

**Dependencies:** 9, 11

### Task 13: Unstamped fallback and kill-switch parity
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) unstamped fresh artifact passes exactly as today; (b) unstamped
   stale artifact fails exactly as today (mtime floor); (c) with the existing gate-code-validity
   kill-switch off, no identity comparison occurs (helper not consulted) and the pre-change
   suites pass end-to-end
2. Verify tests fail (RED)
3. Implement: gate the identity ladder behind `resolveGateCodeValidityConfig(ctx.config).enabled`
   (the existing flag — no new key)
4. Verify tests pass (GREEN); commit "feat(gate-code-validity): identity checking honors the existing kill-switch"

**Done when:**
- [ ] Fallback parity tests (a)+(b) pass and are byte-comparable to pre-change expectations
- [ ] Kill-switch test proves zero identity reads with the flag off
- [ ] No new config key in the diff

**Files:**
- src/conductor/src/engine/gate-code-validity.ts — flag gating
- src/conductor/test — fallback/kill-switch tests

**Dependencies:** 5, 9

### Task 14: manual_test composes with #367 whitewash machinery
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) FAIL→PASS flip with HEAD unmoved still blocks even when the run
   identity matches; (b) a results file whose latest `## Attempt N` section predates this
   dispatch (stamp mismatch) scores "no fresh verdict" instead of re-judging the old section;
   (c) existing #367 suites pass with stamping enabled
2. Verify tests fail (RED)
3. Implement: manual_test predicate consults the identity helper before latest-section judging;
   whitewash guard evaluated regardless of identity outcome
4. Verify tests pass (GREEN); commit "fix(artifacts): manual_test identity composes with whitewash guard"

**Done when:**
- [ ] Whitewash-precedence test passes (guard wins over matching stamp)
- [ ] Stale-section test passes
- [ ] Full existing #367 test set green

**Files:**
- src/conductor/src/engine/artifacts.ts — manual_test predicate
- src/conductor/test — manual_test composition tests

**Dependencies:** 3, 5

### Task 15: Telemetry rides the existing spine
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) an identity-based freshness decision emits the existing
   `verdict_freshness` StepEvent with `floorSource: 'run-identity'`; (b) the retry decision on a
   mismatch emits the existing `retry_decision` event with the extended signal value; (c) the
   `EVENT_SINKS` record compiles with no new event member
2. Verify tests fail (RED)
3. Implement: extend the two vocabularies; no new `ConductorEvent` union member
4. Verify tests pass (GREEN); commit "feat(events): run-identity values on verdict_freshness and retry_decision"

**Done when:**
- [ ] Both events observed in tests with the new values, persisted via the existing persister path
- [ ] Diff adds no `ConductorEvent` union member and no new sink entry
- [ ] Dashboard/log renderers tolerate the new values (render test or snapshot)

**Files:**
- src/conductor/src/types/events.ts — vocabulary extension
- src/conductor/src/engine/artifacts.ts — emission points
- src/conductor/test — event tests

**Dependencies:** 9, 10

## Task Dependency Graph

```
1 ─▶ 2 ─▶ 3 ─▶ 4
│         3 ─▶ 6 ─▶ 7
└──▶ 5 ───────▶ 6
     5 ─▶ 8 ─▶ 10 ─▶ 11 ─▶ 12
     5 ─▶ 9 ────────────▶ 12
     6 ─▶ 10
     5,9 ─▶ 13
     3,5 ─▶ 14
     9,10 ─▶ 15
```

## Integration Points

- After Task 6: the 2026-08-23 incident shape is reproducible end-to-end in a test (handshake
  catches the non-write).
- After Task 11: the full mismatch lifecycle (stamp → handshake → rerun → halt) is testable.
- After Task 12: operator-visible recovery behavior is proven.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
