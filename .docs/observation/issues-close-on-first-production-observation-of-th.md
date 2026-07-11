# Observation: Observed-close (#492)

Signature: observe: enrolled
Surface: daemon-log
Window-days: 14

The signature is the sweep's own enrollment line (pinned in plan Task 15): the first time a
watched fix is enrolled in `.daemon/observation-watch.jsonl` in production, this feature's
behavior has fired — merged, loaded, and exercised.

Note: the engine that builds this spec predates the machinery, so this marker is declarative
for its own ship (grandfathered to close-on-merge by the old engine); it defines the
convention and states the signature an operator or later engine can verify against.
