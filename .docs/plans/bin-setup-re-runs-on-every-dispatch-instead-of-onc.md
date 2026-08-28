# Implementation Plan: Setup once per worktree + per-dispatch lifecycle script

**Date:** 2026-08-26
**Stories:** .docs/stories/bin-setup-re-runs-on-every-dispatch-instead-of-onc.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Gate `bin/setup` behind a content-addressed success marker so re-dispatches of a prepared
worktree skip provisioning, add a `project_setup` spine event naming why setup ran or was
skipped, give setup-triage a force path, and add an optional contained `bin/dispatch-start`
per-dispatch script. 12 tasks.

## Technical Approach

Governing design: adr-2026-08-26-setup-once-per-worktree-marker (APPROVED). All engine work
lives in `src/conductor/src/engine/worktree-prepare.ts` plus the seams that feed it:

- **Marker**: `«worktree»/.daemon/setup-ok.json` — `{ version, setupScriptHash, baseSha,
  preparedAtCommit }`. Written atomically (temp file + `rename`) only after a successful
  `runProjectSetup`; read tolerantly (missing/corrupt/wrong-version ⇒ treated as absent).
  `setupScriptHash` hashes `bin/setup` bytes + mode, following the trait pattern of
  `sessionHookNeedsRepair` in the same module (content + mode comparison drives the re-run
  decision; search hint: `sessionHookNeedsRepair`, `worktree-prepare.ts`). `preparedAtCommit`
  is provenance only — never compared.
- **Gate predicate** (read-only, fail-closed): skip setup iff marker parses at current version
  AND recomputed script hash equals stored AND currently resolved base SHA equals stored.
  Any read/compare failure ⇒ run setup. The base SHA is resolved per dispatch by the caller
  (`resolveWorktreeBase`, `src/conductor/src/engine/daemon-deps.ts:201`) and passed into
  `prepareWorktree` via new opts — the module never invokes git itself for this.
- **Signature widening**: `prepareWorktree(worktreePath, log?, opts?)` opts gain
  `{ baseSha?: string, force?: boolean, events?: ConductorEventEmitter }`. `force: true`
  bypasses the gate (setup always runs; success rewrites the marker). Callers: daemon dispatch
  (`daemon-deps.ts` passes baseSha + the feature emitter), triage `runPrepare` injections
  (`daemon-cli.ts` passes `force: true`), autoresolve (unchanged — cold-start worktree,
  omitted opts degrade to today's behavior: no baseSha ⇒ gate cannot validate ⇒ setup runs).
- **Event**: new `ConductorEvent` variant `project_setup` `{ ran: boolean, reason }`, reason a
  closed union `'marker-valid' | 'no-marker' | 'script-changed' | 'base-moved' |
  'marker-invalid' | 'forced'`; declared in `EVENT_SINKS` (render + persist, no audit,
  matching the `scratch_cleanup_*` daemon-lifecycle precedent); rendered in
  `renderDaemonEventUnsafe`. When no emitter is supplied, fall back to the existing `log` sink
  so non-daemon callers still see the line.
- **Per-dispatch script**: `runDispatchStart` mirrors `runProjectTeardown`'s containment
  (same env, `execa` timeout, absent-script silent no-op, failures logged never thrown), with
  its own `dispatch_start_timeout_seconds` resolver cloned from
  `resolveTeardownTimeoutSeconds` (`resolved-config.ts:497` — same positive-finite fallback
  rules). Invoked at the end of `prepareWorktree`, after the setup gate, on every dispatch.

Sequencing: marker mechanics first (pure, unit-testable), then the gate inside
`prepareWorktree`, then event + caller threading, then triage force, then the dispatch-start
runner, then the acceptance-level proofs the architecture review conditions require.

## Prerequisites

None — no migrations, no new dependencies.

## Tasks

### Task 1: Setup marker read/write + script fingerprint helpers
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing unit tests: `writeSetupMarker` writes valid JSON to `.daemon/setup-ok.json` via temp-file+rename; `readSetupMarker` returns the parsed marker, and returns null for missing file, invalid JSON, and unknown `version`; `hashSetupScript` changes when file bytes change and when mode changes, and returns null when the script is absent.
2. Verify RED.
3. Implement the three helpers in `worktree-prepare.ts` (module-local, exported for tests): marker shape `{ version: 1, setupScriptHash, baseSha, preparedAtCommit }`.
4. Verify GREEN; commit.

**Done when:**
- New unit tests in `test/engine/worktree-prepare.test.ts` cover all listed cases and pass
- `readSetupMarker` never throws on any input tested (missing, corrupt, wrong version) — asserted by tests
- The write path is temp-file + `rename` (visible in the diff), and the target directory is created if absent

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — helpers
- src/conductor/test/engine/worktree-prepare.test.ts — unit tests

**Dependencies:** none

### Task 2: Gate predicate skips setup on a valid marker, fail-closed otherwise
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: with a marker matching current script hash and a `baseSha` opt equal to stored, `prepareWorktree` does not execute `bin/setup` (recording fake script); with no marker, corrupt marker, wrong version, or no `baseSha` opt supplied, setup runs.
2. Verify RED.
3. Implement: widen `prepareWorktree` opts with `baseSha?`; compute the skip decision before `runProjectSetup`; on skip, bypass execution; the decision also yields the reason value for Task 4.
4. Verify GREEN; commit.

**Done when:**
- Test proves a second `prepareWorktree` call against an unchanged prepared dir does not execute the fake setup script
- Fail-closed enumeration is tested: absent marker, corrupt JSON, unknown version, missing `baseSha` opt, absent `bin/setup` hash — each runs (or correctly no-ops) setup rather than skipping on doubt
- The no-`bin/setup` project path is byte-identical to today (existing tests still pass)
- A worktree with extra commits on top of an unchanged base still skips setup (HEAD movement alone never invalidates) — asserted by test

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — gate in prepare flow
- src/conductor/test/engine/worktree-prepare.test.ts — gate tests

**Dependencies:** 1

### Task 3: Successful setup writes the marker; failed setup never does
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: after a passing fake `bin/setup`, `.daemon/setup-ok.json` exists with the current script hash and the supplied `baseSha`; after a failing fake setup (`SetupFailureError` thrown), no marker file exists; a pre-existing marker is not left behind claiming success after a failed forced re-run.
2. Verify RED.
3. Implement: marker write on the success path of `runProjectSetup` only; delete/refresh semantics on forced runs.
4. Verify GREEN; commit.

**Done when:**
- Test asserts marker presence + field values after success, absence after failure
- A forced failing run leaves no marker that would skip the next dispatch — asserted by a follow-up `prepareWorktree` call executing setup again
- `SetupFailureError` shape (message + `outputTail`) is unchanged (existing triage tests pass)

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — marker write placement
- src/conductor/test/engine/worktree-prepare.test.ts — success/failure marker tests

**Dependencies:** 2

### Task 4: `project_setup` spine event with closed reason union
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: emitting `project_setup` requires a sinks declaration (type-level — the `EVENT_SINKS` record is total); `prepareWorktree` given an emitter emits `{ ran: false, reason: 'marker-valid' }` on skip and `{ ran: true, reason: 'no-marker' }` on a cold run; without an emitter the fact still reaches the `log` sink.
2. Verify RED.
3. Implement: add the variant to `src/conductor/src/types/events.ts`, declare `{ render: true, persist: true, audit: false }` in `event-sinks.ts`, add a render arm in `renderDaemonEventUnsafe` (`daemon-cli.ts`), accept `events?` in `prepareWorktree` opts and emit at the gate decision.
4. Verify GREEN; commit.

**Done when:**
- Compilation fails if the sinks declaration is removed (exhaustive-record property demonstrated by the existing pattern; no `any` cast added)
- Tests assert one emitted event per prepare call with the correct `ran`/`reason` for skip and cold-run cases
- The rendered daemon log line contains the reason string; no separate raw `log()` duplicates it when an emitter is present

**Files likely touched:**
- src/conductor/src/types/events.ts — variant
- src/conductor/src/engine/event-sinks.ts — declaration
- src/conductor/src/daemon-cli.ts — render arm
- src/conductor/src/engine/worktree-prepare.ts — emission
- src/conductor/test/engine/worktree-prepare.test.ts — emission tests

**Dependencies:** 2

### Task 5: Reason attribution for every invalidation cause
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests, one per cause: recreated dir (no marker) ⇒ `no-marker`; changed script bytes and separately changed mode ⇒ `script-changed`; changed `baseSha` opt ⇒ `base-moved`; corrupt/wrong-version marker ⇒ `marker-invalid`.
2. Verify RED.
3. Implement the reason derivation in the gate (evidence-derived: each reason comes from the specific failed comparison, never a default string).
4. Verify GREEN; commit.

**Done when:**
- Four tests, one per reason value, each asserting both that setup executed and the exact emitted reason
- An unreadable marker never maps to `no-marker` (distinct `marker-invalid`) — asserted

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — reason derivation
- src/conductor/test/engine/worktree-prepare.test.ts — per-reason tests

**Dependencies:** 3; 4

### Task 6: Daemon dispatch threads baseSha + emitter into prepare
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test (daemon-deps level, faithful fakes): the `prepareWorktree` dep resolves the base SHA per dispatch via the same resolution used for worktree creation and passes the feature emitter, so a dispatch skip lands a persisted `project_setup` event in the feature's events ledger.
2. Verify RED.
3. Implement: in `daemon-deps.ts`, the prepare dep resolves `baseSha` (reusing `resolveWorktreeBase`) and forwards `featureRun` events; widen the `FeatureRunnerDeps.prepareWorktree` signature in `daemon-runner.ts` as needed.
4. Verify GREEN; commit.

**Done when:**
- Test proves a second dispatch of an unchanged prepared worktree executes no setup and persists `project_setup {ran:false}` to the worktree events file
- Base-resolution failure in the dep results in setup running (fail-closed), asserted by test
- Existing daemon-deps call-ordering tests still pass

**Files likely touched:**
- src/conductor/src/engine/daemon-deps.ts — dep wiring
- src/conductor/src/engine/daemon-runner.ts — dep signature
- src/conductor/test/engine/daemon-deps.test.ts — wiring tests

**Dependencies:** 5

### Task 7: `.daemon/` added to the worktree's info/exclude
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: after `prepareWorktree` in a real temp git worktree, `git status --porcelain` shows no `.daemon/` entries even with the marker present; the exclude write remains idempotent across repeated prepares.
2. Verify RED.
3. Implement: extend the `wanted` list in `excludeEngineArtifacts` with `.daemon/`.
4. Verify GREEN; commit.

**Done when:**
- Porcelain test passes in a real git worktree fixture with a written marker
- Repeated prepare calls append no duplicate exclude lines — asserted

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — exclude list
- src/conductor/test/engine/worktree-prepare.test.ts — porcelain test

**Dependencies:** 3

### Task 8: Triage force path — verification always runs real setup
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: `prepareWorktree` with `force: true` executes setup despite a valid marker and emits reason `forced`; both triage `runPrepare` injection sites pass `force: true`; a forced success rewrites the marker.
2. Verify RED.
3. Implement: `force` opt short-circuits the gate; update the `runPrepare` injections in `daemon-cli.ts`.
4. Verify GREEN; commit.

**Done when:**
- Unit test: valid marker + `force: true` ⇒ fake setup executed, reason `forced`
- Both injection sites verified by test or by an assertion on the constructed options (no site left unforced)
- Existing setup-triage unit tests pass unchanged

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — force opt
- src/conductor/src/daemon-cli.ts — runPrepare injections
- src/conductor/test/engine/worktree-prepare.test.ts — force tests

**Dependencies:** 5

### Task 9: Acceptance: triage verification is never marker-short-circuited
**Story:** 4
**Type:** negative-path

**Steps:**
1. Extend the setup-triage acceptance suite: seed a marker whose stored hash matches the current (failing) `bin/setup` and whose baseSha matches — i.e. a marker that WOULD skip — then run the triage verification paths and assert they execute the real script anyway (recording fake counts invocations).
2. Verify RED against the pre-force behavior (skipped verification), then GREEN with Task 8's implementation.
3. Commit.

**Done when:**
- Acceptance test proves the verification prepare executed `bin/setup` at least once more than the initial failing run (invocation counter)
- A dispatch whose setup was skipped by a valid marker never invokes triage — asserted (triage spy not called)
- Suite `test/acceptance/setup-triage-dispatch.acceptance.test.ts` passes in full

**Files likely touched:**
- src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts — acceptance coverage

**Dependencies:** 8

### Task 10: `dispatch_start_timeout_seconds` config resolver
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing unit tests cloned from the teardown-timeout resolver's: default 120; missing/non-numeric/zero/negative/non-finite fall back to default with the same behavior as `resolveTeardownTimeoutSeconds`.
2. Verify RED.
3. Implement `resolveDispatchStartTimeoutSeconds` in `resolved-config.ts` beside the existing `*_timeout_*` resolvers.
4. Verify GREEN; commit.

**Done when:**
- Resolver tests cover default + all five malformed-value fallbacks and pass
- The new key follows the existing resolver naming/shape (same file section, same signature pattern)

**Files likely touched:**
- src/conductor/src/engine/resolved-config.ts — resolver
- src/conductor/test/engine/resolved-config.test.ts — resolver tests

**Dependencies:** none

### Task 11: `runDispatchStart` — contained per-dispatch script runner
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests mirroring the teardown runner's suite: absent script ⇒ silent no-op (no log line); present script runs with `CI=true` + `WORKTREE_NAMESPACE` in the worktree cwd; non-zero exit ⇒ logged, not thrown; timeout ⇒ killed, logged, not thrown.
2. Verify RED.
3. Implement `runDispatchStart` in `worktree-prepare.ts` mirroring `runProjectTeardown`'s containment traits (same env construction, `execa` `all: true` + `timeout`, tail extraction on failure; allowed variation: its own script constant and log prefix), using Task 10's resolver.
4. Verify GREEN; commit.

**Done when:**
- All four contract cases (absent, success, failure, timeout) tested and passing
- No code path in `runDispatchStart` can throw to its caller — failure and timeout tests assert the promise resolves

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — runner
- src/conductor/test/engine/worktree-prepare.test.ts — runner tests

**Dependencies:** 10

### Task 12: Wire dispatch-start into every dispatch, after the setup gate
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: across two consecutive `prepareWorktree` calls where the second skips setup, a recording `bin/dispatch-start` executes both times, after the gate decision.
2. Verify RED.
3. Implement: invoke `runDispatchStart` at the end of `prepareWorktree`.
4. Verify GREEN; commit.

**Done when:**
- Test proves two executions across two prepares (one cold, one skipped) via the recording fake
- A failing dispatch-start script does not change the prepare outcome (prepare resolves; dispatch proceeds in the daemon-deps test)

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — wiring
- src/conductor/test/engine/worktree-prepare.test.ts — cadence test

**Dependencies:** 11; 2

### Task 13: A project with no `bin/setup` reports honestly
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests: preparing a worktree whose project has no `bin/setup` emits `project_setup` with `ran: false` and a reason naming the absent script, for all three entry shapes — no marker and no `baseSha`, no marker with a `baseSha`, and `force: true`; and the daemon renders that event as a skip, not as `project setup ran`.
2. Verify RED — today `setupDecision` (`worktree-prepare.ts:248-262`) returns `ran: true` before `runProjectSetup` discovers the script is absent (`:217`, no-script return at `:776-777`), so a scriptless project emits `{ran: true, reason: 'no-marker'}` on every dispatch and `daemon-cli.ts:2113` prints `· project setup ran (no-marker)`.
3. Implement: probe for the setup script first in `setupDecision` and return `{ ran: false, reason: 'no-script' }` when it is absent, ahead of the `force` and missing-`baseSha` branches — with no script there is nothing for the triage force path of Task 8 to run, so `ran: false` is the honest answer there too.
4. Add `'no-script'` to the `project_setup` reason union (`src/conductor/src/types/events.ts:178`), keeping the union closed as Task 4 requires.
5. Distinguish an absent script from an unreadable one: `hashSetupScript` returning null must not be read as absence at `worktree-prepare.ts:262`, where it means the script changed.
6. Verify GREEN, including the preserved `no bin/setup — skipping project setup` log line and every pre-existing worktree-prepare and daemon-render test unmodified.
7. Commit: "fix(setup): a project with no bin/setup reports ran:false with reason no-script".

**Done when:**
- [ ] A scriptless project emits `project_setup {ran: false, reason: 'no-script'}` for the no-marker, marker-with-baseSha, and forced entry shapes.
- [ ] The daemon renders that event as `project setup skipped (no-script)`.
- [ ] The `no bin/setup — skipping project setup` line is unchanged, and no marker is written for a scriptless project.
- [ ] An unreadable-but-present setup script still reports `script-changed`, not `no-script`.
- [ ] The reason union remains closed and every pre-existing reason keeps its meaning.

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — script probe ahead of the decision branches
- src/conductor/src/types/events.ts — `no-script` reason
- src/conductor/src/daemon-cli.ts — renderer wording for the new reason
- src/conductor/test/engine/worktree-prepare.test.ts — the three entry-shape tests
- src/conductor/test/daemon-render.test.ts — render assertion

**Dependencies:** Task 4; Task 5

## Task Dependency Graph

```
Task 1 ──> Task 2 ──> Task 3 ──> Task 5 ──> Task 6
                │        │          ^
                │        └─> Task 7 │
                └──> Task 4 ────────┘
Task 5 ──> Task 8 ──> Task 9
Task 10 ──> Task 11 ──> Task 12 (also after Task 2)
```

## Integration Points

- After Task 6: a real daemon dispatch skips setup end-to-end with the event persisted.
- After Task 9: the triage lane is proven safe under the marker.
- After Task 12: the full contract (gate + hook) is observable in one dispatch.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s41-1: Remove the test-side masking that hid the forced-prepare wiring defect, without dropping any existing coverage: (a) src/conductor/test/engine/daemon-cli.test.ts:71-83 — keep the existing `force: true` / `verbose: true` option-shape assertions (plan Task 8's 'no site left unforced' proof) and extend them to require the resolved `baseSha` and the passed `events` emitter; (b) src/conductor/test/acceptance/setup-once-per-worktree.acceptance.test.ts:193-202 and :238-247 — re-point both cases at the real `createForcedSetupPrepare(prepareWorktree, ...)` with the production resolver/emitter arguments instead of the baseSha+events-injecting lambda, preserving every existing assertion in both (invocation counts, persisted `forced` event, park/`setup-still-failing`, quarantineRef, post-failure marker ENOENT — plan Task 9's delivered coverage); (c) add the missing forced-SUCCESS case: after a cold prepare writes a valid marker, run the forced triage prepare against a PASSING bin/setup and assert setup executed again AND the marker was rewritten with the resolved base, which is the criterion's unproven half.
**Gate:** prd-audit
**Rationale:** Every existing force test injects the arguments production omits, so the AB-2/AB-3 defects shipped invisibly: src/conductor/test/engine/daemon-cli.test.ts:71-83 asserts the constructed options are exactly `{ verbose: true, force: true }`, and both acceptance cases wrap the helper in `(path, log, options) => prepareWorktree(path, log, { ...options, baseSha, events })` (src/conductor/test/acceptance/setup-once-per-worktree.acceptance.test.ts:193-202 and :238-247), adding the very inputs `createForcedSetupPrepare` never supplies — and both exercise only a forced FAILURE, so the forced-success marker rewrite is uncovered entirely. This is assertion strength missing inside plan Task 8's existing Done-when ('Both injection sites verified by test or by an assertion on the constructed options') and Task 9's acceptance coverage, not a planning omission. Sibling sweep: those three sites are the only tests that construct the forced prepare (grep `createForcedSetupPrepare` across src/ and test/ returns exactly daemon-cli.ts:567,:1206 plus these); no other test reads the marker's fields beyond the acceptance `toContain(baseSha)` check at :225, which stays.
**Criterion:** S4.1
**Parent task:** 8
**Done when:**
- S4.1 is satisfied by this task.
