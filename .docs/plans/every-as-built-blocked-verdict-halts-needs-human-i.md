# Implementation Plan: every-as-built-blocked-verdict-halts-needs-human-i

**Date:** 2026-08-25
**Design:** .docs/decisions/adr-2026-08-25-as-built-remediable-findings-bounded-build-route.md
**Stories:** .docs/stories/every-as-built-blocked-verdict-halts-needs-human-i.md
**Conflict check:** Clean as of 2026-08-25

## Summary

Classify each as-built BLOCKED finding (REMEDIABLE vs DESIGN) via a machine-read table, and
route fully-remediable reports through the existing single-appender remediation seam under a
new `architecture_review_as_built` gate key with a one-lap cap; everything ambiguous or
design-shaped halts needs-human. 18 tasks.

## Technical Approach

- **Contract first:** the architecture-review skill's as-built section gains a
  `## Blocking Findings` table contract (columns: Finding, Class, Governing clause, Summary;
  closed class set REMEDIABLE|DESIGN; clause = ADR filename stem plus decision number, or a
  plan task id of this feature's plan).
- **Parsing:** a new `parseAsBuiltBlockedFindings` in `src/conductor/src/engine/artifacts.ts`
  mirrors `parsePrdAuditReport`'s local pattern — section-scoped line slice, header-validated
  table, closed grade set, malformed row fails the whole parse. The relevant traits to
  preserve: scope rows strictly to the section between the heading and the next `##` heading;
  validate required columns by header name, not position count alone; return a typed
  fault (never throw) so callers stay fail-closed. Search hint: the prd-audit parser and its
  `verdictTableLines` helper live in the same module. `classifyAsBuiltReviewOutcome` widens
  `blocked` into `blocked-remediable` | `blocked-design`; any table defect returns `invalid`.
- **Routing:** the two as-built halt sites in `src/conductor/src/engine/conductor.ts` (serial
  SHIP walk and validation-group join) branch on the widened outcome. `blocked-remediable`
  builds clause-bound remediation gaps and enters the existing `planRemediation` admission;
  `blocked-design` and `invalid` write needs-human halts carrying the per-finding listing.
- **Bounds:** the gate gets its own lap cap (config default 1) through
  `remediationLapCapForGate`; appended tasks draw the shared growth allowance via the
  gate-keyed `byGate` record in `src/conductor/src/engine/kickback-ledger.ts` (additive key,
  no schema change). The retired capture/check no-op escalation pair is re-armed for this
  gate. Exhaustion halts use the existing `kickback-cap` class.
- **Kill switch:** `architecture_review_as_built.remediation.enabled` (default true); off
  restores today's halt-always behavior exactly.
- **Observability:** per-finding classification and remediation outcomes ride the existing
  recorded-findings projection into the verdict artifact and shipped record; every new exit
  emits its lifecycle terminal; group-path refusal stamping is unchanged.
- **Sequencing:** contract → parser/outcome → config/caps → admission/append → halt-site
  branches → escalation/ledger → projection → lifecycle.

## Prerequisites

None — all seams exist on main; the growth ledger is already gate-keyed.

## Tasks

### Task 1: Blocking Findings table contract in the as-built skill section
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: extend the harness integrity/skill checks only if one already covers section content; otherwise author a unit fixture test in the conductor suite asserting a template-conformant BLOCKED report parses (depends on Task 2's parser — keep the fixture here, the assertion lands in Task 2).
2. Edit the as-built section of the architecture-review skill: add the `## Blocking Findings` table to the BLOCKED artifact template with columns `| Finding | Class | Governing clause | Summary |`, the closed class set REMEDIABLE|DESIGN, the clause grammar (ADR filename stem plus decision number, or a task id from this feature's own plan), and the rule that the table is required exactly when the verdict is BLOCKED.
3. Update the skill's verification checklist rows for BLOCKED accordingly.
4. Run the harness validation suite; commit.

**Done when:**
- [ ] The as-built artifact template in the skill shows the table with the four named columns and the closed class set
- [ ] The skill text states the clause grammar and that a REMEDIABLE row without a clause is malformed
- [ ] `test/test_harness_integrity.sh` passes

**Files likely touched:**
- skills/architecture-review/SKILL.md — as-built template + checklist

**Dependencies:** none

### Task 2: parseAsBuiltBlockedFindings parser
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: a fixture BLOCKED report with a valid two-row table parses to typed findings `{id, class, clause, summary}`; a fixture with all-REMEDIABLE rows and one with a DESIGN row produce the expected sets.
2. Verify RED.
3. Implement `parseAsBuiltBlockedFindings(content)` in the artifacts module following the prd-audit parser's traits (section-scoped slice, header-name validation, closed class set, typed fault return).
4. Verify GREEN; commit.

**Done when:**
- [ ] `src/conductor/test/as-built-verdict.test.ts` (or a sibling new test file) passes with valid-table fixtures for all-REMEDIABLE and mixed rows
- [ ] The parser returns a typed fault object for malformed input and never throws

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — new parser + types
- src/conductor/test/as-built-verdict.test.ts — fixtures

**Dependencies:** none

### Task 3: Fail-closed negative paths for the parser
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests, one per defect: BLOCKED with no table; unknown class value; REMEDIABLE row with empty clause; header missing a required column. Each asserts the parse returns a fault naming the specific defect (missing table / offending row and value / clause-less finding / malformed header).
2. Verify RED, implement the fault paths, verify GREEN; commit.

**Done when:**
- [ ] Four negative tests pass, each asserting the fault message names its defect
- [ ] Fail-closed enumeration is closed: exactly these defect classes produce `invalid`; a valid table never does

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — fault paths
- src/conductor/test/as-built-verdict.test.ts — negative fixtures

**Dependencies:** 2

### Task 4: Widen AsBuiltReviewOutcome
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: `classifyAsBuiltReviewOutcome` returns `blocked-remediable` for an all-REMEDIABLE table, `blocked-design` for any DESIGN row, `invalid` for every Task 3 defect on a BLOCKED verdict; non-BLOCKED verdicts are byte-identical to today (no table required).
2. Verify RED.
3. Widen the outcome union, thread the parser into classification, and update the completion predicate's blocked arm to carry the widened kind (reason text unchanged for the design case).
4. Verify GREEN; commit.

**Done when:**
- [ ] The outcome union compiles with `blocked-remediable` and `blocked-design` and all existing consumers type-check
- [ ] Non-BLOCKED classification behavior is proven unchanged by existing tests still passing

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — outcome union, classifier, completion predicate

**Dependencies:** 3

### Task 5: Config keys — lap cap and kill switch
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test: config validation accepts `architecture_review_as_built.remediation.enabled` (boolean, default true) and `architecture_review_as_built.max_remediation_laps` (positive integer, default 1); rejects a non-boolean/non-integer with a named error.
2. Verify RED, implement in the config validator beside the prd_audit cap keys, verify GREEN; commit.

**Done when:**
- [ ] Defaults resolve to enabled=true, laps=1 with no config present
- [ ] Invalid values fail validation with errors naming the key

**Files likely touched:**
- src/conductor/src/engine/config.ts — keys + validation
- src/conductor/test/config.test.ts — cases

**Dependencies:** none

### Task 6: Per-gate lap cap resolution
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: `remediationLapCapForGate('architecture_review_as_built', config)` returns the configured cap (default 1) while other gates keep their current values.
2. Verify RED, add the branch beside the prd_audit branch, verify GREEN; commit.

**Done when:**
- [ ] The cap function returns 1 by default and the configured value when set for the as-built gate
- [ ] prd_audit and generic gate caps are unchanged (existing tests pass)

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — remediationLapCapForGate

**Dependencies:** 5

### Task 7: Admission — as-built source allowed when enabled
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: with remediation enabled, `planRemediation` given as-built hint evidence no longer converts the task request into a kickback-cap halt at the growth-allowance guard; with the switch off it behaves exactly as today.
2. Verify RED.
3. Update `requiresPlanGrowthAllowance` (and its caller) so the as-built hint source is admitted when the kill switch is on, rejected identically to today when off.
4. Verify GREEN; commit.

**Done when:**
- [ ] The guard admits the as-built source only when the config switch is on
- [ ] Kill-switch-off behavior is byte-equivalent to current behavior in the guard's test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — requiresPlanGrowthAllowance and admission wiring

**Dependencies:** 4, 5

### Task 8: Clause-bound gap construction and resolution
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: parsed REMEDIABLE findings become clause-bound remediation gaps; a clause naming an APPROVED ADR stem plus decision resolves against the decisions directory on disk; a clause naming a task id resolves against the active plan.
2. Verify RED, implement gap construction in the as-built branch of the admission loop (parallel to the prd_audit criterion-bound map), verify GREEN; commit.

**Done when:**
- [ ] A resolvable clause produces exactly one admitted gap per finding with parent linkage
- [ ] Gap objects carry the clause string that later renders into the appended task

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — gap admission loop
- src/conductor/src/engine/remediation-append.ts — clause-bound gap type extension

**Dependencies:** 7

### Task 9: Unresolvable clause halts needs-human
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: a REMEDIABLE finding whose clause names a non-existent ADR stem or a task id absent from the active plan causes no append and a needs-human halt naming the unresolvable clause.
2. Verify RED, implement the fail-closed branch, verify GREEN; commit.

**Done when:**
- [ ] No task is appended when any clause fails resolution
- [ ] The halt body names the finding id and the unresolvable clause verbatim

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — admission fail-closed branch

**Dependencies:** 8

### Task 10: Appended task rendering with governing clause
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: appended as-built remediation tasks render with an id prefixed `rem-as-built-`, a Gate line naming the as-built source, a `Governing clause:` line, parent task linkage, and a Done when block; the append is idempotent on re-run.
2. Verify RED, extend the append primitive's render for the as-built gate source, verify GREEN; commit.

**Done when:**
- [ ] Rendered task blocks contain the clause line and pass the plan task-id grammar
- [ ] Re-appending the same gap upserts rather than duplicates (existing idempotency test extended)

**Files likely touched:**
- src/conductor/src/engine/remediation-append.ts — render + id scheme
- src/conductor/test/prd-audit-kickback.test.ts — or a sibling as-built append test

**Dependencies:** 8

### Task 11: Ledger — laps, growth byGate, isolation
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: a completed admission records one lap under the as-built gate key and growth `byGate` gains the as-built entry; build_review's cumulative counter and prd_audit's lap counter are unchanged by the as-built lap (isolation assertions).
2. Verify RED, wire lap increment + `recordGrowth` for the as-built gate in the cap block, verify GREEN; commit.

**Done when:**
- [ ] The ledger shows laps=1 under the as-built gate key after one admission and emits the plan-growth event
- [ ] Isolation test proves the other two counters are untouched

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — cap block ledger writes
- src/conductor/test/prd-audit-kickback.test.ts — isolation cases

**Dependencies:** 7

### Task 12: Cap and allowance exhaustion halts
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: with one as-built lap already recorded, a second BLOCKED outcome appends nothing and halts with class kickback-cap listing every finding with class and clause; a request exceeding the remaining shared growth allowance halts the same way naming the allowance.
2. Verify RED, implement both halt branches in the cap block, verify GREEN; commit.

**Done when:**
- [ ] Both exhaustion tests pass with halt class kickback-cap and full per-finding listing in the body
- [ ] The exhaustion enumeration is closed: second lap, or requested tasks exceeding remaining allowance — nothing else halts here

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — cap block halts

**Dependencies:** 11

### Task 13: Serial halt-site branch
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: at the serial SHIP walk site, blocked-remediable within allowance routes (tasks appended, navigate back to BUILD, gate restaged stale) instead of halting; blocked-design and invalid still halt needs-human with the per-finding listing.
2. Verify RED.
3. Branch the serial intercept on the widened outcome, reusing the dispatch shape of the existing remediation block (escalation check, planRemediation, capture context, navigate back, restage stale); delete or repurpose the dead hardcoded finish-only branch it replaces where touched.
4. Verify GREEN; commit.

**Done when:**
- [ ] Serial-path test proves route on blocked-remediable and halt on blocked-design/invalid
- [ ] After navigateBack the as-built step is restaged stale and re-runs after BUILD

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — serial as-built intercept

**Dependencies:** 9, 10, 11

### Task 14: Validation-group join branch
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: at the group join, a blocked-remediable as-built verdict produces exactly one consolidated planRemediation dispatch (multi-source evidence preserved, per-gate budgets intact) whose route is now taken; blocked-design/invalid keep the current halt with `recordGroupRefusal` stamping unchanged.
2. Verify RED, branch the group-join intercept (stop discarding the route for the remediable case), verify GREEN; commit.

**Done when:**
- [ ] Group-path test proves single consolidated dispatch and taken route for remediable, halt otherwise
- [ ] Refusal stamping assertions from the existing group tests still pass

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — group join intercept
- src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts — group case

**Dependencies:** 13

### Task 15: Mixed and design reports halt whole with listing
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests at both sites: a report with one DESIGN row among REMEDIABLE rows appends nothing and halts needs-human listing all rows with id, class, and clause/open question; after an operator clears the halt, re-dispatch re-runs the gate freshly (no resumed route).
2. Verify RED, implement, verify GREEN; commit.

**Done when:**
- [ ] Mixed-report tests at serial and group sites prove zero appends and the full listing in the halt body
- [ ] The committed halt record carries the listing through the existing writeHaltMarker seam with class needs-human

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — design-halt bodies

**Dependencies:** 13, 14

### Task 16: No-op escalation re-armed for the as-built gate
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: after an as-built remediation route, the capture context is recorded for the as-built gate; on the gate's next evaluation with zero tree movement and an unchanged verdict, the escalation check halts instead of re-dispatching.
2. Verify RED, add capture/check call sites beside the new route (mirroring the prd_audit call-site pattern), verify GREEN; commit.

**Done when:**
- [ ] Escalation test proves the zero-progress lap halts via the existing shouldEscalateKickback path
- [ ] Capture is single-use and scoped to the as-built gate key

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — capture/check call sites

**Dependencies:** 13

### Task 17: Per-finding projection into verdict artifact and shipped record
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: after a converged remediation lap, the recorded-findings projection includes each remediated finding with class and clause in the verdict artifact and the shipped record; a finding object missing a required field fails the render with an error naming the field; existing recorded-findings consumers round-trip unchanged (additive shape).
2. Verify RED, extend the projection writer and the shipped-record reader, verify GREEN; commit.

**Done when:**
- [ ] Round-trip test parses the as-built remediation entries from the shipped record
- [ ] The missing-field render error test passes and pre-existing projection tests are green

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — projection writer
- src/conductor/src/engine/shipment-association.ts — reader

**Dependencies:** 13

### Task 18: Lifecycle terminals and kill-switch revert proof
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests: each of the four new exits (remediable route, kickback-cap halt, design needs-human halt, invalid needs-human halt) emits exactly one lifecycle terminal for the started execution; the kill-switch-off path matches today's terminal emission; any new event member declares its sink row (compile-time exhaustiveness stays green).
2. Verify RED, wire terminal emissions where missing, verify GREEN; commit.
3. Also assert (kill-switch revert, covering the Story 3 negative): with remediation disabled, a blocked-remediable outcome halts needs-human exactly as before this feature.

**Done when:**
- [ ] Four exactly-one-terminal tests pass
- [ ] The kill-switch revert test proves halt-always behavior when disabled
- [ ] The event sink registry compiles exhaustively with no undeclared member

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — terminal emissions
- src/conductor/test/as-built-verdict.test.ts — exit coverage

**Dependencies:** 12, 15, 16

## Task Dependency Graph

```
1 (skill contract)          5 (config)
2 → 3 → 4 ──────────────┐    │
                        ├→ 7 ← 5     6 ← 5
                        │   ↓
                        │   8 → 9
                        │   8 → 10
                        │   7 → 11 → 12
                        └→ 13 (needs 9, 10, 11) → 14 → 15
                            13 → 16
                            13 → 17
                            12, 15, 16 → 18
```

## Integration Points

- After Task 4: parser + classification testable end-to-end against fixture reports.
- After Task 12: admission/caps/ledger flow testable without touching the halt sites.
- After Task 14: full remediation loop drivable in an acceptance test (BLOCKED → append → BUILD → re-run → APPROVED).

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done when block; fail-closed and exhaustion enumerations are closed in Tasks 3 and 12
- [ ] Dependencies are explicit and acyclic


### Task rem-as-built-AB-R1: Reject non-exact finding class and any second Blocking Findings table
**Gate:** as-built
**Rationale:** parseAsBuiltBlockedFindings uppercases the supplied class before checking the closed set (artifacts.ts:4114), so `remediable` and `Design` are accepted although decision 2 requires the exact vocabulary REMEDIABLE|DESIGN. A blank line ends the first table (artifacts.ts:4097) and success returns (artifacts.ts:4138) without rejecting a second table in the same section.
**Governing clause:** adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 2
**Done when:**
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 2 is satisfied by this task.

### Task rem-as-built-AB-R2: Prove every parsed REMEDIABLE finding maps to exactly one admitted gap
**Gate:** as-built
**Rationale:** All parsed REMEDIABLE rows are collected (conductor.ts:3608) but admission keeps only ids that match planner-produced gaps (conductor.ts:3663, :3679). No set-equality check runs before the append (:3823), the ledger write (:3833), or route selection (:3931), so a planner response that omits a finding can still append and route the rest. Halt fail-closed naming missing/unexpected ids.
**Governing clause:** adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 3
**Done when:**
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 3 is satisfied by this task.

### Task rem-as-built-AB-R3: Render the parser fault on validation-group invalid reports
**Gate:** as-built
**Rationale:** The group halt appends renderAsBuiltBlockedFindingDetail only for blocked-design (conductor.ts:6775-6781); an `invalid` outcome gives the operator only the generic predicate reason (artifacts.ts:3133). The serial site already renders the fault (conductor.ts:10070). Decision 2 requires an invalid report to halt needs-human NAMING the defect.
**Governing clause:** adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 2
**Done when:**
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 2 is satisfied by this task.

### Task rem-as-built-AB-R4: Stamp refusal on both new validation-group halt exits
**Gate:** as-built
**Rationale:** The no-op/cap halt (conductor.ts:6651-6666) and the remediation halt (conductor.ts:6731-6746) emit a terminal and return without recordGroupRefusal, unlike the governing design/invalid halt (conductor.ts:6786) which stamps the judging validator and affected siblings.
**Governing clause:** adr-2026-08-24-refused-step-status decision 4
**Done when:**
- adr-2026-08-24-refused-step-status decision 4 is satisfied by this task.

### Task rem-as-built-AB-R5: Close the open execution before each projection-refusal return
**Gate:** as-built
**Rationale:** The group emits parallel_started (conductor.ts:6020) but its projection-refusal branch returns (:6569-6580) before parallel_completed (:6597). The serial path emits step_started (:7266) but its projection-refusal branch returns (:9293-9305) before step_completed (:10523). Every started execution must emit exactly one terminal on every path that can still run code.
**Governing clause:** adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1
**Done when:**
- adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1 is satisfied by this task.

### Task rem-as-built-AB-R6: Shared PRD/as-built repairs consume the as-built lap
**Gate:** as-built
**Rationale:** A planner gap can match a PRD-audit finding and an as-built finding at once (conductor.ts:3680-3687), but its tasks are assigned only to prdAuditTasks (:3709-3718). The as-built budget then receives asBuiltTasks.length === 0 (:3792-3800), and recordRemediationGateAppend increments the gate lap only when taskCount > 0 (:697) — so gates.architecture_review_as_built.laps stays zero even though a validated as-built finding authorized the append (:3863-3883). A later changed-tree as-built BLOCKED can then take another remediation lap instead of hitting the configured cap. Keep shared plan-growth accounting single-counted, but consume the as-built lap whenever at least one validated as-built finding authorized the successful append, including when PRD-audit owns the shared task's growth attribution. Add a mixed-source acceptance case in which EVERY as-built finding shares its task with PRD-audit, assert gates.architecture_review_as_built.laps === 1, then assert that a surviving second as-built BLOCKED report halts kickback-cap. The existing fixture at src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts:733-775 masks the zero-lap case with an additional as-built-only task.
**Governing clause:** adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 4
**Done when:**
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 4 is satisfied by this task.


### Task rem-prd-audit-rem-prd-audit-S3.4-1: src/conductor/test/prd-audit-kickback.test.ts:1745-1756 — delete BOTH leftover debug instrumentation blocks from the `it(\`grants no as-built authority in a ${round} round when disabled\`)` body: the `require('node:fs').appendFileSync('/tmp/claude-1000/-home-james-stoup-code-ai-conductor/1a13e694-818d-4cd1-b92b-9336b35c191f/scratchpad/m2.txt', JSON.stringify({...}) + '\n')` call and the identical one writing `.../scratchpad/matrix.txt`, including their JSON.stringify object literals — nothing else in the block. These are the only two sites of this class in the whole feature diff (verified by sweeping added lines in `git diff fc73b34cc...HEAD -- src/ skills/` for appendFileSync('/, writeFileSync('/, /tmp/, claude-1000, scratchpad and console.log). Writing to a hard-coded absolute path whose parent does not exist throws ENOENT, so today both disabled matrix cells — the only proof of criterion S3.4 — fail on every checkout but this author's, and the pattern is exactly what this suite's own tmpdir-leak guard (src/conductor/test/global-setup.ts, issue #1112) polices. PRESERVE, do not touch or relax: the `const ledger = await readKickbackLedger(fixture.root)` and `const plan = await readFile(fixture.planPath, 'utf8')` reads at :1743-1744, which remain live inputs to the four assertions that follow; all four disabled-cell assertions at :1760-1768 (`gates.architecture_review_as_built` undefined, `growth.byGate.architecture_review_as_built` undefined, plan does not contain 'rem-as-built-', `pendingAsBuiltRemediationFindings` length 0) delivered by plan Task 18; the paired enabled cells at :1769-1778; and the serial kill-switch revert proof at src/conductor/test/as-built-verdict.test.ts:502. No production code changes — the kill-switch behaviour at src/conductor/src/engine/conductor.ts:3545 is already correct per the audit. Verify by running `npx vitest run test/prd-audit-kickback.test.ts -t "kill switch"` (4 pass) with the scratchpad directory removed or renamed, proving the cells no longer depend on it.
**Gate:** prd-audit
**Rationale:** Blocking row S3.4 (FIXABLE, owning plan Task 18) is the sole blocking gap in .pipeline/prd-audit.md; the as-built gate is APPROVED WITH DRIFT NOTES (non-blocking) and .pipeline/build-review.json is PASS, so nothing else is emitted. The defect is leftover machine-local debug instrumentation, not a design question: src/conductor/test/prd-audit-kickback.test.ts:1745-1756 carries two unguarded `require('node:fs').appendFileSync('/tmp/claude-1000/-home-james-stoup-code-ai-conductor/1a13e694-818d-4cd1-b92b-9336b35c191f/scratchpad/{m2,matrix}.txt', ...)` calls inside the `it` body of "grants no as-built authority in a ${round} round when disabled" — the only two tests that prove this criterion. appendFileSync into a non-existent directory throws ENOENT, so both disabled cells fail before their assertions on any checkout or CI runner lacking that author-specific path; they pass here only because that scratchpad directory happens to exist in this worktree. Confidence 98% (verified): the two lines were read directly at HEAD dd70bf3f0 and the ENOENT behaviour of appendFileSync on a missing parent directory is Node's documented semantics. Classification is conforming test drift against an approved, still-authoritative design — the production behaviour is already correct at src/conductor/src/engine/conductor.ts:3545 (the audit's own Criterion detail states "Behaviour — now correct" and "no production code changes"), so nothing approved must change or be clarified and `architecture_review` and `halt: architectural-clarity` are both invalid; the behaviour is inside the approved design, so `halt: product-scope` is invalid; the criterion's own wording makes the test the deliverable ("a test proves the revert") and plan Task 18 Step 3 admits it verbatim ("with remediation disabled, a blocked-remediable outcome halts needs-human exactly as before this feature", Done-when "The kill-switch revert test proves halt-always behavior when disabled", .docs/plans/every-as-built-blocked-verdict-halts-needs-human-i.md:359-372), so `plan` is inapplicable and `acceptance_specs` is wrong because the coverage exists and merely needs its debug residue removed. Class sweep: the class is "hard-coded absolute machine-local path or debug output written from a test"; `git diff fc73b34cc...HEAD -- src/ skills/` filtered for added lines matching appendFileSync('/, writeFileSync('/, /tmp/, claude-1000, scratchpad and console.log returns exactly these two sites and no other, so the class is closed by this one task. Removal orphans: none — the `ledger` and `plan` consts read at :1743-1744 remain live inputs to the four assertions at :1760-1768, and `require` is call-site local with no import to strip. No regression: the task deletes only the two instrumentation blocks and preserves every assertion Task 18 delivered (the four disabled-cell expectations at :1760-1768 and the serial kill-switch proof at src/conductor/test/as-built-verdict.test.ts:502 stay unchanged and green). No matched pair is half-edited: the deleted lines are write-only telemetry with no counterpart enumeration. Found and DELIBERATELY EXCLUDED: (a) the paired enabled cells at src/conductor/test/prd-audit-kickback.test.ts:1769-1778 assert only `expect(fixture.outcome.kind).not.toBe('none')`, a near-vacuous positive control — the audit records this as secondary and not separately graded, the enabled path's real coverage lives in the acceptance suite (.../parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts:1303 and src/conductor/test/prd-audit-kickback.test.ts:1140), and strengthening it is not required to close S3.4, so it is recorded here rather than fixed; (b) F1, the unplanned SIGHUP test stabilization at src/conductor/test/engine/deterministic-build-verification-group.test.ts:307/:353, is graded OVER_SCOPE / outside-harmless with no owning criterion and is not a blocking row, so it gets no disposition; (c) the three UNEXERCISED drift notes in .pipeline/architecture-review-as-built.md are non-blocking observations on the enabled path and no plan task admits authoring their end-to-end fixture — fixing them would widen the diff on no plan authority.
**Criterion:** S3.4
**Parent task:** 18
**Done when:**
- S3.4 is satisfied by this task.
