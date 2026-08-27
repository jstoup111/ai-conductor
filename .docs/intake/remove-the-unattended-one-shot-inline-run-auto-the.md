# Intake origin: remove-the-unattended-one-shot-inline-run-auto-the

Source-Ref: jstoup111/ai-conductor#1436
Owner: jstoup111

## Desired outcome

- There is exactly one supported way to run a feature unattended, and it is the daemon.
- An operator who invokes the removed unattended one-shot gets a clear terminal outcome
  naming the daemon and pointing at its documentation — never a partial run, a silent
  degradation, or a crash.
- The human-driven inline run (`inline --interactive`) and the default checkpointed inline
  run behave exactly as they do today; neither is removed, degraded, or rerouted.
- No documentation page or shipped example advertises the removed one-shot as the way to run
  unattended; a reader looking for unattended execution lands on the daemon guide.
- No remaining execution path skips checkpoint prompts, sets `dangerouslySkipPermissions`,
  or auto-skips advisory step failures on the strength of the removed flag.
- The complexity tier still resolves correctly for every surviving run path.
