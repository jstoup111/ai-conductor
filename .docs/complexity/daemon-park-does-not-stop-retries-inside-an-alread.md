# Complexity: Park stops retries inside an already-dispatched step

Tier: M

The change moves the existing operator-park gate from scheduling-unit boundaries down to every provider dispatch, including in-step retries. It also teaches the park command to report whether work for the slug is still running, and updates the emergency-stop runbook. It amends the approved scheduling-unit park ADR (its no-check-inside-a-unit decision) and touches conductor dispatch, the park CLI, and operator docs. It adds no new integration, provider, or subsystem.
