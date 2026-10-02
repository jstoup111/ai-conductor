**Status:** Accepted

# Stories: Finish-step completion becomes engine machinery

Technical track (no PRD) · Tier M · intake jstoup111/ai-conductor#499
Source of intent: `adr-2026-07-11-finish-step-engine-completion-machinery.md` (APPROVED)

---

## Story: Engine repairs a reused halt PR inside the finish step, before the gate reads it

**Requirement:** ADR D1

As the conductor engine, I want halt-PR presentation repair to run inside the finish
step's completion evaluation — order-gated after the non-presentation conditions pass —
so that a feature whose gates all passed ships on its first finish attempt while a
failing or refusing attempt never loses its halt-recovery signals.

*(Ordering revised by conflict-check 2026-07-11, operator-approved: single order-gated
invocation; no pre-dispatch repair.)*

### Acceptance Criteria

#### Happy Path
- Given a finish attempt on a reused halt PR (draft, `needs-remediation` label,
  `needs-remediation:` title) where the engine recorded `finish-choice`/`pr_url` and push
  evidence holds, when the completion predicate evaluates, then the engine repairs the PR
  (ready, label removed, `Closes <sourceRef>` present exactly once when a sourceRef
  exists) strictly BEFORE the presentation conditions are checked — and the gate passes
  on this same attempt.
- Given the repair runs again on a retry of the same attempt, when it executes on
  already-clean facets, then it is a no-op (idempotent — zero redundant mutations beyond
  re-reads).

#### Negative Paths
- Given a finish attempt whose non-presentation conditions do NOT all hold (missing
  `finish-choice`, missing `pr_url`, or push evidence false/null — including an agent
  refusal or an attempt heading to terminal halt), when the completion predicate
  evaluates, then the repair does NOT run and the PR's `needs-remediation` label, body
  marker, and draft state are untouched — the redispatch arm and reconciliation sweep
  keep their signals on every non-shipping outcome.
- Given gh is unavailable (spawn error or non-zero exit on every call) and the PR has no
  captured step-owned body region, when the repair runs, then it logs a warning, mutates
  nothing, and the finish step proceeds to the gate (warn-only — a gh outage never crashes
  or blocks the step).
- Given gh is unavailable and the PR has a captured step-owned body region, when the repair
  runs, then no ready-for-review call is issued and the run halts naming the region's step
  and the failed read (region verification is fail-closed).
- Given a never-halted PR (clean title, no `needs-remediation` label), when the repair
  runs, then no halt-facet mutation is attempted (no unlabel, no retitle, no halt-facet body
  edit) — detection stays title-prefix OR label, per adr-2026-07-05. Restoring a captured
  step-owned body region is not a halt-facet mutation.
- Given a clean-titled, unlabeled draft PR (the #199 early-draft shape), when the repair
  runs, then it is NOT classified as a halt PR (no unlabel/retitle), but the recorded PR is
  still flipped ready at finish (ship-readiness), and a verify-after-write re-read confirms
  the flip.
- Given a facet write succeeds but the verify-after-write re-read still shows the old
  state, when the repair runs, then it retries bounded and, on exhaustion, returns a
  non-fatal partial outcome that is logged — never thrown. A captured step-owned body region
  whose re-read still differs is the exception: the run halts naming the region's step and
  the PR stays draft.
- Given the daemon completes a feature run end-to-end, when the post-run tail executes,
  then it makes NO rehabilitation call — the in-step invocation is the single site
  (`daemon-cli.ts` tail call removed; no double execution).

### Done When
- [ ] A wiring test (not just the pure function) asserts the completion path invokes the
      repair only after the non-presentation conditions pass and strictly before the
      presentation checks, via a fake `GhRunner` recording call order — and asserts zero
      repair calls on an attempt failing recording or push evidence.
- [ ] A wiring test asserts `daemon-cli`'s post-run tail no longer invokes
      `rehabilitateHaltPr` (grep-level and/or fake-injection assertion).
- [ ] fakeGh unit tests cover: reused-halt repair full pass, gh-outage warn-only no-op,
      never-halted no-op, early-draft ready-flip-without-halt-classification, bounded
      verify-after-write retry exhaustion → partial outcome.
- [ ] Existing acceptance tests in `halt-pr-rehabilitation.acceptance.test.ts` still pass
      unchanged (pure-function semantics untouched).

---

## Story: Stale `needs-remediation:` title gets a deterministic retitle-floor

**Requirement:** ADR D2

As the conductor engine, I want a functional title floor applied when the halt prefix
survives to repair time so that the finish gate's title check cannot fail on a PR whose
prose rewrite the agent dropped.

### Acceptance Criteria

#### Happy Path
- Given a recorded PR titled `needs-remediation: …` at repair time and
  `state.feature_desc` present, when the repair runs, then the PR title becomes
  `feat: <feature_desc>` and the PR body is NOT modified by the floor.
- Given the same PR but `feature_desc` absent from state, when the repair runs, then the
  title floor derives from the branch name instead — never left with the
  `needs-remediation:` prefix.

#### Negative Paths
- Given a recorded PR whose title was already rewritten to prose (by `/pr` or by hand),
  when the repair runs, then the floor does NOT fire and the existing title is untouched
  (floor is prefix-gated, not unconditional).
- Given the retitle gh call fails, when the repair runs, then the failure is logged
  warn-only, nothing else is aborted, and the gate's own fail-open title read decides the
  outcome (a gh outage degrades to today's behavior, never a crash).
- Given the agent's `/pr` prose rewrite already cleared the prefix during the session,
  when the order-gated repair later runs, then the floor no-ops and the prose title ships
  (the floor never touches a non-halt title).

### Done When
- [ ] fakeGh unit tests cover: floor from `feature_desc`, fallback from branch, prefix-gated
      no-op on prose titles, warn-only on gh failure, body untouched in all cases.
- [ ] The floor title contains no `needs-remediation:` substring in any tested outcome.

---

## Story: Finish gate presentation branch is injectable and enforces ship-readiness (not draft)

**Requirement:** ADR D3

As the conductor engine, I want the finish completion predicate's PR read to use an
injected gh seam and to fail while the recorded PR is a draft so that draft features stop
shipping (#439) and the branch is finally testable (#368).

### Acceptance Criteria

#### Happy Path
- Given a completion check with an injected fake `GhRunner`, when the recorded PR is ready
  with a clean title, then the presentation branch passes — with zero real gh spawns
  (`AI_CONDUCTOR_NO_REAL_EXEC` safe).
- Given the recorded PR is still a draft (any title), when the completion predicate
  evaluates, then the finish step is not complete and the reason names the draft state.
- Given the recorded PR is ready but titled `needs-remediation: …`, when the predicate
  evaluates, then the step is not complete and the reason names the stale title (existing
  behavior preserved through the seam change).

#### Negative Paths
- Given the injected gh read throws or returns malformed JSON, when the predicate
  evaluates, then the presentation branch passes with a logged warning (fail-open — a gh
  outage never blocks an otherwise-shipped feature) while all non-presentation conditions
  still apply.
- Given no `pr_url` is recorded in state, when the predicate evaluates, then the
  presentation branch is never reached and no gh call is attempted (the gate already fails
  on the missing `pr_url` recording).
- Given no `GhRunner` is injected at a call site, when the predicate evaluates in
  production, then the production seam is used (composition-root default) — behavior
  identical to today's hardcoded path.

### Done When
- [ ] `artifacts.ts` finish predicate accepts an injected `GhRunner` (ctx pattern, like
      `isHeadPushed`); the hardcoded `makeProductionGh()` at the stale-title read is gone.
- [ ] Unit tests exercise the presentation branch through the seam: ready+clean pass,
      draft fail, stale-title fail, gh-error fail-open, no-pr_url short-circuit — the first
      tests ever to reference `readStaleHaltTitle` behavior through the gate.
- [ ] The draft check cites ship-readiness in its failure reason and never classifies the
      PR as a halt PR (no interaction with halt detection).

---

## Story: A recording-only completion miss resumes the engine coordinator

**Requirement:** adr-2026-08-01-engine-owned-resumable-finish-publication D3–D6; adr-2026-10-01-daemon-session-command-contracts D2.

As the conductor engine, I want a recording-only completion miss repaired through the existing publication coordinator so that no managed provider receives a blocked recording instruction.

### Acceptance Criteria

#### Happy Path
- Given publication evidence is coherent and final recording is absent, when FINISH retries, then the coordinator records and verifies the authorized outcome without a provider recording dispatch.
- Given an earlier publication effect is already verified, when the recording transition retries, then the verified effect is not repeated.

#### Negative Paths
- Given publication evidence is missing, stale, or inconsistent, when recovery runs, then it leaves completion unwritten and returns the existing typed FINISH disposition.
- Given no usable coordinator is available, when recording recovery is requested, then the path refuses explicitly without a fabricated marker or a provider recording instruction.
- Given recording fails repeatedly, when the existing publication allowance is exhausted, then the existing typed FINISH exhaustion result applies; recording failure alone never dispatches BUILD.
- Given a completion result lacks a recording facet, when FINISH evaluates recovery, then the coordinator observes authoritative state rather than guessing that recording alone is safe or requesting a full provider re-walk.

### Done When
- [ ] FINISH integration tests prove engine recorder ownership, verify-after-write, no provider recording dispatch, and no repeated verified effects.
- [ ] Missing-coordinator and invalid-evidence fixtures leave completion unwritten and return the appropriate typed disposition.
- [ ] Bounded failed-recording recovery does not route to BUILD solely for publication failure.

---

## Story: finish and pr SKILLs document engine behavior instead of producing it

**Requirement:** ADR D5

As a skill author, I want the presentation mechanics described as engine behavior in both
SKILLs so that agents stop being responsible for mechanics the engine performs, and the
finish/pr contradiction over draft-flip ownership is resolved.

### Acceptance Criteria

#### Happy Path
- Given the updated `skills/finish/SKILL.md`, when its rehabilitation/completion sections
  are read, then undraft, unlabel, and `Closes`-injection are described as engine-performed
  (with the agent's remaining duties limited to the prose title/body rewrite via `/pr` and
  no final-recording action).
- Given the updated `skills/pr/SKILL.md`, when its reused-halt-PR section is read, then its
  description of engine-owned mechanics matches `finish/SKILL.md` exactly (no ownership
  contradiction remains).

#### Negative Paths
- Given the updated finish SKILL checklist, when grepped, then no item instructs the agent
  to run `gh pr ready` or to remove the `needs-remediation` label itself (the former
  `finish/SKILL.md:373` instruction class is gone).
- Given the harness validation suite (`test/test_harness_integrity.sh`), when run after the
  SKILL edits, then it passes (frontmatter, cross-references, model table untouched or
  regenerated).
- Given a managed FINISH instruction, when recording ownership is described, then it assigns final recording to the engine coordinator under adr-2026-08-01 D3–D6 and never directs the marked provider to invoke finish-record.

### Done When
- [ ] Both SKILL.md files updated; a grep test (or documented manual check in the PR)
      confirms no agent-instruction for draft flip/label removal remains in either.
- [ ] `test/test_harness_integrity.sh` passes.
- [ ] CHANGELOG `[Unreleased]` documents the SKILL contract change.
