# ADR: Sandbox harness self-builds via a throwaway CLAUDE_CONFIG_DIR

**Date:** 2026-06-30
**Status:** APPROVED
**Feature:** Harness daemon self-host guardrails
**Related:** adr-2026-06-30-self-host-detection-seam, adr-2026-06-30-halt-based-release-gates

## Context

Claude Code loads skills/hooks from `~/.claude/skills` / `~/.claude/hooks`, which are **global
symlinks into the harness main checkout**, shared live by the operator's ~20 concurrent sessions.

A daemon self-build edits skills/hooks/conductor inside its build worktree, but the running engine
keeps executing the *old main-checkout* versions. Two consequences:

1. **Verification gap:** the build "verifies" harness changes against the code it is replacing — a
   green PR can be green against the wrong version (the harness instance of
   [[feedback_orphaned_primitives]] false-pass).
2. **Corruption risk (if we naively fixed #1 in place):** repointing the global symlinks at the
   worktree would expose the operator's live sessions to broken intermediate skill states.

## Decision

For a harness self-build only, run the build step with a **throwaway `CLAUDE_CONFIG_DIR`** whose
`skills/` and `hooks/` symlink into the **build worktree's edited copies**. The self-build thus
exercises its own edited harness, while the global `~/.claude` the operator's sessions read is
**never mutated**. The sandbox is torn down after the build (pass or fail) under a
try/finally-style guarantee; the global symlinks are left byte-for-byte as found.

`CLAUDE_CONFIG_DIR` is not read anywhere in the codebase today; this feature introduces its use.
The sandbox attaches at the existing build step (`engine/steps.ts` `DefaultStepRunner`).

Isolation correctness is **safety-critical** and therefore a built primitive with an explicit
contract, not a convention:
- No sandbox symlink ever resolves to a global-config target (invariant, TR-6).
- Teardown runs on the error/crash branch, asserted — not assumed from the happy path (TR-5).
- Provisioning failure (EACCES/disk) never launches a partially-built sandbox; it fails/HALTs and
  removes the partial (TR-5).
- Any ambient `CLAUDE_CONFIG_DIR` in the daemon env is restored after the child build (no bleed).

## Consequences

- **Positive:** true self-verification — the daemon exercises its real edits before the operator
  ever sees the PR; closes the verification gap.
- **Positive:** zero mutation of global state → the concurrency hazard is eliminated by
  construction, not by care.
- **Negative:** sandbox provisioning/teardown is new machinery with adversarial tests; the
  isolation contract must be airtight. Accepted — this is the safety core of the feature.
- The self-build still ends in a HALT for the operator to re-install + `/verify` + merge
  (see the HALT-gates ADR); the sandbox proves the edits internally, it does not authorize a merge.

## Alternatives rejected

- **Gate-only (HALT for manual verify, no self-exercise):** leaves the daemon unable to certify its
  own harness changes at all. Rejected in favor of true self-verification.
- **In-place relink of global `~/.claude/skills` during the build:** mutates state shared with ~20
  live sessions; a crash/overlap strands them on worktree skills. Rejected as a contention hazard.
