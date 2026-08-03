**Status:** Accepted

# v1 interface lock for parallel task-stream dispatch (#552, locking #474)

Track: technical (no PRD — acceptance criteria live here)
Tier: L

## Context

#474 (engine-orchestrated parallel task-stream dispatch) is deferred past v1.0, but the
surfaces it touches freeze at the v1.0 tag. This feature pins each of those surfaces and
ships the enforcement that makes each pin real, so #474 lands post-v1 as MINOR with no
migration block. It does **not** implement parallel dispatch: no stream detection, no
concurrent dispatch, no overlap veto engine.

The pins, their anchors, and the reasoning are in
`adr-2026-08-02-v1-parallel-dispatch-surface-lock` (APPROVED). Each story below implements
exactly one pin's enforcement. Story 2 is the single deliberate breaking-in-v1 tightening,
escalated per #552's negative path.

A pin defended only by prose is not a pin: `adr-2026-07-10-session-hook-task-stamping`
specified an overlap guard that was later deleted in an unrelated refactor (`ce1c1cf17`)
with no test, gate, or reviewer noticing. Every story here ends in a test that fails if the
shape moves.

---

## Story 1 — `.pipeline/current-task` format is frozen and means unique-or-absent

**Requirement:** ADR S1, S2 · #552 desired outcome 1

As the engine, I want the `current-task` stamp's on-disk format frozen and its meaning
defined as "present iff exactly one task is in flight", so the two operator-installed hooks
that read it (`hooks/claude/lint-after-edit.sh:66-67`, and `prepare-commit-msg` derived from
it) never need to change when parallel dispatch arrives.

### Acceptance Criteria

#### Happy Path
- Given a build with exactly one task in flight, when the stamp is written, then the file
  contains the bare task id with no trailing newline, no JSON, and no wrapper — byte-for-byte
  as `task-cli.ts:153` writes it today.
- Given the reserved path `.pipeline/lanes/`, when any v1 code path runs a full build, then
  nothing is written there and no v1 reader consults it.

#### Negative Paths
- Given zero tasks in flight, when `prepare-commit-msg` runs, then the stamp is absent and the
  hook abstains — no `Task:` trailer is stamped and the commit succeeds.
- Given a stamp file whose content has a trailing newline or surrounding whitespace, when a
  reader consumes it, then the value is rejected rather than silently trimmed into a
  different id — the format is exact, so a future writer cannot drift into a tolerated variant.

### Done When
- [ ] A test asserts the written stamp is exactly `<id>` with no trailing byte.
- [ ] A test asserts `.pipeline/lanes/` is absent after a full build run.
- [ ] A test asserts an absent stamp yields an unstamped commit and exit 0 from
      `prepare-commit-msg`.
- [ ] `docs/reference/artifacts.md` records the unique-or-absent contract for `current-task`.

---

## Story 2 — Parallel-branch names cannot make a synthetic state key ambiguous

**Requirement:** ADR S3 · #552 negative path (breaking form ships in v1)

As an operator, I want a `steps.<name>.parallel` branch name restricted to `[A-Za-z0-9.-]+`,
so the `<step>__<branch>` synthetic state key written into `conduct-state.json` can always be
split back into its two parts — before #474 starts generating stream names dynamically and
freezes the ambiguity permanently.

### Acceptance Criteria

#### Happy Path
- Given a config with `steps.build.parallel` branches named `alpha`, `lock-2`, and `v1.2`,
  when the config loads, then it validates and the synthetic keys are `build__alpha`,
  `build__lock-2`, `build__v1.2`.

#### Negative Paths
- Given a branch named `a__b`, when the config loads, then it fails with a hard error naming
  the offending branch and the permitted charset — not a warning, and not a dropped key.
- Given an empty branch name or one containing a space or `/`, when the config loads, then it
  fails the same way.
- Given a config with no `parallel` block at all, when it loads, then nothing changes — the
  validation is inert for every consumer who does not use the key.

### Done When
- [ ] A test asserts each of `a__b`, ``, `a b`, and `a/b` is rejected at load with the branch
      name in the message.
- [ ] A test asserts `alpha`, `lock-2`, `v1.2` load and produce the expected synthetic keys.
- [ ] A test asserts a config without `parallel` is unaffected.
- [ ] `CHANGELOG.md` `[Unreleased]` records the tightening as a behavior change for existing
      configs, per the escalation in the ADR.
- [ ] `docs/reference/configuration.md` documents the charset on the `parallel` branch name.

---

## Story 3 — `task-status.json` rows tolerate fields a future engine adds

**Requirement:** ADR S4

As a future engine version, I want per-row fields I add to survive a seed round-trip
untouched, so #474 can attach lane information to a row without any schema-version
discriminator — of which the file has none.

### Acceptance Criteria

#### Happy Path
- Given a `task-status.json` whose rows carry an unrecognized field, when `seedTaskStatus`
  runs and rewrites the file, then the unrecognized field is present and unchanged on every
  row that survived.
- Given the same file, when `normalizeTasks` parses it, then the known fields resolve exactly
  as before and the unknown field is ignored without warning.

#### Negative Paths
- Given a row whose unknown field collides with a name the engine later uses, when the seed
  runs, then the engine's own value wins and the round-trip does not silently preserve a
  stale conflicting value.
- Given a malformed file (not an object, or `tasks` not an array), when a reader runs, then it
  fails or abstains exactly as it does today — tolerance of unknown *fields* must not become
  tolerance of a wrong *shape*.

### Done When
- [ ] A test seeds a file with an extra row field and asserts it survives verbatim.
- [ ] A test asserts a wrong-shaped file still fails/abstains unchanged.
- [ ] `docs/reference/artifacts.md` states that unknown row fields are preserved.

---

## Story 4 — Build-progress telemetry gains a plural without changing its scalar's type

**Requirement:** ADR S5

As a consumer of the event stream, the renderer, the daemon dashboard, and OTEL span
attributes, I want `currentTaskId` to stay a scalar forever and a new optional
`currentTaskIds` array to carry the plural case, so #474 reports N in-flight tasks without
breaking anything reading the singular field.

### Acceptance Criteria

#### Happy Path
- Given exactly one `in_progress` row, when a build-progress snapshot is taken, then
  `currentTaskId` is that id and `currentTaskIds` is a one-element array containing it.
- Given zero `in_progress` rows, when a snapshot is taken, then `currentTaskId` is absent and
  `currentTaskIds` is empty.

#### Negative Paths
- Given two or more `in_progress` rows, when a snapshot is taken, then `currentTaskId` is
  **absent** — not the first row's id, which is what
  `build-progress-watcher.ts:120-124` reports today and which is an arbitrary choice — and
  `currentTaskIds` lists every in-flight id in file order.
- Given a consumer reading only `currentTaskId`, when the plural field is present, then that
  consumer is unaffected: the renderer, dashboard, and span attributes emit the same values
  they do today in every single-task case.

### Done When
- [ ] A test asserts the one-row, zero-row, and two-row cases produce the values above.
- [ ] A test asserts the renderer and OTEL span attributes are byte-identical to today for
      the single-task case.
- [ ] The renderer and the daemon dashboard display `currentTaskIds` when more than one task
      is in flight, so the operator sees the in-flight set rather than a blank field where an
      arbitrary id used to appear. Multiple `in_progress` rows already occur in real builds
      (#531), so this is visible before #474, not only after it.
- [ ] `docs/reference/artifacts.md` and the events reference record both fields and the
      unique-or-absent rule for the scalar.

---

## Story 5 — Evidence counters stay build-scoped and stop losing updates

**Requirement:** ADR S6

As the evidence sidecar, I want `noEvidenceAttempts`, `noEvidenceReasons[]` and
`lastResolvedCount` pinned as build-scoped scalars written by a single writer, so #474 changes
nothing about this file's shape and concurrent increments cannot be lost.

### Acceptance Criteria

#### Happy Path
- Given several sequential increments of `noEvidenceAttempts`, when each completes, then the
  persisted count equals the number of increments.
- Given `evidenceStamps`, when a task's stamp is written, then it is keyed by task id exactly
  as today — the already-parallel-safe part is unchanged.

#### Negative Paths
- Given two increments issued concurrently, when both complete, then the persisted count is 2
  — today's read-modify-write (`task-evidence.ts:181-204`) loses one.
- Given a corrupt or partially-written sidecar, when a reader loads it, then it warns and
  continues with empty state exactly as today — the serialization fix must not change the
  corruption path.

### Done When
- [ ] A test drives two concurrent increments and asserts no lost update.
- [ ] A test asserts the corrupt-file path is unchanged.
- [ ] The ADR's decision that these counters are never widened per lane is reflected in
      `docs/reference/artifacts.md`.

---

## Story 6 — `dispatch-count` line grammar is frozen; correlation goes to a reserved sidecar

**Requirement:** ADR S7, S8

As the attribution telemetry reader, I want the `dispatch-count` line grammar frozen at
`Task: <id>` / `Task: none`, so no future writer can append a correlation field in place —
the reader takes everything after `Task: ` as the id, so widening the line would silently
corrupt every id it parses.

### Acceptance Criteria

#### Happy Path
- Given dispatches with and without task ids, when the pre-dispatch hook records them, then
  each line is exactly `Task: <id>` or `Task: none` and `readDispatchAttribution` classifies
  them exactly as today.
- Given the reserved path `.pipeline/dispatch-log.jsonl`, when a v1 build runs, then nothing
  writes it and no v1 reader consults it.

#### Negative Paths
- Given a line carrying any trailing field beyond the id, when a test asserts the grammar,
  then it fails — the freeze is enforced, not merely documented.
- Given an unparseable hook payload, when the hook runs, then no line is appended at all,
  unchanged from today.

### Done When
- [ ] A test asserts the exact line grammar for both the attributed and `none` cases.
- [ ] A test asserts a trailing-field line is not produced by any engine code path.
- [ ] A test asserts `.pipeline/dispatch-log.jsonl` is absent after a full build.
- [ ] `docs/reference/artifacts.md` records the frozen grammar and the reserved sidecar.

---

## Story 7 — `.pipeline/phase-active` stays worktree-global so the shipped hooks never change

**Requirement:** ADR S9

As the operator whose `~/.claude/settings.json` points at absolute paths under `hooks/`, I
want `phase-active` pinned as one file per worktree whose `allow:` prefixes are a union
across all lanes, so `hooks/claude/docs-guard.sh` — which lives under the one path prefix that
trips the release gate's `hook wiring` surface — is byte-for-byte unchanged post-v1.

### Acceptance Criteria

#### Happy Path
- Given an active step, when the marker is written, then it is a single line-oriented file at
  `.pipeline/phase-active` with `step:`, `phase:`, `written:` and zero or more `allow:` lines,
  parseable by bash without a JSON parser, exactly as today.
- Given multiple allow prefixes, when they are written, then they appear as separate `allow:`
  lines forming a union, and `docs-guard.sh` permits a path matching any of them.

#### Negative Paths
- Given a path matching no `allow:` prefix, when an edit is attempted during an active phase,
  then `docs-guard.sh` blocks it exactly as today.
- Given the marker file absent, when an edit is attempted, then the hook permits it, unchanged
  from today.

### Done When
- [ ] A test asserts the marker's line-oriented format and that allow prefixes union rather
      than replace.
- [ ] A test asserts `hooks/claude/docs-guard.sh` requires no modification: its blocking and
      permitting behavior is unchanged against a union-of-prefixes marker.
- [ ] `docs/reference/settings-and-hooks.md` records that the marker is worktree-global and
      never lane-scoped.

---

## Story 8 — `**Dependencies:**` values gain a pinned grammar with a fail-safe parser

**Requirement:** ADR S10 · #552 desired outcome 1

As #474's future stream detector, I want the plan's dependency edges parseable from a pinned
grammar, and I want an unparseable value to degrade to "depends on every prior task", so no
already-merged plan can ever break — the worst case is that it does not parallelize.

### Acceptance Criteria

#### Happy Path
- Given `**Dependencies:** none`, when the value is parsed, then the task has no dependencies.
- Given `**Dependencies:** Task 1, Task 3`, when the value is parsed, then the task depends on
  exactly tasks `1` and `3`, with `T3` and `3` canonicalized to the same id as elsewhere in the
  engine.

#### Negative Paths
- Given a free-prose value such as `**Dependencies:** Task 1 and the config work`, when it is
  parsed, then the task is treated as depending on **every prior task** — sequential, never
  parallel — and the plan is **not** rejected.
- Given a task with no `**Dependencies:**` line at all, when the plan is parsed, then the same
  fail-safe applies and `planHasDependencyTree`'s existing document-level presence check is
  unchanged, so no currently-eligible plan becomes ineligible for daemon dispatch.
- Given a dependency naming a task id absent from the plan, when it is parsed, then the
  reference is dropped with a non-blocking lint warning and the task falls back to sequential.

### Done When
- [ ] Tests cover `none`, a comma list, `T`-prefixed ids, free prose, a missing line, and an
      unknown id, asserting the fail-safe result in every non-conforming case.
- [ ] A test asserts no plan input causes a parse **error** — the parser has no failing exit.
- [ ] A test asserts `planHasDependencyTree` and daemon-backlog eligibility are unchanged for
      every existing fixture plan.
- [ ] The non-blocking lint surfaces non-conforming values to plan authors.
- [ ] `skills/plan/SKILL.md` states the pinned grammar; `docs/reference/artifacts.md` records
      it and the fail-safe rule.

---

## Story 9 — An undeclared file set vetoes parallelism rather than permitting it

**Requirement:** ADR S11

As #474's future overlap veto, I want a task with an empty declared file set treated as
overlapping everything, so `**Files likely touched:**` never has to become mandatory — which
would break existing plans.

### Acceptance Criteria

#### Happy Path
- Given two tasks with disjoint declared file sets, when overlap is computed, then they are
  reported non-overlapping.
- Given two tasks sharing one declared path, when overlap is computed, then they are reported
  overlapping.

#### Negative Paths
- Given a task with no `**Files likely touched:**` line and no fallback backtick paths, when
  overlap is computed against any other task, then it is reported **overlapping** — the
  undeclared case is never treated as "touches nothing".
- Given a plan where no task declares files, when overlap is computed, then every pair
  overlaps and the whole plan is sequential.

### Done When
- [ ] A test asserts disjoint, shared, and empty-set cases produce the stated verdicts.
- [ ] A test asserts the existing `parsePlanTaskPaths` behavior and its four current consumers
      are unchanged.
- [ ] `skills/plan/SKILL.md` states that omitting the Files block forfeits parallel eligibility.

---

## Story 10 — The concurrency config surface is pinned and its successor key reserved

**Requirement:** ADR S12, S13

As a consumer running mixed engine versions across worktrees, I want `validation_concurrency`
never renamed and `build_concurrency` accepted-and-ignored in v1, so a config written for a
later engine does not hard-fail to load on a v1.0 engine — unknown top-level keys are a total
load failure (`config.ts:316-320`), not a warning.

### Acceptance Criteria

#### Happy Path
- Given a config setting `build_concurrency: 3`, when it loads on the v1 engine, then it
  validates successfully and has no effect on any behavior.
- Given a config setting `validation_concurrency`, when it loads, then it caps group and
  branch fan-out exactly as today.

#### Negative Paths
- Given `build_concurrency` set to a non-number, when the config loads, then it fails with a
  hard type error — reserved does not mean unvalidated.
- Given a config setting neither key, when it loads, then defaults resolve exactly as today
  (`validation_concurrency` → 2) and no new key is materialized into the config object.

### Done When
- [ ] A test asserts `build_concurrency` validates, is type-checked, and changes no behavior.
- [ ] A test asserts `validation_concurrency`'s name, default, and resolver are unchanged.
- [ ] `docs/reference/configuration.md` documents `build_concurrency` as reserved for #474 with
      no current consumer, alongside the existing `validation_concurrency` entry.

---

## Story 11 — The `conduct-ts task` CLI contract is frozen

**Requirement:** ADR S14

As an operator following the recovery runbooks, I want `conduct-ts task start|done <id>` frozen
in verbs, id charset, exit codes, and mismatch behavior, so #474 adds no verb and changes no
existing one — it is a canonical breaking surface.

### Acceptance Criteria

#### Happy Path
- Given a valid id present in `task-status.json`, when `task start <id>` runs, then the row
  flips to `in_progress` and the stamp is written, exit 0.
- Given a stamp matching `<id>`, when `task done <id>` runs, then the stamp is removed, exit 0,
  and `task-status.json` is not modified.

#### Negative Paths
- Given a stamp holding a different id, when `task done <id>` runs, then it prints
  `cannot clear task <id>; current stamp is <other>` and exits 1 with the stamp untouched.
- Given no stamp at all, when `task done <id>` runs, then it exits 0 idempotently.
- Given an unknown verb or a missing id, when the command runs, then it prints the guide to
  stderr and exits 2.

### Done When
- [ ] Tests pin each verb's exit code and side effects, including both mismatch and absent-stamp
      cases.
- [ ] A test asserts the id charset `[A-Za-z0-9._-]+` is enforced unchanged.
- [ ] `docs/reference/cli.md`'s `conduct-ts task` section matches the pinned behavior.
