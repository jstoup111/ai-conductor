# Implementation Plan: Wiring reachability gate (green-but-unwired guard)

**Date:** 2026-07-12
**Design:** adr-2026-07-12-wired-into-contract, adr-2026-07-12-wiring-check-gate (both APPROVED);
architecture-review-2026-07-12-wiring-reachability-gate (APPROVED WITH CONDITIONS)
**Stories:** .docs/stories/2026-07-12-wiring-reachability-gate.md (Status: Accepted)
**Conflict check:** Clean as of 2026-07-12 (2 degrading resolved; legacy zero-line advisory
disposition operator-selected)

## Summary

Adds a deterministic `wiring_check` gate (between `build_review` and `manual_test`) that verifies
a plan-declared `Wired-into:` contract and a diff-scoped orphan-export backstop, so
green-but-unwired features fail mechanically with named gaps. 27 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/wired-into.ts`** owns the `Wired-into:` grammar: parse +
  serialize for the four closed forms (declared `path#symbol` sites, `same as Task N`,
  `none (no new production surface)`, `none (inert until <ref>)`), returning named parse errors.
  `autoheal.ts#parsePlanTaskPaths` consumes the line (before the `BACKTICK_TOKEN` prose fallback,
  so values never leak into `Files:` corroboration).
- **New module `src/conductor/src/engine/wiring-probe.ts`** owns verification. Layer 1
  (universal): new-export extraction from `git diff <base>...HEAD` (base via the existing
  evidence-range ladder), declared-site reference check, orphan backstop, undeclared-surface and
  contradiction gaps — all via injected runners (push-evidence `GitRunner` pattern). Layer 2
  (TS-only): module import graph via the already-present `typescript` compiler API, rooted at
  `wiring.entry_points` config; loud skip when unconfigured, gap on bad roots. Waiver resolution:
  on-disk for path refs, `gh` for issue refs, fail-closed on `gh` error.
- **Gate plumbing** follows shipped templates: StepDefinition modeled on `build_review`
  (steps.ts:145), `WiringEvidence` + `validateWiringEvidence` modeled on `AcceptanceRedEvidence`
  (artifacts.ts:458-539), predicate in `STEP_COMPLETION_CHECKS`, kickback via existing
  `GateVerdict` machinery. `wiring_check` joins the post-rebase invalidation set
  (conductor.ts:3454-3463) per the conflict-check resolution.
- **Sequencing rationale:** grammar first (everything reads contracts), then step+evidence
  plumbing (gate exists, fail-closed), then Layer 1 (universal protection ships complete),
  then waiver, then Layer 2 (enhancement), then skill/docs contracts. Layer 1 strictly precedes
  Layer 2 (review condition 1); round-trip tests land inside the parser tasks (condition 2).

## Prerequisites

- None beyond the repo: `typescript@^5.5.0` and vitest are already dependencies; tests run from
  `src/conductor` (cd there — wrong-cwd vitest false-fails).

## Tasks

### Task 1: Parse declared-site Wired-into lines
**Story:** Parser story — happy paths (single site, multiple sites, ordering)
**Type:** happy-path
**Steps:**
1. Write failing tests: `parseWiredIntoLine('**Wired-into:** src/engine/conductor.ts#advanceTail')`
   → one declared site `{path, symbol}`; two comma-separated sites parse in order; backticked
   values accepted.
2. RED → implement `WIRED_INTO_LINE` regex + `parseWiredIntoLine` in new
   `src/conductor/src/engine/wired-into.ts` (closed-variant result type, exhaustive kinds).
3. GREEN → commit.
**Files:** src/conductor/src/engine/wired-into.ts; src/conductor/test/wired-into.test.ts
**Wired-into:** src/conductor/src/engine/autoheal.ts#parsePlanTaskPaths
**Dependencies:** none

### Task 2: Parse none-forms and inert waiver refs
**Story:** Parser story — `no_new_surface`, `inert` with issue ref, `inert` with repo-local path ref
**Type:** happy-path
**Steps:**
1. Failing tests: `none (no new production surface)` → `no_new_surface`; `none (inert until
   jstoup111/ai-conductor#999)` → `{kind:'inert', ref:{form:'issue',...}}`; path-form ref →
   `{form:'path'}`.
2. RED → extend the variant union + ref classifier. GREEN → commit.
**Files:** src/conductor/src/engine/wired-into.ts; src/conductor/test/wired-into.test.ts
**Wired-into:** src/conductor/src/engine/autoheal.ts#parsePlanTaskPaths
**Dependencies:** 1

### Task 3: Malformed lines produce named errors; round-trip property
**Story:** Parser story — negative paths (free text, empty inert ref) + round-trip guarantee
**Type:** negative-path
**Steps:**
1. Failing tests: `fix it later` → `malformed` naming offending text + the four accepted forms;
   `none (inert until )` → `malformed`; round-trip: parse → `serializeWiredInto` → parse yields
   deep-equal results for every form from Tasks 1–2 (property-style over a fixture table).
2. RED → implement named `malformed` results + `serializeWiredInto`. GREEN → commit.
**Files:** src/conductor/src/engine/wired-into.ts; src/conductor/test/wired-into.test.ts
**Wired-into:** src/conductor/src/engine/autoheal.ts#parsePlanTaskPaths
**Dependencies:** 2

### Task 4: Inheritance (`same as Task N`) and multi-line accumulation
**Story:** Parser story — inheritance happy path; missing-target and accumulation negatives
**Type:** negative-path
**Steps:**
1. Failing tests: `same as Task 3` resolves against a task map (reusing `TASK_ID_PATTERN`
   grammar); `same as Task 99` (absent) → named error `inheritance target Task 99 not found`;
   two `Wired-into:` lines on one task accumulate sites.
2. RED → implement inheritance resolution + accumulation. GREEN → commit.
**Files:** src/conductor/src/engine/wired-into.ts; src/conductor/test/wired-into.test.ts
**Wired-into:** src/conductor/src/engine/autoheal.ts#parsePlanTaskPaths
**Dependencies:** 3

### Task 5: parsePlanTaskPaths consumes the Wired-into line (no prose-fallback leak)
**Story:** Parser story — backtick leak negative path (conflict-check finding); repo-relative
path validation (plan story negative: `../` rejected)
**Type:** negative-path
**Steps:**
1. Failing tests: a plan section whose task has `**Wired-into:** \`src/b.ts#foo\`` and NO
   `Files:` line — `parsePlanTaskPaths` must NOT include `src/b.ts#foo` in that task's paths
   (line consumed before `BACKTICK_TOKEN` fallback, autoheal.ts:1159-1166); a `../outside#f`
   site parses as `malformed` (repo-relative required); plan-level extraction API
   `extractWiredIntoContracts(planText)` returns per-task contracts.
2. RED → integrate consumption into `parsePlanTaskPaths` + export the plan-level extractor.
   GREEN → commit.
**Files:** src/conductor/src/engine/autoheal.ts; src/conductor/src/engine/wired-into.ts; src/conductor/test/wired-into.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 4

### Task 6: wiring_check StepDefinition + prerequisites repoint + registry-test amendment
**Story:** Step story — placement happy paths; adjacency registry-test amendment (conflict-check
resolution 1); all-tier presence
**Type:** infrastructure
**Steps:**
1. Failing tests: registry asserts `wiring_check` exists with `enforcement:'gating'`,
   `phase:'BUILD'`, `loopGate:true`, `skippableForTiers:[]`, `prerequisites:['build_review']`;
   `manual_test.prerequisites === ['wiring_check']`. Amend (same commit) the existing
   build-review registry test pinning `['build_review']` to the new adjacency, keeping its
   "build_review strictly upstream" assertion.
2. RED → add the StepDefinition to `ALL_STEPS`, repoint manual_test. GREEN → commit.
**Files:** src/conductor/src/engine/steps.ts; src/conductor/test/steps.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 7: WiringEvidence schema + validator (shape)
**Story:** Evidence story — happy path (fields) + non-object/missing-field negatives
**Type:** infrastructure
**Steps:**
1. Failing tests: valid evidence (base+HEAD shas, per-task contract form, per-symbol results
   with gap kind from a closed enum, layer2 applicability, waiver resolutions) validates; a
   non-object, a missing field, and an unknown gap kind each fail naming the exact defect.
2. RED → add `WIRING_EVIDENCE = '.pipeline/wiring-evidence.json'`, `WiringEvidence` interface,
   `validateWiringEvidence` in artifacts.ts (AcceptanceRedEvidence template). GREEN → commit.
**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/test/wiring-evidence.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** none

### Task 8: Evidence freshness — HEAD-sha mismatch fails
**Story:** Evidence story — stale/forged evidence negative
**Type:** negative-path
**Steps:**
1. Failing test: write valid evidence, advance HEAD by one commit, validator reports
   `evidence recorded for <sha> but HEAD is <sha>` and the gate stays unsatisfied.
2. RED → implement freshness check in the validator. GREEN → commit.
**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/test/wiring-evidence.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 7

### Task 9: STEP_COMPLETION_CHECKS.wiring_check predicate
**Story:** Evidence story — zero-gaps satisfied; gaps compose kickback with full named messages
**Type:** happy-path
**Steps:**
1. Failing tests: valid fresh evidence + zero gaps → satisfied; gaps present → unsatisfied with
   `kickback:{from:'wiring_check', evidence}` where evidence contains every gap's full message
   verbatim; missing evidence file → unsatisfied (fail-closed) with named reason.
2. RED → register the predicate in `STEP_COMPLETION_CHECKS`. GREEN → commit.
**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/test/wiring-evidence.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 6, 8

### Task 10: Selector/tail integration + topology migration + no-HALT proof
**Story:** Step story — selector order; kickback never HALTs; cap engages existing stall path;
stale-topology migration
**Type:** negative-path
**Steps:**
1. Failing tests (conductor/selector level, seeded gate verdicts): unsatisfied `wiring_check`
   blocks `manual_test`; satisfied unblocks; a wiring gap writes NO `.pipeline/HALT`; exceeding
   `MAX_KICKBACKS_PER_GATE` engages the existing stall escalation; a state dir whose
   `manual_test` verdict predates `wiring_check` re-derives topology without crashing.
2. RED → any glue fixes surfaced. GREEN → commit.
**Files:** src/conductor/src/engine/selector.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/wiring-gate-loop.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 9

### Task 11: wiring_check joins the post-rebase invalidation set
**Story:** Step story — rebase negative path (conflict-check resolution 2)
**Type:** negative-path
**Steps:**
1. Failing tests: file-changing rebase invalidation set equals
   `{build, build_review, wiring_check, manual_test}`; amend (same commit) the #420 pinned-set
   test and the build-review TS-5 enumeration test.
2. RED → extend the target array at conductor.ts:3454-3463 (`applyRebaseVerdicts` path).
   GREEN → commit.
**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/rebase-invalidation.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 6

### Task 12: New-export extraction from the feature diff
**Story:** Layer 1 story — scope of "new symbols" (ADR §2)
**Type:** infrastructure
**Steps:**
1. Failing tests (injected GitRunner fixtures): added `export function foo` / `export const bar`
   / re-export in diff `base...HEAD` → extracted with defining file; symbols present at base are
   NOT "new"; base derived via the existing evidence-range ladder (mock anchor → fork-point →
   merge-base fallbacks exercised).
2. RED → create `src/conductor/src/engine/wiring-probe.ts` with `extractNewExports(runGit, base)`.
   GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-probe.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** none

### Task 13: Layer 1 declared-site verification
**Story:** Layer 1 story — declared-site happy path; no-reference gap naming symbol + scope
**Type:** happy-path
**Steps:**
1. Failing tests: declared site whose file non-test-references a new symbol passes with
   `{site, symbol, matchedLine}` evidence; site file with no reference → gap exactly
   `declared call site src/x.ts#foo has no non-test reference to «symbol» (searched: src/x.ts)`;
   site file absent → named gap.
2. RED → implement `verifyDeclaredSites` (injected file reader/grep runner). GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-probe.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 12

### Task 14: Layer 1 orphan backstop — test-only and self references never count
**Story:** Layer 1 story — backstop happy path; test-only-references gap; self-reference gap
**Type:** negative-path
**Steps:**
1. Failing tests: new export with ≥1 non-test reference outside its defining file passes listing
   the referencing file; references only in `*.test.ts`/`test/`/`__tests__/` → gap
   `«symbol» exported but referenced by no production code (N test-only references excluded)`;
   reference only in the defining file → gap. Test-path exclusion patterns shared with the
   superseded-symbol check semantics.
2. RED → implement `orphanBackstop`. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-probe.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 12

### Task 15: Undeclared-surface and declared-none contradiction gaps
**Story:** Layer 1 story — `none (no new production surface)` happy path; contradiction negative;
plan story — omitted line gates independently (defense in depth)
**Type:** negative-path
**Steps:**
1. Failing tests: task declaring `no_new_surface` whose files add no exports passes; same
   declaration but diff adds exports → gap naming the symbols vs the declared-none contract;
   a contract-bearing plan where a task with new exports has NO line → gap `undeclared
   new-export surface`.
2. RED → implement contract/diff cross-check. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-probe.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 13, 14

### Task 16: Legacy zero-line advisory; partial declaration = full gating
**Story:** Layer 1 story — legacy disposition (operator-selected) + partial-declaration paths
**Type:** negative-path
**Steps:**
1. Failing tests: plan with ZERO Wired-into lines anywhere → `satisfied:true` with reason
   containing `legacy plan (pre-Wired-into contract): wiring gate advisory-only` and backstop
   findings rendered as advisory text (not gaps); plan with exactly one line → every task fully
   gated.
2. RED → implement the plan-level disposition switch. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-probe.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 15

### Task 17: Underivable base fails closed
**Story:** Layer 1 story — `wiring scope undeterminable` negative
**Type:** negative-path
**Steps:**
1. Failing test: GitRunner where anchor, origin default, and merge-base all fail → probe result
   is a single fail-closed gap `wiring scope undeterminable` (never a silent pass, never a throw
   that skips evidence).
2. RED → implement. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-probe.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 12

### Task 18: Probe wired into the predicate via CompletionContext; evidence written durably
**Story:** Evidence story — end-to-end write; #549-pattern durability (ensure-dir)
**Type:** infrastructure
**Steps:**
1. Failing integration test: predicate invokes the injected probe runner
   (`CompletionContext.wiringProbe`, push-evidence injection pattern), writes
   `.pipeline/wiring-evidence.json` (ensure-dir first), and the gate verdict reflects probe
   gaps end-to-end on a fixture repo.
2. RED → add the injection seam + evidence write. GREEN → commit.
**Files:** src/conductor/src/engine/artifacts.ts; src/conductor/src/engine/conductor.ts; src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-gate-loop.test.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#STEP_COMPLETION_CHECKS
**Dependencies:** 9, 16, 17

### Task 19: Waiver path-form resolution (on-disk, no network)
**Story:** Waiver story — path exists happy path; path absent gap; gh never invoked for paths
**Type:** happy-path
**Steps:**
1. Failing tests: inert ref to an existing repo-local file → waived with evidence
   `(path exists)`; absent path → gap `inert waiver ref … not found`; a spy `gh` runner asserts
   zero invocations on path-form refs.
2. RED → implement `resolveWaiverRef` path branch. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-waiver.test.ts
**Wired-into:** src/conductor/src/engine/wiring-probe.ts#runWiringProbe
**Dependencies:** 12

### Task 20: Waiver issue-form via gh — open passes, closed and errors block
**Story:** Waiver story — open-issue happy path; closed-issue gap; gh-failure fail-closed
**Type:** negative-path
**Steps:**
1. Failing tests (injected gh runner): open issue → waived with resolved state; closed issue →
   gap naming the closed state; gh error (nonzero/stderr) → gap
   `inert waiver ref #N unverifiable (gh error: <line>)`.
2. RED → implement issue branch, fail-closed. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-waiver.test.ts
**Wired-into:** src/conductor/src/engine/wiring-probe.ts#runWiringProbe
**Dependencies:** 19

### Task 21: Inert-but-wired contradiction gap
**Story:** Waiver story — stale-contract negative (contract says inert, code says wired)
**Type:** negative-path
**Steps:**
1. Failing test: task waived inert whose diff ALSO adds a production reference to the new
   symbol → named gap (stale contract; plan must switch to declared sites), not a pass.
2. RED → implement contradiction check in waiver evaluation. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-waiver.test.ts
**Wired-into:** src/conductor/src/engine/wiring-probe.ts#runWiringProbe
**Dependencies:** 20, 14

### Task 22: wiring.entry_points config — schema, self-host default, degradation modes
**Story:** Layer 2 story — config happy path; missing-config loud skip; non-TS not-applicable;
bad-root gap
**Type:** infrastructure
**Steps:**
1. Failing tests: config parse of `wiring.entry_points` list; missing key in a TS project →
   Layer 2 skip recorded as `Layer 2 skipped: wiring.entry_points not configured` in the verdict
   reason while Layer 1 still gates; no tsconfig/package.json → `Layer 2 not applicable`; a
   configured root that doesn't exist on disk → `satisfied:false` naming the bad root.
2. RED → add config schema + applicability logic. Commit the self-host default (the four entry
   points) to this repo's `.ai-conductor/config.yml`. GREEN → commit.
**Files:** src/conductor/src/config.ts; src/conductor/src/engine/wiring-probe.ts; .ai-conductor/config.yml; src/conductor/test/wiring-layer2.test.ts
**Wired-into:** src/conductor/src/engine/wiring-probe.ts#runWiringProbe
**Dependencies:** 18

### Task 23: TS import graph — reachability with chain evidence
**Story:** Layer 2 story — reachable-export happy path (chain recorded)
**Type:** happy-path
**Steps:**
1. Failing tests (fixture TS project): module graph built with the `typescript` compiler API
   resolves imports from roots; a new export whose module is transitively imported from a root
   passes with the chain (root → … → defining module) in evidence.
2. RED → implement `buildImportGraph` + `reachableFromRoots`. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-layer2.test.ts
**Wired-into:** src/conductor/src/engine/wiring-probe.ts#runWiringProbe
**Dependencies:** 22

### Task 24: Orphan islands and test-only import edges are unreachable
**Story:** Layer 2 story — orphan-island gap; test-import exclusion
**Type:** negative-path
**Steps:**
1. Failing tests: two new modules importing each other but imported by nothing → gap
   `«symbol» exported but unreachable from any entry point (roots: <configured list>)`; a module
   reachable only through a test file's import → unreachable (edges from test paths excluded).
2. RED → implement non-test edge filtering + island detection; integrate Layer 2 results into
   the probe's gap set. GREEN → commit.
**Files:** src/conductor/src/engine/wiring-probe.ts; src/conductor/test/wiring-layer2.test.ts
**Wired-into:** src/conductor/src/engine/wiring-probe.ts#runWiringProbe
**Dependencies:** 23

### Task 25: architecture-review SKILL — design-time Wiring Surface requirement
**Story:** Architecture-review story — both paths (section required M/L; checklist blocks
without it; as-built §12 untouched)
**Type:** infrastructure
**Steps:**
1. Edit `skills/architecture-review/SKILL.md`: design-time output (§8 report format) gains a
   required `## Wiring Surface` section for M/L features + a blocking verification-checklist
   item; scope explicitly design-time only.
2. Run `test/test_harness_integrity.sh` (frontmatter, model table, section numbering) — must
   pass. Commit.
**Files:** skills/architecture-review/SKILL.md
**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 26: plan SKILL — Wired-into grammar, derivation, fallback, blocking checklist
**Story:** Plan story — derivation on M/L; Small self-authoring; omitted-line checklist block;
repo-relative requirement
**Type:** infrastructure
**Steps:**
1. Edit `skills/plan/SKILL.md`: document the four forms + inheritance + repo-relative rule,
   the M/L derivation from `## Wiring Surface`, the Small-tier fallback, a `Wired-into:` example
   beside `Files:` in the task format block, and a blocking checklist item.
2. Run `test/test_harness_integrity.sh` — must pass. Commit.
**Files:** skills/plan/SKILL.md
**Wired-into:** none (no new production surface)
**Dependencies:** 25

### Task 27: Docs + CHANGELOG
**Story:** Docs story — both paths (READMEs + CHANGELOG; release-gate classification)
**Type:** infrastructure
**Steps:**
1. Update `README.md` + `src/conductor/README.md`: `wiring_check` step, `Wired-into:` grammar,
   `wiring.entry_points`, legacy advisory disposition, waiver semantics. Add CHANGELOG
   `[Unreleased]` Added entry. If the release classifier flags a breaking surface, add the
   compliant migration note or `.docs/release-waivers/2026-07-12-wiring-reachability-gate.md`.
2. Run `test/test_harness_integrity.sh`. Commit.
**Files:** README.md; src/conductor/README.md; CHANGELOG.md
**Wired-into:** none (no new production surface)
**Dependencies:** 18, 24, 26

## Task Dependency Graph

```
Parser:    1 → 2 → 3 → 4 → 5
Step:      6 → 9 ; 6 → 11
Evidence:  7 → 8 → 9 → 10 ; 9 → 18
Probe L1:  12 → 13 ─┐
           12 → 14 ─┼→ 15 → 16 → 18
           12 → 17 ─┘         17 → 18
           5 (contracts feed probe input) → 18
Waiver:    12 → 19 → 20 → 21 (also 14 → 21)
Layer 2:   18 → 22 → 23 → 24
Skills:    25 → 26
Docs:      18, 24, 26 → 27
```

## Integration Points

- After Task 10: gate loop end-to-end with stubbed probe (step blocks/unblocks manual_test).
- After Task 18: full Layer 1 pipeline live — plan contract → probe → evidence → verdict.
- After Task 24: Layer 2 reachability active on this repo via committed entry-point config.
- After Task 27: docs/CHANGELOG complete; release gates satisfied.

## Coverage Check

| Story | Covering tasks |
|---|---|
| Parser (round-trip, malformed, inheritance, leak) | 1, 2, 3, 4, 5 |
| Architecture-review wiring surface | 25 |
| Plan carries contract / Small fallback | 26, 15 (defense in depth), 5 (repo-relative) |
| Step insertion / kickback / topology / rebase set | 6, 10, 11 |
| Layer 1 probe | 12, 13, 14, 15, 16, 17 |
| Layer 2 reachability | 22, 23, 24 |
| Inert waiver fail-closed | 19, 20, 21 |
| WiringEvidence artifact | 7, 8, 9, 18 |
| Docs/config/changelog | 22 (config), 27 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks (no catch-alls)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Layer 1 (Tasks 12–18) fully precedes Layer 2 (22–24) — review condition 1
- [ ] Round-trip tests live in the parser tasks (3) — review condition 2
- [ ] Gap messages assert symbol + searched scope in tests (13, 14, 24) — review condition 3
- [ ] Docs/CHANGELOG same PR (27) — review condition 4
- [ ] Adversarial negative-path specs at every predicate call site (8, 9, 10, 16, 17, 20, 21) —
      review condition 5
