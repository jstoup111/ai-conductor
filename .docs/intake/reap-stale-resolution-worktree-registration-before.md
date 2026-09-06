# Intake origin: reap-stale-resolution-worktree-registration-before

Source-Ref: jstoup111/ai-conductor#2157
Owner: jstoup111

## Desired outcome
- After a crashed prior run, the next autoresolve attempt for the same slug succeeds without operator intervention.
- Stale worktree registrations do not accumulate across crashes.
