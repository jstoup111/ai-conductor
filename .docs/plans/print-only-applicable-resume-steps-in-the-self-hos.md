# Implementation Plan: Self-host gate HALT resume procedure

**Date:** 2026-09-06
**Stories:** .docs/stories/print-only-applicable-resume-steps-in-the-self-hos.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent touches one exported helper's literal body text and its own unit file, contradicts no in-flight spec, and preserves the halt contract every caller and reader already depends on — reason first, `needs-human` class, redacted body.

## Summary

Two bounded tasks deliver #1775 by rewriting the shared resume procedure the self-host finish-gate halt writer appends to every park, and by proving the rewrite kept the dashboard reason, the redaction span, and the merge invariant intact. Gate reasons, halt classification, the marker path, other halt writers, and the daemon's re-dispatch behavior are outside this slice.

## Technical Approach

The self-host gate halt writer composes its marker body as the redacted caller reason, a blank line, a heading line naming the ADR-005/ADR-010 invariant, and a fixed three-step resume procedure. Only the procedure lines and the module header sentence that paraphrases them change; the composition order, the redaction call, the delegation to the shared marker writer, and the `needs-human` classification stay byte-for-byte as they are.

Replace the middle step, which tells the operator to re-install the harness and run a `/verify` command, with the step the operator actually performs next: clearing the halt marker and its class sidecar so the daemon re-dispatches the feature. That is the same instruction the sibling rebase halt writer in this directory already prints, and the same one the stalled-feature runbook prescribes, so the two engine halt bodies converge rather than diverge. The recommended wording, which BUILD may adjust only in phrasing and not in substance, is:

    Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).
    Resume procedure:
      1. Address the gate reason above in this worktree and commit the fix.
      2. Clear .pipeline/HALT and .pipeline/HALT.class — the daemon re-dispatches the feature, re-runs the gates, and opens or updates the PR.
      3. Merge the PR yourself once its checks pass.

Keep every step on one physical line so the body stays greppable and the first non-empty line remains the caller's reason. The module header's closing sentence — which today says a self-build ends at a halt for the operator to re-install, run `/verify`, and merge — is corrected in the same edit so the comment and the emitted text cannot drift apart again.

Tests follow the repository's test-authoring rules: this behavior is a pure composition inside one exported function, so the narrowest credible seam is that function, invoked directly against a temporary directory, exactly as the existing unit file for it already does. Search hints for the local pattern: the existing unit file for this helper builds a temporary project root with `mkdtemp` in `beforeEach`, removes it in `afterEach`, calls the writer, and reads the marker and its class sidecar back from disk. Reuse that fixture shape and add cases to it; do not introduce a conductor run, a gate fixture, a provider, or any process, network, or third-party call. No production boundary is newly crossed — the two finish gates and the retained-draft-PR reader already call this writer through their existing injected `writeHalt` seams and are not edited, so no separate integration-owning task is warranted.

Assertions are written against properties, not against the whole literal blob: absence of an installer invocation and of a `/verify` instruction, presence of the marker-and-sidecar clearing step and the merge step, the reason's position ahead of the procedure, survival of the ADR sentence, and the numbered-step count. A whole-body string equality assertion would make every future wording fix a test edit and is not used.

## Preconditions and claim ledger

- Operator delegated Small scope, the technical track, and both stories on 2026-09-06; the wording decision was taken as the sensible default under that delegation.
- Verified: the halt writer at `src/conductor/src/engine/self-host/gate-halt.ts` composes the body as redacted reason, ADR heading line, then three numbered steps, and its step 2 is the harness re-install plus `/verify` instruction.
- Verified: the same file's module header closes with the sentence that a self-build ends at a halt for the operator to re-install, `/verify`, and merge — the same wrong instruction in comment form.
- Verified: no `/verify` skill exists in the shipped catalog; the nearest name is the claim-grounding protocol skill, which is not an installation check.
- Verified: the engine's install-freshness module runs the harness installer in relink-only mode before dispatching a self-build, so the printed installer step duplicates work the engine already did.
- Verified: the daemon's engine republish loop fetches, fast-forwards, and rebuilds the engine under self-host, so no operator-run rebuild step belongs in the procedure either.
- Verified: the sibling rebase halt writer in this directory already instructs operators to clear both the halt marker and its class sidecar before re-queueing.
- Verified: the only test asserting this writer's output is its own unit file, `src/conductor/test/engine/self-host/gate-halt.test.ts`; the other engine and acceptance tests that assert the literal phrase `Resume procedure:` are exercising different halt writers and are untouched by this change.
- Verified: the two finish gates and the retained-draft-PR reader reach this text only through the exported writer or an injected `writeHalt` seam, so no caller edit is required.
- Scope check: harness-repo-only (self-host engine directory); no skill addition; provider-agnostic. Event spine: no channel is added or changed; the halt marker is an existing artifact whose prose is being corrected.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; no pending assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Replace the resume procedure with steps that apply to a self-build
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/self-host/gate-halt.ts, src/conductor/test/engine/self-host/gate-halt.test.ts
**Dependencies:** none

**Steps:**
1. Add unit cases to the existing halt-writer test file, reusing its temporary-root fixture shape: assert the written body carries no harness-installer invocation and no `/verify` instruction, and that its numbered steps name addressing the reason, clearing the halt marker and its class sidecar, and merging the pull request.
2. Add a unit case that passes a canary-bearing reason and asserts both that the canary is absent from the body and that every numbered resume step is still present, so redaction and the rewritten procedure are proven together.
3. Verify the new cases fail against the current text (RED).
4. Rewrite the writer's resume-procedure lines to the wording given in Technical Approach, keeping one physical line per step, and correct the module header's closing sentence in the same edit so the comment matches the emitted text.
5. Verify the new cases pass (GREEN), run the repository's typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A unit assertion proves the written halt body contains no harness-installer invocation and no `/verify` instruction.
2. A unit assertion proves the body's numbered steps name addressing the reason, clearing the halt marker and its class sidecar, and merging the pull request.
3. A unit assertion proves a canary-bearing reason is redacted while the body still carries every numbered resume step.
4. The module header's closing sentence no longer instructs the operator to re-install the harness or run a `/verify` command.

### Task 2: Prove the dashboard reason and the merge invariant survive the rewrite
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/self-host/gate-halt.test.ts
**Dependencies:** 1

**Steps:**
1. Add a unit case asserting the caller's reason text appears in the written body ahead of the resume procedure, so the daemon dashboard's first-non-empty-line read still surfaces the gate reason.
2. Add a unit case asserting the ADR-005/ADR-010 daemon-never-merges sentence is still present after the rewrite.
3. Add a negative unit case passing an empty or whitespace-only reason, asserting the class sidecar still reads `needs-human` and the body still carries the complete resume procedure.
4. Verify the three cases pass against the rewritten writer without changing it further; if any fails, fix the writer rather than relaxing the assertion.
5. Run the repository's typecheck target that covers test files and commit the focused change.

**Done when:**
1. A unit assertion proves the caller's reason text precedes the resume procedure in the written body.
2. A unit assertion proves the ADR-005/ADR-010 daemon-never-merges sentence survives the rewrite.
3. A unit assertion proves an empty reason still produces a `needs-human` class sidecar and a body containing the resume procedure.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a self-host finish gate refuses with a reason, when the engine writes the self-host halt marker, then the printed resume procedure instructs the operator to run neither the harness installer nor a `/verify` command. | 1 | "A unit assertion proves the written halt body contains no harness-installer invocation and no `/verify` instruction." | diff-local |
| Story 1 happy: Given the same halt marker, when the operator follows the printed procedure in order, then it directs them to address the gate reason, clear the halt marker and its class sidecar, and merge the pull request themselves. | 1 | "A unit assertion proves the body's numbered steps name addressing the reason, clearing the halt marker and its class sidecar, and merging the pull request." | diff-local |
| Story 1 negative: Given a gate reason carrying a redactable safety token, when the engine writes the self-host halt marker, then the token is absent from the written body and the resume procedure still lists its full set of numbered steps. | 1 | "A unit assertion proves a canary-bearing reason is redacted while the body still carries every numbered resume step." | diff-local |
| Story 2 happy: Given a self-host gate halt is written, when a reader takes the body's first non-empty line, then it is the gate's own reason rather than any resume step or heading. | 2 | "A unit assertion proves the caller's reason text precedes the resume procedure in the written body." | diff-local |
| Story 2 happy: Given the same halt body, when the operator reads past the reason, then it still states that the daemon never merges under ADR-005/ADR-010 and that the operator performs the merge. | 2 | "A unit assertion proves the ADR-005/ADR-010 daemon-never-merges sentence survives the rewrite." | diff-local |
| Story 2 negative: Given a gate reason that is empty or whitespace only, when the engine writes the self-host halt marker, then the marker is still classified `needs-human` and the body still carries the complete resume procedure. | 2 | "A unit assertion proves an empty reason still produces a `needs-human` class sidecar and a body containing the resume procedure." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: the halt body is composed entirely inside the changed function from its own literal text and the caller's reason, so nothing outside this diff can change whether a criterion holds. Task 1 owns the rewritten procedure's assertions plus the redaction case; Task 2 owns the ordering, invariant, and empty-reason cases. Both live at the unit level in the writer's existing test file, which is the narrowest seam that owns the behavior. No new production boundary is crossed — the finish gates already call this writer through existing seams and are not edited — so no integration or acceptance test is added and no aggregate or external-service test is required. The marker module's own write-failure coverage remains authoritative for best-effort write behavior. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
