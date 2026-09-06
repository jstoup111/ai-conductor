# Track: Self-healing mechanical remediation for the self-host release gate

Track: technical

Scope boundary: A general, bounded mechanical-remediation lane in the self-host release
gate — the integrity suite declares a deterministic remediation per failed check, and the
engine executes it only when the command appears on an engine-side allowlist, then commits
and re-runs the suite once before halting. Initial allowlist entry: `bin/generate-model-table`.
Excluded: build-time or edit-time prevention of model-table drift (the issue's alternative
outcome), changes to any non-integrity sub-gate, and unbounded or repeated self-heal attempts.

Engine and gate machinery with no user-facing product capability; acceptance criteria live
directly in stories, so no PRD is authored.
