# Complexity: daemon-lock-exclusivity-pidfile-boot-refusal-and-p

Tier: S

Rationale: The operator descope comment on #554 (2026-07-11 ~22:30Z), refined by the
2026-07-11 ~22:37Z read-only investigation comment, bounds this to two mechanical
additions on an existing, well-factored primitive — reusing identity that ALREADY exists
on the pidfile, so no new schema/probe is introduced:

1. Boot exclusivity — make the boot refusal in `daemon-cli.ts` name the holder pid (and
   its recorded `engineDir`) and exit nonzero, instead of silently exiting 0. No change
   to `holdLock`'s live-vs-dead decision; dead-holder takeover is preserved.
2. Per-sweep ownership re-check — expose the per-boot `uuid` (already on `PidRecord`,
   `daemon-lock.ts:56`, `randomUUID()` at `:163`) on the lock handle, add an `ownsLock()`
   helper that compares the on-disk `uuid` to this daemon's boot `uuid`, and wire a
   `lockOwnershipLost` predicate into the existing top-of-loop guard chain in
   `engine/daemon.ts` (mirrors the existing `repoRootMissing` seam) so the daemon stops
   dispatching when the pidfile is no longer ours. This on-disk-uuid comparison is
   deterministic and strictly better than the current bare `isLive(pid)`, which cannot
   distinguish a reused pid or a genuine second daemon.

No new architecture, no new subsystems, no schema/CLI surface change, and — per the #554
investigation — NO `/proc` signature probe and NO `pgrep -f`/cmdline matching anywhere
(that self-matches the operator's own diagnostic shells and is a proven false-positive
source). Detection uses only the pidfile record's own fields plus `isLive(pid)`. The
orphan-census / `daemon status` surface — the platform-dependent enumeration part — is
explicitly DEFERRED post-v1 by the operator comment and is OUT of scope here. Each change
has a clear RED test against real, injectable seams. Estimated 4 tasks, no architectural
decisions required.
