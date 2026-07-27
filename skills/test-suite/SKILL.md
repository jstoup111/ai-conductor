---
name: test-suite
description: "Run the mandatory aggregate verification gate between BUILD and SHIP."
enforcement: gating
phase: build
standalone: true
requires: []
---

## Purpose

Obtain a current aggregate result from the repository-configured aggregate verifier after BUILD
and before manual validation begins.

## Gate

1. Read the repository configuration for its declared aggregate verifier, working directory, and
   timeout.
2. Invoke that repository-configured aggregate verifier exactly once and retain its result as the
   gate evidence.
3. A passing result satisfies this gate and permits the next SHIP activity.
4. A failure blocks SHIP immediately. Stop progression, report the actionable failure evidence,
   and route remediation back to `/tdd` for a focused repair or `/pipeline` for coordinated work.
5. After remediation, repeat this gate and require new passing evidence before entering SHIP.

## Rules

- This is mandatory after BUILD; it cannot be skipped by complexity tier or substituted with a
  scoped-test result.
- Do not replace the declared verifier with a repository-specific command.
- Treat a missing, malformed, stale, timed-out, unlaunchable, or non-zero result as a failure.
- Record only the verifier outcome and actionable evidence needed for remediation.
