---
slug: composer-decide-cannot-switch-providers-within-one
spec_hash: e0bcf488d2315f93b879fb4f2f0de491aa8288079db9934b59da5655231e0e35
pr: https://github.com/jstoup111/ai-conductor/pull/3669
shipped: 2026-11-22
engine_version: 20261122T020604Z-3379a47ff8d4
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an unplanned change to OTel retry timing, apparently made to keep a deterministic retry test stable. It changes no operator-visible output, CLI result or persisted state."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This is engine and operator halt bookkeeping committed to the feature branch. It is not a Composer feature deliverable and does not change product behaviour."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "This is an unplanned telemetry-field derivation change. It produces the same owner/repo value for GitHub refs, and nothing branches on the field."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-4
    summary: "These are layout-only rewrites beyond the planned edits. They inflate the diff but change no behaviour, output or persisted state."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: production checkpoint composition supplies no publication adapter at src/conductor/src/engine/engineer-cli.ts:1849. Consequently checkpoint.ts:210 always returns before push, draft-PR creation, block rendering/refresh, or publication-ledger updates at checkpoint.ts:217,222,231,239,243. Wire the guarded production publication required by D4–D5; helper tests with injected publication do not establish production reachability."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/engineer/checkpoint.ts:178 and :210 return before publication when no new commit is needed. After a failed push or PR creation, retrying the saved clean checkpoint cannot publish that existing commit. Separate publication retry from creation of a new checkpoint commit."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: acceptance bookkeeping violates D3 at four connected sites. src/conductor/src/engine/engineer/checkpoint.ts:184 digests plan-review records and .docs/coherence/.gitkeep although land-spec.ts:1027 excludes them, causing run-record.ts:325 to classify them as missing drafts. checkpoint.ts:178 prevents clean reconfirmation of accepted steps marked needsReconfirm. checkpoint.ts:184 supplies only dirty artifacts to run-record.ts:259, replacing a multi-file step's acceptance and losing untouched artifacts. resume.ts:69 derives acceptance solely from stored flags without checking current digests, so edited accepted artifacts can be presented as accepted and skipped."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: resume can select the wrong run. src/conductor/src/engine/engineer/resume.ts:60 discards the repository from PR URLs; engineer-cli.ts:1881 chooses an explicit or sole project without repository matching; :1891 resolves the PR number in that chosen project. Intake resolution at :1898–1904 ignores both the issue number and local ledger, selecting the first open spec PR instead of the issue's cross-referenced run."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:5"
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Verified, 99% confidence: chooseResumeLocalState at src/conductor/src/engine/engineer/resume.ts:31 has no production caller; the search covered src/conductor/src. resume.ts:101–106 fetches, attaches, and reads the local record directly, while worktree-shared.ts:54–62 reuses existing local state. There is no inspection of leftovers, keep/discard choice, divergence refusal, backup, or reconciliation with fetched progress."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 9"
    outcome: remediated
    summary: "Verified, 99% confidence: resumed intake runs never populate the machine's deciding ledger. src/conductor/src/engine/engineer-cli.ts:1922 supplies a recordDeciding callback containing only void branch and void draftPrUrl. resume.ts:107 invokes that no-op. Implement durable intake reconciliation using the resolved run identity, branch, and draft PR."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 11"
    outcome: remediated
    summary: "Verified, 99% confidence: ownership takeover is not enforced. src/conductor/src/engine/engineer/checkpoint.ts:197–199 unconditionally rewrites the owner marker to the current machine owner, including foreign-owned and daemon-session runs. engineer-cli.ts:1906 does not reject unresolved identity or inspect committed ownership, and :1929 merely records 'unresolved' before launching. resume.ts:109 hard-codes unchanged ownership; resumeOwnershipMode at :44 has no production caller. Implement the approved interactive takeover and exact push approval, preserving the original owner and local-only mode otherwise."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:8"
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "Verified, 100% confidence: resumeOwnershipMode at src/conductor/src/engine/engineer/resume.ts:44 is an unreachable production rung. Searching src/conductor/src finds its definition but no caller. Its integration belongs to the ownership repair required by D11."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: the launcher boundary is absent. src/conductor/src/engine/engineer-cli.ts:1300 generates no per-launch ID; after host exit at :1355 it proceeds directly to confirmAnother at :1372. It neither discovers touched runs nor saves unfinished drafts nor offers continue/switch/hand-off. Resume's child launch at :1943 likewise returns without boundary handling. These omissions contradict the approved launcher component and sequence diagram."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:10"
    class: REMEDIABLE
    governing_clause: "Task 17"
    outcome: remediated
    summary: "Verified, 100% confidence: resolveBoundaryProvider at src/conductor/src/engine/engineer/launch-boundary.ts:10 has no production caller. composer_provider_switched and composer_run_handed_off appear only in types/events.ts:1387,1395 and engine/event-sinks.ts:174,175, with no production emitter. Search covered src/conductor/src. Wire these into the approved launcher boundary."
  - gate: architecture_review_as_built
    finding: "as-built:42bd4de1-6ef7-4403-b7e1-6d1052f231be:11"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 10"
    outcome: remediated
    summary: "Verified, 99% confidence: transition persistence and correlation disagree. src/conductor/src/engine/engineer-cli.ts:1846 writes checkpoint events beneath the worktree, while :1551 and :1908 write started/resumed events beneath the canonical target. The resumed event at :1927 lacks worktreePath, uses the incoming launch ID at :1931, and then launches its child with a different UUID at :1943. Use the target ledger and consistent launch/worktree correlation required by D8–D10."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence; prior finding 3 remains partially unresolved. src/conductor/src/engine/engineer/checkpoint.ts:248 still digests plan-review records and .docs/coherence/.gitkeep, which land-spec.ts:1027 excludes. checkpoint.ts:245 supplies only dirty artifacts when any exist, and run-record.ts:301 replaces the step's complete accepted artifact set, losing untouched artifacts. resume.ts:100 and run-record.ts:90 derive acceptance from stored flags without comparing current digests, so edited accepted artifacts can be presented as accepted and skipped."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence; prior finding 4 remains unresolved. src/conductor/src/engine/engineer/resume.ts:60 discards the repository from PR URLs. engineer-cli.ts:1990 selects an explicit or sole project without repository matching, and :2000 resolves the PR number there. Intake resolution at :2007–2013 ignores the issue number and local ledger, selecting the first open spec PR instead of the issue's run."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:3"
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Verified, 100% confidence; prior finding 5 remains unresolved. Searching src/conductor/src finds chooseResumeLocalState only at src/conductor/src/engine/engineer/resume.ts:31. Production resume.ts:95–101 fetches, attaches and reads local state; engineer-cli.ts:2028 reaches worktree-shared.ts:54–62, which reuses existing state without reconciliation. The required leftovers inspection, keep/discard choice, divergence refusal and backup are absent."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 9"
    outcome: remediated
    summary: "Verified, 100% confidence; prior finding 6 remains unresolved. src/conductor/src/engine/engineer-cli.ts:2031–2034 supplies a recordDeciding callback containing only void statements. resume.ts:102 invokes that no-op, so resumed intake runs do not reconstruct the local deciding ledger required by D9 and the diagram's resume-to-ledger edge."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 11"
    outcome: remediated
    summary: "Verified, 99% confidence; prior finding 7 remains unresolved. src/conductor/src/engine/engineer/checkpoint.ts:255–262 appends owner history and unconditionally re-stamps the marker to the current owner without the approved takeover workflow. engineer-cli.ts:2015 does not reject unresolved identity or inspect committed ownership; :2038 records unresolved and :2045 launches. resume.ts:104 hard-codes unchanged ownership. Interactive exact-push approval, foreign-owner local-only behavior, and daemon/engine takeover prohibition remain unenforced."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:6"
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "Verified, 100% confidence; prior finding 8 remains unresolved. Searching all src/conductor/src finds resumeOwnershipMode only at src/conductor/src/engine/engineer/resume.ts:44. It has no production caller; integrate it into the ownership repair required by D11."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence; prior finding 9 remains partially unresolved. Launch correlation is repaired, but src/conductor/src/engine/engineer-cli.ts:1435 still returns from the host directly to confirmAnother at :1452. Resume likewise spawns at :2045 and returns at :2046. Neither path discovers touched runs, saves unfinished drafts, or offers continue/switch/hand-off. The approved launcher component and sequence remain unimplemented."
  - gate: architecture_review_as_built
    finding: "as-built:08952775-8791-418a-a54c-b207f7a53500:8"
    class: REMEDIABLE
    governing_clause: "Task 17"
    outcome: remediated
    summary: "Verified, 100% confidence; prior finding 10 remains unresolved. Searching all src/conductor/src finds resolveBoundaryProvider only at engine/engineer/launch-boundary.ts:10. composer_provider_switched appears only in types/events.ts:1388 and engine/event-sinks.ts:174; composer_run_handed_off only in types/events.ts:1396 and engine/event-sinks.ts:175. There is no production caller or emitter for these three primitives."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: prior acceptance finding remains partially unresolved. checkpoint.ts:249 still digest-tracks plan-review files mapped by run-record.ts:371, although land-spec.ts:1027 excludes them. checkpoint.ts:247–255 retains unchanged artifacts only when the current step is accepted; re-accepting a draft can still lose unchanged previously accepted artifacts. The new resume.ts:121–126 comparison fails open: one unreadable/missing artifact disables all digest comparisons, including successfully read edited artifacts. Paths are under src/conductor/src/engine/engineer/. Coherence .gitkeep exclusion, clean reconfirmation and accepted-to-accepted artifact retention are repaired."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:2"
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Verified, 100% confidence: prior task 13 finding remains unresolved. Searching all src/conductor/src finds chooseResumeLocalState only at engine/engineer/resume.ts:31. Production resume.ts:97–102 and engineer-cli.ts:2157 reach worktree-shared.ts:54–62 without leftovers inspection, keep/discard selection, backup/WIP preservation or divergent/non-TTY refusal."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 11"
    outcome: remediated
    summary: "Verified, 99% confidence: prior ownership finding remains unresolved. src/conductor/src/engine/engineer/checkpoint.ts:264–271 unconditionally appends the machine owner and re-stamps ownership, then publishes at :282. engineer-cli.ts:2053 supplies publication without foreign-owner local-only suppression. Resume resolves identity at :2140 but permits unresolved identity through :2174 and launches at :2183; resume.ts:130 hardcodes unchanged ownership. Interactive takeover with exact-ref push approval, preservation of the original owner on refusal, and daemon/engine takeover prohibition remain absent."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:4"
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "Verified, 100% confidence: prior task 14 reachability finding remains unresolved. Searching all src/conductor/src finds resumeOwnershipMode only at engine/engineer/resume.ts:44. Integrate it into the approved ownership workflow."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 9"
    outcome: remediated
    summary: "Verified, 99% confidence: prior ledger finding is only partially repaired. src/conductor/src/engine/engineer-cli.ts:2165 skips reconstruction for PR-number, PR-URL and branch selectors, even when they identify an intake run. Issue selectors now persist deciding state at :2167–2170. The newly added launcher publication callback at :1526 is a no-op, so its first draft publication also omits the required deciding transition."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: prior run-selection finding is substantially repaired, but src/conductor/src/engine/engineer-cli.ts:2105–2108 still requires --project whenever multiple projects are registered, rather than matching a repository-qualified selector by registry remote URL as D6 requires. Repository mismatch refusal and issue-specific ledger/PR lookup are now present."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: prior boundary finding remains partially unresolved in the new implementation. In src/conductor/src/engine/engineer-cli.ts:1539–1541, production silently chooses continue/handoff instead of prompting. Child exit at :1557 and refusal handling at :1562–1564 proceed to another-idea at :1566 without another save/boundary or retry choices; direct resume likewise returns at :2183–2184. Autosave at :1518 hardcodes PRD before reading state at :1534 and has no unfinished/dirty guard; checkpoint.ts:236–242 therefore pushes clean runs. The launch ID at :1420 is reused across the loop at :1470, while discovery at :863–873 has no handled/session boundary, allowing an untouched later session to rediscover an old run. Failed publication at :1528–1531 can still produce a successful handoff event/output at :1545–1546. Switch emission at :1550 precedes installation validation at :1554. These sites also diverge from the approved launcher sequence."
  - gate: architecture_review_as_built
    finding: "as-built:065cf9ed-13e2-4c3a-8a27-9599f74fc2d6:8"
    class: REMEDIABLE
    governing_clause: "Task 17"
    outcome: remediated
    summary: "Verified, 100% confidence: composer_provider_switched remains unreachable under production configuration. src/conductor/src/index.ts:1115 supplies no chooseComposerBoundary; engineer-cli.ts:1541 selects only continue or handoff, so the changed-provider branch at :1548–1550 requires injected selection. The prior missing-emitter finding is narrowed to this missing production choice path."
  - gate: architecture_review_as_built
    finding: "as-built:f528a214-254f-4639-9d12-5c71598378ee:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: prior boundary finding remains partially unresolved. In src/conductor/src/engine/engineer-cli.ts:1615 and :1616, step/provider are computed once; child exit at :1645 loops to :1621 without autosave, state refresh or delivery detection. At :1646, any successful child exit clears publication failure without proving publication, permitting false handoff at :1631. Direct resume still returns immediately after its child at :2367–2372. Launch ID allocation at :1483 and historic-event selection at :930–935 allow an untouched subsequent idea to rediscover an earlier run. The newly added record-presence guard at :1580–1583 skips drafts before the first checkpoint. The new retry loop also spins indefinitely on non-TTY handoff refusal: :879 selects handoff repeatedly while :1627 or :1629 continues. Repair every host-exit boundary and scope discovery to the current session."
  - gate: architecture_review_as_built
    finding: "as-built:f528a214-254f-4639-9d12-5c71598378ee:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 11"
    outcome: remediated
    summary: "Verified, 99% confidence: prior ownership finding remains partially unresolved. src/conductor/src/engine/engineer-cli.ts:2326–2341 commits takeover and returns without the required exact-ref, exact-operation approved push. Launcher autosave at :1591–1605 omits localOnly protection, reaching checkpoint.ts:304–312 to re-stamp a foreign owner and publish. The new ownership reader at engineer-cli.ts:813–817 reads mutable worktree content rather than committed provenance; checkpoint :2143 and resume :2312 trust it. Preserve committed ownership across all checkpoint callers and complete the approved takeover publication/refusal flow."
  - gate: architecture_review_as_built
    finding: "as-built:f528a214-254f-4639-9d12-5c71598378ee:3"
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Verified, 99% confidence: prior local-reconciliation finding is partially repaired. src/conductor/src/engine/engineer-cli.ts:2262–2263 skips existing local-branch inspection when its worktree is absent; :2308 reaches worktree-shared.ts:59–62 and attaches that branch unchanged. Fetch at engineer-cli.ts:2255–2257 also never advances a clean behind-remote branch through the reuse/attach paths at worktree-shared.ts:54–62. Newly added discard handling inspects and backs up only .docs at engineer-cli.ts:2265 and :2293–2295, then resets the entire worktree at :2298, leaving other dirty tracked files unpreserved. The prompt at :907–916 and :2279–2282 shows only local state, not saved remote progress. Complete branch reconciliation and preservation before discard."
  - gate: architecture_review_as_built
    finding: "as-built:f528a214-254f-4639-9d12-5c71598378ee:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 9"
    outcome: remediated
    summary: "Verified, 99% confidence: prior resume-ledger finding remains incomplete for branch selectors. src/conductor/src/engine/engineer/resume.ts:101 resolves spec/<slug> to a branch only, bypassing PR discovery. Its callback at :146–149 reaches engineer-cli.ts:2345–2354 with draftPrUrl undefined, so a fresh machine cannot reconstruct the required branch-and-PR deciding entry. PR/issue selectors and launcher publication now persist the ledger correctly."
  - gate: architecture_review_as_built
    finding: "as-built:d019e3bd-81a1-4b39-ab71-cc39664a1c3d:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: prior launcher-boundary finding remains partially unresolved. Direct resume autosaves at src/conductor/src/engine/engineer-cli.ts:3150, prints choices at :3165, then returns at :3169 without prompting, relaunching or handing off. Provider selection at :2235 and :2321, and presentation at :3166, prefer the last checkpoint provider over the host that actually ran; a clean Claude-to-Codex session therefore makes the next continue select Claude. The state display at :2236 is outside the loop, while the repeated prompt at :989 omits refreshed step/provider. Complete the actionable boundary and retain actual session-provider identity."
  - gate: architecture_review_as_built
    finding: "as-built:d019e3bd-81a1-4b39-ab71-cc39664a1c3d:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: prior false-handoff finding remains. src/conductor/src/engine/engineer-cli.ts:1411 resets saveFailed to false, and :1416 skips publication for clean worktrees. After a failed push leaves a local commit, continuing through a session with no edits replaces the failure at :2320 without proving publication. The guard at :2255 then permits :2262 to emit/report handoff through :1589 and :1595. Preserve failed-publication state until successful publication is established."
  - gate: architecture_review_as_built
    finding: "as-built:d019e3bd-81a1-4b39-ab71-cc39664a1c3d:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: prior local-reconciliation finding remains partially unresolved, with two failures in the newly rewritten reconciliation path. src/conductor/src/engine/engineer-cli.ts:1649 assumes a local branch exists, so :1658 fails on remote-only runs before attachment; production Git rejects errors at src/conductor/src/engine/pr-labels.ts:156. engineer-cli.ts:1672 advances behind branches only without a worktree, leaving existing clean behind worktrees unchanged through :1760 and worktree-shared.ts:54. engineer-cli.ts:1731 reads the remote run record outside its catch, so landed runs whose record was stripped fail before resume.ts:163 can direct them to delivery. Handle absent local branches, advance clean existing worktrees, and tolerate intentional record removal."
  - gate: architecture_review_as_built
    finding: "as-built:d019e3bd-81a1-4b39-ab71-cc39664a1c3d:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-composer-run-checkpoint-resume-handoff decision 11"
    outcome: remediated
    summary: "Verified, 99% confidence: prior ownership finding remains on failed takeover publication. src/conductor/src/engine/engineer-cli.ts:3072 and :3090 commit owner B; a non-executed push returns local-only at :3109 but leaves that marker committed. src/conductor/src/engine/engineer/resume.ts:153 receives the mode without preserving it for later checkpoints. engineer-cli.ts:1342 reads the local B marker and :1346 calculates localOnly=false, allowing ordinary publication using local spec-branch provenance at :1138 and :1160 although remote ownership remains A. Preserve local-only protection until the explicitly approved takeover publication succeeds."
---

## Cost
input: 14934827
output: 1587309
cache_read: 241593132
cache_creation: 7935776
cost_usd: 183.7966
dispatches: 3123
retries: 40
halts: 17
unmetered: count: 2917, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 14934309, output: 981984, cache_read: 212456448, cache_creation: 0, cost_usd: 102.3744, dispatches: 3052, cost_unmetered: 0
  claude: input: 518, output: 605325, cache_read: 29136684, cache_creation: 7935776, cost_usd: 81.4221, dispatches: 71, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","82f6ffb8-03fd-40c8-b385-3060d6428c84","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","ba698f72-bc36-43da-b8cd-31d2d7276de2","lifecycle-step","build_review"]

## Build Review
laps_to_pass: 2
skipped: 15
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 1, judged: 18
  implementationQuality: failures: 13, judged: 18
  security: failures: 0, judged: 18
  testQuality: failures: 0, judged: 18
skip_reasons:
  paths-unmatched: 15


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:c6e25f934968a488dc5f789e534f4a0fbfef5b985f8e58cc31ae3ac991e79ba6` — rubric: implementationQuality

- Operator-resolved case: `7ea973bb-a20d-4494-9584-96be0f23c375` — source ids: `implementationQuality:sha256:bf86922d7f49fb58f0a7ab4dafa2b2a3b8cb4df42255cf15db7afc6c1764532d`, `implementationQuality:sha256:8faee93f16143facba317f6195fa757ee3bb634b33d21bf748328f6cc2a66651`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->