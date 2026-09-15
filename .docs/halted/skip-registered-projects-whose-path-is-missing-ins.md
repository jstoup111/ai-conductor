# Halt record

Status: halted
Slug: skip-registered-projects-whose-path-is-missing-ins
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-skip-registered-projects-whose-path-is-missing-ins
Head SHA: 8c21d68769db2d07a537979c34c2f36719c90d85
Halted at: 2026-09-15T01:35:14.988Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Need user decision: Codex pipeline task stamping is required before Task 1, but the daemon-session guard rejects the required ai-conductor task start command; do not bypass the guard with its test-only unsafe environment valve.


stall:task-stamping-guard (architectural-clarity: Harness defect, not a feature gap (verified, 95%): skills/pipeline/SKILL.md:68-77,95 (added by #2542, ce33b8541) requires a Codex orchestrator to run `conduct task start <id>` before each dispatch, but src/conductor/src/execution/daemon-session.ts SESSION_SANCTIONED_SUBCOMMANDS (unchanged on origin/main) omits `task`, so guardDaemonSessionInvocation refuses both `task start` and `task done` inside the CONDUCT_DAEMON_SESSION=1 build session; without the stamp `task done` is a silent no-op and the build stalls no_task_progress, the only in-session escape is the forbidden test-only CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW valve, and the fix (sanction `task` in the guard, or pin this feature's build to claude whose PreToolUse hook stamps) touches engine/config outside all three tasks of .docs/plans/skip-registered-projects-whose-path-is-missing-ins.md, so no build task can close it and a human must choose the route.)
```
