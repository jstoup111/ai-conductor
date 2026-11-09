# Intake origin: newer-engine-child-events-vanish-from-otel-when-th

Source-Ref: jstoup111/ai-conductor#3646
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3646 digest=9c64fd912df6f9e0286ab7cd11ca6e18148037ff1c219e187c2ca6b20cc96160 >>>
## Desired outcome

- An OTel-relevant event emitted by a child running a newer engine than its supervisor is either exported, or its omission is visible on the telemetry spine (which event types, which feature, which version pair).
- A child running an older engine than its supervisor still produces complete telemetry for the event types it emits.
- Event types that are deliberately child-local stay out of daemon-level telemetry.
<<< END INBOUND >>>
