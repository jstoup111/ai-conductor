# Intake origin: pi-build-dispatches-run-without-the-destructive-gi

Source-Ref: jstoup111/ai-conductor#3002
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3002 digest=dc33aa76dd7a5d68f30ba8fc7b634f222f02664ca70eec1638e6cdfb008092f8 >>>
## Desired outcome

- A Pi build dispatch in a prepared feature worktree refuses the same destructive git forms that Claude and Codex dispatches refuse, with the same refusal message.
- Pi read-only review dispatches stay exempt from the guard, as Claude and Codex reviews are.
- Pi dispatch results report whether the guard was installed, so the environment-claim audit shows the true state for Pi spawns.
- A Pi dispatch whose working directory is a linked worktree the engine never prepared still launches and is reported as unguarded rather than failing.
<<< END INBOUND >>>
