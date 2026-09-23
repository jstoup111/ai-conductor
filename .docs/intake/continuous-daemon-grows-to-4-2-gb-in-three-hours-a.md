# Intake origin: continuous-daemon-grows-to-4-2-gb-in-three-hours-a

Source-Ref: jstoup111/ai-conductor#2079
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2079 digest=9cb0a142c81656745dcc35fe6ff18a292e540040a0f9095fcaa88d016a28a4b8 >>>
## Desired outcome

- A daemon driving a single feature at concurrency 1 holds steady-state memory across a multi-hour
- The daemon's own memory growth is observable while it runs, so the shape of the curve can be seen
- A daemon that dies from an external signal is distinguishable in its own log and status output
- A `session-up/process-dead` daemon surfaces itself without an operator having to run
- A feature interrupted this way resumes from its committed task progress rather than repeating
<<< END INBOUND >>>
