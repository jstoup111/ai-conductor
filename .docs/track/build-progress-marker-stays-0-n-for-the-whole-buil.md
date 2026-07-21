# Track: Build progress marker increments per completed task (#757)

Track: technical

Internal daemon observability fix — the live `▶ build X/N` counter is derived from
git evidence during a build session instead of only reflecting task-status.json's
gate-boundary reconciliation. No user-facing product surface; acceptance criteria
live directly in stories (no PRD).
