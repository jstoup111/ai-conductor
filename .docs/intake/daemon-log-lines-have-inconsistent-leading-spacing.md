# Intake origin: daemon-log-lines-have-inconsistent-leading-spacing

Source-Ref: jstoup111/ai-conductor#2367
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2367 digest=bbea66825b78212606f850f4e06c7226c8ad9e2817790b11ec1e5940f25b2aad >>>
## Desired outcome

- Whitespace between the `[daemon][<slug>]` prefix and the message means one thing, applied consistently: a reader can tell nesting depth from indentation alone.
- Forwarded subprocess output (git, provider CLIs) is visually distinguishable from daemon-authored lines, and its own internal padding does not change the daemon's indentation.
- The same event type logs at the same indentation on every dispatch.
<<< END INBOUND >>>
