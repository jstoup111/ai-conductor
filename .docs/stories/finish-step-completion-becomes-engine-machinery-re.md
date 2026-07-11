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
  `needs-remediation:` title) where the agent recorded `finish-choice`/`pr_url` and push
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
- Given gh is unavailable (spawn error or non-zero exit on every call), when the repair
  runs, then it logs a warning, mutates nothing, and the finish step proceeds to the gate
  (warn-only — a gh outage never crashes or blocks the step).
- Given a never-halted PR (clean title, no `needs-remediation` label), when the repair
  runs, then no halt-facet mutation is attempted (no unlabel, no retitle, no body edit) —
  detection stays title-prefix OR label, per adr-2026-07-05.
- Given a clean-titled, unlabeled draft PR (the #199 early-draft shape), when the repair
  runs, then it is NOT classified as a halt PR (no unlabel/retitle), but the recorded PR is
  still flipped ready at finish (ship-readiness), and a verify-after-write re-read confirms
  the flip.
- Given a facet write succeeds but the verify-after-write re-read still shows the old
  state, when the repair runs, then it retries bounded and, on exhaustion, returns a
  non-fatal partial outcome that is logged — never thrown.
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

## Story: A recording-only completion miss triggers a surgical retry, not a full re-walk

**Requirement:** ADR D4

As the conductor engine, I want a completion miss whose only gap is `finish-choice`/`pr_url`
recording to re-dispatch a single-command prompt so that the residual recording-miss class
costs one narrow dispatch instead of a ~10-minute finish re-walk.

### Acceptance Criteria

#### Happy Path
- Given a finish attempt where push evidence, PR presentation, and all other gate
  conditions verifiably held but `.pipeline/finish-choice` is absent, when the engine
  retries, then the dispatched prompt is the narrow finish-record instruction carrying the
  exact `conduct-ts finish-record` command line with the computed absolute
  `--pipeline-dir` — not the full `/finish` skill walk.
- Given the surgical retry's agent runs the named command and it exits 0, when the
  completion predicate re-evaluates, then the step completes on that retry.

#### Negative Paths
- Given the completion miss includes ANY non-recording gap (push evidence false/null,
  stale title, draft PR), when the engine retries, then the retry is the full finish
  re-walk — the recording-only classification requires every other condition to have held
  (misclassification guard).
- Given the agent refused to record (no PR exists or head not pushed), when the surgical
  retry runs the fail-closed `finish-record`, then the CLI refuses with zero writes and the
  step still does not complete — the refusal signal of adr-2026-07-07 is preserved; the
  engine never writes the marker itself.
- Given surgical retries repeat, when the step's bounded retry budget is exhausted, then
  the existing exhaustion path (recovery/HALT) triggers exactly as today — surgical retries
  are not free and cannot loop unbounded.
- Given an older completion-check result without a facet code, when the engine builds the
  retry, then it defaults to the full re-walk (absent code never classifies as
  recording-only).

### Done When
- [ ] The finish predicate result carries a machine-readable facet code; classification is
      computed engine-side (no string-matching on human-readable reasons) and unit-tested
      for: recording-only, mixed-gap, no-code-default cases.
- [ ] A unit test asserts the surgical prompt contains the absolute `--pipeline-dir` and
      the `finish-record` command, and that mixed-gap misses receive the standard retry
      prompt instead.
- [ ] A real-binary smoke test drives the surgical path end-to-end (injected-runner lesson,
      PR #143): fake agent leaves recording absent with all evidence satisfiable → surgical
      retry prompt issued → running the named command completes the step.
- [ ] Retry accounting: surgical retries decrement the same per-step budget (asserted).

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
  the `finish-record` exit contract).
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
- Given the `finish-record` auto-mode exit contract (adr-2026-07-07 D5), when the finish
  SKILL is read, then that contract is still an agent instruction — documentation-ization
  applies only to presentation mechanics, not to decision recording.

### Done When
- [ ] Both SKILL.md files updated; a grep test (or documented manual check in the PR)
      confirms no agent-instruction for draft flip/label removal remains in either.
- [ ] `test/test_harness_integrity.sh` passes.
- [ ] CHANGELOG `[Unreleased]` documents the SKILL contract change.
