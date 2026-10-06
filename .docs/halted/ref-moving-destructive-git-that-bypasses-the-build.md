# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-04T09:21:39.553Z
Slug: ref-moving-destructive-git-that-bypasses-the-build
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-ref-moving-destructive-git-that-bypasses-the-build
Head SHA: 74c837e9492497974d8852eca7dff83cab8d74fe
Halted at: 2026-10-03T23:48:36.342Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — S3.8 (architectural-clarity: Verified 95% by a real-git experiment (git 2.53.0, PRE_PUSH_HOOK from git-hook-assets.ts:268-293, bare remote advanced from a second clone, worktree NOT fetched): a plain `git push origin HEAD:main` exits 1 with the hook's 'refused push to refs/heads/main: ... has not fetched' text and no git non-fast-forward message, and `git push --force` in the same state produces byte-identical output — git forwards the fetch-first update to pre-push with the same stdin for plain and forced pushes, so no hook change can satisfy S3.8 (no hook refusal text) without breaking S3.1/S3.4 (refuse the forced push with that text); only after a fetch does git reject locally as non-fast-forward, which pre-push-hook.test.ts:68-77 already proves. Closing it needs a human decision, not code: either (recommended) amend the story's S3.8 / Task 8 Done-when precondition to 'remote-tracking ref equals the remote tip' (the fetched state the shipped test covers; push is refused either way, only message ownership differs, no data-loss risk), or amend ADR D13 to let the hook distinguish forced from plain pushes by other means (e.g. parent-process argv inspection), which is an architecture trade-off beyond the approved design.)
```
