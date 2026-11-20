# Implementation plan for shorter spec reviews (#3419)

**Stories:** .docs/stories/spec-review-artifacts-still-mix-reviewer-content-w.md
**Design:** adr-2026-11-19-spec-review-layout-and-criterion-references

## Technical Approach

Build on #3418's shipped manifest ownership and prune behavior; verify that prerequisite at integration. Use the existing authoritative parsers, manifest writer and docs-prune workflow. Keep each layout-specific decision at authoring or input resolution so gate logic can operate on canonical evidence. Run scoped RED/GREEN checks for each changed boundary. Use a locally controlled git repository and fake external adapters for publication and review.

### Task 1: Pin the layout on first authoring

**Story:** Story 6
**Story:** Story 7
**Type:** infrastructure
**Dependencies:** none
**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/src/engine/engineer/worktree-authoring.ts`, `src/conductor/src/engine/conductor.ts`

**Steps:** Read the project setting once at feature creation on either route. Persist its effective value with the existing feature authoring state. Resume from that value and treat older authoring state as legacy.

**Done when:**
- An unconfigured project starts in the existing layout. Changing the setting then resuming the same feature keeps its original paths.
- Composer and interactive conduct select the same layout for new specs with identical configuration.

### Task 2: Recognize and validate both manifest formats

**Story:** Story 2
**Story:** Story 7
**Type:** infrastructure
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/feature-manifest.ts`, `src/conductor/src/types/feature-manifest.ts`

**Steps:** Dispatch validation by schema version. Share containment and slug checks. Register review paths, exactly one executable plan, and the separately typed summary for the new format. Preserve the old parser contract.

**Done when:**
- The parser round-trips both formats and refuses duplicate plan roles, a mismatched slug, and a path escaping the feature or allowed shared corpus.
- Existing version-one manifests resolve their original paths, and readers reject an invalid new manifest without trying a similarly named old file.

### Task 3: Produce the review set and full executor inputs

**Story:** Story 1
**Story:** Story 2
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 1, Task 2
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/engineer/worktree-authoring.ts`, `skills/stories/SKILL.md`, `skills/plan/SKILL.md`, `skills/coherence-check/SKILL.md`

**Steps:** Route shipped authoring instructions and templates through the pinned paths. Keep optional tier and track artifacts conditional. Stories own criterion wording, full tasks own completion checks, and the summary describes delivery and links to decisions and findings. Emit no story Done When section for opted-in stories.

**Done when:**
- The file listing identifies each applicable numbered review file and separates task detail. On fixed Medium and Large specimens, record before/after character counts including required links, and show the removed passages with equivalent obligations.
- The four review files contain one copy of the canonical criterion in a Medium product spec. A technical spec omits its PRD without leaving a broken link. Both size comparisons show a reduction after counting required linked material, with decisions, behavior and scope held fixed.

### Task 4: Read persistent story IDs

**Story:** Story 1
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/story-criteria.ts`, `src/conductor/src/engine/artifacts.ts`

**Steps:** Extend the authoritative bullet extractor for the new format and use the same parsed result in the accepted-story check. Preserve explicit IDs over edits and moves. Assign fresh IDs to added criteria and reject missing or duplicate IDs. Keep the positional legacy parser.

**Done when:**
- Two task links resolve to one canonical passage after insertion, reorder and edit. Deleting the target leaves its ID unresolved; the next bullet cannot satisfy the link.
- The shared story reader rejects duplicate explicit IDs and preserves each canonical criterion exactly once across distinct task links.

### Task 5: Resolve task completion checks by owner and ID

**Story:** Story 1
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/plan-task-parse.ts`, `src/conductor/src/engine/engineer/coherence-validator.ts`

**Steps:** Parse explicit completion-check IDs only within each task's Done when section. Resolve a task/check pair against the executable plan, never its summary. Reject an ambiguous check within its task or a reference with the wrong owner.

**Done when:**
- Reordering a check preserves its identity. Wrong-task references and duplicate checks within one task are rejected even when the same words occur elsewhere.
- The full-plan parser returns the referenced check text only from the named task’s completion block; identical Steps text cannot satisfy a task/check reference.

### Task 6: Validate references at land

**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 3, Task 4, Task 5
**Files:** `src/conductor/src/engine/coherence-parse.ts`, `src/conductor/src/engine/engineer/coherence-validator.ts`, `src/conductor/src/engine/engineer/land-spec.ts`

**Steps:** Read the current authored change set, including uncommitted edits. At Small tier read the executable plan table; at Medium/Large read coherence. Join IDs to canonical records before applying existing disposition and waiver rules. Collect independent gaps in a single refusal.

**Done when:**
- Land accepts a complete valid mapping and names both omissions in a two-gap example; duplicate, deleted or dangling references identify the specific ID. Legacy waiver and tier rules still hold.
- Pre-registration review resolves uncommitted criterion edits. Land reports both uncovered IDs with their current wording and names a deleted reference even when the original wording is unavailable.

### Task 7: Publish and discover complete artifacts on both routes

**Story:** Story 6
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 2, Task 3, Task 6
**Files:** `src/conductor/src/engine/engineer/land-spec.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/src/engine/artifacts.ts`

**Steps:** Use the plan stem for interactive and composer registration. Before sealing or dispatch rebuild from the final authored set through the existing manifest writer. A retry after partial authoring can rebuild without duplicate entries. Dispatch from the recorded full plan. Keep no-manifest and v1 lookup.

**Done when:**
- Both routes with differing feature text and plan stem resolve the same complete inputs. Interrupted registration cannot dispatch partial evidence, and malformed manifests fail without looking up similarly named files.
- Previously authored no-manifest and version-one features can complete review, BUILD and SHIP after opt-in.

### Task 8: Preserve review and audit evidence

**Story:** Story 5
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 4, Task 5, Task 6, Task 7
**Files:** `src/conductor/src/engine/plan-review-runner.ts`, `src/conductor/src/engine/engineer/plan-review-gate.ts`, `src/conductor/src/engine/prd-audit-routing.ts`, `src/conductor/src/engine/conductor.ts`

**Steps:** Resolve canonical inputs for indexed plan review and fallback, and supply the executable plan. Carry parsed IDs and current story wording to audit routing and DECIDE coherence and plan-review judgements. Preserve shared decision discovery and legacy reviews.

**Done when:**
- Indexed and fallback reviews receive the full plan and accessible evidence. A semantically irrelevant but valid check remains rejectable; audit routes a moved criterion by its persisted ID.
- Land coherence, plan review, PRD audit and DECIDE coverage judgement receive canonical evidence equivalent to that supplied for the same legacy obligations.

### Task 9: Protect and retain the new artifact kinds

**Story:** Story 7
**Story:** Story 8
**Type:** happy-path
**Dependencies:** Task 2, Task 7
**Files:** `src/conductor/src/engine/docs-retention.ts`, `src/conductor/src/engine/docs-prune.ts`, `src/conductor/src/engine/protected-artifact-seal.ts`

**Steps:** Extend the #3418 ownership policy at the existing kind table and its production callers. Protect the summary with plan-equivalent rules. Apply retention by kind across both folders and keep v1 and no-manifest selection. Defer the full candidate set on an open edit.

**Done when:**
- The guarded prune selection includes summary, full plan, eligible bookkeeping and manifest together. A PR editing only the summary defers all of them; unshipped and malformed features contribute no deletion.
- The summary receives plan-equivalent seal protection before shipment; after shipment an overlapping open edit to either plan defers the entire selection.

### Task 10: Recover the executable plan after cleanup

**Story:** Story 8
**Type:** happy-path
**Dependencies:** Task 9
**Files:** `src/conductor/src/engine/docs-prune.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`

**Steps:** Use the manifest from the parent of the deleting commit to resolve the historical executable plan independently of the summary. Exercise the shipment audit caller against local git history and verify durable requirements, stories, architecture and decisions remain directly readable after prune.

**Done when:**
- After cleanup the audit recovers the full task checks from history while the two plan files are absent from the current tree. Durable records remain readable and shared decision queries still find applicable ADRs.
- The retained requirements, stories, diagrams and decisions remain directly readable after manifest removal without consulting a deleted summary.

## Coverage Check

| Story | Tasks |
|---|---|
| 1 | 3, 4, 5 |
| 2 | 2, 3 |
| 3 | 3 |
| 4 | 4, 5, 6 |
| 5 | 8 |
| 6 | 1, 7 |
| 7 | 1, 2, 7, 8, 9 |
| 8 | 9, 10 |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-19-spec-review-layout-and-criterion-references#D1 | task | task-1 | An unconfigured project starts in the existing layout. Changing the setting then resuming the same feature keeps its original paths. |
| adr-2026-11-19-spec-review-layout-and-criterion-references#D2 | task | task-2 | The parser round-trips both formats and refuses duplicate plan roles, a mismatched slug, and a path escaping the feature or allowed shared corpus. |
| adr-2026-11-19-spec-review-layout-and-criterion-references#D3 | task | task-4 | Two task links resolve to one canonical passage after insertion, reorder and edit. Deleting the target leaves its ID unresolved; the next bullet cannot satisfy the link. |
| adr-2026-11-19-spec-review-layout-and-criterion-references#D4 | task | task-8 | Indexed and fallback reviews receive the full plan and accessible evidence. A semantically irrelevant but valid check remains rejectable; audit routes a moved criterion by its persisted ID. |
| adr-2026-11-19-spec-review-layout-and-criterion-references#D5 | task | task-9 | The guarded prune selection includes summary, full plan, eligible bookkeeping and manifest together. A PR editing only the summary defers all of them; unshipped and malformed features contribute no deletion. |
| adr-2026-08-31-coverage-binding-judge-step#D21 | no-change | none | The existing decision (, D22, D23, and the 2026-10-04 amendments to D18 and D21. The `CoverageBindingPayloadError`) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D1 | task | task-6 | Land accepts a complete valid mapping and names both omissions in a two-gap example; duplicate, deleted or dangling references identify the specific ID. Legacy waiver and tier rules still hold. |
| adr-2026-08-31-coverage-binding-judge-step#D2 | task | task-6 | Land accepts a complete valid mapping and names both omissions in a two-gap example; duplicate, deleted or dangling references identify the specific ID. Legacy waiver and tier rules still hold. |
| adr-2026-08-31-coverage-binding-judge-step#D3 | task | task-6 | Land accepts a complete valid mapping and names both omissions in a two-gap example; duplicate, deleted or dangling references identify the specific ID. Legacy waiver and tier rules still hold. |
| adr-2026-08-31-coverage-binding-judge-step#D4 | no-change | none | The 2026-10-10 amendment retires the pre-BUILD judgement; its remaining topology and resume contract is independent of the new artifact layout. |
| adr-2026-08-31-coverage-binding-judge-step#D5 | no-change | none | The existing decision (The judge is a fresh one-shot dispatch with a closed, engine-stamped verdict.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D6 | no-change | none | The existing decision (A `does-not-assert` verdict halts `needs-human` before any build lap.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D7 | no-change | none | The existing decision (Default off, with a named exit.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D8 | no-change | none | The existing decision (Legacy tolerance.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D9 | no-change | none | The existing decision (Occurrences ride the spine.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D10 | no-change | none | The existing decision (A `fail` criterion row may carry an authored correction cell.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D11 | no-change | none | The existing decision (An `architecture` correction must cite an enumerable decision, and no correction routes.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D12 | no-change | none | The existing decision (The judge is dispatched per bounded batch, not per claim.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D13 | no-change | none | The existing decision (A batch verdict is valid only when its digest set equals the batch's digest set.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D14 | no-change | none | The existing decision (The envelope is checkpointed atomically after every batch.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D15 | no-change | none | The existing decision (`coverage_binding.judge.batch_size` is a registered config key.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D16 | no-change | none | The existing decision (An operator reseal that changes DECIDE content voids this step's completion.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D17 | no-change | none | The existing decision (The ADR-obligation layer runs before the judge, whatever D7's key says.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D18 | no-change | none | The existing decision (Amendment clauses are a separately typed claim kind.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D19 | no-change | none | The existing decision (On a D16 re-run, completed work the change contradicts is reopened, never re-planned.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D20 | no-change | none | The existing decision (Occurrences ride the spine.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D22 | no-change | none | The existing decision (The conflict verdict is closed and batch-validated.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D23 | no-change | none | The existing decision (A `conflicts` verdict refuses `needs-human`, first; it never reopens, appends, or routes.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-08-31-coverage-binding-judge-step#D24 | no-change | none | The existing decision (Occurrences ride the spine.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-09-23-one-owner-for-accepted-story-readability#D1 | task | task-4 | Two task links resolve to one canonical passage after insertion, reorder and edit. Deleting the target leaves its ID unresolved; the next bullet cannot satisfy the link. |
| adr-2026-09-23-one-owner-for-accepted-story-readability#D2 | task | task-4 | Two task links resolve to one canonical passage after insertion, reorder and edit. Deleting the target leaves its ID unresolved; the next bullet cannot satisfy the link. |
| adr-2026-09-23-one-owner-for-accepted-story-readability#D3 | task | task-6 | Land accepts a complete valid mapping and names both omissions in a two-gap example; duplicate, deleted or dangling references identify the specific ID. Legacy waiver and tier rules still hold. |
| adr-2026-10-24-per-feature-artifact-manifest#D1 | task | task-2 | The parser round-trips both formats and refuses duplicate plan roles, a mismatched slug, and a path escaping the feature or allowed shared corpus. |
| adr-2026-10-24-per-feature-artifact-manifest#D2 | task | task-2 | The parser round-trips both formats and refuses duplicate plan roles, a mismatched slug, and a path escaping the feature or allowed shared corpus. |
| adr-2026-10-24-per-feature-artifact-manifest#D3 | no-change | none | The existing decision (Not in the manifest:) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-10-24-per-feature-artifact-manifest#D4 | task | task-7 | Both routes with differing feature text and plan stem resolve the same complete inputs. Interrupted registration cannot dispatch partial evidence, and malformed manifests fail without looking up similarly named files. |
| adr-2026-10-24-per-feature-artifact-manifest#D5 | task | task-7 | Both routes with differing feature text and plan stem resolve the same complete inputs. Interrupted registration cannot dispatch partial evidence, and malformed manifests fail without looking up similarly named files. |
| adr-2026-10-24-per-feature-artifact-manifest#D6 | task | task-7 | Both routes with differing feature text and plan stem resolve the same complete inputs. Interrupted registration cannot dispatch partial evidence, and malformed manifests fail without looking up similarly named files. |
| adr-2026-10-24-per-feature-artifact-manifest#D7 | task | task-9 | The guarded prune selection includes summary, full plan, eligible bookkeeping and manifest together. A PR editing only the summary defers all of them; unshipped and malformed features contribute no deletion. |
| adr-2026-10-24-per-feature-artifact-manifest#D8 | task | task-7 | Both routes with differing feature text and plan stem resolve the same complete inputs. Interrupted registration cannot dispatch partial evidence, and malformed manifests fail without looking up similarly named files. |
| adr-2026-10-24-per-feature-artifact-manifest#D9 | task | task-1 | An unconfigured project starts in the existing layout. Changing the setting then resuming the same feature keeps its original paths. |
| adr-2026-10-24-per-feature-artifact-manifest#D10 | no-change | none | The existing decision (Delivery is three sequential specs.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D1 | task | task-2 | The parser round-trips both formats and refuses duplicate plan roles, a mismatched slug, and a path escaping the feature or allowed shared corpus. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D2 | task | task-7 | Both routes with differing feature text and plan stem resolve the same complete inputs. Interrupted registration cannot dispatch partial evidence, and malformed manifests fail without looking up similarly named files. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D3 | task | task-7 | Both routes with differing feature text and plan stem resolve the same complete inputs. Interrupted registration cannot dispatch partial evidence, and malformed manifests fail without looking up similarly named files. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D4 | task | task-9 | The summary receives plan-equivalent seal protection before shipment; after shipment an overlapping open edit to either plan defers the entire selection. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D5 | no-change | none | The existing decision (The hook reads engine-computed lines.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D6 | no-change | none | The existing decision (Invalidation and rebase use the owned set.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D7 | no-change | none | The existing decision (build_review scopes by the owned set.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D8 | no-change | none | The existing decision (Registration after land is an operator command.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D9 | task | task-9 | The guarded prune selection includes summary, full plan, eligible bookkeeping and manifest together. A PR editing only the summary defers all of them; unshipped and malformed features contribute no deletion. |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D10 | no-change | none | The existing decision (Legacy unchanged, no flag, one spec in three stacked slices.) retains its approved scope. This feature changes input representation and leaves that independent policy in place. |
