# Complexity: Daemon lifecycle controls (pause/resume, restart-in-place, versioned dist)

Tier: L

## Signals

- **Cross-process/cross-repo coordination** — fleet-wide pause/resume and restart
  iterate the registry while per-daemon authority stays with each repo's pidfile
  (adr-010); correctness spans multiple concurrently-running daemons.
- **Filesystem atomicity as a safety mechanism** — versioned `dist-<sha>/` dirs with an
  atomic `current` symlink flip and reference-aware GC; a bug here crashes unrelated
  running daemons (the exact #215 hazard this fixes).
- **Lifecycle state machine** — running → paused (drain in-flight) → idle → restart →
  running, honored at the tick/dispatch boundary; interacts with existing HALT parking
  and rekick semantics.
- **External tool integration** — tmux respawn-in-place (session preservation) replaces
  the supervisor's kill-session + new-session restart; needs injected-runner tests PLUS
  a real-binary smoke (established convention for tmux argv bugs).
- **CLI surface change** — new `daemon pause`/`resume` verbs and `--all`/multi-repo
  selectors on management verbs; status output gains a PAUSED state.
- **Self-host interaction** — restart of the harness repo's own daemon must compose
  with the SelfHostDetector guardrails and pidfile handoff.

Story count is expected to exceed the Small threshold across the three phases
(versioned dist, pause/resume, restart-in-place) → **Large.**

Full DECIDE: prd (product track) → architecture-diagram (full) → architecture-review
(full, ADRs) → stories → conflict-check → plan.
