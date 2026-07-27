# Architecture Review: DECIDE-phase coherence ownership at the daemon boundary (#971)

**Date:** 2026-07-26
**Tier:** M (lightweight review)
**Track:** technical
**Verdict:** **APPROVED** — proceed to `/stories`
**ADR produced:** `adr-2026-07-26-daemon-decide-preseed-ownership.md` (Status: APPROVED)

## What was reviewed

The direction recorded in the track artifact (approaches B + C) and formalised as decisions
D1–D4 in the ADR: derive the daemon preseed set from the step table, stamp preseeded steps with
a tier-correct status, reject a missing/invalid required coherence artifact at daemon discovery,
and keep deep validation at land.

## Feasibility

| Decision | Feasible? | Basis | Confidence |
|---|---|---|---|
| D1 derive preseed from `ALL_STEPS` | Yes | `ALL_STEPS` already exported (`steps.ts:4`); `StepDefinition.phase` already present (`types/steps.ts:50-56`). No new plumbing. | verified, 100% |
| D2 tier-correct stamp | Yes | `skippableForTiers` already on every definition; the daemon already resolves `complexity_tier` before stamping (`daemon-cli.ts:887` runs adjacent to the stamping loop `:882-886`). | verified, 95% |
| D3 discovery rejection | Yes | The vetting loop exists (`daemon-backlog.ts:655-673`), the `warnOnce` channel exists (`daemon-deps.ts:70`), and the tier is resolved in the same loop (`:771`). Two structurally identical checks already ship there. | verified, 100% |
| D4 shallow-at-discovery / deep-at-land | Yes | Discovery reads the base tree via `tree.readFile` with no change set; the deep validator requires one. | verified, 90% |

**Ordering constraint identified.** D2 requires the resolved tier at stamping time. Today
`daemon-cli.ts:887` sets `complexity_tier` *after* the `PRESEEDED_DONE` loop at `:882-886`.
The tier resolution must therefore be hoisted above the stamping loop. This is a real
implementation hazard — writing D2 against the current ordering yields a silently wrong stamp
for every S-tier spec (the tier would read as `undefined`, and `conductor.ts:2549` defaults an
absent tier to `'L'`, i.e. "not skippable"). Flagged to `/plan` as an explicit ordered task.

**Second ordering constraint.** D3 needs the tier before the vetting checks, but the tier is
currently parsed at `:771`, *after* the vetting block at `:655-673`. The tier read must be
hoisted within the loop body. Both hoists are local to their functions and carry no cross-module
coupling.

## Alignment with approved decisions

- **Design Principle (CLAUDE.md), "deterministic where possible; LLM only where necessary."**
  D1 is a direct application — it replaces a hand-maintained constant whose drift caused this
  defect with a derivation that cannot drift. Strongly aligned.
- **HARNESS.md SDLC phase table.** `coherence-check` is listed under DECIDE. D1 makes the code
  agree with the documented phase table; today it disagrees.
- **HARNESS.md "Design-conformance before effort."** The daemon executing a DECIDE step is a
  conformance violation against the documented phase boundary, which this closes.
- **No conflict found** with `adr-2026-07-06-migration-gate-waiver` or the release gates: this
  change touches neither `bin/conduct` CLI, hook wiring, skill symlink targets, nor
  `settings.json` schema. A migration block is not expected to be required.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | D3 warn-skips merged specs that build fine today but carry no coherence artifact, silently shrinking the live backlog | **High** | Plan must include an explicit pre-landing survey task enumerating affected merged specs on the default branch, and the warn message must name the exact remedy. `warnOnce` already logs once per slug rather than every poll. |
| R2 | D2 changes recorded state values (`'done'` → `'skipped'`) for three steps beyond `coherence_check` | Medium | `shouldSkipForUpstreamSkip` (`steps.ts:465-475`) is the known consumer and no step declares `skipWhenSkipped` for any of the four. Plan must include a grep-level audit of literal `'done'` comparisons on those step names. |
| R3 | Inverting the assertion at `audit-trail-daemon-wiring.integration.test.ts:118-121` could mask a genuine regression if done carelessly | Medium | The replacement must assert both directions: `coherence_check` is absent from `stepsRun` **and** the first executed step is `acceptance_specs`. A bare `.not.toContain` would also pass if the run executed nothing at all. |
| R4 | The hand-copied `DAEMON_PRESEEDED_DONE` in the test drifts from the derived production set | Medium | The new sync test should assert against the *production* export, and the test's local copy should be replaced by an import rather than updated. |
| R5 | A spec whose plan stem differs from its coherence stem passes discovery's shallow check but was already rejected at land | Low | Accepted. Discovery is a backstop, not a re-implementation (D4). |

## Assumptions surfaced (verify-claims)

| # | Assumption | Confidence | Impact if wrong | How to confirm |
|---|---|---|---|---|
| A1 | The daemon's preseed loop and the tier resolution can be reordered without disturbing resume semantics for in-flight features | inferred, 85% | An incorrect stamp on resume for existing features | Read `daemon-cli.ts:865-900` in full during BUILD before editing; covered by an explicit plan task |
| A2 | No consumer outside `shouldSkipForUpstreamSkip` branches on the literal `'done'` for the four tier-skippable DECIDE steps | inferred, 80% | D2 causes a silent behavior change elsewhere | `grep -rn "=== 'done'"` scoped to the engine — made an explicit plan task (R2) |
| A3 | Warn-skipping non-conforming merged specs is the operator's intent, accepting that some currently-buildable specs stop building | inferred, 75% | The live backlog shrinks unexpectedly | **Not load-bearing for authoring** — it is the issue's own stated outcome 3 ("rejected before BUILD begins"). The survey task (R1) makes the blast radius visible before it lands rather than after. |
| A4 | `priority: critical` / `size: S` are the operator's labels and the bot's `medium`/`M` are unparsable-field defaults | **verified, 99%** | Wrong tier selection | Confirmed: issue timeline (human 14:55:59–14:56:00, bot 14:56:18–14:56:19) plus `intake-label-sync.yml:13` and `intake-label-sync-apply.mts:33-51` |
| A5 | Tier M is the correct classification despite the `size: S` label | inferred, 80% | An over-heavy DECIDE pass (superset of artifacts, nothing missing) | Flagged to the operator in the complexity artifact. The `size:` label does not feed the build tier (`daemon-backlog.ts:771`), so there is no machinery conflict. M is the conservative direction. |

**No HARD-BLOCK raised.** Every assumption that would change a requirement, schema, or code
behavior if wrong (A1, A2) is resolved into an explicit verification task in the plan rather than
being carried silently into implementation. A3 restates the issue's own stated outcome rather than
substituting a guess for it. A4 is verified. A5 is a divergence from an operator label, is
flagged in writing, and is conservative by construction (it produces a superset of artifacts), so
it cannot cause under-delivery.

## Conditions on approval

1. `/plan` MUST order the two hoists (tier resolution above the stamping loop in `daemon-cli.ts`;
   tier read above the vetting checks in `daemon-backlog.ts`) before the behavior changes that
   depend on them.
2. `/plan` MUST include the R1 backlog survey and the R2 literal-`'done'` audit as first-class
   tasks, not as notes.
3. The inverted integration assertion MUST assert both directions (R3).
4. `docs/daemon-operations.md` MUST document the new discovery rejection and its remedy — the
   repo's documentation-upkeep rule makes this same-PR mandatory for new daemon operational
   behavior.
