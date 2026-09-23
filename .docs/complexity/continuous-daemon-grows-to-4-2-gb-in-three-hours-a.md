# Complexity: continuous-daemon-grows-to-4-2-gb-in-three-hours-a

Tier: M

Rationale: four independent engine surfaces, each small but crossing a contract. (1) A new
`ConductorEvent` variant for process-memory samples emitted at step boundaries from the
in-process gate loop, plus a threshold-triggered heap dump under `.daemon/` — touches the event
union, `EventPersister`, and the daemon runner. (2) A Node heap cap in the tmux spawn command
(`daemon-tmux.ts` `DAEMON_FOREGROUND_COMMAND`), which is launcher-visible. (3) An exit witness
that records the daemon's signal/exit code when the process dies inside a surviving tmux pane,
read back by `daemon status` and `ensure-running` — a separate-process writer, so it needs an
event-spine exception A ruling. (4) Verification of resume-from-trailers after an abrupt kill
plus runbook coverage. No config-schema or consumer skill change; the growth fix itself is
out of scope. Needs an architecture diagram and a lightweight architecture review because
(1) and (3) extend the telemetry spine and the liveness model (adr-010, adr-014).
