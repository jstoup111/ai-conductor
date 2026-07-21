---
Status: APPROVED
Date: 2026-07-21
Deciders: operator (James Stoup)
Feature: acceptance_specs RED-evidence determinism (#741)
---

# ADR: Engine-owned RED execution for acceptance_specs, driven by a skill-recorded run contract

## Status
APPROVED

## Supersedes
Supersedes the "**fix the skill, not an engine workaround**" convention clause of the
#297 story `writing-system-tests-red-exit-gate.md` (Accepted; no backing ADR). That
clause is falsified by production evidence — the prompt-only skill exit gate recurred as
a HALT on the #733 build (2026-07-21) — and contradicts this repo's own Design Principle
("never rely on prompt discipline for what machinery can enforce"). The #297 story's
skill-side exit gate is RETAINED as best-effort (its first-attempt happy path still holds:
if the skill records the marker, no self-heal is needed); only its prohibition on an engine
mechanism is superseded. The engine self-heal is the authoritative deterministic guarantee.

## Context

The `acceptance_specs` step dispatches the `/writing-system-tests` skill in autonomous
print mode. The engine gate (`artifacts.ts:1099`, `ACCEPTANCE_SPECS_RED_EVIDENCE =
'.pipeline/acceptance-specs-red.json'`) correctly requires the feature's specs to have
actually run RED (failed>=1, skipped==0, errors==0, executed>=1), not merely to exist.

Two failure modes both surface as "marker missing → HALT, retries can't recover":

1. **Non-execution** — the skill commits spec files without running them; no marker is
   written, and re-dispatching the same print-mode session on retry is a ~15s no-op
   (observed: #733 build 2026-07-21, tries 2/3 = 16s/13s; earlier #297).
2. **Cwd-misplacement** — nested-package projects run specs via `cd src/conductor &&
   <runner>`; `writing-system-tests/SKILL.md:409` writes the marker as a cwd-relative
   path, which can strand it in `src/conductor/.pipeline/` (verified: that dir exists in
   the halted worktree with `dispatch-count`, absent from the primary checkout) while the
   gate reads only the worktree-root `.pipeline/`.

#297 attempted a **prompt-only** remediation (a self-enforced exit gate in SKILL.md). It
is non-deterministic — it recovered on the 2026-07-20T23:06 dispatch but HALTed on the
2026-07-21T08:35 one. Per the repo Design Principle, prompt discipline drifts; mechanical
work must be engine-enforced.

**Key constraint (verified):** there is NO configured test command anywhere in the engine
— the run command exists ONLY inside the RED marker (validated `artifacts.ts:597`). So the
engine cannot derive a correct cross-project invocation without re-homing the cwd/runner
bug into itself.

## Decision

Adopt the **Hybrid (C)** design:

1. **Skill records a run contract early.** When `/writing-system-tests` authors the specs,
   it writes `.pipeline/acceptance-specs-run.json` = `{ command, cwd, targetSpecs }` — the
   exact invocation and working directory it intends. This is the skill's judgement output
   (it knows the runner and layout); no engine guessing.

2. **Engine owns execution, deterministically.** When the `acceptance_specs` completion
   gate reports the RED marker missing/invalid but spec files are committed, the engine
   executes the recorded contract itself (from the recorded `cwd`) as a **step-path
   self-heal** — NOT inside the completion predicate, and NOT by re-dispatching the skill.
   It writes `.pipeline/acceptance-specs-red.json` to the **authoritative worktree-root
   path**, then re-runs the existing `validateAcceptanceRedEvidence`.

3. **Completion predicate stays a pure read.** `artifacts.ts` `acceptance_specs` keeps
   reading only the authoritative root marker — no subprocess in a predicate that may be
   evaluated repeatedly. The execution lives in the `Conductor.run` step/retry seam,
   alongside the existing `deriveCompletion`/self-heal precedent.

4. **Cwd-robust by construction.** Because the engine writes the marker to the root path
   itself, a subdir-relative write can no longer strand it. (Defensive: the self-heal also
   tolerates a marker already present at the nested path by normalizing it to root.)

5. **Negative paths preserved.** The engine re-validates via the existing validator: specs
   that genuinely PASS, are skipped/deselected, or error at collection still FAIL the gate
   — now with real evidence ("executed 0 / failed 0"), never a fabricated marker and never
   a bare "missing → HALT".

## Consequences

**Positive:** both failure modes close deterministically; the daemon self-recovers without
the manual `red.json` write; the agent keeps only the judgement half (authoring specs);
matches the Design Principle (deterministic machinery over prompt discipline); reuses the
existing validator so the RED contract is unchanged.

**Negative / cost:** one new tiny contract file and a two-step handshake; the engine gains
a controlled subprocess-exec in the step seam (bounded: it runs the skill-recorded command,
no more privileged than the skill itself, already inside the skip-permissions worktree).

**Fallback:** if the run contract is absent (older skill, or the skill failed before
recording it), the engine cannot self-heal blindly — it fails the gate with a clear
"run contract missing" reason and (optionally) a hardened forced-execution retry directive.
This keeps the change safe when the contract is not yet produced.

## Evidence
- `.daemon/daemon.log` 2026-07-21T08:35:40Z–08:38:39Z (#733 HALT; tries 2/3 = 16s/13s)
- Marker mtime 08:45:31Z (7 min post-HALT) → manual remediation, operator-confirmed
- `artifacts.ts:550` (marker constant), `:597` (command validated), `:1099-1131` (gate)
- `skills/writing-system-tests/SKILL.md:409` (cwd-relative marker write)
- Two `.pipeline/` dirs in the halted worktree; only root in primary checkout
- Prior art: #297 (prompt-only fix), PR #181 (RED gate), #280 (retries blind to progress)

## Confidence & Assumptions
- Engine can exec a recorded command in the worktree step seam — **verified** ~95% (the
  worktree already runs skill subprocesses with skip-permissions; the runner is the same
  environment).
- Re-validating the engine-produced marker with the existing validator preserves all
  negative paths — **verified** ~90% (same `validateAcceptanceRedEvidence`).
- The skill can reliably record `{command,cwd,targetSpecs}` at authoring time — **inferred**
  ~85% (it already emits these fields into `red.json` today; moving them earlier is a small
  SKILL.md change). Load-bearing but low-impact-if-wrong (fallback path covers absence).
