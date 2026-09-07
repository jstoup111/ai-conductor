# Intake origin: run-memory-store-setup-on-daemon-dispatch

Source-Ref: jstoup111/ai-conductor#2062
Owner: jstoup111

## Desired outcome
- A daemon-dispatched run establishes the canonical memory store before any session touches
  `.memory/`, the same way an inline run does.
- Setup is idempotent on the daemon path: performed when the store is absent, a no-op when it is
  already canonical, and it migrates a pre-existing real `.memory/` directory rather than leaving
  it stranded.
- A setup that fails does not abort the run — the same non-fatal contract the inline path's
  criterion states.
- The 5 worktrees currently holding an unmigrated real `.memory/` end up with their content in
  the canonical store rather than orphaned by the fix.
- An operator can tell whether a given worktree's store is canonical without stat-ing the symlink
  by hand.
