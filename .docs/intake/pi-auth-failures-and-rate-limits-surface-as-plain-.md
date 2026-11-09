# Intake origin: pi-auth-failures-and-rate-limits-surface-as-plain-

Source-Ref: jstoup111/ai-conductor#2718
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2718 digest=cf4e71a5bc7ce2c2a6fc88c253da3544d238c119556d5f15cf2fd9bf9a029753 >>>
## Desired outcome

- A Pi auth failure is reported as an auth failure: the run parks as it does for claude/codex, and the ladder does not advance.
- A Pi rate limit or usage exhaustion advances the candidate-fallback ladder exactly as claude/codex exhaustion does.
- Pi output that matches neither remains an ordinary step failure (no false fallback on a real step failure).
- The default test suite still makes no real Pi call; signatures are proven against committed captures of real Pi output.
<<< END INBOUND >>>
