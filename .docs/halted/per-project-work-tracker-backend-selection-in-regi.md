# Halt record

Status: halted
Slug: per-project-work-tracker-backend-selection-in-regi
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-per-project-work-tracker-backend-selection-in-regi
Head SHA: 49b46416d9d750ca700ba2dc587d7de8fcfa55f0
Halted at: 2026-09-29T13:38:33.626Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AR-ASBUILT-003 (architectural-clarity: Verified (95%, events.jsonl test_suite failure + commit 1abdbe8c0): the finding demands removing the daemon-cli.ts:2950 tracker_backend_unavailable branch per rem-as-built-rem-ar002-1, but that removal already landed (5716a3974) and failed the suite at daemon-render.test.ts:637 ('handles every event type declared renderable by the sink registry'), which requires renderDaemonEventUnsafe to handle exactly the EVENT_SINKS render:true set, while Task 4's approved Done-when requires tracker_backend_unavailable to be render:true (event-sinks.ts:151), so build re-added the branch; rem-as-built-rem-ar002-1 was planned on the false premise that no test pins the daemon branch, and the three constraints (as-built reachability, Task 4 render:true, the repo-wide render-completeness guard) cannot all hold — any build route cycles test_suite against as-built. A human must decide which yields: (a) accept a daemon branch for every render:true event as the repo invariant and retire rem-as-built-rem-ar002-1 (recommended — keeps the guard and Task 4 intact, zero code change), (b) amend Task 4 to render:false and rely on the explicit intake-loop subscription (rem-as-built-rem-ar002-2, intake-loop-cli.ts:149), then remove the branch and its daemon-render.test.ts:90 case, or (c) introduce a sink-registry distinction between daemon-rendered and operator-console-rendered events. Each option amends the sealed plan or the event-sink contract, so no autonomous route exists.)
```
