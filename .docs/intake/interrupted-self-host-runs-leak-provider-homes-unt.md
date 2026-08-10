# Intake origin: interrupted-self-host-runs-leak-provider-homes-unt

Source-Ref: jstoup111/ai-conductor#1223
Owner: jstoup111

## Desired outcome

- A normally completed provider attempt leaves no provider-home directory behind.
- After an interrupted or killed attempt, the harness deterministically identifies and removes that attempt's orphaned provider home without deleting any active provider home.
- Temporary storage is associated with a canonical repository, feature, run, and attempt identity rather than discoverable only through a random directory name.
- Feature completion or worktree cleanup removes all remaining temporary storage owned by that feature while preserving any durable run-state required for recovery or audit.
- Cleanup behavior remains correct if #564 relocates durable run-state outside the worktree.
- The same lifecycle and safety behavior works on supported Linux and macOS hosts without requiring systemd, launchd, cron, or operator-installed cleanup configuration.
- Cleanup decisions and failures are observable in daemon logs, including the owning feature/run and the reason an entry was retained or removed.
