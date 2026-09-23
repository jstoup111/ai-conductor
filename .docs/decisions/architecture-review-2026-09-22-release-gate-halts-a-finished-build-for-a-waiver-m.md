# Architecture Review: SHIP tail authors the release waiver the TR-10 gate validates (#2230)
**Date:** 2026-09-22
**Mode:** lightweight (Medium tier) — §2 Technical Feasibility and §4 Architectural Alignment
**Input:** explore decision (approach A, technical track, balanced scope) and
`.docs/architecture/release-gate-halts-a-finished-build-for-a-waiver-m.md`
**Verdict:** APPROVED

## Feasibility

| Check | Finding | Confidence / basis |
|---|---|---|
| Stack compatibility | No new packages or services. The change is the repository-local `.agents/skills/release-disposition/SKILL.md` contract, its existing contract test (`release-disposition-contract.test.ts`), and an ADR amendment. | 95% verified |
| Prerequisites | None. `.docs/release-waivers/` is already on `DOCS_WRITE_ALWAYS_ALLOWED` (`phase-marker.ts`), so a SHIP-phase step may write it. | 95% verified |
| Gate sees the commit | `runSelfHostFinishGates` runs the release gate before `finish` dispatches and `selfBuildChangedFiles` diffs local `base...HEAD`, so a local commit made by `release-disposition` satisfies W1 without a push. | 90% verified (conductor.ts `runSelfHostFinishGates`, `selfBuildChangedFiles`) |
| Commits in the SHIP tail | `maintain-documentation`, one step earlier in the same tail, already commits. A docs-only delta after rebase preserves gate verdicts (`gate-invalidation.ts`, ADR-2026-07-20; `isCodeOrTestPath` excludes `.docs/`). | 85% verified |
| Commit hook | The commit passes through the provider-neutral pre-commit hook (adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts); a release waiver is not a sealed protected artifact. | 80% inferred — BUILD must confirm the hook admits the path |
| Integration surface | One skill, one test, one ADR. The TR-10 gate, the path classifier, `version-signal.ts`, and consumer pipelines are untouched (scope boundary). | 95% verified |
| Data / performance / worktree isolation | No schema, ports, or shared state; the commit is in the feature worktree, inside live-checkout containment (adr-2026-08-17-structural-live-checkout-containment). | 95% verified |

## Alignment

- **Governing ADR reused, not duplicated.** adr-2026-07-06-migration-gate-waiver already defines the
  waiver contract (W1–W4) and names PR-merge review as the backstop against a build rubber-stamping a
  waiver. The only uncovered question is *who* authors it; that is recorded as amendment D4–D6 on the
  same ADR (repo convention: prefer amendments over new ADRs).
- **Fail-closed preserved.** adr-2026-06-30-halt-based-release-gates is untouched: the gate still
  writes the HALT on any missing or invalid satisfier, and `unclassifiable` authors nothing (D6).
- **Self-exemption risk (adr-2026-08-02-plan-scope-containment-at-commit-boundary).** The step
  authors the record that satisfies a gate, but the validator is a separate, unchanged module
  (`release-gate.ts`), so the step cannot widen what counts as valid.
- **TTY-authorship precedent (adr-2026-08-13-stable-build-review-finding-dispositions,
  adr-2026-08-12-operator-reseal-as-second-scope-justification).** Those gates bar autonomous
  sessions from authoring a gate-resolving disposition. Release waivers were never in that class:
  adr-2026-07-22-phase-scoped-docs-write-guard already states waivers "are authored by the
  implementing BUILD session". This change moves authorship to a later autonomous step that sees the
  final diff; it adds no new autonomy. Its line about BUILD authorship stays true (a plan task may
  still author one), so it needs no amendment.
- **Step contract.** adr-2026-08-01-scoped-run-verb-release-surface already has `release-disposition`
  deriving the PR's release declaration on its own; the surface verdict is the same judgement,
  extended. adr-2026-07-25-custom-step-completion-artifacts is unchanged: the pass marker stays a
  presence-and-freshness artifact.
- **Machinery vs judgement.** "Is this touch internal-only?" is a judgement call; it lives in the
  step that reads the diff, constrained to a closed four-value vocabulary (D4), while the
  bookkeeping — freshness, format, coverage — stays machine-checked by the gate.
- **Diagram accuracy.** The feature sequence diagram reflects the design; no container or system
  context change.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| Surface verdict + waiver authoring in `.agents/skills/release-disposition/SKILL.md` | Dispatched by the conductor as the configured custom step `release-disposition` (`.ai-conductor/config.yml`, `after: maintain-documentation`) in the self-host SHIP tail |
| Committed `.docs/release-waivers/<plan-stem>.md` | Consumed by the existing `runReleaseArtifactGate` → `evaluateWaiver` from `runSelfHostFinishGates` before `finish` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Step issues `waiver` where consumer action was needed | Technical | Low | Medium | W2 forces named surfaces + rationale; waiver sits in the PR diff; operator merge review (ADR-005) |
| Step writes the waiver but skips the commit | Technical | Medium | Low | W1 fails, gate halts as today; skill orders commit before PASS (D5) |
| Pre-commit hook rejects the waiver path | Integration | Low | Low | BUILD verifies against the hook; falls back to today's halt |

## ADRs Created

None. Amended: adr-2026-07-06-migration-gate-waiver (D4–D6).

## Conditions

None.
