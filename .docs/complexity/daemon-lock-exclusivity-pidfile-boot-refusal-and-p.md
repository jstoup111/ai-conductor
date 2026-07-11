# Complexity: daemon-lock-exclusivity-pidfile-boot-refusal-and-p

Tier: S

Rationale: The operator descope comment on #554 (2026-07-11 ~22:30Z) bounds this to two
mechanical additions on an existing, well-factored primitive:

1. Boot exclusivity with pid-reuse defense — fold a process-signature check into the
   existing `holdLock` live-owner decision in `daemon-lock.ts`, and make the boot
   refusal in `daemon-cli.ts` name the holder pid and exit nonzero.
2. Per-sweep ownership re-check — expose the owner uuid on the lock handle, add an
   `ownsLock()` helper, and wire a `lockOwnershipLost` predicate into the existing
   top-of-loop guard chain in `engine/daemon.ts` (mirrors the existing
   `repoRootMissing` seam) so the daemon stops dispatching when the pidfile is no
   longer ours.

No new architecture, no new subsystems, no schema/CLI surface change. The orphan-census /
`daemon status` surface — the platform-dependent enumeration part — is explicitly DEFERRED
post-v1 by the same operator comment and is OUT of scope here. Each change has a clear RED
test against real, injectable seams (KillProbe already exists; the signature probe follows
the same injectable pattern). Estimated 6 tasks, no architectural decisions required.
