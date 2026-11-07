# Complexity: One daemon feature lifecycle, run only in the child executor (#3333)

Tier: L
Stacked-Delivery: approved

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None persisted. One new engine module owns the daemon feature lifecycle that `runConductorInWorktree` holds today, with an explicit context type for the supervisor-owned services it needs |
| External integrations | None new. The moved lifecycle keeps its existing git and GitHub boundaries: the REKICK rebase-first resume, the stacked-state preflight, the merged-PR guard and the `Closes` injection |
| Auth / permission surface | The guarded `Closes` mutation and the managed-session observation move into the child process. Their authorization contexts must be unchanged |
| State machines | The REKICK sentinel lifecycle (consume, rearm, preserve when operator-parked) and the stack preflight's halt and recovery arms now run in the child |
| Story count | ~9 across two slices: the in-memory fork and four parity stories (resume, records, config and policy, telemetry); then the four removal stories (one executor, retired key, tests on the child path, log attribution) |
| Files touched | ~30: `daemon-cli.ts`, `index.ts`, `engine/executor-child-runtime.ts`, `engine/executor-child.ts`, `engine/executor-proxies.ts`, `engine/child-feature-executor.ts`, `engine/daemon-deps.ts`, `engine/daemon-runner.ts`, `engine/feature-executor.ts`, `engine/daemon-log.ts`, `engine/config.ts`, `types/config.ts`, a new `engine/daemon-feature-lifecycle.ts`, the template, and about fifteen daemon test files |
| ADR work | No new ADR: adr-2026-10-15 D1 already governs. It amends `adr-2026-10-15-per-dispatch-engine-pinned-executor` D1, D4 and A2 (2026-11-07 notes), and keeps the 2026-10-24 notes on `adr-2026-10-15-per-dispatch-engine-pinned-executor` D1 and D4 and `adr-2026-08-27-daemon-dispatcher-executor-seam` D1 and D8 |

## Rationale

Large. The child executor is the production default, and it skips behavior that only the
in-process runner performs: the REKICK rebase-first resume and stacked preflight, the audit trail,
the mechanical `Closes` link, `provider_suppressed` persistence, merged user config, the
managed-session context, setup and teardown bounds, the triage kill switch, false-ship escalation,
the quarantine sentinel, self-host skill resolution, `.memory` setup, and complete dispatch and OTel
telemetry. Deleting the in-process path without first moving that lifecycle into the child would
remove the last implementation of each of these. The operator chose on 2026-11-07 to include
parity in this spec. The fix moves one implementation across a process boundary and must respect
the `engine` → entry layer rule, so it needs a full architecture review. Delivery is stacked:
slice 1 makes the child run the one lifecycle, and slice 2 removes the in-process executor.
