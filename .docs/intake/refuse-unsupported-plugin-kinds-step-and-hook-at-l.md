# Intake origin: refuse-unsupported-plugin-kinds-step-and-hook-at-l

Source-Ref: jstoup111/ai-conductor#1931
Owner: jstoup111

## Desired outcome
- A plugin installed with `kind: step` or `kind: hook` either participates in a run through a working seam, or is refused at load time with a message saying the kind is unsupported.
- Silent registration followed by no invocation is not possible for any kind in `VALID_PLUGIN_KINDS`.
- A plugin of a supported kind continues to load and run unaffected.
