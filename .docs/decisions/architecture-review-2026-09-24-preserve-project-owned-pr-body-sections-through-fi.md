# Architecture Review: Preserve project-owned PR body sections through finish

**Date:** 2026-09-24
**Mode:** lightweight (Tier M) — feasibility and alignment only
**Input:** `.docs/track/preserve-project-owned-pr-body-sections-through-fi.md` (technical track), intake jstoup111/ai-conductor#2616
**Stories reviewed:** none yet — this review precedes stories
**Verdict:** APPROVED WITH CONDITIONS

## Scope

Binding scope boundary from the track marker: step-keyed regions declared in the project's pull
request template, the SHIP draft seeded from that template, capture on owning-step success,
re-insertion after every FINISH body rewrite with verification before the ready flip, and
retirement of the self-host `Release-*` snapshot with `release-disposition` migrated onto the
mechanism. Two operator decisions taken during this review narrow it further: only
`.github/pull_request_template.md` is read, and the engine (not the step) inserts a missing region
before the owning step dispatches.

## Feasibility

Every claim was read from source on `main` at `c50ca7651` unless marked inferred.

| Element | Finding | Basis | Confidence |
|---|---|---|---|
| Today's only preservation | `snapshotFinishReleaseMetadata` runs before `finish` dispatch and `restoreFinishReleaseMetadata` only on the finish completion repair; the production `ready_pr` presentation repair is composed without it. | verified — `conductor.ts` finish dispatch hook, `createFinishPresentationRepair`, `index.ts`/`daemon-cli.ts` composition | 90% |
| Snapshot is repo-specific | `snapshotReleaseMetadataBlock` accepts only `Release-Disposition/Category/Semver/Note`; the flow module lives under `engine/self-host/`. | verified — `release-metadata.ts`, `self-host/release-metadata-flow.ts` | 95% |
| Whole-body rewriters | `author_pr_prose` and the judge's single repair rewrite title and body; `bodyFloor` and `rehabilitateHaltPr` rebuild the body. | verified — `step-runners.ts` finish prose prompt, `halt-pr-rehabilitation.ts` | 90% |
| Judged revision digest | Prose verdicts are keyed by a sha256 of the raw title/body revision, so a region re-inserted after judgment would stale the verdict and cost one re-judge. Re-insertion inside the authoring and repair effects avoids it. | verified — `finish-publication-production.ts` `revisionDigest` | 85% |
| Draft seed | `shipDraftPrBody` hard-codes `## Why / What Changed / Testing`; the engine reads no template on the finish path. | verified — `ship-draft-pr.ts` | 95% |
| Floor detection | `isEngineFlooredBody` requires the floor marker and authored free text ≤ 400 characters; a template-seeded draft would exceed that and be mistaken for authored prose. | verified — `halt-pr-rehabilitation.ts` `FLOOR_FREE_TEXT_MAX_CHARS`, `authoredProseLength` | 90% |
| Template precedent | The only engine template read is `engineer/release-metadata-inject.ts` at the fixed path `.github/pull_request_template.md`; bootstrap installs the consumer template there. | verified — `release-metadata-inject.ts`, `skills/bootstrap/SKILL.md` | 95% |
| Config load reach | `loadConfig(projectRoot)` already has the project root, so reading the template during validation needs no new plumbing. | verified — `config.ts` `loadConfig` | 90% |
| Custom-step ordering | `selectFinishPrerequisiteSteps` already computes custom steps ordered before `finish`; the "owning step runs before finish" rule reuses it. | verified — `finish-custom-step-prerequisites.ts` | 90% |
| Capture hook | The dispatch loop already runs per-step pre-dispatch hooks (the snapshot, the supersede clear); a post-completion hook for owning steps fits the same loop. | inferred — adjacent hooks in `conductor.ts`; completion handling not traced end to end | 75% |
| Release parser tolerance | Single-line HTML comments outside fences are ignored inside the Migration section, so a closing region marker after `## Migration` does not break `parseReleaseDisposition`. | verified — `release-metadata.ts` Migration content scan | 85% |
| Human-opened PRs | Markers are HTML comments; GitHub keeps them in the raw body and hides them when rendered. A hand-opened PR in this repository therefore carries the markers inertly. | inferred — GitHub template behavior; not exercised here | 80% |

**Stack / prerequisites / data:** no new dependency, migration, or external service. The only new
durable state is the per-PR, per-step capture file under `.pipeline/`, replacing
`.pipeline/release-metadata-snapshot.json`.
**Performance:** one body read per owning-step completion and one read before the ready flip; bounded.
**Worktree isolation:** captures live in the feature worktree's `.pipeline/`; no shared resource.

## Alignment

- **Governing ADRs, reused not duplicated.** `adr-2026-09-11-github-operation-ownership` (D1, D6, D7):
  every region write and verification read goes through the guarded operation boundary and appears
  in the operation inventory. `adr-2026-07-25-custom-step-completion-artifacts` (D6) and
  `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` (D1): marker validation is
  custom-step-only and fail-closed. `adr-2026-08-01-engine-owned-resumable-finish-publication` (D1, D3)
  and `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`:
  re-insertion rides inside existing effects and presentation repair; no transition is added.
  `adr-2026-08-16-restore-the-current-head-publication-fence`: "owning step is done" is read from the
  same fenced step state FINISH already trusts. `adr-2026-07-11-pipeline-state-durability`: guarded
  capture writes. `adr-2026-07-25-fail-closed-durable-shipment-evidence` (D2): missing or mismatched
  regions halt with the step named.
- **Halt-PR paths.** `adr-2026-07-03-halt-pr-rehabilitation-at-finish` and
  `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` regenerate the body; this design sequences
  re-insertion after those rewrites rather than changing them.
- **Self-host seam.** `adr-2026-06-30-self-host-detection-seam`: the release gate's activation and
  body validation stay in the self-host module; only snapshot/restore is removed, leaving no
  orphaned detector call site.
- **Release PR.** `adr-2026-08-01-bot-owned-release-pr` governs the separate bot release PR; no shared
  pull request, no conflict.
- **New structural decision.** Cross-module ownership of pull request body regions, a new
  project-declared configuration surface (the template), and new durable capture state are not
  covered by any APPROVED ADR — recorded in `adr-2026-09-24-project-owned-pr-body-regions`.
- **Scope split (scope-check A).** Consumer-facing: template regions, seeding, capture, re-insertion,
  verification, shipped `pr`/`finish` skills. Harness-repo-only: `release-disposition` skill, this
  repository's template, deleting the self-host snapshot.
- **Diagrams.** `.docs/architecture/preserve-project-owned-pr-body-sections-through-fi.md`
  matches this design.

## Focused local pattern basis

- **Region upsert by markers.** Role: the precedent for replacing a delimited body region
  idempotently. Traits to preserve: start/end comment markers, replace-in-place when present,
  append when absent, no interpretation of the contents. Why it applies: project regions are the
  same shape with a step-keyed marker. Allowed variation: markers carry a step key; re-insertion
  restores captured bytes rather than regenerating them. Hints: `build-review-accepted-risk.ts`
  `upsertBuildReviewAcceptedRisk`.
- **Custom-step-only config validation.** Role: fail-closed validation of a key legal only on
  custom steps. Traits: reject on built-in steps, reject unknown targets, error names the step.
  Hints: `config.ts` `validateConfig` custom-step checks around `completion_artifact`, and
  `finish-custom-step-prerequisites.ts` `selectFinishPrerequisiteSteps` for "ordered before finish".

## Wiring Surface

| New or changed production surface | Where it is called from in production |
|---|---|
| Template region parser and validator | `loadConfig` / `validateConfig` during project config load (CLI entry and daemon per-project load). |
| Template-seeded draft body | `openShipDraftPr` at SHIP entry, from the conductor's SHIP draft path. |
| Template-aware floor measurement | `isEngineFlooredBody`, consumed by the existing floor readers in FINISH observation and halt-PR rehabilitation. |
| Region ensure-before-dispatch | The conductor dispatch loop's pre-dispatch hook, for steps that own a region. |
| Region capture on success + persisted store | The conductor's post-step completion handling for owning steps; store read by FINISH re-insertion. |
| Region re-insertion | Inside the `author_pr_prose` and judge-repair effects; in `createFinishPresentationRepair` after `bodyFloor`/rehabilitation (both the `ready_pr` production composition and `repairFinishPr`). |
| Verify-before-ready | Immediately before `ensureShipReady` in the presentation repair. |
| Halt naming the step | The existing halt writer via `emitLoopHalt`. |
| Removed: self-host snapshot/restore | Call sites in `conductor.ts` (finish dispatch hook, supersede clear, `restoreFinishReleaseMetadata`) are deleted with the functions. |

Overlap scan (`ai-conductor overlap-scan`, advisory): only two stale spec branches touch
`conductor.ts` and `config.ts` (`spec/daemon-self-host-guardrails`, `spec/self-host-phase6-wiring`).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Seeded draft misread as authored prose, skipping authoring or paying a judge session on template text | Technical | High without mitigation | High | Condition 1: floor measurement nets out seeded template bytes. |
| Re-insertion after judgment stales the prose verdict | Technical | Medium | Medium | Condition 2: re-insert inside authoring and repair effects before observation. |
| Ready flip before regions are restored lets the release check read an incomplete body | Integration | Medium (today's shape) | High | Condition 3: verify-before-ready on every ready path. |
| Template edit breaks config load for the whole project | Integration | Low | Medium | Validation error names the marker, the line, and the rule broken. |
| Human edit to a region after capture is overwritten | Data | Low | Low | Documented in the ADR consequences; capture refreshes only when the owning step re-runs. |

## ADRs Created

- `adr-2026-09-24-project-owned-pr-body-regions` — D1–D9. Presented for operator approval.

## Conditions

1. Floor detection must classify a template-seeded, unauthored draft as a floor, and a draft with
   real prose around the seeded template as authored; both need tests.
2. Region re-insertion in the authoring and repair paths happens before the revision is observed, so
   a judged revision already carries every region.
3. Every production ready flip (`ready_pr` presentation repair and the finish completion repair) is
   preceded by region verification; the test must use the production composition, not a hand-built
   repair with the hook injected.
4. After deletion, no engine source matches `Release-(Disposition|Category|Semver|Note)` for
   preservation purposes; the release parser and the release gate's validation remain.
5. A repository whose template has no markers produces a byte-identical FINISH body to today's, and
   a repository with no template produces today's draft body.
