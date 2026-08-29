# Architecture Review: Budgeted, mode-aware test_suite verification (#2021)
**Date:** 2026-08-28
**Stories reviewed:** none yet — pre-stories feasibility review (technical track; input is the
explore output, the approved approach in
`.memory/decisions/test-suite-drift-budget-approach.md`, and the approved diagrams)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** entirely in-repo TypeScript engine work; no new packages, services, or
  infrastructure. Verified: the drift substrate already exists — PASS evidence persists
  `provenanceHeadSha` and all eight per-category fingerprints
  (`src/conductor/src/engine/full-suite-fingerprint.ts:51-60`, `:589`, `:645`;
  `full-suite-evidence.ts` v3), and `changedFingerprintInspection`
  (`full-suite-verifier.ts:973-995`) already computes the per-category change vector.
  Confidence: verified (Explore sweep 2026-08-28, direct reads).
- **Prerequisites:** none external. Config validation slots into `validateTestSuiteBlock`
  (`config.ts:1612-1706`), whose existing presence rule (`:1624-1629`) and content rule
  (`:1638-1651`) are the exact fail-at-load patterns needed.
- **Integration surface:** `full-suite-verifier.ts` (judgement point), `full-suite-fingerprint.ts`
  (scoped identity), `full-suite-evidence.ts` (schema bump), `config.ts` (validation +
  allowlist), `types/events.ts` + emit sites in `conductor.ts` (mode/budget fields),
  `scoped-run.ts` (reused unchanged), `registry-cli.ts` (`config init` flags),
  `skills/bootstrap/SKILL.md`. Crosses >3 module boundaries — expected for Tier L; every
  boundary is an existing seam.
- **Data implications:** evidence file version bump with an explicit reader policy for
  prior-version files (treat as stale — fail toward re-run). No git-history or state-machine
  migration.
- **Performance:** drift measurement adds one `git diff --name-only <sha>..HEAD` + category
  classification per STALE evaluation — negligible against the ~3-minute runs it avoids.
- **Worktree isolation:** all state is per-worktree `.pipeline/`; no shared resources.

## Complexity

High (Tier L, recorded in `.docs/complexity/`): one new config contract, one judgement
function, an evidence schema bump, event-union extension, CLI flags, skill edit, and six ADR
amendment notes. No split recommended: the drift budget and the mode share the same
validation, evidence, and event surfaces — splitting would ship a schema bump twice. The
bootstrap answers (D8) are the natural candidate if BUILD needs to shed scope, and are
severable without weakening the core outcome.

## Alignment

- Governing decisions were swept in full (all of `.docs/decisions/`, 2026-08-28). The three
  that independently forbid a naive pass-once flag are honored by design: inspection is never
  skipped (`gates.md:127` stays literally true), tree-attesting membership is retained
  (adr-2026-08-19 D1 — amended, not evicted), and freshness recalculation at every entry
  stands (adr-2026-07-25 D7 — amended for consequence, not for inspection).
- Amendment notes (additive, original assertions preserved) were made in this pass to:
  `adr-2026-07-25` (D7), `adr-2026-08-19` (D1), `adr-2026-08-01` (D7/D8), `adr-2026-07-20`
  (soundness invariant), `adr-2026-08-18` (refund basis), `adr-2026-07-27` (config init
  instantiation). One new ADR was drafted for the uncovered structural decision — the
  eight-category enum becoming a public config contract and the budget/mode semantics:
  `adr-2026-08-28-test-suite-drift-budget-and-verification-mode`.
- **Cross-artifact constraint:** story
  `.docs/stories/reduce-redundant-full-test-suite-runs-in-build-shi.md` (#588) binds "No gate
  semantics change". Scoped-satisfies-gate amends that boundary; the engineer land gate
  rejects foreign-stem story edits on a spec branch, so this amendment ships as a companion
  main-based PR (condition C3).
- Pattern consistency: fail-at-load validation follows `validateTestSuiteBlock`'s existing
  style; events extend the existing `ConductorEvent` union (event-spine principle: no new
  channel); scoped execution reuses `scoped-run.ts` verbatim (no second substitution
  implementation — and the existing duplicate in `step-runners.ts:2312-2340` is noted as
  prior art, out of scope here).

## Domain Integrity

- Budget values are a closed domain (`none | positive integer | unlimited`), parsed at config
  load — no raw-string plumbing past the boundary.
- Category names are a closed set validated at load; unknown or unbudgetable-in-budget keys
  are `validation_error` (invalid states unrepresentable at the config boundary).
- Verification outcome gains an explicit new state (`PRESERVED_WITHIN_BUDGET`) rather than
  overloading `CURRENT` with a boolean — state transitions stay explicit and exhaustively
  matched.
- Evidence `driftLedger` is append-only within a PASS epoch and resets only on a new PASS —
  no ratcheting through repeated small preservations (cumulative-from-attested-PASS rule,
  ADR D4).

## Wiring Surface

| New production surface | Called from (design-time commitment) |
|---|---|
| `test_suite.verification.mode` + `drift_budget` config keys | parsed in `loadConfig` → `validateTestSuiteBlock` (`src/conductor/src/engine/config.ts`), consumed by `FullSuiteVerifier.resolveInspection`; registered in the adr-2026-08-26 consumer registry |
| Drift-budget judgement (new function in `full-suite-verifier.ts`) | invoked from `resolveInspection` on every fingerprint mismatch — reached by the tree-attesting recheck (`conductor.ts` dispatch boundary), the post-BUILD/kickback/FINISH restages, and `finish`'s current-proof check |
| Scoped gate execution path | `FullSuiteVerifier.ensure` in scoped mode → existing `runScopedCommand` seam (`scoped-run.ts`); selector derivation reuses the merge-base surface derivation (`gate-code-validity.ts` pattern) |
| Evidence schema fields (`mode`, `selectors`, `driftLedger`) | written by the verifier's existing atomic evidence write; read by `finish`'s current-proof check and operators |
| Extended `test_suite_verification` / `build_member_evidence_reused` event fields | emitted at the existing `conductor.ts:11160-11204` emission sites; persisted by `EventPersister` to `.pipeline/events.jsonl` |
| `conduct-ts config init --test-suite-mode / --test-suite-drift-budget` | command dispatch in `registry-cli.ts` (`runConfigInit`); invoked by the bootstrap skill step 1b-i |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Within-budget foreign change actually breaks the suite; feature ships on a preserved PASS | Technical | Low | High | Opt-in only; unbudgetable core categories; drift recorded in evidence; CI independently authoritative (nothing merges on red CI) |
| Drift measurement diverges from fingerprint categorization (two classifiers drift apart) | Technical | Medium | Medium | Reuse the same category regex table (`full-suite-fingerprint.ts:250-288`) for both; a shared-function task in the plan |
| Evidence version bump breaks the `finish` current-proof reader on old files | Data | Low | Medium | Prior-version evidence reads as stale → re-run (fail toward execution, never toward reuse) |
| Scoped mode verifies too little (changed-test selection only) and operators over-trust it | Knowledge | Medium | Medium | Documented trade-off in `configuration.md` + the ADR; mode recorded in every event/evidence record |
| `config init` parameterization breaks idempotence/refuse-to-clobber | Technical | Low | Low | Flags only affect the initial write; clobber rule untouched; covered by `config-template.test.ts` extension |

## ADRs Created

- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` — pending operator approval
  in this session (must be APPROVED before land).

## Conditions

- **C1 — Consumer registry:** both new config keys enter the adr-2026-08-26 registry in the
  same implementing change; the coverage test fails otherwise.
- **C2 — Shared classifier:** drift measurement and fingerprint categorization must consume
  one category-classification function; the plan must carry this as an explicit task.
- **C3 — Companion PR:** the #588 story scope-boundary amendment ships as a main-based
  companion PR (foreign-stem story edits fail the spec-branch land); the spec PR body links
  it.
- **C4 — Documentation:** `docs/reference/configuration.md`, `docs/explanation/gates.md`,
  `docs/reference/cli.md`, and `skills/bootstrap/SKILL.md` are updated in the implementing
  change (gates.md's "evidence can never satisfy it" sentence gains the budget-judgement
  clarification rather than deletion).
- **C5 — Fail-closed defaults everywhere:** absent `verification` block, prior-version
  evidence, unresolvable provenance SHA, or git failure during drift measurement must all
  resolve toward re-run, never toward preservation.
