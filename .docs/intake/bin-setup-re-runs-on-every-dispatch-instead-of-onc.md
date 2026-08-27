# Intake origin: bin-setup-re-runs-on-every-dispatch-instead-of-onc

Source-Ref: jstoup111/ai-conductor#1930
Owner: jstoup111

## Desired outcome

- Project setup runs once per worktree provisioning; a re-dispatch of an already-prepared worktree starts the conductor without re-running `bin/setup`.
- Setup re-runs when the worktree is actually re-provisioned (e.g. recreated), and the daemon log states why it ran.
- Projects that need a genuinely per-dispatch action have a distinct, documented lifecycle mechanism, so `bin/setup` is not the vehicle for "on dispatch start" behavior.
- Setup failure triage (`runSetupTriage`) still works when setup does run.
