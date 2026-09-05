# Implementation Plan: `gh` version floor and machine-level environment gate

**Date:** 2026-09-05
**Stories:** .docs/stories/gh-cli-capability-probe-report-an-unsupported-json.md
**Conflict check:** Clean as of 2026-09-05

## Summary

Declare a minimum supported `gh` version, gate dispatch on it at the machine level so an old CLI is
never charged to a feature, and produce a typed capability error at the canonical `gh` seam.
18 tasks.

## Technical Approach

A new module `src/conductor/src/engine/gh-version-floor.ts` owns three pure pieces and one
injectable one: the `GH_VERSION_FLOOR` constant (`2.73.0`), `parseGhVersion` (text to a version
triple), `checkGhVersionFloor` (a closed verdict set — `ok`, `below-floor`, `unparseable`,
`absent`, `timeout`), and a probe that obtains the version string through an injected runner.
The pure trio is testable with no process; the probe is the only part that can spawn.

**Sequencing.** The pure parse and compare land first because everything else consumes their
verdict. The probe lands next. The two consumers — the daemon dispatch cycle and the
DECIDE/engineer entry — land after, independently of each other. The seam's capability-error
translation is independent of all of the above and can proceed in parallel.

**The floor's value is a constant, deliberately not a config key.** A floor an operator can lower
is not a floor, so a task asserts no configuration surface can change it.

**Two consumers, two entry points, one shared verdict.** The daemon gate prevents dispatch and
raises a single waiting condition; the engineer entry refuses. Neither writes a per-feature marker,
because no feature has been claimed at that point.

**The seam translation is a thin wrapper, not a restructuring.** `makeProductionGh` in
`src/conductor/src/engine/tracker-client.ts` is the only production `gh` factory, and the wrapper
changes only the type and text of a rejection. Every caller keeps the disposition it has today.

**Local pattern context — error classification from structured fields.** The repository already
classifies a `gh` failure in `src/conductor/src/engine/pr-labels.ts`: `isNotFoundError` reads the
rejection's `stderr` and exit code rather than its `message`, and an ambiguous rejection resolves
to the uncertain state rather than the confident one. The traits to preserve are (a) read
structured fields, never `message`; (b) an unrecognized or ambiguous signal yields the
non-committal result; (c) the recognition lives in exactly one function. This applies because the
new capability classifier answers a sibling question about the same CLI's rejections; the allowed
variation is the signal itself, since an unsupported `--json` field carries no GraphQL error type
and must be recognized from `stderr` text. Search hints: `isNotFoundError`, `prMergeState` in the
pr-labels module.

## Prerequisites

- None. No migration, no new dependency, no external account.

## Tasks

### Task 1: Parse a `gh --version` banner into a version triple

**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `parseGhVersion('gh version 2.73.0 (2025-05-19)\\nhttps://github.com/cli/cli/releases/tag/v2.73.0\\n')` returns `{ major: 2, minor: 73, patch: 0 }`.
2. Add cases for `gh version 2.14.1 (2022-07-12)` and a bare `gh version 2.100.0`.
3. Verify tests fail (RED).
4. Implement `parseGhVersion` in a new module `src/conductor/src/engine/gh-version-floor.ts`, reading only the first line.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- `parseGhVersion` returns the correct triple for the three banner shapes named in Steps.
- `parseGhVersion` returns `null` for empty input and for a first line with no `gh version` prefix.
- The function reads only the first line and ignores every following line.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.ts` — new module
- `src/conductor/src/engine/gh-version-floor.test.ts` — new tests

**Dependencies:** none

### Task 2: Give pre-release and build-metadata suffixes a defined comparison

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a banner reading `gh version 2.73.0-beta.1` parses, and the comparison treats it as below `2.73.0`.
2. Write failing test: a banner reading `gh version 2.73.0+build.5` parses and compares equal to `2.73.0`.
3. Verify tests fail (RED).
4. Extend `parseGhVersion` to capture a suffix and define the two rules above explicitly.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- A `-beta.1` suffix compares strictly below the same release version.
- A `+build.5` suffix compares equal to the same release version.
- Neither suffix causes `parseGhVersion` to return `null`.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.ts` — suffix handling
- `src/conductor/src/engine/gh-version-floor.test.ts` — suffix cases

**Dependencies:** 1

### Task 3: Declare the floor constant and the closed verdict set

**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: `checkGhVersionFloor` returns `ok` for `2.73.0` and for `2.100.0`, and `below-floor` for `2.72.9`, `2.18.0`, and `2.14.1`.
2. Write failing test: an unparseable banner yields `unparseable`, distinct from `below-floor`.
3. Verify tests fail (RED).
4. Implement `GH_VERSION_FLOOR = { major: 2, minor: 73, patch: 0 }` and `checkGhVersionFloor` returning a discriminated union of `ok`, `below-floor`, `unparseable`, `absent`, `timeout`.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- `checkGhVersionFloor` returns `ok` at exactly `2.73.0` and above, and `below-floor` for `2.72.9`, `2.18.0`, and `2.14.1`.
- The verdict type is a discriminated union whose five members are `ok`, `below-floor`, `unparseable`, `absent`, and `timeout`; no boolean pair is exported.
- `unparseable` is returned for an unrecognized banner and never collapses into `ok`.
- The literal `2.73.0` appears in exactly one exported constant in the module.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.ts` — constant and comparison
- `src/conductor/src/engine/gh-version-floor.test.ts` — boundary cases

**Dependencies:** 1

### Task 4: Prove no configuration surface can change the floor

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: load a merged config whose project and user layers both attempt a `gh` floor key, then assert `GH_VERSION_FLOOR` is unchanged and the key is not a known top-level key.
2. Verify test fails (RED) if a config path were ever wired.
3. Implement nothing new — assert the absence and add the guard test.
4. Verify test passes (GREEN) and commit.

**Done when:**
- A test asserts `GH_VERSION_FLOOR` is unaffected by project config, user config, and environment variables.
- A repository search shows no config key name containing `gh_version` or `gh_floor` in the config type or resolver.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.test.ts` — config-immunity guard

**Dependencies:** 3

### Task 5: Add the injectable version probe guarded by the real-exec kill switch

**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test: the probe constructed with an injected runner returns that runner's banner and spawns no process.
2. Write failing test: the production probe with the real-exec kill switch set throws the existing guard error rather than spawning `gh`.
3. Verify tests fail (RED).
4. Implement `probeGhVersion` taking an injected runner, with a production default that calls the existing real-exec guard before spawning `gh --version`.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- The probe accepts an injected runner and returns its output unchanged.
- With the real-exec kill switch set and no injection, the probe throws the existing guard error and spawns nothing.
- The production default calls the shared real-exec guard before any spawn.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.ts` — probe
- `src/conductor/src/engine/gh-version-floor.test.ts` — injection and guard tests

**Dependencies:** 3

### Task 6: Bound the probe's runtime so a hung CLI cannot wedge a dispatch cycle

**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: an injected runner that never settles yields the `timeout` verdict within the bound.
2. Verify test fails (RED).
3. Implement a bounded wait in the probe returning the `timeout` verdict; the bound is a module constant.
4. Verify test passes (GREEN) and commit.

**Done when:**
- A runner that never settles yields the `timeout` verdict and the call returns within the declared bound.
- The `timeout` verdict is distinct from `absent` and from `below-floor`.
- No code path treats `timeout` as satisfying the floor.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.ts` — bounded wait
- `src/conductor/src/engine/gh-version-floor.test.ts` — timeout case

**Dependencies:** 5

### Task 7: Treat a failing or silent `gh --version` as refusing, never passing

**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: an injected runner rejecting with `ENOENT` yields the `absent` verdict.
2. Write failing test: an injected runner exiting non-zero, and one returning empty stdout, each yield a refusing verdict and never `ok`.
3. Verify tests fail (RED).
4. Implement the mapping from spawn failure and empty output to `absent` or `unparseable`.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- An `ENOENT` rejection yields `absent`.
- A non-zero exit yields a refusing verdict, never `ok`.
- Empty stdout yields `unparseable`, never `ok`.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.ts` — failure mapping
- `src/conductor/src/engine/gh-version-floor.test.ts` — failure cases

**Dependencies:** 5

### Task 8: Prevent dispatch and raise one waiting condition when the machine is below the floor

**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: drive a daemon dispatch cycle with an injected probe reporting `2.14.1` and assert the cycle raises exactly one waiting condition and dispatches nothing.
2. Assert the condition text contains `gh`, the found version `2.14.1`, the floor `2.73.0`, and the remedy.
3. Verify tests fail (RED).
4. Wire the floor check into the daemon dispatch cycle in `src/conductor/src/daemon-cli.ts`, alongside the existing startup preflight, following the existing globally-missing-precondition waiting-condition shape.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- A dispatch cycle with a probe reporting `2.14.1` raises exactly one waiting condition and dispatches no feature.
- The condition text contains the strings `gh`, `2.14.1`, and `2.73.0`, and names upgrading `gh` as the remedy.
- A dispatch cycle with a probe reporting `2.73.0` raises no condition and dispatch proceeds unchanged.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — gate wiring in the dispatch cycle
- `src/conductor/src/daemon-cli.test.ts` — dispatch-cycle gate tests

**Dependencies:** 3, 5

### Task 9: Prove the gate charges nothing to any feature

**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: with a probe reporting `2.14.1` and a populated backlog, run several dispatch cycles and assert zero features claimed and zero retry or attempt counters advanced.
2. Write failing test: assert no halt marker file and no halt-class sidecar is created in any feature worktree.
3. Write failing test: assert that if this path writes a halt class at all, the value is `needs-human` and never `mechanical`.
4. Verify tests fail (RED).
5. Implement whatever ordering is required so the check runs before any feature is claimed.
6. Verify tests pass (GREEN) and commit.

**Done when:**
- Across several cycles below the floor, zero features are claimed and no retry or attempt counter advances.
- No halt marker and no halt-class sidecar is written for any feature.
- A search of this feature's diff finds no write of the halt class `mechanical`.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — check ordering before claim
- `src/conductor/src/daemon-cli.test.ts` — no-charge assertions

**Dependencies:** 8

### Task 10: Clear the condition and resume dispatch once the CLI is upgraded

**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: an injected probe reporting `2.14.1` on the first cycle and `2.73.0` on the second clears the condition and dispatches on the second.
2. Write failing test: a feature whose state existed before the gate engaged is unchanged after the gate clears.
3. Verify tests fail (RED).
4. Implement re-evaluation of the check on each cycle rather than once per process.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- A probe sequence of `2.14.1` then `2.73.0` clears the condition and dispatches on the second cycle with no operator action beyond the upgrade.
- Pre-existing feature state is byte-identical before and after the gate engages and clears.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — per-cycle re-evaluation
- `src/conductor/src/daemon-cli.test.ts` — clear-and-resume test

**Dependencies:** 8

### Task 11: Keep the waiting condition from flooding the log across cycles

**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: twenty consecutive below-floor cycles emit the condition without twenty identical repeated lines.
2. Verify test fails (RED).
3. Implement transition-aware logging for the condition, reusing the existing daemon delta-logging approach.
4. Verify test passes (GREEN) and commit.

**Done when:**
- Twenty consecutive identical below-floor cycles produce fewer than twenty condition log lines.
- A change from `below-floor` to `ok` and back is logged both times rather than suppressed.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — transition-aware condition logging
- `src/conductor/src/daemon-cli.test.ts` — log-dedup test

**Dependencies:** 8

### Task 12: Refuse the DECIDE and engineer entry below the floor

**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: the engineer dispatch entry with an injected probe reporting `2.14.1` refuses and its message names the CLI, `2.14.1`, and `2.73.0`.
2. Write failing test: the same entry with a probe reporting `2.73.0` proceeds to its normal entry decision.
3. Verify tests fail (RED).
4. Wire the floor check into `dispatchEngineer` in `src/conductor/src/engine/engineer-cli.ts` so it composes with the existing fail-closed entry policy rather than replacing it.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- The entry refuses with a probe reporting `2.14.1` and proceeds with one reporting `2.73.0`.
- The refusal message contains `gh`, `2.14.1`, and `2.73.0`.
- The existing entry policy's own decision is still reached when the floor check passes.

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts` — entry gate
- `src/conductor/src/engine/engineer-cli.test.ts` — entry gate tests

**Dependencies:** 3, 5

### Task 13: Prove the entry refusal mutates nothing and names an absent CLI distinctly

**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: a below-floor refusal creates no worktree, cuts no branch, and writes no claim record.
2. Write failing test: an injected probe yielding `absent` produces an absent-binary refusal whose text differs from the below-floor refusal.
3. Verify tests fail (RED).
4. Implement the ordering and the distinct message.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- A below-floor refusal leaves no worktree, no branch, and no claim record.
- The `absent` refusal text names the missing binary and does not contain the floor-comparison wording.

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts` — refusal ordering and messages
- `src/conductor/src/engine/engineer-cli.test.ts` — no-mutation assertions

**Dependencies:** 12

### Task 14: Produce a typed capability error at the canonical `gh` seam

**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: a runner rejection whose `stderr` carries `Unknown JSON field: "headRefOid"` and a non-zero exit code yields a typed capability error whose structured fields name the CLI and the field `headRefOid`.
2. Write failing test: a rejection carrying that phrase only in `message`, with clean `stderr`, is NOT classified as a capability error.
3. Verify tests fail (RED).
4. Implement a `GhCapabilityError` class and a single recognizer wrapping the runner returned by `makeProductionGh` in `src/conductor/src/engine/tracker-client.ts`, reading `stderr` and exit code only. Preserve the traits named in Technical Approach: structured fields not `message`, one recognizer function, non-committal on an unrecognized signal.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- A rejection with the unsupported-field signal in `stderr` yields `GhCapabilityError` carrying `headRefOid` as a structured field, not only in its message.
- A rejection carrying the phrase only in `message` is not classified as a capability error.
- The recognizer exists in exactly one function and reads no `message` property.
- A successful invocation returns its result unchanged with no wrapper allocation observable to callers.

**Files likely touched:**
- `src/conductor/src/engine/tracker-client.ts` — error class and wrapper
- `src/conductor/src/engine/tracker-client.test.ts` — classification tests

**Dependencies:** none

### Task 15: Keep an ambiguous `gh` failure from becoming a confident capability claim

**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: a not-found rejection and a network-error rejection each pass through unchanged and are not capability errors.
2. Write failing test: a non-zero exit with empty `stderr`, and one with unrelated `stderr`, each produce no capability error.
3. Verify tests fail (RED).
4. Implement the non-committal default in the recognizer.
5. Verify tests pass (GREEN) and commit.

**Done when:**
- A not-found rejection and a network rejection are re-thrown unchanged and are not `GhCapabilityError`.
- A non-zero exit with empty or unrelated `stderr` produces no capability error.
- A repository search finds the string `Unknown JSON field` in exactly one production file.

**Files likely touched:**
- `src/conductor/src/engine/tracker-client.ts` — non-committal default
- `src/conductor/src/engine/tracker-client.test.ts` — ambiguity cases

**Dependencies:** 14

### Task 16: Prove each `gh` caller keeps the disposition it has today

**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: the finish-record path raises a capability error during PR identity verification and records no outcome and writes no file.
2. Write failing test: the same path behaves identically for a genuinely missing PR as it does before this change.
3. Write failing test: the finish completion gate raises a capability error on its PR read and still passes with a warning.
4. Verify tests fail (RED).
5. Implement only what is needed for the capability error to reach these callers as a rejection; change no caller's branching.
6. Verify tests pass (GREEN) and commit.

**Done when:**
- The finish-record path records no outcome and creates no file when a capability error is raised.
- The finish-record path's behavior for a genuinely missing PR is unchanged from before this feature.
- The finish completion gate still passes with a warning when its PR read raises a capability error.
- This feature's diff changes no conditional in either caller.

**Files likely touched:**
- `src/conductor/src/engine/finish-record-cli.test.ts` — fail-closed assertions
- `src/conductor/src/engine/halt-pr-rehabilitation.test.ts` — fail-open assertions

**Dependencies:** 14

### Task 17: Keep park-reconciliation's refusal vocabulary unchanged

**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: the park-reconciliation path raises a capability error while reading a merged PR head, deletes no branch and no worktree, and still reports reason `no-merge-proof`.
2. Write failing test: assert the refusal reason union gains no member from this feature.
3. Write failing test: assert the typed capability error is logged so the cause remains recoverable.
4. Verify tests fail (RED).
5. Implement the log line only; leave the reason mapping as it stands.
6. Verify tests pass (GREEN) and commit.

**Done when:**
- A capability error during the merged-PR head read yields reason `no-merge-proof`, deletes nothing, and logs the capability error.
- The refusal reason union has the same members before and after this feature's diff.

**Files likely touched:**
- `src/conductor/src/engine/park-reconciliation.ts` — capability logging only
- `src/conductor/src/engine/park-reconciliation.test.ts` — reason and no-deletion assertions

**Dependencies:** 14

### Task 18: Add an opt-in real-binary smoke for `gh --version` parsing

**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write a smoke test, excluded from the default suite and from CI, that runs the real `gh --version` and asserts `parseGhVersion` returns a non-null triple from its actual output.
2. Assert the smoke reports the installed version and its verdict so an operator can read the real result.
3. Verify the smoke passes against the installed CLI.
4. Verify the default suite does not execute it.
5. Commit.

**Done when:**
- A named opt-in smoke runs the real `gh --version` and asserts `parseGhVersion` returns a non-null triple.
- The default test suite run does not execute the smoke.
- The smoke prints the installed version and the resulting verdict.

**Files likely touched:**
- `src/conductor/src/engine/gh-version-floor.smoke.test.ts` — new opt-in smoke

**Dependencies:** 3

## Task Dependency Graph

```text
1 ── 2
 └── 3 ── 4
      ├── 18
      ├── 5 ── 6
      │    └── 7
      ├── 8 ── 9
      │    ├── 10
      │    └── 11
      └── 12 ── 13
(5 also feeds 8 and 12)

14 ── 15
 ├── 16
 └── 17
```

Tasks 1-13 and 18 form one chain rooted at the pure parser. Tasks 14-17 are independent of it and
may proceed concurrently.

## Integration Points

- After Task 8: the daemon dispatch cycle can be driven end-to-end with a below-floor probe.
- After Task 12: both entry points enforce the same floor.
- After Task 16: the seam's typed error is observable at its two opposite-disposition callers.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D1 | task | task-3 | The literal `2.73.0` appears in exactly one exported constant in the module. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D2 | task | task-4 | A test asserts `GH_VERSION_FLOOR` is unaffected by project config, user config, and environment variables. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D3 | task | task-8, task-9 | Across several cycles below the floor, zero features are claimed and no retry or attempt counter advances. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D4 | task | task-5 | With the real-exec kill switch set and no injection, the probe throws the existing guard error and spawns nothing. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D5 | task | task-14 | The recognizer exists in exactly one function and reads no `message` property. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D6 | task | task-16 | This feature's diff changes no conditional in either caller. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D7 | task | task-9 | A search of this feature's diff finds no write of the halt class `mechanical`. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D8 | task | task-18 | A named opt-in smoke runs the real `gh --version` and asserts `parseGhVersion` returns a non-null triple. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D9 | no-change | none | The decision records that the direct-`gh` call in the worktree module stays outside the seam and is explicitly out of scope; it obliges no code change in this feature, only the recorded acknowledgement the ADR itself carries. |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate#D10 | task | task-17 | The refusal reason union has the same members before and after this feature's diff. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
