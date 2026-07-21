# Architecture Review: Wiring reachability gate (green-but-unwired guard)
**Date:** 2026-07-12
**Stories reviewed:** none yet — design-time review (DECIDE, pre-stories); input = intake
jstoup111/ai-conductor#462 + operator-approved explore decisions + approved C4 diagrams
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All engine seams verified in source (not inferred):

| Claim | Basis |
|---|---|
| `build_review` StepDefinition is the template; `manual_test.prerequisites=['build_review']` must repoint | verified — `src/engine/steps.ts:145,163` |
| Evidence-file gate pattern exists to copy | verified — `validateAcceptanceRedEvidence`, `src/engine/artifacts.ts:458-539` |
| Plan-line parser family exists (`FILES_LINE`) | verified — `src/engine/autoheal.ts:1075-1149` |
| Injectable deterministic probe pattern exists | verified — `headPushedToUpstream(runGit: GitRunner)`, `src/engine/push-evidence.ts:38` |
| Feature-diff base derivation exists (anchor → fork-point → merge-base ladder) | verified — `src/engine/autoheal.ts:308-414` |
| TS compiler API available without new dependency | verified — `typescript@^5.5.0` in package.json |
| Engine runs in non-TS consumer projects → probe must be layered, entry points must be config | verified — registry contains Rails/other consumer repos |

No new external services, no schema/auth surface. New tooling is the TS import-graph layer —
bounded by using the already-present compiler API.

## Complexity

Tier L (recorded in `.docs/complexity/2026-07-12-wiring-reachability-gate.md`): new gating step,
new plan grammar, first import-graph tooling, two skill-contract edits, waiver mechanism.
Splitting was considered; kept as one feature because the contract without the gate is inert
(exactly the failure class being fixed) — but the plan should sequence Layer 1 before Layer 2 so
the universal check can land even if the TS layer slips.

## Alignment

- **Deterministic-first (CLAUDE.md/HARNESS.md):** aligned — machinery at the gate, LLM sweep
  (§12 as-built) retained only for what static analysis cannot decide (unexercised-at-runtime).
- **Gate precedents:** follows evidence-gate "sole completion authority" and abstain-or-loud
  (#519) — Layer 2 degradation is loud; waiver resolution is fail-closed.
- **Kickback vs HALT:** follows remediate routing — named gap → kickback to build; only the
  existing kickback-cap stall path escalates to human.
- **Existing guards unchanged:** arch-review §12, pipeline superseded-symbol grep,
  writing-system-tests real-entry-point rule stay as complementary layers.
- **Release gates:** new step + config key + plan grammar = MINOR semver; `wiring.entry_points`
  config addition needs README + src/conductor/README.md docs and a CHANGELOG entry; no
  settings.json/hook/CLI breaking surface expected (no migration block) — re-assess at PR time.

## Domain Integrity

- Waiver/contract forms are a closed enum of line shapes (declared sites | same as Task N |
  none-no-surface | none-inert-until-ref) — no free-form strings reach the predicate; parse,
  don't validate.
- `WiringEvidence` must record per-gap named evidence (symbol, kind of gap, what was searched) —
  no boolean-only verdicts.
- Exhaustive matching on gap kinds in the predicate; no catch-all pass.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Static blind spots (dynamic dispatch, config-string wiring, re-exports) → false gaps ping-pong builds | Technical | Medium | High | Declared-site check passes dynamic consumption; INERT waiver escape hatch; MAX_KICKBACKS_PER_GATE caps; gap messages name exactly what was searched |
| Orphan islands pass Layer 1 (referenced only by another orphan) | Technical | Medium | Medium | Layer 2 reachability where available; §12 as-built sweep remains |
| Plan under-declares vs approved architecture (contract drift) | Integration | Medium | Medium | Backstop catches undeclared new exports; plan review checks derivation |
| `gh` outage blocks waiver-bearing builds (fail-closed) | Integration | Low | Medium | Repo-local path refs need no network; gap message says "unverifiable", retry clears |
| Grammar drift (#417 class) between plan authoring and parser | Technical | Medium | High | Single parser beside FILES_LINE; round-trip tests mandatory; grammar defined once in plan SKILL |
| Small-tier self-authored contract gets no design review | Knowledge | Medium | Low | Accepted trade-off (operator-confirmed); backstop is the net |

## ADRs Created

- `adr-2026-07-12-wired-into-contract.md` (APPROVED 2026-07-12, operator)
- `adr-2026-07-12-wiring-check-gate.md` (APPROVED 2026-07-12, operator)

## Conditions

1. Plan must sequence Layer 1 (universal reference check) before Layer 2 (TS reachability) so
   the universal gate can ship independently.
2. `Wired-into:` grammar gets round-trip tests (author → parse → verdict) in the same tasks that
   introduce the parser — not deferred.
3. Gap messages must always name the symbol AND what was searched (files/roots/patterns) —
   verified in acceptance specs.
4. `wiring.entry_points` config documented in README + src/conductor/README.md in the same PR;
   CHANGELOG entry per release gates.
5. Negative-path specs at every predicate call site (adversarial inputs: malformed lines, closed
   waiver refs, gh failure, test-only callers) per the negative-path-specs convention.
