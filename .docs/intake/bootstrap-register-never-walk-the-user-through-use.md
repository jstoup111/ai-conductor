# Intake origin: bootstrap-register-never-walk-the-user-through-use

Source-Ref: jstoup111/ai-conductor#2218
Owner: jstoup111

## Desired outcome

- Running `bootstrap` (or `register`, if that's where this lands) on a project with no
- The same step-by-step flow covers project config fields beyond the two Step 1b-i
- Re-running the flow against an already-configured user/project is safe: it does not
- An automated/non-interactive invocation (daemon, CI) is unaffected: it keeps using
