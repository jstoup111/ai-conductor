# Track: Model availability probe + fallback ladder in claude-provider

Track: technical

Conductor-engine resilience (intake jstoup111/ai-conductor#186): detect model-unavailable
failures at the ClaudeProvider seam and degrade down a configurable ladder instead of
burning the retry budget and HALTing. No user-facing product requirements — acceptance
criteria live in stories.
