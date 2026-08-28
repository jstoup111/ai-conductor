# Intake origin: enable-single-repo-daemon-concurrency-un-clamp-the

Source-Ref: jstoup111/ai-conductor#568
Owner: jstoup111

## Desired outcome

- A single daemon can run N concurrent feature builds for one repo, gated by an explicit config/flag (default stays 1) — observable by running two independent features and seeing both progress in one daemon.
- Concurrent workers never corrupt each other's run-state, park markers, or main-checkout — verifiable by running N builds and confirming each worktree's `.pipeline`/markers stay isolated and no build reaches into another's or the main root.
- Shared idle-gated operations (main fast-forward, stale-engine restart) still run rather than starving when the pool is rarely fully idle at N>1.
- Interleaved worker log lines are attributable to their feature (slug-tagged) so halt/ship triage stays readable.
- Negative path: with the flag at 1 (default), behavior is byte-for-byte today's serial daemon.
