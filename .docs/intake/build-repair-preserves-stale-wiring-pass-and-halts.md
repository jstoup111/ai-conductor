# Intake origin: build-repair-preserves-stale-wiring-pass-and-halts

Source-Ref: jstoup111/ai-conductor#1249
Owner: jstoup111

## Desired outcome

- After a BUILD repair changes the code state, every BUILD-verification prerequisite whose prior verdict no longer represents that state runs again before `build_review`.
- A current sibling verdict remains reusable when the BUILD repair did not invalidate what it verified.
- `build_review` is never reached with a prerequisite state that the engine itself considers unsatisfied.
- A BUILD-verification kickback and repair either rejoins successfully or reports the actual failing verification; it does not end in a synthetic terminal-less `needs-human` halt.
- Daemon events make reused versus redispatched group members and the validity basis observable.
