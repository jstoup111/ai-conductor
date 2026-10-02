# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-02T23:44:47.276Z
Slug: destructive-git-prevention-is-absent-in-self-host
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-prevention-is-absent-in-self-host
Head SHA: ac8d162e8340cf450d80827c8c5785dca5ba1dbe
Halted at: 2026-10-02T22:30:17.840Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 10 negative: **Given** the `tdd` skill, **When** its counterfactual step is read, **Then** it names no stash, path checkout, restore, or reset command and tells the agent to change no worktree's files, the temporary one included, beyond adding the test copies.
Task ids: 15
Done when checks: The skill-content test asserts the `skills/tdd/SKILL.md` pre-diff sensitivity item names a temporary detached worktree at the base commit and copying the new or changed test files into it, then removing that worktree. | The same test asserts the item contains none of `stash`, `checkout --`, `git restore`, or `reset`, so following it never discards paths in any worktree.
Missing assertion: The checks do not explicitly require that the item tells the agent not to change any worktree files other than copying test files.
```
