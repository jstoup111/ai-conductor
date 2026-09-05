# Intake origin: retain-protected-artifact-halts-across-base-advanc

Source-Ref: jstoup111/ai-conductor#2199
Owner: jstoup111

## Desired outcome

- A halt written with class `protected-artifact` survives every base-advance re-kick sweep, exactly as `needs-human` and `plan-gap` halts do, until an operator clears it or performs an audited reseal.
- The sweep's log line for such a halt names the retained disposition, so an operator can see why it was skipped.
- `mechanical` and `legacy` halts are still cleared and re-kicked on a base advance (negative path: retention does not widen).
- A unit test over the sweep enumerates every `HaltClass` value and asserts which are retained, so adding a class without deciding its retry disposition fails the build.
