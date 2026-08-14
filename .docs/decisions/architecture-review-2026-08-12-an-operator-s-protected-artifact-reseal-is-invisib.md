# Architecture Review: Operator reseal as a third build_review Scope evidence channel

**Date:** 2026-08-12
**Track:** Technical
**Tier:** M — lightweight mode (Sections 2 and 4 only; complexity already assessed, domain
integrity delegated to the TDD domain reviewer)
**Design reviewed:** `.docs/architecture/an-operator-s-protected-artifact-reseal-is-invisib.md`
**Stories reviewed:** none — this review runs BEFORE `/stories`
(`adr-2026-06-29-architecture-before-stories-convergent-kickback`)
**Source:** intake `jstoup111/ai-conductor#1502`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. One new optional interface field, one reader function, one rendered prompt section. |
| **Prerequisites** | None. Every input already exists on disk: `resealProtectedArtifactSeal` has written `rebaselines[]` with `trigger`, `paths`, verbatim `reason`, and `fromCommit`/`toCommit` since `adr-2026-08-09-operator-only-scoped-artifact-reseal` shipped. |
| **Integration surface** | Three files in one module: `build-review-inputs.ts` (assembly), `build-review-prompt.ts` (rendering), and a read of `protected-artifact-seal.ts`'s persisted shape. No module boundary is crossed that the two existing evidence channels do not already cross. |
| **Data implications** | None. No schema change, no migration, no new persisted artifact. The seal's on-disk shape is read, never written. Version-1 seals normalize `rebaselines` to `[]` at parse (`protected-artifact-seal.ts:411`), so old seals degrade to an empty channel rather than failing. |
| **Performance risk** | One additional small JSON read per `build_review` dispatch, in a step that already runs a full LLM grade. Negligible. |
| **Worktree isolation** | Preserved. The seal is per-worktree at `.worktrees/«slug»/.pipeline/protected-artifact-seal.json`; no shared state, port, or path is introduced. |

**Feasibility risk of note:** input assembly must not throw on a missing or malformed seal. A
feature that never entered BUILD has no seal at all. The design commits to degrading to an empty
channel (ADR D4), matching how `repairContext` already resolves to `[]` when the plan is not in a
feature root (`build-review-inputs.ts`).

## Alignment

**Against `adr-2026-07-07-build-review-judgement-gate` (grader input isolation) — the load-bearing
check.** This is the one decision that could have blocked the design, and it clears.

The isolation constraint is not "the grader reads only the diff and the plan"; it is that the maker
session's transcript, summary, and `.pipeline/task-status.json` narrative are never passed. The ADR
admits the plan on an explicit stated ground: it is "an operator-approved DECIDE artifact, not maker
self-report, so it does not breach isolation" (lines 43-44). The reseal record satisfies that same
predicate, and does so structurally rather than by convention — `dispatchResealCommand` refuses
unless `process.stdin.isTTY === true`, with an in-code comment establishing that autonomous provider
subprocesses always observe `false`. A maker session cannot invoke `reseal`, so it cannot
manufacture its own authorization. Confidence 95%, verified from `reseal-cli.ts`.

**Pattern consistency.** The design introduces no new pattern. It is the third instance of an
established one: engine-recorded rebase repair context and engine-accepted scope widenings both
reach the same prompt as judged evidence with the same "evidence, not exemption" framing
(`build-review-prompt.ts:103-119`). Rendering is constructed identically to
`renderedAcceptedWidenings` (`:32-36`), including the `(none)` empty case.

**Against the event spine.** Ran the `event-spine` decision procedure. Verdict: not a channel at
all — no watcher, poller, sidecar, bespoke log, second ledger, IPC path, or artifact-stamped
timestamp. An existing durable-state artifact gains a reader. Sourcing from the
`protected_artifact_reseal` event instead was considered and rejected under §4-C (durable state,
read by name; do not reconstruct state from occurrences), and because the seal is already the
authority the write-guard consults — a second derivation would fork that authority.

**Against `CLAUDE.md`'s "deterministic where possible" principle.** Worth stating honestly: this
design deliberately routes a decision through LLM judgement when a deterministic option existed
(Option B, hunk exclusion). That is not a violation of the principle but an application of its
limit — the required behavior is *judging whether a rationale justifies an amendment*, which is
irreducibly a judgement. The deterministic parts are kept deterministic: which paths get rendered,
and which triggers qualify, are both computed in engine code, not asked of the grader.

**State management.** No new state, no boolean flags, no representable invalid state. The trigger
discriminant is an existing string field with exactly three known values.

**Security boundaries.** One real consideration: the operator's `reason` is free text that reaches
an LLM prompt verbatim. It is operator-authored and reachable only from an interactive TTY, so it
is not an untrusted-input surface in the ordinary sense. The mitigation is framing — the section
presents the rationale as a claim to be judged, matching the accepted-widenings section, so the
grader is never told to obey it.

**Production DI defaults.** Not applicable — no DI registration, no in-memory store.

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| `readOperatorReseals` (new exported reader over the seal's `rebaselines[]`) | Called from `assembleBuildReviewInputs` in `build-review-inputs.ts`, which is itself invoked by the `build_review` step runner at `step-runners.ts:1718`. |
| `BuildReviewInputs.operatorReseals` (new optional field) | Populated by `assembleBuildReviewInputs`; consumed by `buildGraderPrompt` (`step-runners.ts:1838`). |
| The rendered "Operator-authorized protected-artifact reseals" prompt section | Emitted by `buildGraderPrompt`, whose output is the dispatched grader session's prompt — the same path the two existing evidence sections already travel. |

No new CLI subcommand, config key, hook, event variant, or scheduled job is introduced, so there is
no other entry point to wire.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Grader treats the new section as a blanket exemption and stops judging resealed hunks at all | Technical | Medium | Medium | Copy the accepted-widenings framing exactly ("evidence, not exemptions... Judge whether each rationale actually justifies..."); regression coverage asserts an unjustified reseal still fails Scope |
| Malformed or absent seal throws during input assembly, converting a Scope kickback into a hard step failure | Technical | Low | High | ADR D4: degrade to an empty channel; explicit coverage for missing, unparseable, and version-1 seals |
| Machinery rotations (`proactive-rebase`, `defensive-history-rewrite`) leak into the rendered section and read as authorization | Technical | Low | High | Filter on the literal `operator-reseal`; all three trigger values enumerated and verified; regression coverage asserts machinery triggers never render |
| Prompt growth degrades grader judgement on long-lived, repeatedly-resealed features | Technical | Low | Low | Accepted. Rendering is bounded by operator actions, which are interactive and rare |
| Merge contention with PR #1526 (`repeated-build-review-semantic-failures-can-churn-`) | Integration | Medium | Low | Different seams: #1526 changes the kickback ledger and conductor halt path; this changes prompt assembly. Complementary in effect — see below |

**Concurrency note.** `adr-2026-08-12-cumulative-build-review-convergence-bound` (merged spec,
#1523; PR #1526 open) gives `build_review` a cumulative lap bound that halts at 5. It bounds the
*churn* #1502 describes; this feature removes one systematic *cause* of it. They compose, and
neither depends on the other. `conduct-ts overlap-scan` over the three candidate paths returned
every unmerged spec branch for `build-review-inputs.ts`, which is near-certainly a scan artifact
(spec branches touch only `.docs/`) rather than real contention; the note is recorded because the
scan is advisory and its output should not be read as signal it cannot carry.

## ADRs Created

`adr-2026-08-12-operator-reseal-as-second-scope-justification.md` — **APPROVED**.

> **Amended 2026-08-12 during conflict-check.** This review originally concluded that no ADR was
> warranted, on the reasoning that the design is the third instance of an established pattern
> governed by a decision that already exists. That reasoning was sound but the evidence was
> incomplete. `/conflict-check` then found a blocking contradiction (C1 in
> `.docs/conflicts/an-operator-s-protected-artifact-reseal-is-invisib.md`): decision 3 of the
> APPROVED `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` names the approved
> plan as the *only* admissible Scope justification for a protected-artifact edit. Adding a second
> admissible source is a genuine architectural decision and cannot be made silently against an
> APPROVED ADR. The original conclusion is preserved above the line for the record; the ADR is the
> operative outcome.

`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` is **extended, not superseded**:
it keeps `Status: APPROVED`, its decisions 1 and 2 remain in force untouched, and an additive
amendment note beside decision 3 points at the new ADR. The corresponding assertion in Story 3 of
`.docs/stories/2026-07-27-protected-artifact-seal-self-amendment-1047.md` carries the same additive
note. Both originals are preserved verbatim.

Beyond that one decision, the design remains the third instance of an established pattern — the
alignment analysis above is unchanged, and no other ADR is warranted or superseded.

The options weighed and rejected are recorded here instead, since they are the part a future reader
would actually want:

### Chosen: third judged evidence channel

Read the seal's `operator-reseal` rebaselines during input assembly, thread them as a new optional
`operatorReseals` field on `BuildReviewInputs`, and render an "Operator-authorized
protected-artifact reseals" section beside the two existing ones. Only `trigger === 'operator-reseal'`
qualifies — the other two values repo-wide, `defensive-history-rewrite`
(`protected-artifact-seal.ts:1008`) and `proactive-rebase` (`rebase-translate.ts:470`), are
machinery rotations carrying no operator rationale, and rendering them would read as blanket
authorization.

### Rejected: deterministic hunk exclusion

Strip hunks touching resealed paths from the diff before the grader sees it — the
`MACHINERY_AUTHORED_PATHS` pattern. Deterministic and drift-proof, and it aligns with `CLAUDE.md`'s
"machinery over prompt discipline" principle. **Disqualifying:** it makes an unjustified reseal
unfailable, directly contradicting #1502's third desired outcome, and it blinds the Tautology and
Completeness rubrics to real content in those files. A reseal would become the blanket exemption the
two existing channels were carefully designed not to be.

This is the one place the design knowingly routes a decision through LLM judgement when a
deterministic option existed. That is an application of the principle's limit rather than a
violation of it: the required behavior is *judging whether a rationale justifies an amendment*,
which is irreducibly judgement. The deterministic parts stay deterministic — which paths render, and
which triggers qualify, are both computed in engine code, never asked of the grader.

### Rejected: event-sourced derivation

Source the evidence from the `protected_artifact_reseal` event that `reseal-cli.ts` already emits
(`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`). Rejected under event-spine §4-C: the
grader's question is durable state — "which paths are authorized right now, on what rationale" — not
"what happened, when". The seal is already the authority the write-guard consults; a second
derivation would fork that authority across two reader paths. The event remains the audit record of
the act.

### Degradation contract

A missing, unparseable, or version-1 seal yields an empty channel and the prompt renders `(none)`,
matching how `repairContext` already degrades. Input assembly must never throw on a feature that has
not entered BUILD.

## Conditions

None. Clean APPROVED.
