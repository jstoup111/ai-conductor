# Track: bin/setup re-runs on every dispatch instead of once per worktree

Track: technical

Scope boundary: Gate + hook — marker-gated setup skip (marker invalidated by re-provisioning, engine rebases/base drift, and bin/setup content change, with the log naming why setup ran) PLUS a distinct optional per-dispatch lifecycle script, documented. runSetupTriage keeps working when setup runs.

Daemon-internal dispatch lifecycle behavior; no product-facing surface beyond documentation.
