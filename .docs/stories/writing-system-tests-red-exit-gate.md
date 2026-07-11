# writing-system-tests RED-run self-enforced exit gate

Status: Accepted

## Context

In auto (daemon) mode the `writing-system-tests` skill authored and committed a 357-line
acceptance spec file but **never executed it**, so `.pipeline/acceptance-specs-red.json` was
never written. The engine's RED-evidence gate (PR #181) correctly refused the file-existence-only
evidence and the daemon HALTed (`daemon-lifecycle-controls`, 2026-07-04, ai-conductor#297).
Retries 2 and 3 saw the committed spec file, treated the work as done, and exited in ~9s each
without running anything — so the dispatch could not self-heal and required manual operator
remediation (which confirmed the specs were genuinely RED, 9/9 failed; zero code changes needed).

This mirrors the failure family of #281 (a skill exits in auto mode without writing its required
`.pipeline/` marker). The fix is the harness convention: make the skill's own exit gate enforce
execution — **fix the skill, not an engine workaround**.

## Story 1 — Executing the specs and recording RED is a self-enforced exit gate

As the daemon build loop, when the `writing-system-tests` skill runs in auto mode, the skill must
treat "run the new specs and record `.pipeline/acceptance-specs-red.json` from a real RED run" as
a hard exit condition, so the step is not reportable as complete on the first attempt without it.

### Happy Path

- **Given** a feature with `.docs/stories/` and no existing acceptance specs, running under the
  daemon in auto mode,
- **When** the `writing-system-tests` skill generates the acceptance specs, executes them against
  the project's test runner, and the feature's own specs fail for the right reason (genuine RED),
- **Then** the skill writes `.pipeline/acceptance-specs-red.json` capturing the real run
  (`executed >= 1`, `failed >= 1`, `skipped == 0`, `errors == 0`) **before** it reports the step
  complete, and only then commits the failing specs,
- **And** the engine's `acceptance_specs` completion check passes on the **first** attempt (no
  retry needed).

### Negative Paths

- **Given** the skill has authored and committed the acceptance spec files but has **not** run
  them (no `.pipeline/acceptance-specs-red.json` exists),
- **When** the skill reaches its exit/verification checklist in auto mode,
- **Then** the skill MUST NOT report the step complete — the presence of committed spec files on
  disk does not satisfy the exit gate; authoring+committing without executing is an incomplete
  step and the skill must execute the specs and record the RED evidence before completing.

- **Given** a run whose specs, when executed, are reported as SKIPPED / DESELECTED / collection-
  errored (never actually executed),
- **When** the skill evaluates the RED result,
- **Then** the skill MUST NOT write a passing `acceptance-specs-red.json` and MUST NOT report
  success — a non-executed run does not establish RED (consistent with the existing §6 rule).

## Story 2 — A retry that finds committed-but-unexecuted specs must execute them

As a retried daemon step whose prior attempt committed specs without running them, when the step
runs again, it must execute the already-committed specs rather than treating their existence on
disk as completed work.

### Happy Path

- **Given** a prior attempt committed the acceptance specs but left
  `.pipeline/acceptance-specs-red.json` missing, and the step is retried,
- **When** the retry session runs the `writing-system-tests` skill and observes committed spec
  files with no RED marker,
- **Then** the skill executes the committed specs, records `.pipeline/acceptance-specs-red.json`
  from that run, and only then reports complete — it does not short-circuit to "specs already
  exist, done."

### Negative Path

- **Given** a retry session that sees the committed spec files,
- **When** it considers exiting because the files exist,
- **Then** it MUST NOT exit as complete while `.pipeline/acceptance-specs-red.json` is missing —
  a missing execution marker means the specs were never run and the step is not done.

## Story 3 — The exit-gate contract is discoverable and validated

As a maintainer of the harness, when I read `skills/writing-system-tests/SKILL.md`, the
execute-and-record-RED requirement must be stated as an explicit self-enforced exit gate (not
merely an implied step ordering), so the skill's contract is unambiguous and survives harness
integrity validation.

### Happy Path

- **Given** the edited `skills/writing-system-tests/SKILL.md`,
- **When** `test/test_harness_integrity.sh` runs,
- **Then** the skill file still passes all structural checks (valid frontmatter with `name`,
  `description`, `enforcement`, `phase`; no duplicate section numbers; intact cross-references),
- **And** the file contains an explicit self-enforced exit-gate statement making
  `.pipeline/acceptance-specs-red.json` from a real RED run a precondition of completion in auto
  mode, plus explicit retry/resumption guidance.

### Negative Path

- **Given** the edit introduced a malformed frontmatter field or a duplicate section number,
- **When** `test/test_harness_integrity.sh` runs,
- **Then** it fails and the change is not landed until fixed.
