# Track: engineer intake claim hands out closed GitHub issues

Track: technical

Internal harness/intake plumbing: a claim-time issue-state guard (in
`createDeliveryGuardedQueue`) plus a periodic brain reconciliation sweep over the
intake ledger + inbox. No user-facing product capability; acceptance criteria live
directly in stories. Disposition for a closed pending entry: `forget` (remove ledger
entry + drop inbox envelope; reopened issues re-ingest fresh via the `--state open`
poll).
