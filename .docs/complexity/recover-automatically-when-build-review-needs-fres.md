# Complexity for #3586

Tier: S

The projected change adds one bounded recovery loop to existing engine steps. Both proof checks are local, with no external integrations, authorization changes, or new service. The estimated three stories cover early detection, late detection in the same build context, and restart-safe exhaustion and failure handling. The state transition is the one Medium signal. The majority of the harness criteria are Small.
