# Intake origin: a-halt-leaves-no-committed-pushed-record-for-the-o

Source-Ref: jstoup111/ai-conductor#1809
Owner: jstoup111

## Desired outcome

- When a feature halts, a record of the halt (reason, class, the findings that caused it, the step that halted) is committed on the feature branch and pushed when a remote exists.
- An operator can read that record from the branch alone, without access to the daemon host, and resume or finish the feature from it.
- A halt that cannot push (no remote, auth failure) still commits locally and reports the push failure; the halt itself is never lost.
- Resuming a feature clears or supersedes the record so a stale halt record never blocks a later run.
