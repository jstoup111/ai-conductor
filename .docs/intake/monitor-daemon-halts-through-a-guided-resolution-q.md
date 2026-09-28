# Intake origin: monitor-daemon-halts-through-a-guided-resolution-q

Source-Ref: jstoup111/ai-conductor#1228
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1228 digest=8291020d4a4d17e23a469a472f2ea8cc7436a14ab5e91850c629dcd92a1cb0a7 >>>
## Desired outcome

- An operator can run one dedicated monitoring command that stays active and surfaces daemon HALTs as work to resolve.
- The operator can choose to monitor every registered daemon project or one selected project.
- On startup, the monitor discovers work that is already halted and places it into the resolution queue before waiting for new HALTs.
- Each detected HALT is presented once in a durable resolution queue, including enough project and feature context to act on it.
- Higher-priority HALTs are offered before lower-priority HALTs, with stable, observable ordering when priorities are equal or absent.
- For the next queued HALT, the monitor opens a session using the configured provider, performs evidence-based debugging, and presents the applicable user-guided recovery runbook.
- Ending that provider session returns the operator to the monitor, which advances to the next queued HALT without requiring the monitor to be restarted.
- Skipping a HALT ends its current session and re-enqueues it for a later pass instead of resolving, dropping, or immediately reopening it.
- When no HALTs are pending, the monitor remains ready for newly detected HALTs without creating duplicate queue entries or provider sessions.
- A HALT that cannot be diagnosed or resolved remains visible with its state and evidence; it is not silently dropped or marked resolved.
<<< END INBOUND >>>
