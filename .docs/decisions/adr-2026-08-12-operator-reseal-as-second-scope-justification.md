# ADR: An operator reseal is a second admissible Scope justification

**Date:** 2026-08-12
**Status:** APPROVED
**Deciders:** James Stoup (operator), DECIDE for intake `jstoup111/ai-conductor#1502`
**Amends:** `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` (decision 3 only;
that ADR's decisions 1 and 2 remain in force and it remains APPROVED)
**Refs:** `jstoup111/ai-conductor#1502`, observed on #1223

## Context

`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` decided that `build_review`'s
Scope rubric would carry an explicit sub-rule: a diff modifying an approved DECIDE artifact under
`.docs/architecture|plans|specs|stories/` "must be justified by the approved plan; an unjustified
self-amendment is a Scope FAIL." That shipped, and it is the rule the grader applies today
(`build-review-prompt.ts:49`).

It names exactly one admissible justification, and that set turns out to be too narrow by
construction.

`conduct-ts reseal` — landed later, by `adr-2026-08-09-operator-only-scoped-artifact-reseal` — is
the audited way an operator authorizes a DECIDE-artifact amendment committed **after** BUILD entry.
No plan approved before BUILD can ever carry that authorization. So a resealed amendment
permanently fails the sub-rule, and the feature cannot leave `needs-human`.

Observed terminal on `interrupted-self-host-runs-leak-provider-homes-unt` (#1223): three
consecutive dispatches on 2026-08-11 produced zero commits, each spending a full `build_review`
grade plus a `remediate` pass before halting, leaving six specified remediation tasks never
attempted. The operator's only remaining moves were to revert the authorized amendment — which
reintroduces the story contradiction the amendment exists to resolve — or to abandon the harness.
**Every reseal is exposed:** the command's entire purpose is authorizing precisely the shape the
sub-rule rejects.

The grader was not malfunctioning. It was correctly applying decision 3 as written.

### Forces

- The plan-only rule is *right for its case*. An unjustified self-amendment by a build agent must
  still fail — that is what `adr-2026-07-27` exists to catch, and this ADR does not weaken it.
- Grader input isolation (`adr-2026-07-07-build-review-judgement-gate`) is a hard constraint, but
  its predicate is about **maker self-report**; that ADR admits the plan on the stated ground that
  it is "an operator-approved DECIDE artifact, not maker self-report, so it does not breach
  isolation" (lines 43-44).
- Two evidence channels already reach the Scope rubric under that same reading — engine-recorded
  rebase repair context and engine-accepted scope widenings (`build-review-prompt.ts:103-119`) —
  and both are framed as "evidence, not an exemption".
- A reseal must remain **falsifiable**. An operator whose rationale does not justify the amendment
  should still be told so; an authorization channel that cannot fail is an exemption, not evidence.

## Options Considered

### Option A: Extend decision 3 with a second justification source — CHOSEN
Add "or by an operator reseal covering that path, judged against its recorded rationale" alongside
the approved plan. Surface the reseal to the grader as a third evidence section built like the two
existing ones.

- **Pros:** Preserves the plan-only rule for the case it was written for. Structurally identical to
  two shipped precedents. Keeps the reseal falsifiable. `adr-2026-07-27`'s decisions 1 and 2 stay
  in force untouched.
- **Cons:** The Scope rubric now has two admissible justification sources, so the grader's
  judgement surface grows.

### Option B: Deterministic hunk exclusion
Strip hunks touching resealed paths from the diff before the grader sees it — the
`MACHINERY_AUTHORED_PATHS` pattern.

- **Pros:** Deterministic and drift-proof; aligns with `CLAUDE.md`'s "machinery over prompt
  discipline" principle.
- **Cons:** **Disqualifying.** It converts a reseal into a blanket exemption an operator cannot get
  wrong, contradicting #1502's third desired outcome, and it blinds the Tautology and Completeness
  rubrics to real content in those files.

### Option C: Fully supersede `adr-2026-07-27`
Mark it SUPERSEDED and restate all three decisions with decision 3 widened.

- **Cons:** Discards two decisions (the `inspectSeal` content tolerance, the non-fatal advisory)
  that are still correct and in force. Restating them verbatim in a new ADR invites drift for no
  gain.

### Option D: Narrow the channel to `.docs/stories/` only
Leave the plan-only rule intact for the other three protected directories.

- **Cons:** Arbitrary. `reseal --path` accepts any protected path, so this leaves the identical
  halt-forever behavior for `.docs/plans|specs|architecture/` and splits the rule on no principle.

### Option E: Source the evidence from the `protected_artifact_reseal` event
`reseal-cli.ts` already emits it (`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`).

- **Cons:** Rejected under event-spine §4-C. The grader's question is durable state — "which paths
  are authorized right now, on what rationale" — not "what happened, when". The seal is already the
  authority the write-guard consults; a second derivation forks that authority across two reader
  paths.

## Decision

**An operator reseal is a second admissible justification under the Scope rubric's DECIDE-artifact
sub-rule, reaching the grader as judged evidence.**

### D1 — Decision 3 of `adr-2026-07-27` is extended, not replaced

The sub-rule now reads, in effect: a diff modifying an approved DECIDE artifact under
`.docs/architecture|plans|specs|stories/` must be justified **either by the approved plan, or by an
operator reseal covering that path** — and in the reseal case, judged against the rationale the
operator recorded. An amendment justified by neither remains a Scope FAIL, exactly as before.

`adr-2026-07-27` keeps `Status: APPROVED`. Its decisions 1 and 2 are untouched. An additive
amendment note beside its decision 3 points here; the original text is preserved verbatim.

### D2 — Source: the seal's `operator-reseal` rebaselines, and only those

Input assembly reads `.pipeline/protected-artifact-seal.json` and filters `rebaselines[]` to
`trigger === 'operator-reseal'`. Exactly three trigger values exist repo-wide; the other two,
`defensive-history-rewrite` (`protected-artifact-seal.ts:1008`) and `proactive-rebase`
(`rebase-translate.ts:470`), are machinery rotations carrying no operator rationale. Rendering them
would read as blanket authorization, so they are excluded.

This introduces no new file, ledger, event variant, watcher, or stamped timestamp — an existing
durable-state artifact gains a reader. Per `adr-2026-07-26-protected-artifact-seal-rebaseline`, that
record already carries `paths`, the verbatim `reason`, and the `fromCommit`/`toCommit` range.

### D3 — Isolation is not breached, and the maker cannot forge this evidence

The reseal record qualifies under `adr-2026-07-07`'s stated ground for admitting the plan: it is
operator-authored, not maker self-report. This is structurally guaranteed, not merely asserted —
`dispatchResealCommand` refuses unless `process.stdin.isTTY === true`, and the code carries an
explicit comment establishing that autonomous provider subprocesses (Claude and Codex alike) always
observe `false`. A maker session cannot invoke `reseal`, so it cannot manufacture its own
authorization.

### D4 — Evidence, never exemption

The rendered section adopts the accepted-widenings framing: the rationale is an operator **claim to
be judged**, never an instruction to obey. Consequently — a reseal whose stated reason does not
justify the amendment still fails Scope; a reseal of paths A and B renders only A and B, so an
unrelated post-BUILD edit to C is judged exactly as it is today; and the other four rubric items are
unchanged for resealed paths.

### D5 — Degrade quietly, never fail input assembly

A missing, unparseable, or version-1 seal yields an empty channel rendering `(none)`, matching how
`repairContext` already degrades. Adding this channel must never convert a Scope kickback into a
hard step failure.

## Consequences

### Positive
- Every reseal becomes effective. #1223 reaches BUILD and attempts its six remediation tasks.
- The operator's rationale becomes visible at the point of judgement instead of dying in a file.
- The plan-only rule survives intact for the case it was written for: an unjustified build-agent
  self-amendment still fails Scope.
- Reseal evidence survives rebases. `rebaselines[]` is append-only —
  `persistProtectedArtifactSealRotation` spreads `...seal.rebaselines` (`:1157-1158`) and
  `createProtectedArtifactSeal` returns any existing seal unchanged (`:1066`) — so no SHA-anchored
  citation can orphan.
- Composes with `adr-2026-08-12-cumulative-build-review-convergence-bound`: that bounds
  non-convergent churn with a terminal state, this removes a systematic cause of it.

### Negative
- The Scope rubric carries two admissible justification sources rather than one; the prompt grows a
  third evidence section and the grader's judgement surface grows with it.
- Enforcement of "judge the rationale" is LLM judgement, not machinery. A grader may fail a
  well-justified reseal or accept a weak one. This is the accepted cost of keeping the reseal
  falsifiable — Option B's determinism was available and was rejected for exactly that trade.
- The repository's smoke-only test policy means the grader's *judgement* cannot be asserted in the
  default suite. Deterministic coverage targets prompt assembly, which is where #1502's defect
  actually lives; judgement scenarios are opt-in smoke tests.
- Reseal evidence accumulates for the life of a feature, so a repeatedly-resealed feature renders a
  correspondingly long section.

### Follow-up Actions
- [ ] Regression coverage in both directions: a diff amending a resealed DECIDE artifact passes
      Scope, and the identical diff without the reseal still fails it.
- [ ] Coverage that a reseal of A and B does not license an unrelated post-BUILD edit to C.
- [ ] Coverage that machinery triggers never render.
- [ ] Unpark and re-dispatch `interrupted-self-host-runs-leak-provider-homes-unt` (#1223) once this
      ships; clear its kickback ledger so the cumulative bound does not halt it on laps this defect
      caused.
- [ ] Out of scope, possibly its own ticket: #1502's Notes report no `protected_artifact_reseal`
      record in the worktree's `.pipeline/events.jsonl`. The event *is* emitted through
      `AuditTrailWriter`; confirm whether the operator read a different sink or a real gap exists.
