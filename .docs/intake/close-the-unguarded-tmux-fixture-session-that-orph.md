# Intake origin: close-the-unguarded-tmux-fixture-session-that-orph

Source-Ref: jstoup111/ai-conductor#1616
Owner: jstoup111

## Desired outcome

- A daemon restart (in-place or respawn) leaves at most one keepalive per live session; superseded keepalives are reaped at spawn time.
- Ending an engineer session reaps its keepalives and tmux session.
- A process audit after any number of restarts finds no keepalive whose session is gone.
