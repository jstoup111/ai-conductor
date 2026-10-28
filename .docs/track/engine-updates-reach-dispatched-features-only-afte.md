# Track: Engine updates reach dispatched features only after a full daemon drain

Track: technical

Scope boundary: Comprehensive — all six #2392 outcomes: dispatches after a rebuild run on the new engine without any in-flight feature finishing; in-flight features finish on the engine they started with and keep valid verdicts/evidence; a cadence pull+rebuild needs no operator action; each feature's engine version is recoverable from its own record; exactly one daemon supervisor generation stays live; `daemon status` shows which features run an older engine than the current build. Excluded: rolling two-generation daemons, remote/multi-host executors, durable claims, restart-without-drain of in-flight work.

Internal daemon infrastructure (process-separated executor pinned per dispatch); the only visible surface is operator status output, so acceptance criteria live in stories without a PRD.
