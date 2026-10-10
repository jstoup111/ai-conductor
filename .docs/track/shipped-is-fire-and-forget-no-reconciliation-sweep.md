# Track: Shipped PRs get a re-examined readiness verdict

Track: technical

Scope boundary: daemon-shipped PRs only (watch-ledger entries in `.daemon/mergeable-watch.jsonl`). Excluded: spec PRs, manual/unledgered PRs, and any operator digest of them.

Internal daemon automation: each sweep tick derives one closed readiness verdict per watched shipped PR from re-read GitHub state and routes it to existing machinery; no new product capability beyond a status surface.
