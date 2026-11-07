# Intake origin: mechanical-prerequisite-halt-loops-the-daemon-in-r

Source-Ref: jstoup111/ai-conductor#3601
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3601 digest=ae56ff9cae1e06f2c2bcc33658caed9d3976576912852651ace83ad5631b2750 >>>
## Desired outcome

- After a mechanical "re-dispatch from an earlier reachable prerequisite" HALT, the next daemon dispatch actually runs that earlier prerequisite (here, `test_suite`) without operator action.
- The daemon never re-dispatches a feature that it will immediately refuse; a refused resume isn't retried in a tight loop.
- A needs-human HALT still blocks dispatch until the operator clears or authorizes it (the current guard stays in place for that class).
<<< END INBOUND >>>
