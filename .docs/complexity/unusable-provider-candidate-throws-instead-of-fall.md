# Complexity: Provider setup failures preserve configured fallback

Tier: M

The change extends an existing shared executor rather than introducing a new subsystem. It crosses candidate setup, failure classification, resource cleanup, retry accounting, and existing diagnostic attribution. Production wiring must demonstrate fallback in both provider directions, including the original self-host capability gap and ordinary execution. Those interactions warrant a lightweight architecture review, conflict check, and coherence check.

No new package, service, configuration surface, or provider is required by the selected approach. Classification must remain explicit: authentication recovery, required-safety refusals, unexpected errors, and runtime failures must not become arbitrary reasons to switch providers.
