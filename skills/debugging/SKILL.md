---
name: debugging
description: "Use when encountering any bug, test failure, or unexpected behavior. Four-phase systematic investigation: root cause before fix. No fixes without evidence."
enforcement: gating
phase: build
standalone: true
requires: []
model: fable
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

3. **Recall related memory.** Before investigating further:
   - Search `.memory/gotchas/` for entries related to the error message, affected files, or domain area
   - Search `.memory/patterns/` for entries about how similar code paths work
   - If a relevant gotcha exists, test it as your first hypothesis

4. **Check what changed.** What's different from when it last worked?
   - `git log --oneline -10` — recent commits
   - `git diff` — uncommitted changes
   - Environment changes (new dependency versions, config changes)

5. **Gather evidence.** Before forming theories:
   - Read the failing code path line by line
   - Add temporary logging/debugging output at key points
   - Check input data — is it what you expect?
   - Check database state — are records in the expected state?
   - If tech-context loaded: use stack-specific tools (e.g., `rails console`, `binding.pry`)

### Phase 2: Pattern Analysis

6. **Find a working example.** Is there similar code that works correctly?
   - Compare the working and broken versions
   - What's different?

7. **Check for known patterns.** Cross-reference findings with `.memory/gotchas/` recalled in step 3.

8. **Identify the boundary.** Where does correct data become incorrect?
   - Trace data flow from input to output
   - Find the exact line/function where the bug manifests

### Phase 3: Hypothesis

9. **Form ONE hypothesis.** Based on evidence gathered, what's the single most likely cause?
   - State it clearly: "The bug is caused by [X] because [evidence]"
   - If you can't form a hypothesis, you need more evidence — go back to Phase 1

10. **Test minimally.** Verify the hypothesis before implementing a fix:
   - Can you confirm the hypothesis with a targeted check?
   - Does the hypothesis explain ALL observed symptoms?
   - If the hypothesis is wrong, form a new one — don't implement anyway

### Phase 4: Fix

**GATE: Before any fix, confirm the buggy code path is supposed to exist.**

This is the SHIP/fix instance of the harness-wide **design-conformance-before-effort**
convention (HARNESS.md → Key Conventions): the same check applies whenever code is written,
not only when it is fixed. A bug is only worth a fix cycle if the code that has it is sanctioned
by the authoritative design. Before writing a test or touching code, read the governing APPROVED
decision for the affected component — the relevant ADR in `.docs/decisions/` (Status: APPROVED) and/or the FR
in the approved PRD (`.docs/specs/`). Ask: **is this code path supposed to exist at all?**

- If the path **conforms** to the approved design → proceed to the fix below.
- If the path **violates or is superseded by** an APPROVED ADR/PRD → **STOP.** The correct
  output is a **conformance finding** (flag the gap; in pipeline/SHIP, that's a BLOCKED /
  kickback, not a patch). A bug on a condemned path is a **removal signal, not a fix target** —
  hardening code slated for deletion is wasted work.

This is deliberately the cheapest check (one ADR/PRD read) placed *before* the most expensive
action (RED test → implement → full suite → commit). Do the design check first, every time.

11. **Write a failing test** that reproduces the bug (RED phase of TDD)

12. **Implement a single fix** targeting the root cause (GREEN phase)

13. **Verify:**
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

### Memory Checkpoint

After a successful fix, evaluate whether the root cause is worth persisting:
- **Category: `gotchas/`** — If the bug's root cause was non-obvious (took >1 hypothesis to find)
- **Category: `patterns/`** — If the fix revealed a pattern in how the codebase handles similar cases

Skip if: the root cause was a simple typo, missing import, or other mechanical error.

## Verification

- [ ] Error message read fully (not just first line)
- [ ] Bug reproduced reliably (or intermittent conditions documented)
- [ ] `.memory/gotchas/` and `.memory/patterns/` searched before investigating
- [ ] Recent changes checked (git log, git diff)
- [ ] Evidence gathered before forming hypothesis
- [ ] Before fixing: confirmed the buggy code path conforms to the governing APPROVED ADR/PRD
      (a path that violates/supersedes an approved decision is flagged as a conformance finding,
      not patched)
- [ ] Working example found and compared
- [ ] Single hypothesis formed with supporting evidence
- [ ] Hypothesis tested before implementing fix
- [ ] Failing test written that reproduces the bug
- [ ] Fix targets root cause, not symptoms
- [ ] Full test suite passes after fix
- [ ] Non-obvious root cause persisted to `.memory/gotchas/` (if applicable)
