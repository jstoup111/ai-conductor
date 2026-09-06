# Track: Surface commit recency in daemon build progress lines

Track: technical

Scope boundary: Small fix for #1715, approved by the operator on 2026-09-06 (delegated). The build-progress watcher already probes the build worktree's Git HEAD on every poll tick; carry the newest commit's timestamp on the two build events that tick already emits, and name that commit's age on the two daemon log lines that render them. Changing the quiet threshold, adding a commits-in-last-N-minutes window, re-basing the quiet episode on anything other than the existing change-driven re-arm, altering the post-hoc stall breaker or the build-progress halt ceilings, and enriching the OpenTelemetry span attributes are all outside this slice.

This is an internal daemon observability correction; acceptance criteria live in technical stories rather than a PRD.

The operator's alternatives were weighed on 2026-09-06 (delegated). The issue's second hypothesis — a status ticker shelling out to `git log` on its own cadence — is rejected: it is a second observer of the same fact and the event-spine rule forbids a parallel channel. The first hypothesis — a post-commit hook pushing commit events — is also rejected: the hook runs in a separate process with no bus access, so it would need the ledger machinery of exception A for a fact the in-process watcher already observes for free. The chosen design adds no observer at all; it carries an already-observed fact on the existing events.

Event spine
  Channel?    no                                  — no watcher, poller, ledger, sidecar, or stamped artifact is added; the watcher's existing per-tick HEAD probe is the only observer
  Concern:    occurrence                          — "the newest commit on this branch landed at T" is an occurrence the build-progress tick already reports
  Verdict:    extend the union                    — one additive optional field (`lastCommitAt`) on the existing `build_progress` variant; `build_no_progress` already declares it
  Exception:  none                                — no separate write location is introduced

Scope check: A — this is engine and daemon-CLI code, not a behavioral rule, so neither HARNESS.md nor AGENT_INSTRUCTIONS.md changes; the operator-facing consequence lands in the stalled-or-stuck runbook and the daemon-triage skill's triage sequence. B — no new skill. C — provider-agnostic: the signal comes from Git and the event bus, with no LLM-provider coupling. No catalog registration is required.

Verified foundation: `BuildProgressWatcher.tick` in `src/conductor/src/engine/build-progress-watcher.ts` already runs `git rev-parse HEAD` in `projectRoot` on every poll and diffs it, so commit movement is already an observed fact; `conductor.ts` constructs the watcher with `projectRoot` set to the feature worktree, so that HEAD is the feature branch's. A HEAD move already counts as a change, which already re-arms the quiet episode — so the quiet warning already requires branch silence as well as task silence, and only the naming half of the issue's second desired outcome is missing. `types/events.ts` already declares `lastCommitAt?: number` on `build_no_progress`, and the governing approved ADR for intra-step build progress lists that field in the event's payload contract, but nothing populates it and no renderer reads it. `daemon-cli.ts` renders `build_progress` and `build_no_progress` from the task counter, current task, and slug only, discarding the commit facts the events already carry.
