---
slug: done-when-closes-as-verified-citing-tests-that-don
spec_hash: f4c021ab74aaf2365003dd6abe7134f2d94acdd7a4c992c39674b5e25158fae0
pr: https://github.com/jstoup111/ai-conductor/pull/3357
shipped: 2026-10-22
engine_version: 20261022T050927Z-eb167759de71
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "The plan only extends the breaker exemption and reuses the existing one-nudge handling unchanged. This change alters that handling for all unverified checks: on the final BUILD attempt the nudge is pre-spent, so completion no longer withholds, and the event can fire on a non-done final attempt. It serves the stated intent that a refusal or demotion never fails or halts BUILD (S5.7), and it is not user-visible beyond event timing. It is still an unplanned behavior change to the D8 nudge."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 15"
    outcome: remediated
    summary: "Verified, 99%: unavailable judgements bypass the required D8 nudge. src/conductor/src/engine/conductor.ts:12091 forces unverifiedDoneWhenNudgeSpent=true, and :12094–12096 overrides a nudge refusal to completion. Emitting the unverified event at :12074 does not provide the required BUILD review attempt."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 14"
    outcome: remediated
    summary: "Verified, 99%: refusal-count identity incorrectly includes the cited reference at src/conductor/src/engine/done-when-citation-judgement.ts:285–286, :302 and :340. Changing the cited test resets the same check's refusal bound; D14 keys the count only by task, check index and check-text digest."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 14"
    outcome: remediated
    summary: "Verified, 99%: settleCitationRefusals at src/conductor/src/engine/done-when-citation-judgement.ts:318–370 never reads current plan text. Its demotion at :336–345 retains obsolete checks as unverified instead of dropping refusals whose check text was removed from the plan."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 16"
    outcome: remediated
    summary: "Verified, 99%: operator acceptance cannot overturn demoted refusals. src/conductor/src/engine/done-when-accept-cli.ts:32 and :51 require source judged, while src/conductor/src/engine/done-when-citation-judgement.ts:342–343 changes it to unverified and deletes the refusal verdict. Preserve refusal provenance and accept eligible demoted records."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 17"
    outcome: remediated
    summary: "Verified, 99%: unknown close sources are not consistently rejected by name. Violating readers are src/conductor/src/engine/done-when-test-reference.ts:47–57 and :85; src/conductor/src/engine/task-progress.ts:694–699; src/conductor/src/engine/done-when-citation-judgement.ts:336–337 and :361–366; and src/conductor/src/engine/done-when-accept-cli.ts:32–35, :51 and :67. The explicit collector error is also swallowed at src/conductor/src/engine/conductor.ts:12080–12084. Unknown records can be ignored, overwritten or treated as settled."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 13"
    outcome: remediated
    summary: "Verified, 99%: pending replacement citations settle obligations prematurely. src/conductor/src/engine/done-when-citation-judgement.ts:361–366 recognizes only judged refusals as open; conductor.ts:12042 invokes this before judgement at :12051. Likewise done-when-accept-cli.ts:67–76 can close an obligation when another listed check is pending judgement. Listed pending checks must remain open until judged."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 2"
    outcome: remediated
    summary: "Verified, 99%: refusal application is not recoverably replayed across crashes. src/conductor/src/engine/conductor.ts:12054 persists judged records before admission at :12057, but restart collection at :12038 selects only pending records. In done-when-citation-judgement.ts:289–305, admission, counter update and restaging are separate writes; replay skips counting at :301. Interruptions can leave a refusal unadmitted, uncounted or unrestaged."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 3"
    outcome: remediated
    summary: "Verified, 99%: malformed citationRefusals state is accepted by src/conductor/src/engine/repair-obligations.ts:175–187 without validating its object shape or count values, then trusted at :302–307 and done-when-citation-judgement.ts:341. Additionally, done-when-accept-cli.ts:74 ignores failed state reads and :76 ignores failed closure results, while conductor.ts:12080 suppresses settlement failures. These paths must preserve named failures rather than report successful settlement."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 13"
    outcome: remediated
    summary: "Verified, 98%: citation admissions lack the required supersession behavior. src/conductor/src/engine/done-when-citation-judgement.ts:289–299 uses generic admission, but repair-obligations.ts:259–275 supersedes only plan_amendment obligations. A later citation refusal must consolidate remaining open checks and supersede the prior citation obligation so exactly one remains live."
  - gate: architecture_review_as_built
    finding: "as-built:38bdfec6-3edf-4d34-938c-eb0858dfca20:10"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 13"
    outcome: remediated
    summary: "Verified, 99%: BUILD can complete with pending citations after a judgement-boundary failure. src/conductor/src/engine/conductor.ts:12080–12086 swallows exceptions and proceeds to completion; artifacts.ts:3206–3210 and :3245–3249 do not guard pending citations. This also contradicts the approved feature diagram at .docs/architecture/done-when-closes-as-verified-citing-tests-that-don.md:38 and :52. Complete bounded judgement or unavailable demotion before permitting completion."
  - gate: architecture_review_as_built
    finding: "as-built:4c2942f1-364c-451f-9aaa-ad8dbf1bef7a:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 17"
    outcome: remediated
    summary: "Verified, 99%; prior finding 5 remains in operator acceptance. src/conductor/src/engine/done-when-accept-cli.ts:32 silently treats unknown sources as not refused. At :51 it reports only 'no refused citation', without naming the unknown source; at :65 and :78 it can ignore another malformed check and close the obligation. Parse and reject unknown sources before acceptance or settlement."
  - gate: architecture_review_as_built
    finding: "as-built:4c2942f1-364c-451f-9aaa-ad8dbf1bef7a:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 13"
    outcome: remediated
    summary: "Verified, 99%; prior finding 6 remains in the CLI. src/conductor/src/engine/done-when-accept-cli.ts:32 excludes pending-judgement from outstanding checks. Its scan at :65 therefore permits closure at :78 when the operator accepts one refused check while another replacement citation awaits judgement. Keep the obligation open until that pending check is settled."
  - gate: architecture_review_as_built
    finding: "as-built:4c2942f1-364c-451f-9aaa-ad8dbf1bef7a:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 2"
    outcome: remediated
    summary: "Verified, 99%; prior finding 7 remains. src/conductor/src/engine/conductor.ts:12053 persists judged records before admission at :12056, while restart collection at :12037 selects only pending records, stranding refusals after an intervening crash. In src/conductor/src/engine/done-when-citation-judgement.ts:287, :300 and :303, admission, counting and restaging remain separate writes; :299 skips counting on replay. Supersession at :308–316 adds another unrecovered partial-write boundary. Persist recoverable intent and replay every unfinished effect idempotently."
  - gate: architecture_review_as_built
    finding: "as-built:4c2942f1-364c-451f-9aaa-ad8dbf1bef7a:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 13"
    outcome: remediated
    summary: "Verified, 99%; prior finding 9 is incompletely repaired. src/conductor/src/engine/done-when-citation-judgement.ts:310–316 closes prior obligations after replacement admission updates currentByPlan at src/conductor/src/engine/repair-obligations.ts:288. The old obligation is then classified superseded at :129–131 and its closure rejected at :404–406, causing the citation helper to throw. Admission at done-when-citation-judgement.ts:264–273 still uses only the current verdict batch rather than all remaining open checks. Changed lines :283–286 also remove the cited reference from admission identity, although D13 requires it; only refusal-counter identity excludes the reference. Consolidate and supersede through a compatible durable transition, preserving the distinct identities."
  - gate: architecture_review_as_built
    finding: "as-built:27fd3ce4-7088-4edb-b838-a5cea73f7008:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 13"
    outcome: remediated
    summary: "Verified, 99%: the new replay revives dropped checks. src/conductor/src/engine/conductor.ts:12050 collects obsolete judged refusals through done-when-citation-judgement.ts:286–293 and unconditionally restages them at :327, including resolved admissions returned by repair-obligations.ts:226–247. Settlement skips removed check text at done-when-citation-judgement.ts:369 and closes its obligation at :393–399, but leaves the judged record eligible for replay at every later boundary. Exclude dropped or settled checks from replay so they cannot repeatedly reset tasks to pending."
  - gate: architecture_review_as_built
    finding: "as-built:27fd3ce4-7088-4edb-b838-a5cea73f7008:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 2"
    outcome: remediated
    summary: "Verified, 99%: prior crash-recovery finding remains partially unresolved. Normal execution persists a second refusal, demotes it, then excludes it from admission at src/conductor/src/engine/conductor.ts:12065–12069. After a crash immediately following verdict persistence, new recovery at :12050 admits before settlement at :12053. For a replacement citation, src/conductor/src/engine/done-when-citation-judgement.ts:286–293, :305–319 and :323–327 therefore mint another obligation, increment the counter and restage work that uninterrupted execution would only demote. Recovery must replay the same bounded disposition."
  - gate: architecture_review_as_built
    finding: "as-built:27fd3ce4-7088-4edb-b838-a5cea73f7008:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-22-done-when-evidence-at-task-close decision 13"
    outcome: remediated
    summary: "Verified, 99%: new replay can count provider unavailability as a refusal. src/conductor/src/engine/conductor.ts:12078 durably writes synthesized judged/does-not-assert records before the separate unavailable demotion at :12081–12082. A crash between writes now reaches replay at :12050; done-when-citation-judgement.ts:286–293 and :309–325 admit and count those failed dispatches. D13 explicitly prohibits failed dispatches becoming refusals or consuming the bound. Preserve unavailable disposition across crashes. This consequence is introduced by the latest replay change."
---

## Cost
input: 2482662
output: 330054
cache_read: 66855845
cache_creation: 1600595
cost_usd: 46.1499
dispatches: 38
retries: 7
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2482454, output: 189098, cache_read: 56584320, cache_creation: 0, cost_usd: 28.4709, dispatches: 21, cost_unmetered: 0
  claude: input: 208, output: 140956, cache_read: 10271525, cache_creation: 1600595, cost_usd: 17.679, dispatches: 17, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","56db1434-566c-4ab3-ba0d-1b44835c78f5","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 4
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
  disabled: 4
