# Architecture Review: per-feature step applicability (Medium — lightweight)

**Date:** 2026-10-03
**Stories reviewed:** none yet (pre-stories); input is PRD FR-1..FR-11 in
.docs/specs/step-applicability-is-fixed-repo-wide-decide-canno.md
**Verdict:** APPROVED

One ADR (`adr-2026-10-03-per-feature-step-applicability`) captures the decisions. It records a new
per-feature durable-state input and a new dispatch-time state transition, which is a structural
state decision. No existing APPROVED ADR governs per-feature step skipping.
`adr-2026-06-29-track-marker-location` is the precedent the marker follows; it is reused, not
superseded.

## Feasibility

- **Base-branch read path exists.** `BacklogTreeSource` / `gitTreeSource` prefetches `.docs/**`
  from the base. `readFeatureMarker` gives the stem and undated fallback. A third marker is one
  more read beside tier and track. ✅ (verified)
- **State seeding path exists.** Values flow `BacklogItem` → `deriveDaemonBaseState` →
  `ConductState`, the same path as `track`. ✅ (verified)
- **Skip recording exists.** `recordStepSkip` already persists `skipped` plus a loop-gate verdict
  with a cause string. ✅ (verified)
- **No hard dependency breaks.** Skipping either of the two declarable steps (`acceptance_specs`, `manual_test`) satisfies its successors
  (`stepDone` / `gateSatisfied`). `finish` and shipped-record copying tolerate the missing
  artifacts. ✅ (verified)
- **Decider identity is net-new but cheap.** It is a `git log -1 --first-parent` sibling of
  `firstAppearanceTime`. ✅ (inferred, ~90%: squash-merged spec PRs carry the PR author as the
  commit author)
- **Config seam exists.** The pattern is the resolved-config block plus `stepSkipAuthorityError`
  validation, which mirrors `configDisableAllowed`. ✅ (verified)
- **Worktree isolation.** No ports, databases, or shared services. The marker is per-stem, and
  state is per-worktree `.pipeline/`. ✅

## Alignment

- **Event spine.** New `ConductorEvent` variants are `step_inapplicable`,
  `step_inapplicable_ignored`, and `step_inapplicable_refused`. There is no sidecar. The per-feature
  list in `ConductState` is durable state seeded from a committed artifact (exception C), not an
  observation channel. ✅
- **Machinery over prompt.** Validation runs at land, and honoring and refusal are computed
  mechanically at dispatch. There is no model judgement at dispatch (PRD NFR). ✅
- **Marker idiom.** The marker follows adr-2026-06-29-track-marker-location: a dedicated per-stem
  file with a dedicated parser, read from base by the daemon. ✅
- **State representation.** The status enum is unchanged (Option D rejected). The cause lives in a
  typed array whose entries carry `{ step: StepName, reason, decider, commit }`. Invalid states are
  prevented: a non-declarable step cannot enter the array, because the land gate and dispatch
  re-check against step metadata. ✅
- **Security / authority.** A marker written on a feature branch is never honored (base-only read).
  Declarations for steps that have already started are refused. The never-declarable core is
  enforced in metadata and validation, not prose. ✅
- **Production DI.** No in-memory defaults are introduced. ✅
- **Diagrams.** The approved component and sequence diagrams at
  `.docs/architecture/step-applicability-is-fixed-repo-wide-decide-canno.md` (and `sequences/`)
  match this decision. ✅

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `parseApplicability` (artifacts.ts) | `landSpec` validation and `discoverBacklog` marker read |
| Land-gate applicability validation + `landGateError` codes | `landSpec`, invoked by `ai-conductor compose land` / engineer land |
| `feature_applicability.enabled` config block | resolved config, read by `landSpec` and the conductor dispatch skip resolution |
| `featureInapplicableAllowed` step metadata | `engine/steps.ts` built-ins, read by land validation and dispatch skip resolution |
| Decider helper (git log first-parent identity) | `discoverBacklog`, after reading the marker from base |
| `BacklogItem.inapplicable` → `ConductState.feature_inapplicable` | `deriveDaemonBaseState`, called from daemon-cli dispatch |
| Dispatch honoring / late refusal / ignored detection | the conductor linear dispatch loop's skip resolution, beside tier, track, and config skips |
| `step_inapplicable*` event variants | emitted by the dispatch loop, persisted by `EventPersister`, rendered by the UI subscriber, OTel by sink policy |
| Dashboard and daemon-status rendering | `ui/dashboard-text.ts` step line; daemon status per-feature view |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Spec PR authored under a bot identity makes the decider a bot | Security | Medium | Medium | Record the sha so the PR is traceable; revisit Option C if this matters |
| Operator expects an interactive run to honor a declaration | Knowledge | Medium | Low | Emit `step_inapplicable_ignored` and document daemon-only scope |
| A later amendment adds a row for a step already run | Data | Low | Medium | ADR D7 late refusal plus a refused event |
| Toggle flipped off with merged markers on base | Data | Low | Low | ADR D5 ignored event with cause `toggle-off` |

## ADRs Created

- `adr-2026-10-03-per-feature-step-applicability` (APPROVED by operator 2026-10-03)

## Conflict-check resolution (2026-10-03)

The repo-wide conflict sweep found three blocking conflicts. `prd_audit`, `architecture_review_as_built`,
and `coverage_binding` are each mandated to run on every feature by APPROVED ADRs. The operator
resolved them by narrowing the declarable set to `acceptance_specs` and `manual_test`, and the ADR
was revised before landing. The same pass also folded in degrading findings:
- sink rows for every new event;
- a project-only config key;
- author and committer in the decider record, as an audit label only;
- the `invalid` and `interactive` ignored causes;
- the already-honored exemption;
- validation-group absence;
- mutation-port writes;
- a corrected preseed premise.

See .docs/conflicts/step-applicability-is-fixed-repo-wide-decide-canno.md.
