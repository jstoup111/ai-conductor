# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-24T19:42:13.425Z
Slug: a-routed-fix-is-never-carried-up-the-stack-or-foll
Class: needs-human
Halting step: rebase
Phase: SHIP
Branch: feat/daemon-a-routed-fix-is-never-carried-up-the-stack-or-foll
Child: 3
Head SHA: 03a5a97233e8969f531584e4d6f68f16dc8bc316
Halted at: 2026-10-24T19:35:35.623Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
protected-artifact seal error
Protected artifact provenance undeterminable: .docs/plans/a-routed-fix-is-never-carried-up-the-stack-or-foll.md
Missing base ref: no base branch was supplied.
Provide the base ref, then rebase onto it.
Attribution: provenance undeterminable

Recovery procedure:
  1. Review the protected-artifact diff and confirm the amendment is authorized.
  2. Perform an audited reseal with the engine rotation function.
  3. Clear .pipeline/HALT and .pipeline/HALT.class, then re-queue the feature.

This refusal happens before and does not start a git rebase; do not run git rebase --continue.
```
