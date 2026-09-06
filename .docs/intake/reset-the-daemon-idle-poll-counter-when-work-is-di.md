# Intake origin: reset-the-daemon-idle-poll-counter-when-work-is-di

Source-Ref: jstoup111/ai-conductor#2156
Owner: jstoup111

## Desired outcome
- The daemon stops for `idle_timeout` only after N consecutive empty polls; finding/dispatching work resets the count.
- Documented semantics and behavior match.
