# ADR: `conduct-ts finish-record` — deterministic finish-completion marker primitive

Status: APPROVED
Date: 2026-07-07
Refs: jstoup111/ai-conductor#281

## Context

In daemon auto mode the finish step (haiku @ low effort, single print-mode turn, fresh
session) recurrently ends its turn without writing `.pipeline/finish-choice`, failing the
completion gate on try 1 and burning a full SHIP-chain retry (~6–10 min + one session)
per occurrence (3 occurrences in the 21h of `.daemon/daemon.log` before this ADR;
2026-07-06T17:10Z, 2026-07-07T00:15Z, 2026-07-07T14:06Z). The engine's auto-mode prompt
(`step-runners.ts`) already instructs the marker write with absolute paths and "step is
NOT complete until" language — the failure mode is **instruction drop by a small model
across a long mechanical tail** (STOP-gate checks + two file writes at exact absolute
paths), not instruction absence. Retries pass because the `RETRY:` reason line plus the
resumed step session leave exactly one salient act.

## Decision

1. **New CLI subcommand** `conduct-ts finish-record` in
   `src/conductor/src/engine/finish-record-cli.ts`, following the established
   `detect<X>Command`/`dispatch<X>` pair wired into `src/index.ts`:

   ```
   conduct-ts finish-record --choice pr   --pr-url <url> --pipeline-dir <abs>
   conduct-ts finish-record --choice keep                --pipeline-dir <abs>
   ```

   - Accepts ONLY `pr` and `keep` (the two daemon-auto outcomes; `merge-local`/
     `discard` are operator decisions the daemon gate rejects anyway).
   - `--pipeline-dir` MUST be absolute; a relative path is refused (guards the
     cd-into-main-repo write-misdirection class fixed for markers in PR #134).
   - Malformed/missing args print a usage guide and exit 1 — never fall through to the
     pipeline launcher (bug #178 lesson).

2. **Verification before any write (choice=pr):**
   - PR exists: `gh pr view --json url -q .url` non-empty (injectable gh runner).
   - Push evidence: reuse `headPushedToUpstream` from `engine/push-evidence.ts` —
     single source of truth with the completion gate's own check. `false` **and**
     `null` (indeterminate) both refuse — stricter than the gate's optional injection,
     never fail-open.
   - `choice=keep` skips both checks (no PR involved).

3. **Fail-closed, zero-write refusal:** any check failure, gh/git spawn error, or
   invalid argument exits non-zero having written NOTHING, with a one-line actionable
   reason on stderr. The absent marker remains the "finish refused" signal the
   conductor already understands. This primitive deliberately does NOT adopt
   shipped-record's degrade-never-block (warn + exit 0) posture: shipped-record's
   failure only degrades dedup, while a wrongly-written finish-choice is a false ship.

4. **Atomic-ordered writes (choice=pr):** read-modify-write
   `<pipeline-dir>/conduct-state.json` setting `pr_url` (preserving all other fields),
   THEN write `<pipeline-dir>/finish-choice` last. The marker is the commit point; a
   crash between writes cannot yield marker-without-pr_url.

5. **Skill exit contract (the self-enforced gate):** `skills/finish/SKILL.md` §4
   auto-mode is rewritten so the unattended flow ENDS with this one command, and the
   engine's auto-mode prompt block (`step-runners.ts`) names the exact command line
   (with the absolute `--pipeline-dir` it already computes) instead of describing two
   manual file writes. The completion gate in `artifacts.ts` is UNCHANGED — the
   primitive satisfies the gate; it does not replace, weaken, or bypass it (push
   evidence and halt-title checks still run independently at the gate).

## Consequences

- Try-1 finish success no longer depends on a haiku turn faithfully executing a ~6-step
  mechanical tail; it depends on one command invocation whose checks and writes are
  deterministic and unit-testable.
- Additive CLI surface → MINOR version bump; docs (README.md, src/conductor/README.md)
  updated in the same PR.
- The skill can still fail to invoke the command (instruction-drop moves up a level),
  but the obligation shrinks from six ordered acts to one; the existing retry budget
  remains the backstop and its trigger rate is expected to drop to the residual class.
- Testing: argv detection, refusal paths (missing PR, unpushed HEAD, null evidence,
  relative pipeline-dir), write ordering, and state-preservation are all pure-function
  or injectable-runner testable; per the injected-runner lesson (PR #143), one
  real-binary smoke test is required.

## Alternatives Rejected

- **SKILL.md prose hardening only:** the instruction already exists verbatim in the
  try-1 prompt and is dropped; more prose does not change the dynamics.
- **Model/effort bump for finish (haiku→sonnet):** raises every ship's cost, stays
  probabilistic, and leaves the mechanical tail model-executed; capacity was not the
  design point — determinism was.
- **Engine writes the marker itself on gate-satisfying evidence:** an engine-side
  workaround that hollows out the skill's self-enforced gate (rejected per the
  #156→#161 convention) and would guess the choice the skill must own.
