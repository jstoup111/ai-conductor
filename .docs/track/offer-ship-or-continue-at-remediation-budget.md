# Track: offer-ship-or-continue-at-remediation-budget

Track: technical

Scope boundary: continue-only (operator-narrowed 2026-09-24). Every remediation budget exit — per-gate lap cap, per-gate plan-growth cap, and the shared plan-growth allowance — records typed cap evidence naming the exhausted allowance, and one `kickback-budget raise` grows exactly that allowance so the daemon resumes the feature after its last completed step, with no config edit and no commit on main. Excluded: the ship-as-draft-PR option and its residuals list, finding-named skipped tests, shipped-record residuals and at-budget flag, release-PR hold, engineer resume entry point, non-blocking observation list, any unattended auto-continue default, and removal of the plan-growth allowance itself (owned by #2184).

Daemon budget machinery and an existing operator CLI with no product requirements; acceptance criteria belong in stories.
