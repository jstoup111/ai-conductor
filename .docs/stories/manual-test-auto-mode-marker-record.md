**Status:** Accepted

# Stories: manual_test auto-mode marker record

Technical track (no PRD) · Tier M · intake jstoup111/ai-conductor#385
Source of intent: `adr-2026-07-21-manual-test-auto-mode-marker-record.md` (APPROVED)

Acceptance criteria derive from the ADR's decisions D1–D4 and the #385 integration outcome.
The engine owns the marker *write* (fail-closed); the agent owns the *evidence*.

---

## Story: `manual-test-record --skip` appends a recognized SKIP sentinel section

**Requirement:** ADR D1, D3

As the manual-test skill running in auto mode, I want a `conduct-ts manual-test-record --skip`
command that atomically records an auditable "skipped — no endpoint/UI stories" section into
`.pipeline/manual-test-results.md`, so a no-endpoint feature completes the step without any
hand-written marker.

### Acceptance Criteria

#### Happy Path
- Given an empty or absent `.pipeline/manual-test-results.md` and args `--skip --reason
  "no endpoint/UI stories" --pipeline-dir <abs-worktree-pipeline>`, when the CLI runs, then it
  exits 0 and the file contains an `## Attempt 1 — <ISO timestamp>` section carrying a
  machine-recognizable SKIP sentinel line and the verbatim reason text.
- Given an existing file with a prior `## Attempt 1` section, when `--skip` runs again, then a
  new `## Attempt 2` SKIP section is **appended** and Attempt 1 is left byte-for-byte intact
  (append, never overwrite — #367 history preserved).

#### Negative Paths
- Given `--skip` with no `--reason` (or an empty/whitespace reason), when the CLI runs, then it
  exits non-zero with a usage error and writes **nothing** to the file (fail-closed).
- Given `--skip` with no `--pipeline-dir`, when the CLI runs, then it exits non-zero with a
  usage error and writes nothing.
- Given a `--pipeline-dir` whose directory is unwritable (or the atomic rename fails), when the
  CLI runs, then it exits non-zero, leaves no partial/temp file, and the pre-existing file (if
  any) is unchanged — the marker is the commit point.

### Done When
- [ ] `conduct-ts manual-test-record --skip --reason R --pipeline-dir D` appends an
      `## Attempt N` SKIP-sentinel section and exits 0.
- [ ] The written section is recognized as a SKIP by the completion predicate (see the
      predicate story) — i.e. the sentinel line is a fixed, greppable token, not free prose.
- [ ] Missing `--reason` or `--pipeline-dir` → non-zero exit, zero bytes written.
- [ ] A simulated write failure leaves the target file unchanged (no partial write).

---

## Story: `manual-test-record --results` appends a real PASS/FAIL attempt section

**Requirement:** ADR D1

As the manual-test skill after exercising the app, I want `conduct-ts manual-test-record
--results <path|->` to append the observed per-story PASS/FAIL table as a fresh attempt
section, so the evidence I produced is written through the same fail-closed engine writer.

### Acceptance Criteria

#### Happy Path
- Given a results table supplied via `--results <path>` (or `-` for stdin) and
  `--pipeline-dir <dir>`, when the CLI runs, then it appends an `## Attempt N — <ISO>` section
  containing exactly the supplied rows and exits 0.
- Given a prior attempt already in the file, when `--results` runs, then the new attempt is
  appended after it (the predicate evaluates the LATEST attempt only).

#### Negative Paths
- Given `--results` pointing at a non-existent path, when the CLI runs, then it exits non-zero
  with a clear error and writes nothing (fail-closed).
- Given an empty results payload (no rows), when the CLI runs, then it exits non-zero and
  writes nothing — an empty attempt is never recorded as a completion.
- Given both `--skip` and `--results` supplied together, when the CLI runs, then it exits
  non-zero with a usage error (mutually exclusive modes) and writes nothing.

### Done When
- [ ] `--results <path>` and `--results -` (stdin) both append the rows verbatim as a new
      attempt and exit 0.
- [ ] Non-existent path, empty payload, or `--skip`+`--results` together → non-zero exit, zero
      bytes written.
- [ ] The appended section is parsed by the existing manual_test predicate exactly as a
      hand-written attempt table is today (no schema break for the parallel-validation reader).

---

## Story: completion predicate accepts a fresh SKIP sentinel as done

**Requirement:** ADR D2

As the conductor engine, I want `CUSTOM_COMPLETION_PREDICATES.manual_test` to evaluate a latest
attempt that is the SKIP sentinel as `done: true`, subject to the same freshness rule as a PASS
result, so a recorded skip clears the gate in both auto and interactive mode.

> **Distinction (preserves ai-conductor#367 / manual-test-fail-routing "auto-skip closed"):**
> a recorded SKIP sets the completion predicate to `done: true` via auditable evidence — it
> does **not** set the step's status to `skipped`. The only path to step-status `skipped`
> remains the explicit committed `steps.manual_test.disable` config key. This sentinel never
> reopens the silent auto-skip of a *failing* manual_test that fail-routing closed: it applies
> only to a no-FAIL attempt (see the whitewash-guard story) and records a reason.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/manual-test-results.md` whose latest attempt is the SKIP sentinel and whose
  mtime is newer than `sessionStartedAt`, when `checkStepCompletion(dir,'manual_test',ctx)`
  runs, then it returns `{ done: true }`.
- Given a file with an earlier real PASS attempt followed by a later SKIP attempt (re-run on a
  now-non-endpoint feature), when the predicate runs, then the latest (SKIP) attempt governs
  and the step is done.

#### Negative Paths
- Given a SKIP sentinel whose mtime is OLDER than `sessionStartedAt`, when the predicate runs,
  then it returns `done: false` with a `stale` reason — a stale skip from a prior session never
  passes (freshness parity with PASS).
- Given a latest attempt that contains BOTH a SKIP sentinel line AND a FAIL row, when the
  predicate runs, then the FAIL wins: `done: false` with a FAIL reason (a SKIP can never mask a
  FAIL in the same attempt).
- Given a still-missing `.pipeline/manual-test-results.md`, when the predicate runs, then it
  returns the unchanged missing-marker failure — absent file is still "did not run".

### Done When
- [ ] A fresh latest-attempt SKIP sentinel → `{ done: true }`.
- [ ] A stale SKIP → `done: false` (`stale` reason); a SKIP+FAIL attempt → `done: false`
      (FAIL reason); missing file → unchanged missing-marker failure.
- [ ] A unit test pins each of the four cases against `checkStepCompletion`.

---

## Story: the #367 whitewash guard cannot be laundered by a SKIP

**Requirement:** ADR D2 (constraint), #367 preservation

As the conductor engine, I want the FAIL-evidence whitewash guard to remain fully in force when
SKIP sections exist, so a feature that manually FAILed cannot be flipped to done by recording a
SKIP without a real fix commit.

### Acceptance Criteria

#### Happy Path
- Given a latest attempt with FAIL rows, when the predicate runs, then it still records
  `.pipeline/manual-test-fail-evidence.json` (HEAD sha + excerpt) and returns `done: false` —
  behavior identical to today.
- Given FAIL rows recorded at sha X, then a later attempt whose latest section is all PASS with
  new commits since X, when the predicate runs, then the FAIL→PASS flip is accepted (unchanged).

#### Negative Paths
- Given FAIL rows recorded at sha X, when a later SKIP attempt is recorded with **no** new
  commits since X, then the predicate returns `done: false` — a SKIP is not a fix and cannot
  clear a recorded FAIL any more than a PASS could without HEAD movement.
- Given a `manual-test-record --skip` invoked on a run whose latest real attempt had FAIL rows,
  when the daemon evaluates completion, then the manual_test→build FAIL kickback path
  (`conductor.ts:4170-4178`) is still reachable off the recorded FAIL rows (SKIP does not erase
  the FAIL rows already appended).

### Done When
- [ ] FAIL-evidence recording and the FAIL→PASS-requires-HEAD-movement rule are unchanged when
      SKIP sections are present (regression test over the existing #367 suite).
- [ ] A SKIP recorded after a FAIL with no new commits does NOT yield `done: true`.
- [ ] The manual_test→build kickback still fires on the recorded FAIL rows.

---

## Story: the manual-test skill records via the CLI on every exit path

**Requirement:** ADR D3

As the operator, I want `skills/manual-test/SKILL.md` rewritten so every exit branch (Step 0
SKIP and every real-run PASS/FAIL outcome) ends by invoking `conduct-ts manual-test-record`
against the absolute worktree `.pipeline` path from the step's system prompt, so the marker can
no longer be silently omitted — and a refusal is still a distinguishable signal.

### Acceptance Criteria

#### Happy Path
- Given a feature with no endpoint/UI stories, when the skill reaches Step 0, then its final
  act is `manual-test-record --skip --reason "…"` (the old "conduct marks it done" language,
  which had no engine backing, is removed).
- Given a real run, when testing completes, then the skill's final act is `manual-test-record
  --results …` written to the absolute worktree pipeline path before any cleanup/`cd`.

#### Negative Paths
- Given a run the skill deliberately refuses or cannot complete (e.g. the app won't start and
  no result can be observed), when it exits, then it does NOT invoke `manual-test-record` — an
  absent marker remains the deliberate "did not run" signal (refusal contract); the skill never
  hand-writes the file to paper over a blocked gate.
- Given the SKILL.md after edit, when `test/test_harness_integrity.sh` runs, then frontmatter
  (`name`/`description`/`enforcement`/`phase`), cross-skill references, and section numbering
  all still pass (no duplicate section numbers, valid references).

### Done When
- [ ] `skills/manual-test/SKILL.md` instructs the record-CLI call on the SKIP branch and every
      real-run branch, using the absolute worktree pipeline path, before cleanup.
- [ ] A refusal contract paragraph + a verification-checklist line are present (mirrors
      `finish`/`writing-system-tests`).
- [ ] `test/test_harness_integrity.sh` passes on the edited SKILL.md.

---

## Story: the missing-marker retry hint points at the record command

**Requirement:** ADR D4

As a drifting auto-mode retry, I want the `manual_test` completion-miss retry hint to echo the
exact `conduct-ts manual-test-record` command, so even a retry that lost the plot self-heals
toward the deterministic writer (parity with the `finish`+`recording` hint).

### Acceptance Criteria

#### Happy Path
- Given a `manual_test` attempt that fails the completion check for a missing/absent marker,
  when `buildRetryHint('manual_test', …)` runs, then the returned hint names the
  `conduct-ts manual-test-record …` command (skip and results forms) rather than the generic
  "Finish the work now." line.

#### Negative Paths
- Given a `manual_test` failure whose reason is a **FAIL row** (not a missing marker), when the
  retry hint is built, then it does NOT tell the agent to record a skip — it routes toward
  fixing the bug (no laundering via the hint).
- Given any non-`manual_test` step, when `buildRetryHint` runs, then its output is unchanged
  (the new branch is scoped to `manual_test`).

### Done When
- [ ] The `manual_test` missing-marker retry hint cites the record command.
- [ ] A FAIL-reason retry hint does not suggest `--skip`.
- [ ] `buildRetryHint` output for `finish`/`build`/other steps is byte-for-byte unchanged
      (unit test).

---

## Story: a no-endpoint/UI feature completes manual_test in daemon mode without a HALT

**Requirement:** #385 integration outcome

As the daemon, I want a fully-built feature with no endpoint/UI stories to pass the manual_test
gate via a recorded SKIP on the first attempt, so it never burns the retry budget into a
`.pipeline/halt-user-input-required` HALT (the #385 regression).

### Acceptance Criteria

#### Happy Path
- Given a daemon (`mode: 'auto'`) run of a feature whose stories reference no HTTP endpoints or
  UI, when the manual_test step runs and the skill records `--skip`, then `checkStepCompletion`
  returns done on that attempt and the run advances past manual_test with no retry and no HALT
  marker written.

#### Negative Paths
- Given a daemon run of a feature that DOES have endpoint stories and genuinely FAILs manual
  testing, when the step runs, then behavior is unchanged: FAIL rows recorded, manual_test→build
  kickback (bounded), and HALT only after the kickback budget — a SKIP path never short-circuits
  a feature that must be tested.
- Given a daemon run where the skill neither records results nor a skip (true omission/refusal),
  when the step runs, then the gate stays unsatisfied and the run HALTs as today — the fix
  removes the *SKIP-contradiction* HALT, not the genuine did-not-run HALT.

### Done When
- [ ] An acceptance test drives a no-endpoint feature through auto-mode manual_test and asserts:
      `done: true` on attempt 1, no `.pipeline/halt-user-input-required` written, run advances.
- [ ] An acceptance test asserts an endpoint feature with real FAILs still routes to build /
      HALTs per existing behavior (no regression, no laundering).
- [ ] A genuine no-record/refusal run still HALTs (the absent-marker signal survives).

---

## Story: manual_test is skipped for S-tier features

**Requirement:** ADR D5

As the conductor engine, I want an S-tier (trivial) feature to skip `manual_test` entirely — the
same way S-tier already skips `conflict_check` and `acceptance_specs` — so trivial work is not
gated on manual testing, while enforcement for M/L features is untouched.

### Acceptance Criteria

#### Happy Path
- Given `state.complexity_tier === 'S'`, when the selector evaluates the `manual_test` step, then
  the step is skipped (`getStepStatus === 'skipped'`) and no `.pipeline/manual-test-results.md`
  marker is required.
- Given an S-tier feature where manual_test is skipped, when `prd_audit`'s prerequisites are
  checked, then the skipped `manual_test` satisfies the `prerequisites: ['manual_test']` gate (a
  `skipped` step counts as resolved for downstream prereqs and the selector) and the tail chain
  proceeds.

#### Negative Paths
- Given `state.complexity_tier === 'M'` or `'L'`, when the selector evaluates `manual_test`, then
  the step is NOT skipped — it runs and gates exactly as today (S-tier skip must not leak to M/L).
- Given an S-tier project that attempts to downgrade manual_test enforcement via a local skill
  override, when enforcement resolves, then it is still `gating` — D5 changes tier policy only,
  never enforcement (`manual_test` stays in `ENFORCEMENT_LOCKED_STEPS`).
- Given an M/L feature whose manual_test genuinely FAILs, when failure routing runs, then it still
  kicks back to build / HALTs per the existing #367 contract — D5 does not reopen the "auto-skip
  closed" hole for failing manual tests.

### Done When
- [ ] `manual_test` step def carries `skippableForTiers: ['S']`; a selector unit test asserts
      S-tier → skipped, M/L → not skipped.
- [ ] A test asserts an S-tier skipped `manual_test` satisfies `prd_audit`'s prerequisite.
- [ ] A test asserts enforcement stays `gating` for manual_test regardless of tier (no downgrade).
- [ ] The existing M/L FAIL→build kickback / HALT behavior is unchanged (regression).
