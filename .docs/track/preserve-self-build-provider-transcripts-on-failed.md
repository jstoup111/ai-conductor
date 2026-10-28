# Track: Preserve self-host provider transcripts for failed, stalled, or zero-progress dispatches

Track: technical

Scope boundary: comprehensive — every self-host step and auxiliary member (build, build_review
rubrics, test_suite, etc.) across every self-host provider (Claude, Codex); harvest an allowlisted
set of transcript/session files from the scratch home before every release (including the
dead-owner scratch sweep), retain by outcome verdict (failed / stalled / no_task_progress /
needs-human kept; successful-with-progress pruned; size/count cap backstop), announce captures on
the event spine, and add a `ai-conductor transcripts` reader that lists captures and prints the final
assistant message. Excludes: copying credentials or any non-allowlisted scratch-home content;
changing scratch-home lifetime itself; non-self-host (consumer) builds.

Internal forensics machinery for the harness's own self-host engine — no consumer-facing product
behavior, so no PRD. Source: intake jstoup111/ai-conductor#611.
