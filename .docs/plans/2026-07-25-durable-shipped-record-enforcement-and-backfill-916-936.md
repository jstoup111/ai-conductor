# Implementation Plan: Durable Shipped-Record Enforcement and Backfill (#916, #936)

**Date:** 2026-07-25
**Issues:** `jstoup111/ai-conductor#916`, `jstoup111/ai-conductor#936`
**Track / tier:** Technical / M
**Design:** `.docs/decisions/adr-2026-07-25-fail-closed-durable-shipment-evidence.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936.md`
**Stories:** `.docs/stories/durable-shipped-record-enforcement-and-backfill-916-936.md`
**Conflict check:** Clean as of 2026-07-25

## Summary

Add one strict, read-only shipment-evidence verdict; require it at every PR terminal boundary and on
protected `main`; propose record-only repairs for out-of-band merges; and run one proven historical
backfill. The plan has 40 small TDD/delivery tasks because all 29 accepted negative paths remain
explicit rather than being hidden in catch-all error handling. Per operator direction on
2026-07-25, Tasks 9 and 31–35 implement and inspect the one-time historical backfill without adding
a dedicated automated backfill test suite.

## Technical Approach

- Add `shipment-evidence.ts` beside the hot `shipped-record.ts` seam. Reuse the current canonical
  plan-plus-stories hash and record renderer; add only the minimal strict parse/source helpers needed
  to distinguish absent fields from the permissive legacy parser's defaults. The verifier reads the
  record from a candidate commit, compares exact slug/PR/hash identity, checks commit/head
  reachability through injected Git/GitHub adapters, and returns only `valid`, `not-applicable`, or a
  typed refusal. Validation never writes.
- Add a pure `shipment-association.ts` classifier. An implementation association needs one exact plan
  stem corroborated by PR metadata, a committed plan, and a non-`.docs/` change. Zero/multiple
  candidates are diagnostic `not-applicable` in premerge checks and unresolved in repair/audit paths.
- Add a thin `shipment-evidence` CLI with `check-pr`, `reconcile`, `audit`, and
  `configure-protection` operations, registered in the existing `index.ts` dispatch chain. GitHub
  Actions invoke the built CLI, so workflows do not duplicate policy.
- Wire the verifier into finish recording, the finish predicate, complete-state verification,
  merged-PR guards, rekick recovery, conductor merge shortcuts, and the daemon's final verified-ship
  boundary. No DONE/cache/teardown/watch side effect may occur after a refusal; `keep`/`discard`
  remain non-shipping choices.
- Add one always-reporting `pull_request` workflow that checks the immutable PR head and one merged-PR
  reconciliation job. Repair uses a deterministic branch keyed by implementation PR and slug,
  allows only `.docs/shipped/<slug>.md`, invokes the same verifier on the repair head, and posts the
  stable `shipped-record` status. It never pushes to `main`, approves, requests approval, enables
  auto-merge, or merges.
- The protection command performs an exact read-modify-write against ruleset `15933604`, rejects
  drift, preserves every existing rule/bypass value, adds only the stable required context, and
  enables the repository's coarse Actions PR-creation setting. Activation occurs only after the
  bootstrap PR visibly emits the expected context.
- The audit enumerates every committed plan/spec and all merged-PR pages, writes an explicit
  complete/incomplete machine report, and generates records only for unique proven implementation
  matches. A final delivery task commits the generated records; valid existing records remain
  byte-identical.

## Prerequisites

- Accepted stories, clean conflict report, approved ADR, and approved architecture review listed
  above.
- Node 20.5+, installed `src/conductor` dependencies, Git, and authenticated `gh` access.
- Ruleset `15933604` and Actions settings must still match the 2026-07-25 verify-claims snapshot before
  protection activation; any drift is a refusal, not an invitation to replace current settings.
- The implementation PR must emit the stable `shipped-record` context before the required-status
  rule is activated.

## Tasks

### Task 1: Establish the strict durable-evidence verdict

**Story:** ST-916-1 AC1, AC2
**Type:** infrastructure + happy-path

**Steps:**
1. Write a failing fixture test for one exact record at the plan stem, canonical plan/stories hash,
   expected PR URL, and candidate commit; assert the complete `valid` payload and identical repeated
   verdicts with no writes.
2. Run the focused test and confirm RED because no strict verifier exists.
3. Implement the typed verdict, candidate-tree/Git dependency seams, strict required-field parser,
   shared plan/stories source resolver, and canonical comparisons while preserving the current schema
   and permissive discovery parser.
4. Re-run the focused test and typecheck; confirm GREEN and byte-identical repository state.
5. Commit with message: `feat(conductor): add strict shipment evidence verdict`

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/src/engine/shipped-record.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`, `src/conductor/test/engine/shipped-record.test.ts`

**Wired-into:** `src/conductor/src/engine/finish-record-cli.ts#dispatchFinishRecord`, `src/conductor/src/engine/artifacts.ts#CUSTOM_COMPLETION_PREDICATES.finish`, `src/conductor/src/engine/complete-verifier.ts#verifyCompleteState`, `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`, `src/conductor/src/engine/merged-pr-guard.ts#checkMergedPrGuard`, `src/conductor/src/engine/daemon-rekick.ts#resumeRebaseFirst`

**Dependencies:** none

### Task 2: Classify exact implementation and non-implementation PRs

**Story:** ST-916-3 AC1, AC2
**Type:** infrastructure + happy-path

**Steps:**
1. Write failing table tests for one exact plan-stem/metadata/non-`.docs/` implementation match and
   for spec-only, plan-only, documentation-only, and record-only `not-applicable` classifications.
2. Confirm RED because the association policy does not exist.
3. Implement the pure classifier over normalized PR metadata, changed paths, committed plan stems,
   and exact spec-to-plan links; return evidence-rich deterministic classifications.
4. Confirm GREEN with input-order invariance and no filesystem/GitHub mutation.
5. Commit with message: `feat(conductor): classify shipment PR associations`

**Files:** `src/conductor/src/engine/shipment-association.ts`, `src/conductor/test/engine/shipment-association.test.ts`

**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`, `src/conductor/src/engine/shipment-reconciliation.ts#reconcileMergedShipment`, `src/conductor/src/engine/shipment-audit.ts#runShipmentAudit`

**Dependencies:** Task 1

### Task 3: Report the immutable-head premerge check on every PR event

**Story:** ST-916-3 AC1, AC2, AC3
**Type:** happy-path

**Steps:**
1. Write failing CLI/workflow tests for opened, reopened, and synchronized PR payloads: checkout the
   exact `head.sha`, classify once, invoke the strict verifier for implementations, and terminate the
   stable `shipped-record` context as `valid` or `not-applicable` without path filters.
2. Confirm RED because the CLI command and workflow are absent.
3. Implement `shipment-evidence check-pr`, register it before the interactive CLI fallthrough, and
   add the read-only premerge workflow job using the built conductor.
4. Confirm GREEN with workflow-structure assertions, CLI fixtures, build, and typecheck.
5. Commit with message: `feat(ci): require immutable shipment evidence checks`

**Files:** `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`, `src/conductor/test/cli/index.test.ts`, `.github/workflows/shipment-evidence.yml`, `src/conductor/test/acceptance/shipment-evidence-workflow.acceptance.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main`, `.github/workflows/shipment-evidence.yml#shipment-evidence`

**Dependencies:** Tasks 1, 2

### Task 4: Prepare an exact, drift-safe protection cutover

**Story:** ST-916-3 AC3, AC4
**Type:** infrastructure + happy-path

**Steps:**
1. Write failing adapter tests from the captured ruleset/Actions fixtures: the proposed payload adds
   only `required_status_checks(context=shipped-record)`, preserves every rule/condition/bypass value,
   and changes only `can_approve_pull_request_reviews` from false to true.
2. Confirm RED because no protection operation exists.
3. Implement `shipment-evidence configure-protection` with dry-run/apply modes, exact precondition
   comparison, one ruleset PUT, one Actions-permissions PUT, and after-read equality verification.
4. Confirm GREEN; prove dry-run has no writes and repeated apply is idempotent.
5. Commit with message: `feat(conductor): add drift-safe shipment protection cutover`

**Files:** `src/conductor/src/engine/github-protection.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/github-protection.test.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`, `src/conductor/test/cli/index.test.ts`

**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`, `src/conductor/src/index.ts#main`

**Dependencies:** Task 3

### Task 5: Admit valid evidence through every ordinary PR finish mode

**Story:** ST-936-2 AC1
**Type:** happy-path

**Steps:**
1. Write failing matrix tests for daemon, inline-auto, inline-default, and inline-interactive PR
   finishes with a `valid` verdict; assert exactly one PR URL, finish choice, DONE transition, cache
   write, teardown, label cleanup, and watch enrollment.
2. Confirm RED because terminal seams still accept marker/URL state without the shared verdict.
3. Inject and invoke the verifier in finish recording, the finish predicate, complete-state
   verification, and the daemon verified-ship boundary; preserve the existing once-only ordering.
4. Confirm GREEN across the focused finish/daemon matrix and existing finish regressions.
5. Commit with message: `feat(conductor): gate PR completion on durable evidence`

**Files:** `src/conductor/src/engine/finish-record-cli.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/complete-verifier.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/test/engine/finish-record-cli.test.ts`, `src/conductor/test/engine/artifacts.test.ts`, `src/conductor/test/engine/complete-verifier.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`, `src/conductor/test/acceptance/finish-record-real-binary.acceptance.test.ts`

**Wired-into:** `src/conductor/src/engine/finish-record-cli.ts#dispatchFinishRecord`, `src/conductor/src/engine/artifacts.ts#CUSTOM_COMPLETION_PREDICATES.finish`, `src/conductor/src/engine/complete-verifier.ts#verifyCompleteState`, `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`

**Dependencies:** Task 1

### Task 6: Converge valid merged PRs while preserving non-shipping finishes

**Story:** ST-936-2 AC2, AC3
**Type:** happy-path

**Steps:**
1. Write failing tests proving a merged PR with valid evidence on merged history reaches the normal
   verified-ship boundary, while `keep` and `discard` need no record and never become PR shipments.
2. Confirm RED against synthetic merged markers and stale alternate metadata behavior.
3. Thread the strict verifier through the merged guard, conductor merge shortcuts, and rekick path;
   route valid merges through normal convergence and leave non-shipping choices record-independent.
4. Confirm GREEN in guard, conductor, rekick, and finish-choice suites.
5. Commit with message: `feat(conductor): verify merged shipment convergence`

**Files:** `src/conductor/src/engine/merged-pr-guard.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/merged-pr-guard.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/finish-record-cli.test.ts`

**Wired-into:** `src/conductor/src/engine/merged-pr-guard.ts#checkMergedPrGuard`, `src/conductor/src/engine/conductor.ts#Conductor.run`, `src/conductor/src/engine/daemon-rekick.ts#resumeRebaseFirst`, `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Tasks 1, 5

### Task 7: Propose one record-only repair for a proven merged gap

**Story:** ST-916-4 AC1, AC2
**Type:** happy-path

**Steps:**
1. Write failing reconciliation tests for a proven merged PR with missing/invalid evidence and for an
   already-valid record; assert one deterministic repair branch/PR with canonical fields in the first
   case and a completely write-free aligned result in the second.
2. Confirm RED because no reconciliation adapter exists.
3. Implement pure repair planning plus injected Git/GitHub execution, reusing the record renderer and
   strict verifier and enforcing the single-record changed-path allowlist.
4. Confirm GREEN, including exact branch name, PR body evidence, shipped date, and no-op assertions.
5. Commit with message: `feat(conductor): propose durable record repair PRs`

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/src/engine/shipped-record.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`

**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`, `.github/workflows/shipment-evidence.yml#reconcile-shipment`

**Dependencies:** Tasks 1, 2, 3

### Task 8: Converge repair retries and post the repair-head status

**Story:** ST-916-4 AC3, AC4, AC5
**Type:** happy-path

**Steps:**
1. Write failing overlapping-run tests for deterministic branch reuse, at most one open repair PR,
   exact-head verification/status, job-scoped write permissions, and a zero-call denylist for direct
   `main`, review, approval, auto-merge, and merge APIs.
2. Confirm RED because postmerge workflow/status behavior is absent.
3. Add the merged-PR job, idempotent find-or-create/update logic, strict repair-head verification, and
   stable commit-status posting with only contents/pulls/statuses write permissions.
4. Confirm GREEN in concurrency, payload, workflow-authority, and non-autonomy assertions.
5. Commit with message: `feat(ci): reconcile shipment records without merge authority`

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`, `.github/workflows/shipment-evidence.yml`, `src/conductor/test/acceptance/shipment-evidence-workflow.acceptance.test.ts`

**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`, `.github/workflows/shipment-evidence.yml#reconcile-shipment`

**Dependencies:** Task 7

### Task 9: Implement the real-repository audit and proven-backfill report

**Story:** ST-916-5 AC1, AC2, AC3, AC4, NP1, NP2, NP3, NP4, NP5
**Type:** infrastructure + happy-path

**Steps:**
1. Define the typed audit result/report contract over the already-tested strict verifier and exact
   association policy; do not add an audit fixture module or dedicated backfill test file.
2. Implement deterministic repository enumeration, paginated GitHub evidence loading, exact
   association, strict validation, report persistence, and record generation through the existing
   renderer; register `shipment-evidence audit`.
3. Run typecheck and production build to prove the audit/CLI result algebra is exhaustive and wired.
4. Run report-only mode against the real repository; inspect candidate cardinality, evidence,
   aggregate counts, completeness, and proposed paths without writing records.
5. Commit with message: `feat(conductor): audit and backfill proven shipments`

**Files:** `src/conductor/src/engine/shipment-audit.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/src/index.ts`

**Wired-into:** `src/conductor/src/engine/shipment-evidence-cli.ts#dispatchShipmentEvidence`, `src/conductor/src/index.ts#main`

**Dependencies:** Tasks 1, 2

### Task 10: Preserve durable discovery dedup in fresh checkouts

**Story:** ST-936-6 AC1, AC2, AC3
**Type:** happy-path

**Steps:**
1. Write failing fresh-checkout fixtures with empty processed cache for feature-branch, repair, and
   backfill records, plus renamed-plan hash and same-stem changed-plan cases; assert skip and cache
   repair under the current slug.
2. Confirm RED where the new strict policy would otherwise disturb existing discovery behavior.
3. Keep `makeIsProcessed` stem/hash discovery semantics intact and adapt only shared parsing/source
   exports needed by strict validation; ensure daemon discovery repairs cache from committed records.
4. Confirm GREEN in shipped-record, daemon dependency, and discovery acceptance suites.
5. Commit with message: `test(conductor): preserve durable shipped discovery compatibility`

**Files:** `src/conductor/src/engine/shipped-record.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/test/engine/shipped-record.test.ts`, `src/conductor/test/engine/daemon-deps.test.ts`, `src/conductor/test/acceptance/content-aware-shipped-dedup.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 11: Refuse absent, malformed, and incomplete records

**Story:** ST-916-1 NP1
**Type:** negative-path

**Steps:**
1. Add failing table rows for absent record, broken frontmatter, and each omitted required field;
   assert a distinct typed defect and no cache fallback.
2. Confirm RED against permissive defaults.
3. Complete strict shape validation without changing legacy discovery parsing.
4. Confirm GREEN and unchanged discovery tests.
5. Commit with message: `test(conductor): refuse incomplete shipment records`

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/src/engine/shipped-record.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`, `src/conductor/test/engine/shipped-record.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 12: Distinguish every record identity mismatch

**Story:** ST-916-1 NP2
**Type:** negative-path

**Steps:**
1. Add failing rows for slug, PR URL, and canonical-hash mismatch, asserting expected/observed values
   and byte-identical record content.
2. Confirm RED where mismatches are collapsed or accepted.
3. Add field-specific refusal variants and stable rendering.
4. Confirm GREEN for all identity rows and type exhaustiveness.
5. Commit with message: `test(conductor): distinguish shipment identity mismatches`

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 13: Refuse uncommitted, unpushed, and stale-head evidence

**Story:** ST-916-1 NP3
**Type:** negative-path

**Steps:**
1. Add failing injected-Git rows for working-tree-only records, local-only commits, and a candidate SHA
   superseded by the live PR head.
2. Confirm RED because reachability failures are not distinguished.
3. Enforce candidate-tree containment and exact head/upstream reachability with typed reasons.
4. Confirm GREEN without reading the working tree as authoritative.
5. Commit with message: `test(conductor): enforce shipment record reachability`

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 14: Close verifier dependency failures

**Story:** ST-916-1 NP4
**Type:** negative-path

**Steps:**
1. Add failing injection cases for plan, stories, record, Git, authentication, and network reads;
   assert typed dependency refusals and never `valid`.
2. Confirm RED for any thrown or fail-open branch.
3. Normalize adapter failures at the verifier boundary while retaining dependency/cause metadata.
4. Confirm GREEN and no unhandled rejection.
5. Commit with message: `test(conductor): fail closed on evidence dependencies`

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 15: Keep repeated strict validation read-only

**Story:** ST-916-1 NP5
**Type:** negative-path

**Steps:**
1. Add a failing spy/byte-snapshot test that repeats validation of inaccurate content and expects the
   same refusal with zero write, commit, or GitHub calls.
2. Confirm RED if validation attempts self-repair.
3. Remove or isolate any mutation from the verifier path; leave repair solely to reconciliation/audit.
4. Confirm GREEN for valid and invalid repetition.
5. Commit with message: `test(conductor): keep shipment validation immutable`

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Tasks 1, 7

### Task 16: Halt every engine mode on any evidence refusal

**Story:** ST-936-2 NP1
**Type:** negative-path

**Steps:**
1. Add a failing mode × refusal matrix covering missing, malformed, mismatched, uncommitted, unpushed,
   stale, and unavailable evidence; assert no finish/DONE/cache/teardown/label/watch side effects and
   an actionable HALT preserving work.
2. Confirm RED at each former partial-evidence acceptance path.
3. Route all verifier refusals through one terminal-gap formatter before any ship side effect.
4. Confirm GREEN across daemon and three inline modes.
5. Commit with message: `fix(conductor): halt all PR modes without durable evidence`

**Files:** `src/conductor/src/engine/finish-record-cli.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/complete-verifier.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/finish-record-cli.test.ts`, `src/conductor/test/engine/artifacts.test.ts`, `src/conductor/test/engine/complete-verifier.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Tasks 5, 11, 12, 13, 14

### Task 17: Stop after terminal-state persistence failure

**Story:** ST-936-2 NP2
**Type:** negative-path

**Steps:**
1. Add failing fault-injection tests after valid evidence but before/during state and marker persistence;
   assert no later cache/cleanup/watch side effects and a retry reuses the same record once.
2. Confirm RED wherever later side effects run after partial persistence.
3. Order convergence as verify → persist terminal state atomically enough to retry → downstream
   effects, returning a closed gap on persistence failure.
4. Confirm GREEN and no duplicate record write.
5. Commit with message: `fix(conductor): stop shipment after terminal persistence failure`

**Files:** `src/conductor/src/engine/finish-record-cli.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/finish-record-cli.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Tasks 5, 16

### Task 18: Preserve out-of-band merged branches with evidence gaps

**Story:** ST-936-2 NP3
**Type:** negative-path

**Steps:**
1. Add failing guard/rekick tests for merged PRs with missing and invalid records; assert no synthetic
   finish/DONE/cache state, no teardown, preserved branch, and a reconciliation-oriented gap.
2. Confirm RED against `writeSyntheticShipMarkers` and `already_shipped` shortcuts.
3. Replace synthetic success with a typed merged-evidence gap handled by normal halt/recovery paths.
4. Confirm GREEN and prove the valid merged case from Task 6 still converges.
5. Commit with message: `fix(conductor): preserve merged work with record gaps`

**Files:** `src/conductor/src/engine/merged-pr-guard.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/merged-pr-guard.test.ts`, `src/conductor/test/engine/merged-pr-guard-kickback.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** same as Task 6

**Dependencies:** Tasks 6, 16

### Task 19: Close merge-state and merged-history read failures

**Story:** ST-936-2 NP4
**Type:** negative-path

**Steps:**
1. Add failing tests for GitHub merge-state failure and merged-commit evidence read failure; assert no
   verified ship, no teardown, and recoverable work.
2. Confirm RED if unknown state is treated as proceed/merged success.
3. Return dependency-specific guard refusals and route them through the preserved-work halt path.
4. Confirm GREEN in merged guard, rekick, and conductor suites.
5. Commit with message: `test(conductor): close merged shipment dependency failures`

**Files:** `src/conductor/src/engine/merged-pr-guard.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/merged-pr-guard.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** same as Task 6

**Dependencies:** Task 18

### Task 20: Isolate keep/discard from stale shipment metadata

**Story:** ST-936-2 NP5
**Type:** negative-path

**Steps:**
1. Add failing keep/discard tests with stale PR URL/choice and unrelated record; assert no record write,
   processed marker, or PR shipment outcome.
2. Confirm RED if stale alternate state changes the selected choice.
3. Clear/ignore shipping-only metadata for non-shipping choices at the finish boundary.
4. Confirm GREEN and unchanged keep/discard completion.
5. Commit with message: `test(conductor): isolate non-shipping finish choices`

**Files:** `src/conductor/src/engine/finish-record-cli.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/finish-record-cli.test.ts`, `src/conductor/test/engine/artifacts.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Tasks 5, 6

### Task 21: Fail the required check on strict evidence refusal

**Story:** ST-916-3 NP1
**Type:** negative-path

**Steps:**
1. Add failing PR-event rows for a unique implementation association with each strict refusal; assert
   nonzero CLI exit, failed stable result, and exact diagnostic.
2. Confirm RED if any refusal becomes success/not-applicable.
3. Map only `valid` to successful implementation status; preserve the verifier defect in output.
4. Confirm GREEN for all refusal classes.
5. Commit with message: `test(ci): fail associated PRs without valid records`

**Files:** `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`, `src/conductor/test/acceptance/shipment-evidence-workflow.acceptance.test.ts`

**Wired-into:** same as Task 3

**Dependencies:** Tasks 3, 11, 12, 13, 14

### Task 22: Reject fuzzy or incomplete implementation associations

**Story:** ST-916-3 NP2
**Type:** negative-path

**Steps:**
1. Add failing classifier rows for fuzzy slug resemblance, absent exact metadata corroboration, and
   docs-only changes; assert no proven implementation and no record-generation call.
2. Confirm RED against substring or candidate-count inference.
3. Tighten normalization to exact bounded stems and explicit non-`.docs/` evidence.
4. Confirm GREEN with near-collision fixtures.
5. Commit with message: `test(conductor): reject fuzzy shipment associations`

**Files:** `src/conductor/src/engine/shipment-association.ts`, `src/conductor/test/engine/shipment-association.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 23: Report zero and multiple PR associations without guessing

**Story:** ST-916-3 NP3
**Type:** negative-path

**Steps:**
1. Add failing PR-check rows for zero and multiple exact candidates; assert successful
   `not-applicable`, explicit unresolved/ambiguous evidence, and zero mutation.
2. Confirm RED if a candidate is guessed or the check remains pending.
3. Add stable diagnostic result variants and terminal output for both cardinalities.
4. Confirm GREEN and deterministic candidate ordering.
5. Commit with message: `test(ci): report ambiguous shipment checks safely`

**Files:** `src/conductor/src/engine/shipment-association.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/engine/shipment-association.test.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`

**Wired-into:** same as Task 3

**Dependencies:** Tasks 2, 3

### Task 24: Keep workflow setup and runtime failures non-successful

**Story:** ST-916-3 NP4
**Type:** negative-path

**Steps:**
1. Add failing workflow/CLI cases for checkout, dependency install, classification, and verifier
   failure; assert no fallback command or success status can run.
2. Confirm RED wherever shell control flow masks exit status.
3. Use default fail-fast step behavior and explicit CLI nonzero exits; do not add `continue-on-error` or
   synthetic success cleanup.
4. Confirm GREEN via workflow structure and injected CLI failures.
5. Commit with message: `test(ci): keep shipment workflow failures closed`

**Files:** `.github/workflows/shipment-evidence.yml`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/acceptance/shipment-evidence-workflow.acceptance.test.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts`

**Wired-into:** same as Task 3

**Dependencies:** Task 3

### Task 25: Refuse any protection payload that weakens current rules

**Story:** ST-916-3 NP5
**Type:** negative-path

**Steps:**
1. Add failing fixture mutations that omit/change each existing rule, review parameter, condition, or
   bypass actor; assert no PUT and a precise drift refusal.
2. Confirm RED if the updater reconstructs defaults or writes partial state.
3. Compare normalized exact inventories before composing the one additive status rule.
4. Confirm GREEN for every drift row and the approved unchanged snapshot.
5. Commit with message: `test(conductor): reject weakened main protection updates`

**Files:** `src/conductor/src/engine/github-protection.ts`, `src/conductor/test/engine/github-protection.test.ts`

**Wired-into:** same as Task 4

**Dependencies:** Task 4

### Task 26: Leave uncertain merged associations write-free

**Story:** ST-916-4 NP1
**Type:** negative-path

**Steps:**
1. Add failing reconciliation rows for absent, ambiguous, contradictory, and unresolvable spec-to-plan
   association; assert visible unresolved results and zero record/branch/commit/PR calls.
2. Confirm RED if reconciliation inherits premerge `not-applicable` as permission to guess.
3. Map every non-unique repair association to a closed write-free result.
4. Confirm GREEN with complete mutation-spy assertions.
5. Commit with message: `test(conductor): keep uncertain repairs write-free`

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`

**Wired-into:** same as Task 7

**Dependencies:** Tasks 2, 7

### Task 27: Preserve accurate records across repeated merge events

**Story:** ST-916-4 NP2
**Type:** negative-path

**Steps:**
1. Add a failing repeated-event snapshot for valid evidence; assert identical record bytes/history and
   zero branch, commit, comment, status, or PR writes.
2. Confirm RED if reconciliation refreshes dates/costs or posts noise.
3. Return aligned before constructing a repair plan or mutating GitHub.
4. Confirm GREEN for sequential and duplicate event delivery.
5. Commit with message: `test(conductor): preserve aligned shipment records`

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`

**Wired-into:** same as Task 7

**Dependencies:** Task 7

### Task 28: Converge repair races and GitHub write failures safely

**Story:** ST-916-4 NP3
**Type:** negative-path

**Steps:**
1. Add failing rows for competing branch updates, rate limit, timeout, authentication, and each GitHub
   write; assert failure, zero direct-`main` fallback, and the same retry identity.
2. Confirm RED where errors open a second branch/PR or widen the target.
3. Re-read deterministic branch/open PR state at conflicts and return retryable typed failures without
   alternate writes.
4. Confirm GREEN, including at-most-one-open-PR after overlapping calls settle.
5. Commit with message: `test(conductor): contain shipment repair races`

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`

**Wired-into:** same as Task 8

**Dependencies:** Task 8

### Task 29: Fail the stable status for an invalid repair head

**Story:** ST-916-4 NP4
**Type:** negative-path

**Steps:**
1. Add a failing repair-job case whose proposed record is malformed/mismatched at the exact head;
   assert failed `shipped-record` status and no success status.
2. Confirm RED if branch creation implies success.
3. Gate status state solely on the shared strict verifier result for the repair SHA.
4. Confirm GREEN and prove the repair PR remains subject to normal protection.
5. Commit with message: `test(ci): fail invalid repair-head shipment status`

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`, `src/conductor/test/acceptance/shipment-evidence-workflow.acceptance.test.ts`

**Wired-into:** same as Task 8

**Dependencies:** Tasks 1, 8

### Task 30: Fail visibly when repair permissions are insufficient

**Story:** ST-916-4 NP5
**Type:** negative-path

**Steps:**
1. Add failing branch/PR/status permission-denial rows; assert a visible failure and zero approve,
   review-request, auto-merge, merge, direct-main, or permission-escalation calls.
2. Confirm RED if a fallback broadens authority.
3. Preserve the job-scoped permission declaration and return the original denied operation as the
   repair failure.
4. Confirm GREEN across API spies and workflow structure.
5. Commit with message: `test(ci): contain shipment repair permission failures`

**Files:** `src/conductor/src/engine/shipment-reconciliation.ts`, `src/conductor/test/engine/shipment-reconciliation.test.ts`, `.github/workflows/shipment-evidence.yml`, `src/conductor/test/acceptance/shipment-evidence-workflow.acceptance.test.ts`

**Wired-into:** same as Task 8

**Dependencies:** Task 8

### Task 31: Report specs without a canonical plan as unresolved

**Story:** ST-916-5 NP1
**Type:** negative-path

**Steps:**
1. Identify real product-spec candidates without an exact canonical-plan link in report-only output.
2. Implement the unresolved classification before hash computation or record planning.
3. Re-run report-only mode and inspect that those rows carry no spec-only/unknown hash or write path.
4. Run typecheck and build; add no dedicated backfill fixture or automated test.
5. Commit with message: `feat(conductor): classify planless shipment candidates`

**Files:** `src/conductor/src/engine/shipment-audit.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 9

### Task 32: Skip every historically unproven implementation candidate

**Story:** ST-916-5 NP2
**Type:** negative-path

**Steps:**
1. Enumerate real report-only rows with no merged PR, multiple candidates, local-marker-only,
   spec-only, heuristic-only, or contradictory evidence.
2. Require one exact merged implementation association with non-`.docs/` corroboration before a
   record plan can exist.
3. Re-run report-only mode and inspect that every insufficient-proof row is skipped with no write path.
4. Run typecheck and build; add no dedicated backfill fixture or automated test.
5. Commit with message: `feat(conductor): require proven historical implementations`

**Files:** `src/conductor/src/engine/shipment-audit.ts`, `src/conductor/src/engine/shipment-association.ts`

**Wired-into:** same as Task 9

**Dependencies:** Tasks 2, 9

### Task 33: Never overwrite accurate historical records on contradiction

**Story:** ST-916-5 NP3
**Type:** negative-path

**Steps:**
1. Identify real aligned records and any later plan/local-marker/unrelated-PR contradictions in the
   report-only output; snapshot their bytes before apply.
2. Give valid committed evidence preservation priority and report later contradictions separately.
3. Re-run report-only/apply and inspect byte-identical aligned records plus human-review rows.
4. Run typecheck and build; add no dedicated backfill fixture or automated test.
5. Commit with message: `fix(conductor): preserve valid historical shipment evidence`

**Files:** `src/conductor/src/engine/shipment-audit.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 9

### Task 34: Mark incomplete audits non-successful

**Story:** ST-916-5 NP4
**Type:** negative-path

**Steps:**
1. Implement explicit completeness accounting across every GitHub page and repository read.
2. Convert pagination, authentication, rate-limit, timeout, and read failures into typed incomplete
   reports and nonzero exit without aligned/backfilled claims for unavailable evidence.
3. Inspect the real complete run's page/candidate totals and audit the fail-closed branches in code.
4. Run typecheck and build; add no injected backfill failures or dedicated automated test.
5. Commit with message: `fix(conductor): expose incomplete shipment audits`

**Files:** `src/conductor/src/engine/shipment-audit.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 9

### Task 35: Refuse success when the audit report cannot persist

**Story:** ST-916-5 NP5
**Type:** negative-path

**Steps:**
1. Order report persistence before any successful-complete summary in the production command.
2. Convert a report-write exception into a typed incomplete result and nonzero exit.
3. Inspect the command path to prove no success output precedes the durable write.
4. Run typecheck and build; add no report-write injection or dedicated automated backfill test.
5. Commit with message: `fix(conductor): require durable shipment audit reports`

**Files:** `src/conductor/src/engine/shipment-audit.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 9

### Task 36: Reject records that are not durable from a fresh checkout

**Story:** ST-936-6 NP1
**Type:** negative-path

**Steps:**
1. Add failing fresh-checkout cases for working-tree-only, local-only, and invalid committed records;
   assert discovery does not claim strict shipment and does not create false cache state.
2. Confirm RED if local visibility is conflated with committed durability.
3. Keep strict terminal consumers on candidate-commit evidence and discovery on committed records only.
4. Confirm GREEN with empty-cache fixtures.
5. Commit with message: `test(conductor): reject non-durable fresh-checkout evidence`

**Files:** `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/src/engine/shipped-record.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`, `src/conductor/test/engine/daemon-deps.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Tasks 1, 10

### Task 37: Keep durable skip decisions when cache repair fails

**Story:** ST-936-6 NP2
**Type:** negative-path

**Steps:**
1. Add a failing discovery case with valid committed evidence and an unwritable/corrupt local cache;
   assert the feature still skips and the repair failure is visible.
2. Confirm RED if cache write failure re-dispatches shipped work.
3. Preserve the committed-record decision while reporting cache repair independently.
4. Confirm GREEN and no plan execution.
5. Commit with message: `test(conductor): keep shipped skip on cache repair failure`

**Files:** `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/test/engine/daemon-deps.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 10

### Task 38: Prevent false rename dedup on hash mismatch

**Story:** ST-936-6 NP3
**Type:** negative-path

**Steps:**
1. Add a failing renamed-plan fixture whose content differs from the record hash; assert no hash-based
   skip or repaired marker for the renamed slug.
2. Confirm RED if basename/near-hash matching accepts it.
3. Keep rename discovery on exact canonical hash equality.
4. Confirm GREEN alongside the valid rename case.
5. Commit with message: `test(conductor): require exact hash for rename dedup`

**Files:** `src/conductor/src/engine/shipped-record.ts`, `src/conductor/test/engine/shipped-record.test.ts`, `src/conductor/test/acceptance/content-aware-shipped-dedup.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 10

### Task 39: Prevent permissive discovery from authorizing terminal success

**Story:** ST-936-6 NP4
**Type:** negative-path

**Steps:**
1. Add a failing integration fixture where same-stem discovery skips a changed plan but strict terminal
   verification sees a hash mismatch; assert the permissive result cannot create DONE/cache/teardown.
2. Confirm RED if discovery's boolean leaks into ship eligibility.
3. Keep discovery and strict-verdict types separate and require the latter at every terminal caller.
4. Confirm GREEN across discovery, finish, and daemon boundary tests.
5. Commit with message: `test(conductor): separate discovery from ship authority`

**Files:** `src/conductor/src/engine/shipped-record.ts`, `src/conductor/src/engine/shipment-evidence.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/shipped-record.test.ts`, `src/conductor/test/engine/shipment-evidence.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Tasks 5, 10, 16

### Task 40: Run the proven historical audit and commit only valid backfills

**Story:** ST-916-5 AC1, AC2, AC3, AC4; ST-936-6 AC1
**Type:** infrastructure

**Steps:**
1. Run the completed audit in report-only mode; inspect `complete`, aggregate counts, every candidate
   row, and the exact proposed `.docs/shipped/` diff; treat any unresolved proof as a skip.
2. Run apply mode and the strict verifier over every proposed record; confirm the generated set is
   valid and contains no overwrite of an accurate existing record.
3. Re-run the audit from a clean-cache checkout; assert zero additional record changes, prior
   backfilled rows now aligned, and unchanged unresolved/ambiguous/contradictory rows.
4. Run the existing non-backfill shipment suites, full harness integrity suite, typecheck, and
   build; do not add a dedicated automated test suite for the historical backfill.
5. Commit the report-backed records with message: `chore: backfill proven shipped records`

**Files:** `.docs/shipped`, `.pipeline/shipment-audit.json`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 9, 15, 31, 32, 33, 34, 35, 36, 37, 38, 39

## Task Dependency Graph

```text
1 ──┬── 2 ──┬── 3 ── 4 ── 25
    │       │    ├── 7 ── 8 ──┬── 28
    │       │    │             ├── 29
    │       │    │             └── 30
    │       │    ├── 21
    │       │    └── 23
    │       ├── 9 ──┬── 31
    │       │        ├── 32
    │       │        ├── 33
    │       │        ├── 34
    │       │        └── 35
    │       ├── 22
    │       ├── 26
    │       └── 32
    ├── 5 ──┬── 6 ──┬── 18 ── 19
    │       │        └── 20
    │       ├── 16 ──┬── 17
    │       │         ├── 18
    │       │         └── 39
    │       └── 20
    ├── 10 ─┬── 36
    │        ├── 37
    │        ├── 38
    │        └── 39
    ├── 11 ── 16
    ├── 12 ── 16
    ├── 13 ── 16
    ├── 14 ── 16
    └── 15

7 ── 15

9, 15, 31–39 ── 40
```

## Integration Points

- After Task 3: an immutable PR head receives a deterministic `valid`/`not-applicable` check result.
- After Task 6: all ordinary, merged, and non-shipping engine terminal paths share the durable verdict.
- After Task 8: a missed merged record yields one human-merged, record-only repair PR with its own
  stable status.
- After Task 9: historical candidates can be audited and reported without heuristic record creation.
- After Task 25: the protection updater can preserve the live ruleset exactly and reject drift.
- After Task 39: all accepted negative paths are closed and discovery remains compatible.
- After Task 40: proven historical gaps are committed and a second fresh-checkout run is idempotent.

## Post-Merge Protection Cutover

This is a delivery operation, not an implementation task: after the bootstrap implementation PR is
merged and the stable `shipped-record` context has been observed, run
`conduct-ts shipment-evidence configure-protection --apply --ruleset 15933604`. Re-read both GitHub
endpoints and require exact equality with the captured inventory plus the one status rule and enabled
Actions PR setting. If the live inventory drifted, stop and review; do not submit a replacement payload.

## Coverage Mapping

| Story | Happy-path criteria | Negative-path criteria |
|---|---|---|
| ST-916-1 | AC1–AC2 → Task 1 | NP1 → 11; NP2 → 12; NP3 → 13; NP4 → 14; NP5 → 15 |
| ST-936-2 | AC1 → Task 5; AC2–AC3 → Task 6 | NP1 → 16; NP2 → 17; NP3 → 18; NP4 → 19; NP5 → 20 |
| ST-916-3 | AC1–AC3 → Tasks 2–3; AC4 → Task 4 | NP1 → 21; NP2 → 22; NP3 → 23; NP4 → 24; NP5 → 25 |
| ST-916-4 | AC1–AC2 → Task 7; AC3–AC5 → Task 8 | NP1 → 26; NP2 → 27; NP3 → 28; NP4 → 29; NP5 → 30 |
| ST-916-5 | AC1–AC4 → Tasks 9, 40 | NP1 → 31; NP2 → 32; NP3 → 33; NP4 → 34; NP5 → 35 |
| ST-936-6 | AC1–AC3 → Tasks 10, 40 | NP1 → 36; NP2 → 37; NP3 → 38; NP4 → 39 |

## Verification

- [ ] Every happy-path criterion is covered by at least one task.
- [ ] Every negative-path criterion has its own explicit task.
- [ ] Each implementation task uses a focused RED → GREEN cycle and targets a 2–5 minute slice,
      except the operator-directed one-time backfill tasks (9 and 31–35), which add no dedicated
      automated backfill tests and are verified against the real report/diff in Task 40.
- [ ] Every task declares repo-relative `Files`, `Wired-into`, and acyclic `Dependencies`.
- [ ] Focused shipment suites, full harness integrity suite, typecheck, and production build pass.
- [ ] Repair code has zero direct-main/approval/review-request/auto-merge/merge operations.
- [ ] Backfill report is complete; every generated record verifies strictly; a second run is diff-free.
- [ ] Post-merge ruleset/Actions cutover preserves every captured protection and enables the stable
      required context without weakening bypass or review rules.
