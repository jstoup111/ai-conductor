# Track: Vitest daemon fixtures leak into shared operational OTel metrics

Track: technical

Scope boundary: Balanced. Isolate the whole user-level config layer (`~/.ai-conductor/config.yml`) from ordinary test runs, and add an export-boundary backstop: OTel network export is refused under the test marker unless an explicit opt-in smoke flag is set. Excluded: redirecting HOME for the whole suite, a repo-wide audit of every `homedir()` read, and Grafana-side filtering.

Rationale: test-isolation and internal telemetry-guard work. No user-facing capability changes, so the acceptance criteria live in stories.
