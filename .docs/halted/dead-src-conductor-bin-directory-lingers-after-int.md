# Halt record

Status: halted
Slug: dead-src-conductor-bin-directory-lingers-after-int
Class: needs-human
Halting step: rebase
Phase: SHIP
Branch: feat/daemon-dead-src-conductor-bin-directory-lingers-after-int
Head SHA: 29a37346b25a7fbcbb8ed9b5774f3aa8fbf2923d
Halted at: 2026-10-10T18:40:03.653Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
completed BUILD evidence is unavailable after rebase: unverified Done-when checks require one BUILD review pass: Task 1: [test] `src/conductor/test/skills/intake-file-helper-entry.test.ts` passes unchanged: "keeps the caller repository as the production gh adapter cwd" asserts the bundled helper reaches the intake filing CLI and the production gh adapter runs with the caller repository as cwd, and "returns the CLI usage without reaching gh when required arguments are absent" asserts it prints the CLI usage, exits non-zero, and never reaches gh.; Task 1: [test] `test/test_lint_shell_enumeration.sh` passes unchanged, its real-tree assertion still listing `skills/intake/scripts/intake-file`.
Recover .pipeline task evidence before resuming; do not redispatch completed BUILD blindly.
```
