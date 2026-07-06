# Track: fresh-session-per-step

Track: technical

Session-model refactor of the conductor (ai-conductor#325): reset the LLM session
at every step boundary unconditionally instead of gating it behind the opt-in
`freshContextPerStep` flag. No user-facing product behavior — acceptance criteria
live directly in stories; no PRD.
