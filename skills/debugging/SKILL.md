---
name: debugging
description: "Use when encountering any bug, test failure, or unexpected behavior. Four-phase systematic investigation: root cause before fix. No fixes without evidence."
enforcement: gating
phase: build
standalone: true
requires: []
---

## Purpose

Prevents shotgun debugging by enforcing systematic root cause investigation before any fix
is attempted. Evidence-based diagnosis catches the real problem instead of treating symptoms.

## Practices

### Phase 1: Investigate

**GATE: No fix proposals until investigation is complete.**

1. **Read the error.** Fully. Not just the first line — the full stack trace, log output, and context.

2. **Reproduce.** Can you make it happen reliably?
   - If yes: note the exact reproduction steps
   - If intermittent: note the conditions under which it occurs and doesn't occur

3. **Check what changed.** What's different from when it last worked?
   - `git log --oneline -10` — recent commits
   - `git diff` — uncommitted changes
   - Environment changes (new dependency versions, config changes)

4. **Gather evidence.** Before forming theories:
   - Read the failing code path line by line
   - Add temporary logging/debugging output at key points
   - Check input data — is it what you expect?
   - Check database state — are records in the expected state?
   - If tech-context loaded: use stack-specific tools (e.g., `rails console`, `binding.pry`)

### Phase 2: Pattern Analysis

5. **Find a working example.** Is there similar code that works correctly?
   - Compare the working and broken versions
   - What's different?

6. **Check for known patterns.** Search `.memory/gotchas/` for similar issues.

7. **Identify the boundary.** Where does correct data become incorrect?
   - Trace data flow from input to output
   - Find the exact line/function where the bug manifests

### Phase 3: Hypothesis

8. **Form ONE hypothesis.** Based on evidence gathered, what's the single most likely cause?
   - State it clearly: "The bug is caused by [X] because [evidence]"
   - If you can't form a hypothesis, you need more evidence — go back to Phase 1

9. **Test minimally.** Verify the hypothesis before implementing a fix:
   - Can you confirm the hypothesis with a targeted check?
   - Does the hypothesis explain ALL observed symptoms?
   - If the hypothesis is wrong, form a new one — don't implement anyway

### Phase 4: Fix

10. **Write a failing test** that reproduces the bug (RED phase of TDD)

11. **Implement a single fix** targeting the root cause (GREEN phase)

12. **Verify:**
    - The reproduction test passes
    - The full test suite passes
    - The original symptoms are gone

### The 3-Strike Rule

If 3 attempted fixes fail to resolve the issue:

**STOP.** You are likely fixing symptoms, not the root cause.

Ask yourself:
- Is the architecture wrong, not just the implementation?
- Am I making assumptions about how this code works that are incorrect?
- Should I read more code before trying again?
- Is this a deeper systemic issue (data model, dependency, race condition)?

Escalate to the user with a summary of what you've tried and why it didn't work.

## Verification

- [ ] Error message read fully (not just first line)
- [ ] Bug reproduced reliably (or intermittent conditions documented)
- [ ] Recent changes checked (git log, git diff)
- [ ] Evidence gathered before forming hypothesis
- [ ] Working example found and compared
- [ ] Single hypothesis formed with supporting evidence
- [ ] Hypothesis tested before implementing fix
- [ ] Failing test written that reproduces the bug
- [ ] Fix targets root cause, not symptoms
- [ ] Full test suite passes after fix
