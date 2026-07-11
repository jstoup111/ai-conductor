# Track: writing-system-tests-red-exit-gate

Track: technical

## Rationale

This change modifies the internal contract of the `writing-system-tests` SKILL.md — it
makes "execute the committed acceptance specs and record the real RED result" a self-enforced
exit gate in auto mode. There is no user-facing product requirement, no new command, flag, or
config key, and no new functional surface an end user perceives. Acceptance criteria for a
harness-skill behavior belong in stories, not a PRD. → **technical track** (skip `/prd`).
