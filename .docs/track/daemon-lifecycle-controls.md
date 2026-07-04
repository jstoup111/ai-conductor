# Track: daemon-lifecycle-controls

Track: product

Operator-facing daemon fleet lifecycle capability (pause/resume across daemons, safe
restart preserving the tmux session, rebuild-safe versioned dist) — same product
precedent as the daemon supervised-hosting PRD (on-demand management of the per-repo
build daemon). Requirements are worth a PRD; the versioned-dist keystone is expressed
there as a reliability requirement (a harness rebuild must never crash running
daemons), with mechanism deferred to architecture. Source: jstoup111/ai-conductor#215.
Scope: Approach A (full bundle, phased plan: versioned dist → pause/resume →
restart-in-place); B (dist-only) and C (controls without dist fix) rejected.
