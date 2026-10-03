# Track: Interrupted intake claim still strands high-priority issues

Track: technical

Scope boundary: Minimal. An interrupted, killed, or crashed `compose claim` never leaves a `pending`-ledger entry unclaimable; the next claim self-heals every pending-ledger / `.claimed`-envelope mismatch, including strands created before the fix ships; a live claim is never handed out twice. Excluded: changes to `compose unclaim` / `compose requeue --stale`, a mismatch count in `brain status`, and `.claimed` envelopes whose ledger entry is `done` or absent.

Internal intake-queue machinery with no product requirements; acceptance criteria live in stories.
