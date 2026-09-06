# Implementation Plan: Bounded mechanical remediation in the self-host release gate

**Date:** 2026-09-06
**Source:** jstoup111/ai-conductor#658
**Stories:** .docs/stories/ship-halts-on-model-table-drift-whose-failure-mess.md
**Conflict check:** Clean as of 2026-09-06 (one degrading conflict accepted; companion PR carries the foreign story edit)
**Architecture:** amended adr-2026-06-30-halt-based-release-gates (decisions 1–3, 2026-09-06); architecture-review-2026-09-06-ship-halts-on-model-table-drift-whose-failure-mess

## Summary

Thirteen tasks give the self-host release gate a one-shot mechanical-remediation lane: the integrity suite declares a deterministic remediation per failed check, the engine runs only allowlisted commands, commits, re-runs the suite once, and everything else halts `needs-human` with the outcome on the event spine.

## Technical Approach

- **Record channel.** `test/test_harness_integrity.sh` gains an optional third `assert` argument, the remediation command. When the environment variable `HARNESS_INTEGRITY_REMEDIATION_OUT` names a file, the suite truncates that file at start and, for every *failing* assert, appends one tab-separated line `check<TAB>remediation<TAB>deterministic` (`deterministic` is `true` when a command was declared, else `false` with an empty command). Passing asserts and warn-skips (`warn_check`) write nothing. Writes are `2>/dev/null || true` so an unwritable file never changes the suite's own verdict. Without the variable the suite is byte-for-byte unchanged. TSV, not JSON: bash emits it with one `printf`, descriptions never contain tabs, and the engine parser can reject anything that is not exactly three fields.
- **Engine decision, pure and LLM-free** (idiom of `classifyRetryDecision` in `artifacts.ts`): new module `src/conductor/src/engine/self-host/integrity-remediation.ts` exports `MECHANICAL_REMEDIATION_ALLOWLIST` (`readonly ['bin/generate-model-table', 'bin/generate-docs-guard-hook']`), `parseRemediationRecords(text)` (three fields or the line is `malformed`), and `decideMechanicalRemediation(records)` returning a closed union `{ kind: 'run'; commands; checks } | { kind: 'declined'; reason: 'undeclared' | 'not-allowlisted' | 'malformed'; detail }`. Matching is `===` against the allowlist entry; no prefix, glob, or argument tolerance.
- **Gate orchestration** lives in `release-gate.ts`. `IntegrityExec` gains an optional third `env` parameter that `realIntegrityExec` passes through; `runIntegritySuite` supplies `HARNESS_INTEGRITY_REMEDIATION_OUT=<harnessRoot>/.pipeline/integrity-remediation.tsv` and reads the file after a non-zero exit. `runReleaseArtifactGate` on integrity failure calls `attemptMechanicalRemediation(deps)`: decide → for each command `execa(join(harnessRoot, cmd), { cwd: harnessRoot })` → `git add -A`+`git diff --cached --quiet` (no-op → skip commit) → `git commit --no-verify` with `withEngineCommitEnv()` (the exact sequence of `commitHaltRecordChange` in `halt-record.ts`, which BUILD should rediscover by that name) → one more `exec` → verdict. Any non-ok step returns a distinct reason and the existing `halt()` closure writes it via `writeSelfHostHalt`, which already hardcodes class `needs-human`. All git and command execution goes through injectable deps (`runCommand`, `git`) so unit tests never run the real suite or generators.
- **Events** are four new `ConductorEvent` variants — `integrity_remediation_attempted | succeeded | failed | declined` — each declared in `EVENT_SINKS` with `persist: true`. The gate's `events` emitter is optional (as in `writeSelfHostHalt`); when absent nothing is emitted and nothing throws.
- **Sequencing.** Suite first (Tasks 1–2) so the fixture-driven shell test exists before the engine reads records; then the pure decision module and event types (3–4, parallel); then the gate wiring and happy path (5–6); then negative paths (7–9); then events and rendering (10–11); the migration-ordering proof (12) last.

## Prerequisites

- None beyond the checkout. `src/conductor/node_modules` must be installed for the vitest tasks; the shell test in Task 1 needs only bash.

## Tasks

### Task 1: Suite emits a remediation record per failing assert
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: new `test/test_integrity_remediation_records.sh` sources the `assert` helper from `test/test_harness_integrity.sh` (or invokes the suite with a stub check), sets `HARNESS_INTEGRITY_REMEDIATION_OUT` to a temp file pre-seeded with a stale line, calls `assert "a" 1 "bin/x"`, `assert "b" 1`, `assert "c" 0 "bin/y"`, and asserts the file holds exactly `a<TAB>bin/x<TAB>true` and `b<TAB><TAB>false`; a second case points the variable at a path under a read-only directory and asserts the FAIL line is still printed and the exit status is unchanged; a third case unsets the variable and asserts output is identical to a control run.
2. Verify test fails (RED).
3. Implement: `assert() { local desc=$1 result=$2 remediation=${3:-}; ... }`; on failure, `[ -n "${HARNESS_INTEGRITY_REMEDIATION_OUT:-}" ] && printf '%s\t%s\t%s\n' "$desc" "$remediation" "$([ -n "$remediation" ] && echo true || echo false)" >>"$HARNESS_INTEGRITY_REMEDIATION_OUT" 2>/dev/null || true`; at suite start, `: >"$HARNESS_INTEGRITY_REMEDIATION_OUT" 2>/dev/null || true` when set.
4. Verify test passes (GREEN); `bash -n` and `test/lint_shell.sh` pass.
5. Commit with message: "test(integrity): emit tab-separated remediation records for failing asserts".

**Done when:**
- `test/test_integrity_remediation_records.sh` passes and asserts the two-record file content, the stale-line truncation, the unwritable-path tolerance, and the unset-variable byte-identical output
- `assert` accepts an optional third argument and every existing two-argument call site is unmodified in the diff
- `bash -n test/test_harness_integrity.sh` and `test/lint_shell.sh` exit 0

**Files likely touched:**
- `test/test_harness_integrity.sh` — `assert` gains the optional third argument and the record write; truncation at start
- `test/test_integrity_remediation_records.sh` — new shell test

**Dependencies:** none

### Task 2: The two regenerable checks declare their remediation
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: extend `test/test_integrity_remediation_records.sh` with a fixture copy of the harness where HARNESS.md's generated table has one hand-edited row; run the full suite with the variable set and assert the file contains exactly one `true` record whose command is `bin/generate-model-table` and whose check text starts with `bin/generate-model-table --check`; a second fixture drifts `hooks/claude/docs-guard.sh` and asserts one `true` record naming `bin/generate-docs-guard-hook`; a third case runs on a clean fixture and asserts the file is empty and exit 0; a fourth case removes `src/conductor/node_modules` from the fixture and asserts no record mentions `generate-model-table`.
2. Verify test fails (RED).
3. Implement: pass `bin/generate-model-table` as the third argument in the 5a drift branch (`model_table_exit` = 1) and `bin/generate-docs-guard-hook` in the docs-guard drift branch; leave the environment-error (`2`) branches without a remediation.
4. Verify test passes (GREEN).
5. Commit with message: "test(integrity): declare regenerate remediations for model-table and docs-guard drift".

**Done when:**
- `test/test_integrity_remediation_records.sh` asserts exactly one deterministic record naming `bin/generate-model-table` for the drifted-table fixture and exactly one naming `bin/generate-docs-guard-hook` for the drifted-hook fixture
- The clean fixture yields an empty record file and exit 0, and the fixture without `src/conductor/node_modules` yields no record for the model-table check
- The environment-error branches of both checks pass no remediation argument in the diff

**Files likely touched:**
- `test/test_harness_integrity.sh` — third argument on the two drift asserts
- `test/test_integrity_remediation_records.sh` — fixture cases

**Dependencies:** 1

### Task 3: Pure record parser, allowlist, and remediation decision
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test: `src/conductor/test/engine/self-host/integrity-remediation.test.ts` asserts `parseRemediationRecords` turns two well-formed lines into two records and marks a two-field line and a four-field line `malformed`; `decideMechanicalRemediation` returns `{ kind: 'run' }` with both commands when both allowlisted records are present; `declined/undeclared` naming the check when any record is `false`; `declined/not-allowlisted` naming the command verbatim for `bin/generate-model-table --force`, `../bin/generate-model-table`, and `bin/other`; `declined/malformed` naming the line for a malformed record even when another record is allowlisted; and `MECHANICAL_REMEDIATION_ALLOWLIST` deep-equals exactly the two expected strings.
2. Verify test fails (RED).
3. Implement `src/conductor/src/engine/self-host/integrity-remediation.ts` with the types and functions named in Technical Approach; the allowlist is `as const` and matching uses `includes` on exact strings.
4. Verify test passes (GREEN).
5. Commit with message: "feat(self-host): pure mechanical-remediation decision with exact-string allowlist".

**Done when:**
- `integrity-remediation.test.ts` passes and asserts declined verdicts for an undeclared check, for `bin/generate-model-table --force`, for `../bin/generate-model-table`, and for a malformed record, each naming the offending check, command, or line
- `MECHANICAL_REMEDIATION_ALLOWLIST` is a readonly constant equal to exactly `['bin/generate-model-table', 'bin/generate-docs-guard-hook']` and the decision function performs no prefix, glob, or argument matching
- The module imports nothing from `execa`, `node:fs`, or `node:child_process`

**Files likely touched:**
- `src/conductor/src/engine/self-host/integrity-remediation.ts` — new module
- `src/conductor/test/engine/self-host/integrity-remediation.test.ts` — new unit test

**Dependencies:** none

### Task 4: Self-heal event variants on the spine
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test: extend `src/conductor/test/event-sink-registry.test.ts` (or add a sibling case) asserting `EVENT_SINKS` has entries for `integrity_remediation_attempted`, `integrity_remediation_succeeded`, `integrity_remediation_failed`, and `integrity_remediation_declined`, each with `persist: true`; add a type-level assertion file case that omitting one from `EVENT_SINKS` fails `tsc` (the existing exhaustiveness pattern in that test).
2. Verify test fails (RED).
3. Implement: add the four variants to the `ConductorEvent` union in `src/conductor/src/types/events.ts` (`attempted`: `commands: string[]`, `checks: string[]`; `succeeded`: `commands`; `failed`: `reason: string`, `stillFailing: string[]`; `declined`: `reason: 'undeclared' | 'not-allowlisted' | 'malformed'`, `detail: string`) and declare each in `EVENT_SINKS` with `render: true, persist: true, audit: true, otel: false`.
4. Verify test passes (GREEN) and `npm run typecheck` (or the package's tsc script) passes.
5. Commit with message: "feat(events): integrity_remediation_* variants with persisted sinks".

**Done when:**
- The `ConductorEvent` union contains the four `integrity_remediation_*` variants with the fields listed in Steps
- `event-sink-registry.test.ts` passes asserting each of the four has `persist: true`
- The package typecheck passes, and removing any one of the four `EVENT_SINKS` entries makes it fail (the registry type is `Record<ConductorEvent['type'], SinkDeclaration>`)

**Files likely touched:**
- `src/conductor/src/types/events.ts` — union variants
- `src/conductor/src/engine/event-sinks.ts` — four declarations
- `src/conductor/test/event-sink-registry.test.ts` — assertions

**Dependencies:** none

### Task 5: The gate runs the suite with the record channel and reads records on failure
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: in `src/conductor/test/engine/self-host/release-gate.test.ts`, assert `runIntegritySuite` calls the injected `exec` with an `env` whose `HARNESS_INTEGRITY_REMEDIATION_OUT` ends in `.pipeline/integrity-remediation.tsv` under `harnessRoot`; on non-zero exit the returned verdict carries `records` parsed from that file via an injected `readText`; on exit 0 no `readText` call is made; when the file is absent after a failure the verdict carries an empty `records` array.
2. Verify test fails (RED).
3. Implement: extend `IntegrityExec` with an optional `env: NodeJS.ProcessEnv` third parameter passed to `execa`; `runIntegritySuite` computes the path, passes the env, and on failure reads and parses the file; the failing verdict type becomes `{ ok: false; reason; records: RemediationRecord[] }` while `ok: true` is unchanged.
4. Verify test passes (GREEN); existing `runIntegritySuite` tests still pass.
5. Commit with message: "feat(self-host): integrity suite exposes remediation records to the gate".

**Done when:**
- `release-gate.test.ts` asserts the `env` passed to `exec` names `.pipeline/integrity-remediation.tsv` under `harnessRoot`
- A non-zero exit yields a verdict whose `records` equals the parsed file content, and an absent file yields `records: []`
- The four pre-existing `runIntegritySuite` cases pass unchanged

**Files likely touched:**
- `src/conductor/src/engine/self-host/release-gate.ts` — `IntegrityExec` env, record path, record read
- `src/conductor/test/engine/self-host/release-gate.test.ts` — cases

**Dependencies:** 3

### Task 6: Allowlisted remediation runs, commits, re-runs once, and passes
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: in `release-gate.test.ts`, drive `runReleaseArtifactGate` with an `exec` fake that fails first with one `bin/generate-model-table` record then passes, a `runCommand` fake recording `(command, cwd)`, and a `git` fake recording argv; assert `runCommand` was called exactly once with `join(harnessRoot, 'bin/generate-model-table')` and `cwd === harnessRoot`, `git` saw `add -A`, `diff --cached --quiet`, then `commit --no-verify -m <msg>` with `CONDUCT_ENGINE_COMMIT: '1'` in its env, the commit message contains `bin/generate-model-table` and the check text, `exec` was called exactly twice, and the verdict is `{ ok: true }`; a second case with both allowlisted records asserts two `runCommand` calls, one commit, two `exec` calls, `ok: true`.
2. Verify test fails (RED).
3. Implement `attemptMechanicalRemediation` in `integrity-remediation.ts` taking `{ harnessRoot, records, runCommand, git, exec, timeoutMs, events? }` and wire it into `runReleaseArtifactGate` on the integrity-failed branch; the commit step copies the add/diff-cached/commit sequence used by the halt-record writer in `halt-record.ts`, with the message `chore(self-host): mechanical remediation — <commands> for <checks>`.
4. Verify test passes (GREEN).
5. Commit with message: "feat(self-host): release gate self-heals allowlisted integrity failures once".

**Done when:**
- `release-gate.test.ts` asserts that for one allowlisted record `runReleaseArtifactGate` runs the command once from `harnessRoot`, commits once with `CONDUCT_ENGINE_COMMIT` set and a message naming the command and check, invokes `exec` exactly twice, and returns `ok: true`
- The two-record case asserts two command runs, exactly one commit, exactly two `exec` invocations, and `ok: true`
- `runReleaseArtifactGate` reaches the remediation only from the integrity-failed branch and never when `exec` first returns exit 0

**Files likely touched:**
- `src/conductor/src/engine/self-host/integrity-remediation.ts` — `attemptMechanicalRemediation`
- `src/conductor/src/engine/self-host/release-gate.ts` — wiring on the failed branch, new optional deps on `ReleaseGateOptions`
- `src/conductor/test/engine/self-host/release-gate.test.ts` — cases

**Dependencies:** 5

### Task 7: A failing re-run, a no-op remediation, and a re-run timeout each end the lane
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: (a) `exec` fails, then fails again with the same record → assert `runCommand` called exactly once, `exec` exactly twice, verdict `ok: false` with reason containing the still-failing check text and the phrase `after mechanical remediation`, and the halt writer called once; (b) `git diff --cached --quiet` returns 0 (no change) → assert no `commit` argv, `exec` still called twice, and `ok: true` when the re-run passes; (c) the second `exec` returns `timedOut: true` → assert verdict reason is the existing timeout reason and no further `runCommand` or `exec` call.
2. Verify test fails (RED).
3. Implement the three branches in `attemptMechanicalRemediation`.
4. Verify test passes (GREEN).
5. Commit with message: "fix(self-host): bound the remediation lane to one pass and one re-run".

**Done when:**
- Case (a) asserts exactly one `runCommand` and exactly two `exec` calls and a halt reason naming the still-failing check
- Case (b) asserts no `git commit` argv was issued and the suite still re-ran exactly once
- Case (c) asserts the timeout reason is returned verbatim from the existing `runIntegritySuite` text and no third `exec` call occurs

**Files likely touched:**
- `src/conductor/src/engine/self-host/integrity-remediation.ts` — branches
- `src/conductor/test/engine/self-host/release-gate.test.ts` — cases

**Dependencies:** 6

### Task 8: A failing remediation command or commit halts before any re-run
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: (a) `runCommand` resolves `{ exitCode: 2, stderr: 'missing tsx' }` → assert `exec` called exactly once, no `git` argv, verdict `ok: false` with reason naming `bin/generate-model-table` and `exit 2`; (b) `git commit` rejects → assert `exec` called exactly once and the reason names the commit failure text.
2. Verify test fails (RED).
3. Implement: `runCommand` non-zero → return `{ ok: false, reason }` immediately; commit rejection caught and returned as a reason.
4. Verify test passes (GREEN).
5. Commit with message: "fix(self-host): failed remediation command or commit halts without re-running the suite".

**Done when:**
- Case (a) asserts exactly one `exec` call, zero `git` calls, and a reason containing both the command and its exit code
- Case (b) asserts exactly one `exec` call and a reason containing the git failure message
- Neither case invokes `runCommand` more than once

**Files likely touched:**
- `src/conductor/src/engine/self-host/integrity-remediation.ts` — early returns
- `src/conductor/test/engine/self-host/release-gate.test.ts` — cases

**Dependencies:** 6

### Task 9: Declined lanes halt through the existing needs-human writer, naming the cause
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: in `release-gate.test.ts`, with a recording `writeHalt` fake, (a) records `[x<TAB><TAB>false, y<TAB>bin/generate-model-table<TAB>true]` → no `runCommand`, one `exec`, halt reason lists `x`; (b) record naming `bin/other` → reason contains `bin/other` verbatim and `not on the mechanical remediation allowlist`; (c) a two-field line → reason contains that line and `malformed`; (d) `writeHalt` returns `{ status: 'failed', reason: 'disk' }` → verdict reason contains `HALT marker write failed: disk`; (e) in `src/conductor/test/engine/self-host/gate-halt.test.ts` (new or existing), assert `writeSelfHostHalt` passes class `needs-human` to `writeHaltMarker` for a remediation-lane reason.
2. Verify test fails (RED).
3. Implement: map each `declined` reason to a distinct first-line reason string and route through the existing `halt()` closure in `runReleaseArtifactGate`; no change to `writeSelfHostHalt` is expected.
4. Verify test passes (GREEN).
5. Commit with message: "feat(self-host): declined remediation lanes halt needs-human naming the cause".

**Done when:**
- Cases (a)–(c) assert zero `runCommand` calls, exactly one `exec` call, and a halt reason naming the undeclared check, the rejected command verbatim, or the malformed line respectively
- Case (d) asserts the returned reason contains `HALT marker write failed:` followed by the writer's reason
- Case (e) asserts the class argument passed to `writeHaltMarker` is `needs-human`

**Files likely touched:**
- `src/conductor/src/engine/self-host/release-gate.ts` — reason mapping on the declined branch
- `src/conductor/test/engine/self-host/release-gate.test.ts` — cases
- `src/conductor/test/engine/self-host/gate-halt.test.ts` — class assertion

**Dependencies:** 6

### Task 10: Every lane branch emits its outcome on the spine
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: pass a recording emitter through `ReleaseGateOptions.events` and assert exact event sequences: success → `[attempted{commands,checks}, succeeded{commands}]`; re-run fails → `[attempted, failed{stillFailing}]`; undeclared → `[declined{reason:'undeclared', detail}]`; not-allowlisted → `[declined{reason:'not-allowlisted', detail: 'bin/other'}]`; and with `events` omitted the success case still returns `ok: true` and throws nothing.
2. Verify test fails (RED).
3. Implement emission points in `attemptMechanicalRemediation` guarded by `events?.emit`.
4. Verify test passes (GREEN).
5. Commit with message: "feat(self-host): emit integrity_remediation_* events from the release gate".

**Done when:**
- `release-gate.test.ts` asserts the exact event type sequence for the success, failed-re-run, undeclared, and not-allowlisted branches
- The omitted-emitter case asserts `ok: true` with no thrown error
- No event is emitted from any code path other than `attemptMechanicalRemediation`

**Files likely touched:**
- `src/conductor/src/engine/self-host/integrity-remediation.ts` — emission
- `src/conductor/src/engine/self-host/release-gate.ts` — `events` option threading
- `src/conductor/test/engine/self-host/release-gate.test.ts` — cases

**Dependencies:** 4, 6

### Task 11: The terminal renderer names the gate and outcome for each variant
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: in the terminal-renderer test file (`src/conductor/test/ui/terminal-renderer.test.ts` or the existing renderer spec), render each of the four variants and assert the line contains `release gate` and, respectively, `remediation attempted`, `remediation succeeded`, `remediation failed`, `remediation declined`, and that it does not contain a tab character or more than one line.
2. Verify test fails (RED).
3. Implement the four render cases beside the existing halt-record rendering.
4. Verify test passes (GREEN).
5. Commit with message: "feat(ui): render integrity_remediation_* events as one-line gate outcomes".

**Done when:**
- The renderer test asserts one line per variant containing `release gate` and the outcome word
- Each rendered line contains no tab character and no newline
- Rendering a `declined` event includes its `detail` (the rejected command or undeclared check)

**Files likely touched:**
- `src/conductor/src/ui/terminal-renderer.ts` — four cases
- `src/conductor/test/ui/terminal-renderer.test.ts` — assertions

**Dependencies:** 4

### Task 12: The migration sub-gate evaluates the changed-file set after the remediation commit
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: in `release-gate.test.ts`, a `changedFiles` fake records the order of calls relative to the `git commit` fake and returns a set including `hooks/claude/docs-guard.sh` only after the commit; drive a `bin/generate-docs-guard-hook` self-heal with no migration block and assert the verdict is the existing `hook wiring` migration HALT (not `ok`), proving `changedFiles` was invoked after the commit.
2. Verify test fails (RED).
3. Implement: ensure `runReleaseArtifactGate` calls `opts.changedFiles()` only after the remediation branch resolves (move the call if needed).
4. Verify test passes (GREEN).
5. Commit with message: "fix(self-host): evaluate breaking surfaces after mechanical remediation commits".

**Done when:**
- `release-gate.test.ts` asserts `changedFiles` is invoked after the remediation commit and that a remediation touching `hooks/claude/docs-guard.sh` without a migration block returns the existing hook-wiring migration HALT reason
- The same case with a runnable migration block returns `ok: true`

**Files likely touched:**
- `src/conductor/src/engine/self-host/release-gate.ts` — call ordering
- `src/conductor/test/engine/self-host/release-gate.test.ts` — case

**Dependencies:** 6

### Task 13: Non-self-host builds never reach the remediation lane
**Story:** 2
**Type:** verification

**Steps:**
1. Write test: in `src/conductor/test/engine/self-host/wiring.test.ts`, drive the guardrail wiring with `isSelfHost: false` and recording fakes for the release gate's `exec`, `runCommand`, and `git` deps; assert none is invoked and no remediation record path is read.
2. Verify the test passes against the existing `isSelfBuild()` guard around `guardrails.releaseGate` (no production change expected).
3. If it fails, the guard has regressed: fix the guard, not the test.
4. Commit with an empty commit carrying `Evidence: skipped existing self-host guard covers this` if no code changed.

**Done when:**
- `wiring.test.ts` asserts that with `isSelfHost: false` the release gate's `exec`, `runCommand`, and `git` fakes are never invoked and no remediation record is read
- No production file changes are required for the assertion to pass

**Files likely touched:**
- `src/conductor/test/engine/self-host/wiring.test.ts` — assertion

**Verify-only:** yes

**Dependencies:** 6

## Task Dependency Graph

```
1 ─▶ 2
3 ─▶ 5 ─▶ 6 ─▶ 7
              ├▶ 8
              ├▶ 9
              ├▶ 10 ◀─ 4
              ├▶ 12
              └▶ 13
4 ─▶ 11
```

## Integration Points

- After Task 2: the real suite, run with `HARNESS_INTEGRITY_REMEDIATION_OUT` set on a drifted fixture, produces the record the engine will consume.
- After Task 6: `runReleaseArtifactGate` — the function the conductor's SHIP tail calls through `guardrails.releaseGate` — self-heals end to end with fakes at the command, git, and suite boundaries.
- After Task 10: `.pipeline/events.jsonl` carries the lane's outcome for any spine consumer.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-06-30-halt-based-release-gates#D1 | task | task-6, task-7 | runs the command once from `harnessRoot`, commits once with `CONDUCT_ENGINE_COMMIT` set and a message naming the command and check, invokes `exec` exactly twice, and returns `ok: true` |
| adr-2026-06-30-halt-based-release-gates#D2 | task | task-3 | `MECHANICAL_REMEDIATION_ALLOWLIST` is a readonly constant equal to exactly `['bin/generate-model-table', 'bin/generate-docs-guard-hook']` and the decision function performs no prefix, glob, or argument matching |
| adr-2026-06-30-halt-based-release-gates#D3 | task | task-9 | Case (e) asserts the class argument passed to `writeHaltMarker` is `needs-human` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
