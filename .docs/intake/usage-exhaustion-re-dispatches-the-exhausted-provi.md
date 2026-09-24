# Intake origin: usage-exhaustion-re-dispatches-the-exhausted-provi

Source-Ref: jstoup111/ai-conductor#1492
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1492 digest=2863d3c1ee5b598201635be1ddebe28c76399df4092c460f3e242526e1748b7f >>>
## Desired outcome

- An operator can configure, globally and per step, that no provider substitution may occur. With that in
- A step pinned to a single provider is observably honored: its `provider_attempt` records show no attempt
- After a provider is observed usage-exhausted, later steps and later feature dispatches inside the same
- That suppression expires on its own: when the provider's reported reset time arrives — or after a bounded
- The suppression, its reason, and the time remaining until re-attempt are visible in the telemetry an
- With neither setting configured, behavior is unchanged from today.
<<< END INBOUND >>>
