---
slug: engine-updates-reach-dispatched-features-only-afte
spec_hash: f28788a54e8aa80e38513d187c873ec1a7255077decc9626348cbc87e0e2259c
pr: https://github.com/jstoup111/ai-conductor/pull/3306
shipped: 2026-10-20
engine_version: 20261019T223530Z-89c498bda849
findings:
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:1"
    class: REMEDIABLE
    governing_clause: "Task 21"
    outcome: remediated
    summary: "Verified, 99%: executor_isolation has no runtime consumer. src/conductor/src/daemon-cli.ts:2266 unconditionally constructs createInProcessFeatureExecutor, leaving createChildProcessFeatureExecutor at src/conductor/src/engine/child-feature-executor.ts:43 unreachable. Searches across production source found no child-adapter composition. Wire the approved adapter selection, including rollback logging."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:2"
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/index.ts:848 supplies an always-throwing createWorktree and :849 an error-only runner. Consequently src/conductor/src/engine/executor-child.ts:54 WorkOrder persistence, :57 feature persistence, :61 executor_started emission and :68 feature execution cannot run through the production composition. The diagram's Entry-to-Conductor edge is absent."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:3"
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "Verified, 99%: production-source searches found no callers for createExecutorBroker (src/conductor/src/engine/executor-broker.ts:32), createExecutorRequestClient (:21 of executor-proxies.ts), or createRateLimitEpisodeProxy (:71). These shared-service primitives remain unreachable."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:4"
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Verified, 99%: createProviderAvailabilityProxy at src/conductor/src/engine/executor-proxies.ts:92 has no production caller."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:5"
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "Verified, 99%: createLiveBoundaryProxy at src/conductor/src/engine/executor-proxies.ts:114 has no production caller."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:6"
    class: REMEDIABLE
    governing_clause: "Task 11"
    outcome: remediated
    summary: "Verified, 99%: createWorktreeLifecycleProxy at src/conductor/src/engine/executor-proxies.ts:131 has no production caller."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:7"
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Verified, 99%: teeExecutorConsole at src/conductor/src/engine/executor-proxies.ts:142 has no production caller; the child composition installs neither console forwarding nor feature-log forwarding."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:8"
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "Verified, 99%: writeExecutorRecord, removeExecutorRecord and sweepExecutorRecordsOnBoot at src/conductor/src/engine/executor-records.ts:84, :106 and :153 have no production-root invocation chain. Their references are confined to the unreachable adapter and sweep; daemon startup never performs the sweep."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:9"
    class: REMEDIABLE
    governing_clause: "Task 25"
    outcome: remediated
    summary: "Verified, 99%: createSupervisorStaleness at src/conductor/src/engine/supervisor-staleness.ts:11 has no production caller."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:10"
    class: REMEDIABLE
    governing_clause: "Task 27"
    outcome: remediated
    summary: "Verified, 99%: supervisor_max_stale_hours is validated but never consumed by runtime scheduling. No production connection enforces its age cap or connects protocol mismatch to the drain decision."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:11"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 2"
    outcome: remediated
    summary: "Source-grounded, 98%: src/conductor/src/daemon-cli.ts:2238 derives conductorRoot as dirname(__dirname). In the published dist-versions/<id> layout this selects the version-store directory, so engine-pin.ts:57 searches the wrong dist path. daemon-cli.ts:2242 also supplies an engine subdirectory as fallback although child-feature-executor.ts:51 appends index.js. Fallback evidence is lost when work-order.ts:116 retains only the version and child-feature-executor.ts:103 emits no pinFallbackReason. Resolve the actual installed package and entrypoint roots and retain the fallback reason."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:12"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 3"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/child-feature-executor.ts:83 ignores malformed hello messages; :87 emits no mismatch event; :107 relaunches with the unchanged WorkOrder. The fallback therefore records and sends the original version at :91-92 and reports it at :103 instead of repinning to the supervisor build. Timeout at :75-80 also enters this relaunch path instead of returning the planned missing-handshake error."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:13"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%: dispatch lifecycle ownership is not once per claim. src/conductor/src/engine/child-feature-executor.ts:66 and :103 emit an ended/started pair for each launch, so recursive fallback at :107 emits two pairs. executor-broker.ts:122-124 additionally accepts child-forwarded dispatch-start/end events onto the root bus rather than reserving them for the supervisor."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:14"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/executor-broker.ts:38-46 maintains separate, initially empty service state and updates it only in broker handlers (:68-69, :76, :84), missing supervisor-side changes. Snapshot publication at :131 precedes accepted hello, with no acceptance replay. Escalation advances on enter at :69, unlike the authoritative service's nextWaitSeconds behavior; executor-proxies.ts:88 never advances it. These are not faithful synchronous replicas."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:15"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/executor-proxies.ts:124 supplies a runDispatch admission callback that always throws. executor-broker.ts:92 derives window IDs from map size, allowing reuse and overwrite of an outstanding window after non-LIFO closure. Pending acquisitions at :91 and :105-111 can complete after disconnect cleanup at :127 and leak windows or locks. abortAll at :134 does not reject pending requests; rate-limit.clear at :75 has no shutdown signal. The proxy also always sends live.open at executor-proxies.ts:116, including when no coordinator exists."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:16"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%: the proxy feature bus created at src/conductor/src/engine/executor-broker.ts:55 has no production renderer, OTel or memory-sampling composition. The sole visualizer version setting remains the supervisor build at src/conductor/src/daemon-cli.ts:1782. Returning the bus at executor-broker.ts:132 does not establish these required subscribers."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:17"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 5"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/child-feature-executor.ts:100 and :119 send only SIGTERM, and stopAll returns without confirming exit; :47 uses a fixed default rather than production scaled-budget wiring. The daemon shutdown handler at daemon-cli.ts:1442 has no stopAll call. executor-child.ts:37-43 does not settle its wait when disconnected before receiving an order, and index.ts:850 only sets exitCode without closing IPC after completion. Successor sweep at executor-records.ts:175-182 removes the record immediately after SIGTERM without confirming termination."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:18"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 6"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/child-feature-executor.ts:52 launches before publishing its durable pin at :90, which waits for hello. The running process is unprotected during that interval. src/conductor/src/engine/executor-records.ts:182 removes protection after signalling rather than after confirmed exit, permitting GC while the executor remains alive."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:19"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/daemon.ts:1466-1470 still immediately begins a stale-engine drain without checking stale age or protocol mismatch. This contradicts D7 and the approved diagram's overlapping v1/v2 dispatch sequence. The new staleness helper and configuration do not affect this decision."
  - gate: architecture_review_as_built
    finding: "as-built:4f111ce3-650e-4b50-9d24-3089d9e7c67f:20"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 9"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/executor-child.ts:62 reports order.engineVersionId instead of the child's actual engine identity, and :64 defaults supervisor identity to that same order value. index.ts:846-850 supplies no supervisor identity. Fallback records at child-feature-executor.ts:91 retain the rejected build's version. Status at daemon-observe-cli.ts:829 assumes every repository owns src/conductor rather than resolving the shared install; its currentTarget call also accepts a dangling symlink's basename without resolving the target, so unavailable current builds can be reported as known."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 1"
    outcome: remediated
    summary: "Verified, 99%; residual prior finding 2. The replacement composition only creates the worktree at src/conductor/src/index.ts:875 and directly constructs/runs Conductor at src/conductor/src/engine/executor-child-runtime.ts:90,147. It bypasses preparation, setup triage and teardown in daemon-runner.ts:470,488,511,648,663,692,723. Runtime outcomes at executor-child-runtime.ts:144,155,158,159 contain no terminalEffects, so supervisor collection at daemon-cli.ts:2787 cannot perform the existing terminal effects. Restore the approved whole-feature lifecycle."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%; residual prior finding 14. State replication remains incomplete: src/conductor/src/engine/executor-broker.ts:203 broadcasts before hello, with no accepted-hello replay; executor-proxies.ts:45,67 discards snapshots before subscribers exist; production installs subscribers at executor-child.ts:67,68 after awaited worktree creation at :121. The separate provider map at executor-broker.ts:40,49,115 misses authoritative supervisor changes, and broadcasts occur only in broker handlers. The clear snapshot at :93 precedes authoritative clear at :95, so it retains the old escalation state. Retain/replay initial snapshots and propagate every authoritative change."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%; residual prior finding 16. Child-mode OTel is absent: src/conductor/src/engine/executor-broker.ts:64,68 attaches only the renderer, supplied at daemon-cli.ts:2339. The feature visualizer at daemon-cli.ts:1811,1823 remains on the in-process path and uses the supervisor version at :1817. Attach the child proxy-bus visualizer with the WorkOrder pin. Renderer and memory-sampling portions of the prior finding are resolved."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%; residual prior finding 15. Pending live admission at src/conductor/src/engine/executor-broker.ts:122 is not rejected by close at :180. Its late completion at :126 closes the window without responding, leaving a connected child waiting. Close also leaves the message listener installed at :200; request handling at :76,167 has no closed guard, permitting ownership requests after abort. Settle pending live requests and reject further admission after closure."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 5"
    outcome: remediated
    summary: "Verified, 99%; residual prior finding 17. Successor takeover does not await termination or block redispatch. src/conductor/src/engine/executor-records.ts:175 sends SIGTERM, then :188 retains a still-live record and returns. daemon-cli.ts:2372 proceeds into scheduling, while daemon.ts:996,1016 does not consult retained executor records. A predecessor child can overlap a new executor for the same slug. Confirm termination before permitting that slug to dispatch."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 5"
    outcome: remediated
    summary: "Verified, 99%; residual prior finding 17. Record-publication failure, rejected/missing handshakes and post-outcome hangs send only SIGTERM at src/conductor/src/engine/child-feature-executor.ts:79,123,129,171, while :174 can wait indefinitely for exit. The SIGKILL path exists only in stopAll, which also returns after signaling without confirming exit at :232. Normal child completion merely sets process.exitCode at index.ts:887 without closing the IPC channel/listeners retained by executor-child.ts:103,146. Complete bounded termination, exit confirmation and IPC closure."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7"
    outcome: remediated
    summary: "Verified, 99%; residual prior findings 10/19. src/conductor/src/engine/daemon.ts:1492,1523 requires current staleness before honoring a recorded protocol mismatch. Busy observation at :1941 is gated by daemon-maintenance.ts:135, which excludes width 1, preventing first-stale observation during a width-1 executor. After a failed forced restart, daemon.ts:1537 leaves the drain active and :1620 continues blocking claims. Honor mismatch independently, observe stale age at every width, and restore dispatch after a failed handoff."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 8"
    outcome: remediated
    summary: "Verified, 99%; cadence defect in the changed scheduling composition, also documented in the supplied halt record. src/conductor/src/daemon-cli.ts:2880 returns undefined when the engine-refresh interval has not elapsed. daemon.ts:1258 stops only for status skipped, so :1259 continues discovery and :1273 rebuilds on the idlePollMs cadence configured at :934. Apply the minimum interval to the complete fetch/refresh/rebuild sequence."
  - gate: architecture_review_as_built
    finding: "as-built:0a7d0da8-1a90-409b-b1ce-f249f643247c:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 9"
    outcome: remediated
    summary: "Verified, 99%; residual prior finding 20. src/conductor/src/engine/daemon-observe-cli.ts:829 assumes each repository owns src/conductor instead of resolving the shared installation. Its currentTarget dependency at engine-store.ts:212,220,225 validates the link basename without confirming target existence. Consumer status can miss the actual current build, while dangling links can produce a falsely known current version and incorrect older-than-current labels at daemon-observe-cli.ts:838."
  - gate: architecture_review_as_built
    finding: "as-built:b2066a9b-b2f0-427b-b1b1-74dd81f48fe7:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 1"
    outcome: remediated
    summary: "Verified, 99%; residual lifecycle finding. index.ts:875 only creates the worktree; executor-child-runtime.ts:90,147 directly constructs/runs Conductor, bypassing preparation, setup triage and teardown at daemon-runner.ts:470,488,511,648,663,692,723. Terminal effects at executor-child-runtime.ts:170 now restore markProcessed, enrollWatch and sweep, but omit cleanupHaltPresentation and engineerSignal from daemon-runner.ts:593-600; triage autoPark at :516 is also bypassed. Restore the approved whole-feature lifecycle."
  - gate: architecture_review_as_built
    finding: "as-built:b2066a9b-b2f0-427b-b1b1-74dd81f48fe7:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%; residual replication finding. executor-broker.ts:192 now broadcasts on hello, but executor-proxies.ts:46-47,73 discards snapshots before subscribers exist; production installs subscribers at executor-child.ts:67-68 only after awaited worktree creation at :121. Broadcasts at executor-broker.ts:94,104,109,119,127,192,228 still lack subscriptions to supervisor-side authoritative changes. The clear broadcast at :104 precedes the authoritative reset at rate-limit-episode.ts:155-158, retaining old escalation until clear completes. Retain/replay snapshots and propagate authoritative changes after mutation."
  - gate: architecture_review_as_built
    finding: "as-built:b2066a9b-b2f0-427b-b1b1-74dd81f48fe7:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 5"
    outcome: remediated
    summary: "Verified, 99%; residual bounded-termination finding. Record-publication failure at child-feature-executor.ts:79 still sends only SIGTERM. With hello accepted at :160, the startup timer at :136 no longer acts, :164 suppresses WorkOrder delivery, and :184 can await an uncooperative child's exit indefinitely. Use the bounded termination path at :89-95 for this failure too. Rejected/missing handshakes, post-outcome hangs, successor takeover and normal IPC closure are resolved."
  - gate: architecture_review_as_built
    finding: "as-built:b2066a9b-b2f0-427b-b1b1-74dd81f48fe7:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7"
    outcome: remediated
    summary: "Verified, 99%; residual scheduling finding. daemon.ts:1493,1524,1869 still require current staleness before honoring a recorded protocol mismatch. Busy observation at :1945 is gated by daemon-maintenance.ts:135-136, which excludes width 1, preventing first-stale-age and mismatch observation during a width-one executor. Honor mismatch independently and observe at every width. Failed-handoff dispatch recovery is now resolved at daemon.ts:1538-1543."
  - gate: architecture_review_as_built
    finding: "as-built:b2066a9b-b2f0-427b-b1b1-74dd81f48fe7:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 8"
    outcome: remediated
    summary: "Verified, 99%; residual cadence finding. daemon-cli.ts:2910 and daemon.ts:1272 now suppress rebuilding inside the minimum interval, but daemon.ts:1260 still calls discoverBacklog({refresh:true}) after a throttled skip. The production chain through daemon-cli.ts:2723,1114,2605 reaches daemon-work-source.ts:199 and the unthrottled fastForwardRoot wrapper at daemon-cli.ts:2559-2560, which fetches at daemon-backlog.ts:460. Fetch/fast-forward therefore bypasses the engine-refresh interval. Preserve backlog discovery without bypassing the approved mutation cadence."
  - gate: architecture_review_as_built
    finding: "as-built:838fd677-fa11-4e8f-a021-ff919ada6ae0:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 1"
    outcome: remediated
    summary: "Verified, 99%; residual prior lifecycle finding. index.ts:875 creates only the worktree, then :879 invokes executor-child-runtime.ts, which directly constructs Conductor at :98 and runs it at :158. This bypasses daemon-runner.ts preparation at :470-472, setup triage at :488, autoPark at :516, and teardown at :511,648,663,692,723. Handcrafted terminal effects at executor-child-runtime.ts:181-188 still omit cleanupHaltPresentation and engineerSignal from daemon-runner.ts:593-600. Restore the approved whole-feature lifecycle."
  - gate: architecture_review_as_built
    finding: "as-built:838fd677-fa11-4e8f-a021-ff919ada6ae0:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7"
    outcome: remediated
    summary: "Verified, 99%; residual prior protocol-mismatch finding. daemon.ts:1565-1568 reads recordedMismatch before observation records the pending mismatch, then abandons restart when current staleness is false. The idle path at :1916-1921 also requires current staleness before restarting. A fallback child completing before busy observation takes :1998-2003, so these paths can permit another claim or remain idle indefinitely despite a recorded mismatch. Honor mismatch independently at both boundaries. Width-one observation and failed-handoff recovery are resolved."
  - gate: architecture_review_as_built
    finding: "as-built:2bc4ef41-895f-4e98-9129-c96a20181577:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4"
    outcome: remediated
    summary: "Verified, 99%: the newly introduced shared-runner composition drops lifecycle events. executor-child-runtime.ts:47 accepts input.events but :51 does not bind it through beginFeatureRun; production dependencies at :193 likewise omit that hook. Consequently daemon-runner.ts:419 has no feature scope: shipment emission at :454, setup/triage events at :472,494, shipment-refusal diagnostics at :574, and termination events at :509,627,690,719 receive no bus. This finding concerns the new lifecycle repair in commit 2a18bb73be. Bind the existing child-owned event bus into the runner scope while preserving supervisor ownership of dispatch-start/end."
  - gate: architecture_review_as_built
    finding: "as-built:2bc4ef41-895f-4e98-9129-c96a20181577:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7"
    outcome: remediated
    summary: "Verified, 98%; residual prior protocol-mismatch finding: daemon.ts:2033 now observes mismatch before immediate collection, but collection after busy polling at :2076 and direct awaited collection at :2043 still bypass that observation. With another executor alive, a fallback child completing during the wait frees a slot; :1685 permits filling it, :1585 returns before recording the mismatch, and :1792 dispatches another feature before :2019 starts the drain. Observe pending mismatch before either collection path can reopen claiming."
---

## Cost
input: 6455711
output: 1022599
cache_read: 265906087
cache_creation: 6278638
cost_usd: 161.9541
dispatches: 84
retries: 13
halts: 12
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 6455057, output: 528548, cache_read: 186525312, cache_creation: 0, cost_usd: 85.9652, dispatches: 40, cost_unmetered: 0
  claude: input: 654, output: 494051, cache_read: 79380775, cache_creation: 6278638, cost_usd: 75.9889, dispatches: 44, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","fcd7f976-71e8-4513-803f-cdb8b4d60466","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 7
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 7
  testQuality: failures: 0, judged: 7
skip_reasons:
  disabled: 7
