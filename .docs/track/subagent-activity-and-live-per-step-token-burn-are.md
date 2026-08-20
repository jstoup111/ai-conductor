# Track: Subagent activity and live per-step token burn are unobservable (#1441)

Track: technical

Scope boundary: Approach A — switch the autonomous Claude dispatch to
`--print --output-format stream-json --verbose` and parse the NDJSON stream in-process to emit
new `ConductorEvent` variants carrying (a) live active-child-unit count and (b) live cumulative
uncached input/output token consumption for the running step, rendered by `daemon status`.
Covers **all autonomous `invoke()` dispatches, both providers**: Claude contributes children +
tokens; Codex (`exec --json`) contributes tokens only and keeps rendering children as `unknown`,
since Codex has no subagent concept. Explicitly INCLUDED: amending
`adr-2026-07-22-build-dispatch-json-usage-capture`, whose `stream-json` rejection rested on
"no benefit" — this feature is that benefit. Explicitly EXCLUDED: any out-of-band watcher over
provider-private transcript files (rejected Approach C); any change to the interactive
`invokeInteractive` path; any change to `feature_usage_total` or end-of-step `step_completed`
token accounting, which stay as they are.

Engine-internal observability: provider-stream parsing, an extension of the existing
`ConductorEvent` union persisted to `.pipeline/events.jsonl`, and the `daemon status` in-progress
row. No user-facing product surface, so acceptance criteria live directly in stories and no PRD
is authored — same disposition as the parent feature #1246, whose complexity artifact deferred
exactly this provider-stream plumbing here.
