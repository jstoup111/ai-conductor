# Implementation Plan: writing-system-tests RED-run self-enforced exit gate

Stem: writing-system-tests-red-exit-gate
Track: technical
Tier: S

## Goal

Make the `writing-system-tests` skill enforce, in auto (daemon) mode, that it **executes** the
acceptance specs and records `.pipeline/acceptance-specs-red.json` from a real RED run as a hard
precondition of completion — so authoring+committing specs without running them is treated as an
incomplete step that fails its own exit check on the first attempt, and a retry that finds
committed-but-unexecuted specs is required to execute them rather than treating file-existence as
done. Prose-only edit to `skills/writing-system-tests/SKILL.md`; **no engine code changes** (per
the harness "fix the skill, not the engine workaround" convention).

## Files

- `skills/writing-system-tests/SKILL.md` — the only behavioral change.
- `CHANGELOG.md` — required `## [Unreleased]` entry (harness repo gate).

## Non-goals

- No change to the engine-side `acceptance_specs` completion check / RED-evidence gate (PR #181)
  — it is already correct; the skill must satisfy it on the first attempt.
- No change to retry budgeting or the engine's retry loop (#280 is a separate engine concern).
  The retry-side fix here is a **skill-contract instruction** telling a resumed session what to do,
  not an engine change.
- No VERSION bump beyond what the harness release flow already does (VERSION is operator-frozen
  per project policy).

## Tasks

### Task 1 — Add an explicit "Exit Gate (auto mode)" statement to §6

In `skills/writing-system-tests/SKILL.md` §6 ("Run and Verify RED"), immediately before or within
the "Record the RED evidence (gating)" block, add a clearly-labelled self-enforced exit-gate
paragraph, using the same hard-stop language already used by the §3e FR-coverage gate:

- State that in auto mode the step's exit condition is: `.pipeline/acceptance-specs-red.json`
  exists AND was written from a **real execution** of the feature's own specs showing genuine RED
  (`executed >= 1`, `failed >= 1`, `skipped == 0`, `errors == 0`).
- State explicitly: **authoring and committing the spec files is NOT completion.** A session that
  has written/committed specs but not executed them MUST run them and record the evidence before
  reporting the step complete — a hard stop under the daemon, not a logged warning.
- Reinforce the existing rule that SKIPPED/DESELECTED/collection-errored runs do not establish RED.

Estimated: 3 min.

### Task 2 — Add retry/resumption guidance

Add a short subsection (e.g. "### 6a. Resuming a retried step") stating: if this step is re-entered
(a retry) and the acceptance spec files are already present/committed but
`.pipeline/acceptance-specs-red.json` is **missing**, the session MUST treat the step as
**not done** — the missing execution marker proves the specs were never run — and MUST execute the
committed specs and record the RED evidence. It must NOT short-circuit to "specs already exist,
nothing to do." This is the exact failure that stranded ai-conductor#297 (tries 2–3 exited in ~9s
without running anything).

Estimated: 3 min.

### Task 3 — Strengthen the §7 verification checklist

In §7 ("Commit the Failing Tests") update the "Verification checklist before completing this skill"
so the RED-evidence line is stated as a **blocking exit gate**, not just a checklist item:
"`.pipeline/acceptance-specs-red.json` written from a REAL run (not merely spec files committed) —
the step is incomplete without it." Keep the ordering note that commit follows a verified RED run.

Estimated: 2 min.

### Task 4 — CHANGELOG entry

Add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`:
"writing-system-tests: execution of the new acceptance specs + recording
`.pipeline/acceptance-specs-red.json` is now a self-enforced exit gate in auto mode, and a retried
step that finds committed-but-unexecuted specs must execute them — fixes the daemon HALT where
specs were committed but never run (ai-conductor#297)."

Estimated: 2 min.

### Task 5 — Validate

Run `test/test_harness_integrity.sh` and confirm it passes (frontmatter intact, no duplicate
section numbers, cross-references intact, CHANGELOG has `## [Unreleased]`). Fix any failure before
completing. Re-read §6/§6a/§7 to confirm the exit-gate wording is unambiguous and uses hard-stop
language.

Estimated: 3 min.

## Verification

- `test/test_harness_integrity.sh` passes.
- `skills/writing-system-tests/SKILL.md` contains an explicit auto-mode exit gate making a real
  RED run + `.pipeline/acceptance-specs-red.json` a precondition of completion, plus retry/
  resumption guidance.
- `grep -n "acceptance-specs-red.json" skills/writing-system-tests/SKILL.md` shows the marker
  referenced in both the exit-gate statement and the retry-resumption guidance.
- `CHANGELOG.md` has the `## [Unreleased]` Fixed entry referencing ai-conductor#297.
- No files under `src/` changed (engine untouched).
