# Complexity: interrupted-intake-claim-still-strands-high-priori

Tier: M

Rationale: the fix adds a new concurrency mechanism to the intake claim path — an intake claim lease held across the whole `compose claim` walk, with orphan reconciliation of pending-ledger / `.claimed`-envelope mismatches under that lease. That changes the concurrency model ADR-011 fixed (lock-free atomic-rename single-winner claim) and invalidates the "momentarily holds every pending envelope" consequence of `adr-2026-07-10-intake-claim-priority-banding`, so it needs an ADR amendment and a lightweight architecture review. Code surface is small (claim CLI case, `claimUnblocked`/file queue, a lease wrapper, tests) and touches no schema, config, hook, or event contract. Matches the issue's `size: M` label.
