# Track: Mechanical prerequisite HALT loops the daemon in resume-and-refuse

Track: technical

Scope boundary: Balanced (operator-confirmed). The fix is generic to every mechanical (and legacy) HALT on a stacked feature, not only the prerequisite-blocked HALT. On every automatic progress-gated re-kick, the daemon clears a mechanical HALT through the canonical path the base-advance and episode-end sweeps already use, before stack preflight runs. A dispatch that ends before any step runs, such as a stack-preflight refusal, never earns another progress-gated re-kick. Excluded: the conductor walking back to the reachable pending prerequisite inside the same run; CLI resume-path parity; any change to the stack preflight's live-HALT guard or to needs-human HALT retention, which stays as it is.

Daemon-internal dispatch and recovery bug fix with no user-facing product requirements. Acceptance criteria live in stories. Source: intake jstoup111/ai-conductor#3601.
