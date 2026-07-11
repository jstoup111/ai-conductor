# Architecture Review: Finish-step completion becomes engine machinery
**Date:** 2026-07-11
**Feature:** intake jstoup111/ai-conductor#499 · technical track · Tier M (lightweight review)
**Input reviewed:** approved explore decision (Approach B), operator-approved diagrams
(`.docs/architecture/finish-step-completion-becomes-engine-machinery-re.md` + sequence)
**Verdict:** APPROVED

## Feasibility

- **In-step repair relocation** — verified feasible: `rehabilitateHaltPr` already takes
  an injected `GhRunner` (`halt-pr-rehabilitation.ts:34-40`); the finish step dispatch
  site (`conductor.ts:1560-1571`) and the completion-check site (`conductor.ts:1805-1811`)
  bracket exactly the two insertion points; the daemon-tail call to remove is a single
  site (`daemon-cli.ts:784-800`). Confidence 95% (verified code map).
- **Retitle-floor source** — verified: `ConductState.feature_desc` and
  `worktree_branch` exist (`types/state.ts:28,49`). Confidence 97%.
- **Gate seam injection** — verified: the predicate already receives a `ctx` carrying
  optional injectables (`isHeadPushed` precedent, `artifacts.ts:1172-1199`); adding an
  optional `GhRunner` follows the same pattern, production default at composition root.
  The `fakeGh` test pattern exists (`test/engine/pr-labels.test.ts:37-50`). Confidence 95%.
- **Surgical retry** — feasible: retry hints already flow from completion misses
  (`conductor.ts:1853-1855`); extending the predicate result with a facet code is an
  internal type change; the auto-mode prompt already computes the absolute
  `--pipeline-dir` (`step-runners.ts:840-867`). Confidence 90% (inferred from verified
  retry-path structure; exact prompt-swap mechanics resolved at plan time).
- **No new stack, services, schema, or worktree-isolation surface.** All gh access stays
  behind the existing seam; tests need no network.

## Alignment

- **Deterministic-first (CLAUDE.md):** canonical application — machinery repairs at the
  moment of the detectable mistake; prompts carry only judgement (prose rewrite, ship
  decision). Precedents #477/#433 followed (SKILL becomes documentation, D5).
- **adr-2026-07-03:** amended, not violated — Decision 2's placement (daemon tail) and
  Decision 1's skill-only presentation get a floor; detection stays stateless, warn-only
  posture and fail-open gate reads retained.
- **adr-2026-07-07:** fully preserved — no engine auto-record; `finish-record` remains
  the sole marker writer and the refusal signal; the surgical retry ends in the same
  fail-closed CLI.
- **adr-2026-07-05:** fully preserved — draft-alone never classifies a halt PR; the new
  gate isDraft check is ship-readiness on the feature's own recorded PR; D5
  verify-after-write travels with the relocated call; birth side + reconciliation sweep
  untouched.
- **Injected-runner lesson (PR #143) and #368 lesson:** wiring tests + real-binary smoke
  are explicit testing obligations in the ADR.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Relocated rehab silently not invoked (repeat of #368: pure fn tested, wiring not) | Technical | Medium | High | Explicit wiring test asserting in-step invocation + tail removal; as-built reachability sweep |
| Retitle-floor fires on a PR the agent was mid-rewriting (race) | Integration | Low | Low | Floor only fires when prefix still present at repair time; idempotent; `/pr` overwrites |
| Gate isDraft check blocks a legitimately-draft ship | Integration | Low | Medium | Repair readies the recorded PR pre-gate; check is fail-open on gh errors |
| Surgical retry misclassifies a genuine refusal as recording-only | Data | Low | High | Facet code computed only when ALL other conditions verifiably held; fail-closed CLI re-verifies evidence |

## ADRs Created

- `adr-2026-07-11-finish-step-engine-completion-machinery.md` (Status: APPROVED,
  operator-confirmed 2026-07-11; amends adr-2026-07-03 Decisions 1–2).

## Conditions

None. (High-impact risks above are mitigated by the ADR's explicit testing obligations.)
