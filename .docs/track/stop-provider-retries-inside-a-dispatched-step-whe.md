# Track: Stop provider retries inside a dispatched step when a park lands

Track: technical

Scope boundary: Small fix for #2103, approved by the operator on 2026-09-06 (delegated). Park stays
advisory — it declines the NEXT provider attempt inside an already-dispatched step and reports what
is still in flight; it never cancels a provider call that has already started. Two surfaces are in
scope: the conductor's retry loop, which must consult the operator park boundary before every
attempt rather than only before the step's first dispatch, and the park CLI verb, which must tell
the operator whether the feature still shows live provider activity. Killing an in-flight provider,
changing park's marker format or its selection semantics, and any change to the daemon's markerless-
exit backstop are outside this slice.

The filer explicitly left "advisory versus authoritative" open and argued for making the advisory
behaviour reliable first; that steer is adopted as the approved scope rather than reopened here.

This is an engine defect fix in daemon dispatch machinery; acceptance criteria live in technical
stories rather than a PRD.

Documentation note: the park/emergency-stop runbook's "parking drains exactly the active scheduling
unit" paragraph becomes accurate only after this change and is refreshed alongside the
implementation under the repository's documentation-upkeep rule. Per the plan skill's documentation
boundary it is deliberately not a story, a requirement, or a plan task.

Scope check: A — consumer-facing (the conductor retry loop and the park CLI verb ship to every
repository that installs the harness; no self-host, release-gate, or repo-local convention is
touched); B — n/a (no new skill); C — provider-agnostic (the guard sits above the provider adapter
and reads a filesystem marker, so Claude and Codex dispatches are affected identically). No catalog
registration is required. Event spine: no channel is added — the guard emits the existing
`operator_park_boundary` event through the existing shared helper, and the CLI reads the existing
`.pipeline/step-heartbeat` record that the daemon dashboard already consumes.

Verified foundation: `stopAtOperatorParkBoundary` is declared once inside `run()` in
`src/conductor/src/engine/conductor.ts` and is called from exactly five dispatch sites, the last of
which sits immediately before the serial step's `in_progress` write; the step's `while (attempt <
stepMaxRetries)` retry loop below it contains no call to that helper, so every attempt after the
first launches without re-reading the marker — the exact behaviour the issue observed as
`build:2` and `build:3` under one unchanged attempt id. The helper treats a marker-read rejection as
parked, so a retry-boundary call inherits that fail-closed reading. `daemon-cli.ts` injects
`isOperatorParked` as the boundary reader, which stats the marker on every call, so a second read
sees a marker written after dispatch began. `step-runners.ts` starts a per-step heartbeat pulse in
the feature worktree, and `daemon-dashboard.ts` already reads it, so the park CLI has an existing
in-flight signal to report without inventing one.
