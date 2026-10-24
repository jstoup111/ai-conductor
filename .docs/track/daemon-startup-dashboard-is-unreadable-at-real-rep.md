# Track: Daemon startup dashboard is unreadable at real repo scale

Track: technical

Scope boundary: Balanced (operator-confirmed 2026-10-24). In scope: the daemon startup inherited-state dashboard (`renderDashboard` in `src/conductor/src/engine/daemon-dashboard.ts` and its startup call site in `daemon-cli.ts`) — a top attention summary line, actionable groups rendered first, inert groups (PARKED, RETAINED WORKTREES, NEVER-STARTED, PROCESSED) collapsed to count lines on the console, long free-text reasons clipped to phone width, a BLOCKED group fed by discovery's existing blocked items, full detail kept in the persisted `daemon.log` render and reachable on the console by an opt-in expansion. Excluded: `conduct daemon status` rendering, and slug derivation (slugs are capped at 50 characters at creation, so the dashboard already prints the full, copyable slug).

Internal daemon operator tooling output — no product requirements; acceptance criteria live in stories. Not a maintenance change (observable output changes). Chosen approach: A — reorder and collapse within the existing state groups, preserving group vocabulary and the one-bucket precedence invariant. Source: jstoup111/ai-conductor#1332.
