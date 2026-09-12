Signature: /\[ci-fix\] outcome for .*: published/
Surface: daemon-log
Window-days: 14

A truthful published outcome can occur only after usable CI context reaches a build-configured repair, a committed repair passes daemon guards and verification, and lease-protected publication succeeds. The existing daemon outcome log supplies this signature; no new observation channel is required. This signature is intended for observation after implementation merge under adr-2026-07-10-observed-close-watch-registry; it does not assert that automatic observation machinery is installed. Negative-path and fallback permutations remain covered by the plan's deterministic tests.
