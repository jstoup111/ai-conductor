# Track: Sandbox auth-expiry park-and-poll

Track: technical

Daemon-internal resilience: classify "Not logged in" auth failures and pre-flight
credential expiry as park-and-poll (wait for credentials refresh, re-provision the
sandbox, resume) instead of burning the step retry budget and halting. No
product-facing behavior; acceptance criteria live in stories. (Source:
jstoup111/ai-conductor#210, approach C — pre-flight expiry check + auth-failure
signature, one shared park mechanism.)
