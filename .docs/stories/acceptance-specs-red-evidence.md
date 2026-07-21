**Status:** Accepted

# Stories: acceptance_specs RED-evidence determinism (#741)

Technical track (no PRD). Acceptance criteria derived from the technical intent and
`adr-2026-07-21-engine-owned-acceptance-red-execution`. Terms:
- **RED marker** = `.pipeline/acceptance-specs-red.json` at the worktree root (the path the
  `acceptance_specs` gate reads).
- **Run contract** = `.pipeline/acceptance-specs-run.json` = `{ command, cwd, targetSpecs }`.

---

## Story: Engine self-heals a missing RED marker by executing the recorded run contract

**Requirement:** T-1

As the build engine, I want to execute a feature's committed acceptance specs myself when the
RED marker is absent, so that a legitimately-progressing build advances without manual
intervention or a HALT.

### Acceptance Criteria

#### Happy Path
- Given committed acceptance spec files and a valid run contract exist in the worktree, and the
  RED marker is absent, when the `acceptance_specs` completion gate is evaluated, then the engine
  executes the contract's `command` from the contract's `cwd`, writes the RED marker to the
  worktree root, re-validates it, and the step passes — without re-dispatching the skill.
- Given the engine-run specs fail (failed>=1, skipped==0, errors==0, executed>=1), when the
  engine re-validates the marker it wrote, then the gate reports done and the daemon does not HALT.

#### Negative Paths
- Given no committed acceptance spec files exist, when the gate is evaluated, then the engine does
  NOT attempt a run and the step fails with "no acceptance spec files present" (unchanged behavior).
- Given the contract `command` exits non-zero for an infrastructure reason (runner not installed),
  when the engine executes it, then the produced marker shows `errors>0`/`executed==0`, the gate
  fails with real evidence naming the run failure — never a bare "marker missing" and never a
  fabricated passing marker.
- Given the engine already ran the contract once this step, when the gate is re-evaluated, then the
  engine does NOT re-execute (self-heal is attempted at most once per step attempt — no exec inside
  the pure predicate).

### Done When
- [ ] With specs + valid contract present and no RED marker, a single gate evaluation results in the
      RED marker existing at `<worktree>/.pipeline/acceptance-specs-red.json` and the step passing.
- [ ] The `acceptance_specs` completion predicate in `artifacts.ts` performs no subprocess exec (a
      test asserts the predicate is a pure read; execution lives in the step/retry seam).
- [ ] A run that selects 0 tests yields a `failed`/`errors` verdict, not a "missing" verdict.

---

## Story: writing-system-tests records the run contract at authoring time

**Requirement:** T-2

As the writing-system-tests skill, I want to record the exact command, cwd, and target specs I
intend to run, so that the engine can execute them deterministically without guessing.

### Acceptance Criteria

#### Happy Path
- Given the skill authors acceptance spec files, when it completes authoring, then
  `.pipeline/acceptance-specs-run.json` exists containing `command`, `cwd`, and a non-empty
  `targetSpecs` array naming the feature's spec files.
- Given the skill also executes the specs itself, when it records the RED marker, then the marker
  and the run contract agree on `command` and `targetSpecs`.

#### Negative Paths
- Given the skill records `targetSpecs` that do not match any committed spec file, when the engine
  cross-checks the contract against the globbed spec files, then the mismatch is rejected with a
  clear reason (the contract must name real, committed specs).
- Given the skill records a `cwd` that does not exist in the worktree, when the engine prepares to
  execute, then it fails with an explicit "contract cwd not found" reason, not a silent wrong-dir run.

### Done When
- [ ] `skills/writing-system-tests/SKILL.md` instructs writing `acceptance-specs-run.json` at
      authoring time and documents its `{command, cwd, targetSpecs}` shape.
- [ ] The engine validates `targetSpecs` are real committed specs and `cwd` exists before executing.

---

## Story: RED marker is authoritative at the worktree root regardless of test cwd

**Requirement:** T-3

As the build engine in a nested-package project, I want the RED marker to always resolve at the
worktree root, so that a test command run from a subdirectory cannot strand the marker where the
gate never looks.

### Acceptance Criteria

#### Happy Path
- Given a project whose specs run via `cd src/conductor && <runner>`, when the engine executes the
  contract and writes the marker, then the marker is written to `<worktree>/.pipeline/`
  (the gate's authoritative path), NOT to `<worktree>/src/conductor/.pipeline/`.
- Given a marker was written by an external writer into a nested `.pipeline/` (e.g. `src/conductor/`),
  when the engine self-heals, then it normalizes/relocates that evidence to the root path before
  validation so it is not lost.

#### Negative Paths
- Given only a nested `src/conductor/.pipeline/acceptance-specs-red.json` exists (no root marker) and
  no run contract, when the gate is evaluated, then the step fails with an explicit reason (marker
  not at authoritative path) rather than passing on the stray file OR silently HALTing as "missing".
- Given both a root marker and a stale nested marker exist, when the gate is evaluated, then only the
  root marker is authoritative (the nested one never overrides it).

### Done When
- [ ] An engine self-heal in a `cd`-into-subdir project produces the marker at the worktree root.
- [ ] The completion predicate reads only the worktree-root marker path (a test pins this).

---

## Story: Genuine non-RED runs fail the gate with real evidence (no false GREEN)

**Requirement:** T-4

As the build engine, I want specs that do not truly go RED to fail the gate with real evidence, so
that no build is declared GREEN on specs that passed, were skipped, or errored at collection.

### Acceptance Criteria

#### Happy Path (of the guard)
- Given the engine executes the contract and the specs PASS (failed==0), when it re-validates, then
  the gate fails with a "did not establish RED (0 failed)" reason and no passing marker is fabricated.

#### Negative Paths
- Given the engine-run specs are all SKIPPED/deselected (skipped>0, executed==0), when re-validated,
  then the gate fails ("specs skipped — RED not established").
- Given the engine-run specs ERROR at import/collection (errors>0), when re-validated, then the gate
  fails ("collection errors — RED not established").
- Given a run that executes 0 tests (bad selector), when re-validated, then the gate fails
  ("executed 0 — command did not select the feature's specs"), reusing the existing validator.

### Done When
- [ ] Each of PASS / skipped / errors / executed==0 produces a distinct failing reason, not "missing".
- [ ] The existing `validateAcceptanceRedEvidence` is reused unchanged for the engine-written marker.

---

## Story: Absent run contract fails safe, never silently passes

**Requirement:** T-5

As the build engine, I want a missing run contract to fail with a clear reason (and a forced-execution
retry directive), so that an older skill or a skill that died before recording the contract cannot
either HALT opaquely or slip through.

### Acceptance Criteria

#### Happy Path
- Given committed spec files but NO run contract and NO RED marker, when the gate is evaluated, then
  the engine cannot self-heal blindly and the step fails with an explicit "run contract missing —
  cannot execute specs deterministically" reason.
- Given the step retries after a "contract missing" failure, when the skill is re-dispatched, then it
  receives a hard directive to author the contract AND execute the specs (not an identical prompt).

#### Negative Paths
- Given a run contract file that is present but malformed JSON, when the engine reads it, then it fails
  with "invalid run contract JSON" — it does not crash and does not fall back to a blind guess.
- Given a run contract missing a required field (`command`), when validated, then it is rejected with
  a field-level reason.

### Done When
- [ ] Missing/malformed contract yields an explicit, greppable failure reason — never a silent pass
      and never a bare "marker missing → HALT".
- [ ] The retry directive text names the missing contract and requires execution.

---

## Story: Daemon self-recovers the #297/#733 failure without operator intervention

**Requirement:** T-6

As the operator, I want the daemon to recover the acceptance_specs step on its own when the specs
genuinely run RED, so that I no longer hand-write `acceptance-specs-red.json` and re-kick.

### Acceptance Criteria

#### Happy Path
- Given a feature whose committed specs go RED and whose skill recorded a valid contract, when the
  first `acceptance_specs` gate evaluation finds no marker, then the engine self-heals in that same
  step attempt and the build proceeds — with zero `↻ retry` HALTs and zero manual marker writes.

#### Negative Paths
- Given the specs genuinely do not go RED (a real product defect in the specs), when the engine
  self-heals and re-validates, then the step still fails (RED not established) — self-heal fixes the
  plumbing, never masks a genuinely non-RED spec.
- Given the daemon is in auto mode, when self-heal succeeds, then no operator-facing HALT is emitted
  for this step (the log shows the engine RED run, not "retries exhausted").

### Done When
- [ ] A regression scenario reproducing #733 (specs committed, marker absent, valid contract) passes
      the step deterministically without HALT.
- [ ] Daemon log for the recovered step shows an engine RED-run line, not a "retries exhausted" HALT.
