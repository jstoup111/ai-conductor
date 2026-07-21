---
status: APPROVED
date: 2026-07-21
approved: 2026-07-21
supersedes: none
amends: none
deciders: James Stoup
issues: "#385"
---

# ADR: manual_test completion marker becomes engine-stamped via a record CLI, with an auditable SKIP sentinel, and manual_test becomes S-tier skippable

## Status

APPROVED (2026-07-21, operator-confirmed in engineer session — Approach C selected over the
skill-contract-only hypothesis A and the engine-auto-skip alternative B; Decision D5 —
S-tier skippability — added in the same session at operator request).

## Context

In daemon/auto mode the `manual_test` step HALTs after exhausting all retries when the
`manual-test` skill exits without writing `.pipeline/manual-test-results.md` (intake #385,
observed 2026-07-06 on `prd-audit-kickback-preserves-task-status`: 28/28 tasks built and
committed, `build` passed, yet three straight `manual_test` attempts wrote no marker and the
run HALTed). Verified in current `origin/main`:

- The completion gate is a custom predicate, `CUSTOM_COMPLETION_PREDICATES.manual_test`
  (`src/conductor/src/engine/artifacts.ts`, glob `STEP_ARTIFACT_GLOBS.manual_test =
  ['.pipeline/manual-test-results.md']`), whose missing-file branch fails the step with
  "…is missing — the manual-test skill must record per-story PASS/FAIL results before
  exiting". (verified)
- The skill's own Step 0 tells a no-endpoint/UI feature to "report SKIP … so conduct can
  mark the step as done" (`skills/manual-test/SKILL.md:31-34`) — but writes **no** marker,
  so the gate cannot pass. This is a direct contract contradiction. (verified)
- A missing marker carries no FAIL rows, so the `manual_test`→build kickback
  (`conductor.ts:4170-4178`) does not engage; the run falls through to the generic gating
  HALT (`conductor.ts:4775-4819`) writing `.pipeline/halt-user-input-required`. (verified)
- The lost-run pathology is **auto-mode only** (`conductor.ts:4147`); interactive mode
  surfaces a recovery menu (`conductor.ts:4889`), though `manual_test` is `enforcement:
  gating` so the menu's `skip` is blocked — the human must retry or write the marker by
  hand. The root contradiction is mode-agnostic. (verified)

This is the third instance of the identical "skill exits without its completion marker in
auto mode" failure family, after #281 (`finish` → `.pipeline/finish-choice`) and #297
(`acceptance_specs` → `.pipeline/acceptance-specs-red.json`). The repo Design Principle
(CLAUDE.md) is explicit: recurring marker-omission is fixed by machinery that stamps the
marker at the moment of the action, not by a stronger prompt.

### Constraints from standing behavior (preserved, not amended)

- **#367 whitewash guard** — the predicate records fail-evidence (HEAD sha + excerpt) on
  FAIL rows and refuses a later FAIL→PASS flip unless HEAD moved. The new SKIP path must not
  weaken this: a SKIP sentinel is only valid when the latest attempt has **no FAIL rows**.
- **manual_test→build FAIL kickback** and the **SHIP parallel-validation fan-out group**
  (`members: ['manual_test','prd_audit','architecture_review_as_built']`) read step status
  and the results file; the record CLI must produce a file shape they already understand
  (append-an-attempt-section), adding only a recognized SKIP section — no schema break.
- **adr-2026-07-11 (finish-record) precedent** — the marker is the *commit point*: written
  only after the underlying evidence is real, fail-closed (nothing written on error), never
  auto-fabricated by the engine.

## Decision

**Approach C.** Split by facet exactly as #281 did for `finish`: the engine owns the marker
*write* deterministically via a new CLI; the agent still owns the *evidence* (observed
PASS/FAIL, or the reasoned decision that the feature has no endpoint/UI surface). The engine
never fabricates test results.

### D1 — New `conduct-ts manual-test-record` subcommand (engine-owned, fail-closed writer)

Add `src/conductor/src/engine/manual-test-record-cli.ts` following the `finish-record-cli.ts`
trio: `detectManualTestRecordCommand(argv)` (matches `argv[2] === 'manual-test-record'`),
`dispatchManualTestRecord(...)`, `makeProductionManualTestRecordRunners()`. Two record modes:

- `--skip --reason <text> --pipeline-dir <dir>` — append a recognized **SKIP sentinel**
  attempt section to `.pipeline/manual-test-results.md`.
- `--results <path|-> --pipeline-dir <dir>` — append a real per-story PASS/FAIL attempt
  section produced by the skill after exercising the app.

Both writes are atomic and **fail-closed**: on any write error nothing is left behind (no
false completion), mirroring `finish-record`'s "marker is the commit point" guarantee. The
CLI **appends** an `## Attempt N` section (never overwrites), preserving #367 history and the
"latest attempt" evaluation.

### D2 — Completion predicate recognizes the SKIP sentinel as done

Extend `CUSTOM_COMPLETION_PREDICATES.manual_test` so that a latest attempt whose section is
the SKIP sentinel (a fixed, machine-recognizable marker line + reason) evaluates `done: true`
— subject to the same **freshness** check as a PASS result (mtime newer than session start)
and only when there are **no FAIL rows** in that attempt. FAIL-row handling, the whitewash
guard, and the missing/stale branches are unchanged. The engine still cannot pass the step
with a fabricated result — a SKIP is a recorded, reasoned decision, not a silent bypass.

### D3 — Skill contract: the record CLI is the guaranteed final act on every exit path

`skills/manual-test/SKILL.md` is rewritten so that **every** exit branch ends by invoking
`conduct-ts manual-test-record` against the **absolute worktree `.pipeline` path supplied in
the step's system prompt**, before any cleanup/`cd`:

- Step 0 SKIP → `manual-test-record --skip --reason "…"` (replaces the "conduct marks it
  done" language that has no engine backing).
- Real run (PASS or FAIL) → `manual-test-record --results …`.

Add a **refusal contract** (an absent marker remains the deliberate "did not run" signal —
never hand-write it to paper over a blocked gate) and a verification-checklist line, matching
the `finish`/`writing-system-tests` SKILL.md pattern.

### D4 — Retry hint points at the exact command

Extend `buildRetryHint` (`conductor.ts`) `manual_test` case so a missing-marker retry echoes
the `conduct-ts manual-test-record …` command (as the `finish`+`recording` case already does),
so even a drifting retry self-heals toward the deterministic writer.

### D5 — manual_test becomes S-tier skippable (`skippableForTiers: ['S']`)

Set `skippableForTiers: ['S']` on the `manual_test` step definition (`steps.ts:169-188`,
currently `[]`). For an S-tier (trivial) feature the step is then skipped deterministically by
the selector (`selector.ts:71`) — marked `skipped`, which satisfies the downstream `prd_audit`
prerequisite and the selector, exactly as a config-disable does today.

This is a deliberate, pre-run **complexity policy**, not a failure bypass. It is the same
gating-step-plus-S-tier-skip pattern already shipped for `conflict_check` (gating,
`skippableForTiers: ['S']`) and `acceptance_specs` (gating, `['S']`), so it introduces no new
mechanism.

**Why it does not reopen the #367 "auto-skip closed" hole (fail-routing Story 1):** that rule
removed the *advisory silent auto-skip of a FAILING manual_test after retries*. D5 is orthogonal:
- It never changes enforcement — `manual_test` stays `gating` and stays in
  `ENFORCEMENT_LOCKED_STEPS` (governed by `skill-resolver.ts`, which locks enforcement, not tier
  policy). At M/L tier a failing manual_test still HALTs; the recovery-menu `skip` is still refused.
- It is a pre-run tier decision, not a post-failure skip. An S-tier feature's manual_test never
  runs; it does not "skip a failure."

D5 also supersedes the need for the assumed manual_test feature-type skip in the unbuilt
`parallel-validation-phase-fan-out` spec for the S-tier case: an S-tier feature's manual_test is a
`skipped` group member (contributes no verdict), so that spec must NOT add a second skip path.

Interaction with D1–D4: at S tier, the record CLI and SKIP sentinel are simply not exercised (the
step never runs). They remain the mechanism for M/L features that have no endpoint/UI stories —
where manual_test still runs and must complete cleanly. The two are complementary: D5 covers "the
feature is trivial (S)"; D1–D4 cover "the feature is non-trivial but has nothing to manually test."

## Wiring Surface (design-time)

- **`manual-test-record` subcommand** → wired into the `conduct-ts` CLI dispatch in
  `src/conductor/src/index.ts`, immediately after the existing finish-record block
  (`index.ts:350-352`): a `detectManualTestRecordCommand(process.argv)` guard that, on match,
  `await dispatchManualTestRecord(...)` and exits — identical shape to finish-record.
- **SKIP-sentinel recognition** → invoked inside `checkStepCompletion` via the existing
  `CUSTOM_COMPLETION_PREDICATES.manual_test` entry (`artifacts.ts`), already called from the
  daemon retry loop (`conductor.ts:3180`) and the interactive path (`conductor.ts:4889`).
- **Retry hint** → emitted from `buildRetryHint` (`conductor.ts:6059-6095`), already consumed
  by the `step_retry` dispatch at `conductor.ts:4079`.
- **Skill invocation** → the `manual-test` skill session runs the CLI; the step's system
  prompt already supplies the absolute pipeline dir (same channel finish uses).
- **S-tier skip (D5)** → the `skippableForTiers: ['S']` value on the `manual_test` step def
  (`src/conductor/src/engine/steps.ts`) is consumed by the existing selector tier-skip check
  (`src/conductor/src/engine/selector.ts:71`) — no new call site; it reuses the same code path
  that already skips `conflict_check`/`acceptance_specs` at S tier.

## Consequences

- **Positive:** closes the daemon HALT for no-endpoint/UI features and removes the interactive
  gating-menu dead-end; the marker can no longer be silently omitted because the write is a
  named CLI the retry hint points at; the skip is auditable (reason recorded in the file); no
  new #367 whitewash surface; follows a twice-proven in-repo precedent.
- **Negative / cost:** larger surface than a prose patch (new CLI module + predicate branch +
  skill rewrite + retry hint + tests). A new SKIP sentinel format must be chosen carefully so
  the parallel-validation group and #367 guard keep parsing the file.
- **Follow-up (not in this ADR):** the recurrence across three steps suggests a shared
  auto-mode exit-contract/record helper; tracked as a future intake, not built here.

## Alternatives Considered

- **A — skill-contract only (filer's hypothesis).** Make the SKILL.md write the marker on
  every exit. Rejected as the primary fix: prompt discipline is exactly what drifted three
  times; violates the Design Principle. (Its every-exit-path idea survives as D3, but backed
  by the engine writer rather than free-hand.)
- **B — engine auto-skip from story analysis.** Have the engine guess "no endpoint/UI
  stories" and mark the step `skipped`. Rejected: `steps.ts:183` shows the harness already
  guards against the "#367 silent auto-skip" — mechanically inferring endpoint-ness from
  story prose can whitewash a feature that genuinely needs manual testing.
