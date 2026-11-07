# Architecture Review: per-feature artifact manifest and one lookup (#3405, spec 1 of 3)

**Date:** 2026-10-24
**Mode:** Full (Tier L)
**Inputs reviewed:**
- `.docs/track/decide-artifacts-are-too-repetitive-for-people-to-.md`
- `.docs/complexity/decide-artifacts-are-too-repetitive-for-people-to-.md`
- `.docs/architecture/decide-artifacts-are-too-repetitive-for-people-to-.md` (operator approved 2026-10-24)
- Governing ADRs: `adr-2026-07-28-feature-aware-artifact-resolution`, `adr-2026-07-26-daemon-decide-preseed-ownership`,
  `adr-2026-08-09-operator-only-scoped-artifact-reseal`, `adr-2026-08-23-committed-halt-record`,
  `adr-2026-07-22-phase-scoped-docs-write-guard`, `adr-2026-10-03-stacked-child-plans-identity-and-state`,
  `adr-2026-09-29-plan-slice-manifest`

**Verdict:** APPROVED

## Feasibility

| Intent | Assessment | Basis |
|---|---|---|
| Manifest committed with the spec | Feasible. Land stages `git add -- .docs` excluding plan-review (`engineer/land-spec.ts`), and refuses only non-`.docs/` paths. | Verified: source read. |
| Discovery sees manifests | Feasible with no new read. The backlog prefetch runs `ls-tree -r .docs` on the default branch and reads every blob (`daemon-backlog.ts`, `prefetchDocs`). | Verified: source read. |
| One lookup | Feasible. `STEP_ARTIFACT_CONTRACTS` and `resolveArtifactFiles` (`artifacts.ts`) are the approved seam; four feature resolvers sit beside them. About 40 sites already use a seam and about 100 build paths themselves. | Verified: inventory with file:line evidence. |
| Legacy behavior unchanged | Feasible. Each reader keeps its existing resolution expression as the no-manifest branch. | Design. |
| Registration in land | Feasible. Land holds the idea's change set (`resolveIdeaFiles`). The interactive `conduct` path is deferred to spec 3: its coherence and plan-review steps run after the plan step, so a manifest written there would be incomplete. | Verified: source read. |
| Reseal registration | Not feasible: reseal refuses any path absent from the seal (`adr-2026-08-09-operator-only-scoped-artifact-reseal` D1). Dropped; land is the only writer. | Verified: conflict check. |
| Prerequisites, migration, worktree isolation | None. No schema migration, service, port or shared runtime state. Existing specs need no backfill. | Verified. |
| Performance | One small JSON read per lookup; discovery reuses its prefetch. Negligible. | Inferred. |

## Complexity

High breadth, low depth: one new module (manifest parse, render, register), a manifest rung in
the existing resolver for feature-scoped reads, and mechanical routing of about 100 hard-coded
readers of feature-scoped kinds.
Excluding shipped, halted and release-waiver records (ADR decision 3) removes about 25 reader sites
and every post-land writer except the plan remediation append, which only edits a listed file.
Estimate: 15 to 20 plan tasks in about three slices. The operator chose a three-spec split over one
spec carrying path policy (decision 10).

## Alignment

- **Lookup.** `adr-2026-07-28-feature-aware-artifact-resolution` governs feature-aware resolution. Its
  D3 said the resolver uses "no manifest"; that assertion is falsified, so D3 carries an additive
  amendment note dated 2026-10-24. Its D2 keeps the ADR and architecture corpora
  repository-scoped, so the manifest rung applies to feature-scoped patterns only. The resolver
  still writes nothing.
- **Discovery coherence.** `adr-2026-07-26-daemon-decide-preseed-ownership` D3 names
  `.docs/coherence/<slug>.md`; it carries an amendment note pointing manifest-backed specs at the
  manifest's `coherence` entry.
- **Reseal.** `adr-2026-08-09-operator-only-scoped-artifact-reseal` D1 refuses unsealed paths, so
  reseal cannot register a new file. Land is the only writer in this spec.
- **Halt records.** `adr-2026-08-23-committed-halt-record` is untouched. Halt records stay in
  `.docs/halted/` and outside the manifest, so its "nothing in this path may throw" seam gains no new
  failure.
- **Docs write guard.** `adr-2026-07-22-phase-scoped-docs-write-guard` covers Edit, Write and
  NotebookEdit (`worktree-prepare.ts` hook matcher), not Bash, so it does not stop a BUILD agent
  writing `.docs/<slug>/manifest.json`. Spec 2 protects the manifest through the seal.
- **Stacked features.** `adr-2026-10-03-stacked-child-plans-identity-and-state` gives stacked children
  one feature identity, so one manifest per slug serves every child.
- **Naming.** `adr-2026-09-29-plan-slice-manifest` owns the plan's `## Slice manifest`. Prose calls the
  new file the "artifact manifest" to keep them apart.
- **Event spine.** The manifest is durable state under exception C (read by name as current authority,
  no timestamps). Registration is an occurrence and emits `feature_artifacts_registered` on the
  existing union. No parallel channel.
- **Path policy.** The seal, pre-commit hook, write allowlist, gate invalidation, rebase, retention and
  build_review scope still match by folder and basename. That is correct for this spec because no file
  moves; spec 2 owns the change.

## Domain Integrity

- Kinds are a closed union; there is no string kind and no default case.
- One parser yields a typed manifest; readers never re-validate raw JSON.
- The resolution result is a discriminated union (manifest hit, manifest miss, no manifest, malformed),
  so "absent" and "malformed" cannot be confused.
- Slug, kind and repository-relative path are named types, not bare strings.

## Wiring Surface

| Surface | Production caller |
|---|---|
| Manifest parse and render | The lookup and registration below. |
| Manifest rung in the lookup | `resolveArtifactFiles`, `resolveFeaturePlanPath`, `resolveFeatureStoriesPath`, `resolveFeaturePrdPaths`, `resolvePlanStoriesPath`, and each hard-coded reader of an in-scope kind. |
| Registration | `compose land` (`land-spec.ts`). |
| `feature_artifacts_registered` event | Emitted by registration through `ConductorEventEmitter`; persisted by `EventPersister`. |
| Manifest-backed discovery | `daemon-backlog.ts` candidate enumeration and per-candidate reads. |
| `malformed-manifest` blocked reason | Daemon backlog blocked-item channel. |

Early overlap scan (advisory) over `artifacts.ts`, `daemon-backlog.ts` and `engineer/land-spec.ts`
was run before `/plan`: no overlap and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A routed reader returns a different file with a manifest than without | Technical | Medium | High | Parity tests per routed reader: same file with and without a manifest. |
| A reader keyed by `feature_desc` misses the manifest in interactive `conduct` | Technical | Medium | Low here, High for spec 3 | Falls back to identical legacy result in spec 1 (assumption A3); spec 3 gives those readers the plan stem first. |
| A BUILD step writes a new in-scope file that manifest-backed readers then miss | Technical | Low | Medium | Assumption A4; spec 2 adds drift checks at build_review. |
| A BUILD agent rewrites the manifest through Bash | Technical | Low | Medium | A malformed result fails closed; spec 2 seals the manifest. |
| A pruned feature leaves its manifest on main | Data | Medium | Low | Shipped dedup drops the candidate before its manifest is parsed; post-prune audits read the parent commit; spec 2 moves retention onto the manifest. |
| A consumer repository runs a mixed engine version | Integration | Low | Medium | Legacy resolution is unchanged; an older engine ignores the extra `.docs/<slug>/` file. |
| A hand-edited malformed manifest stops discovery for that feature | Data | Low | Medium | Fails closed with reason `malformed-manifest` and a remedy naming the file. |

## ADRs Created

- `adr-2026-10-24-per-feature-artifact-manifest` (new)
- `adr-2026-07-28-feature-aware-artifact-resolution` D3 (amendment note)
- `adr-2026-07-26-daemon-decide-preseed-ownership` D3 (amendment note)

## Conditions

None beyond operator approval of the new ADR and its assumptions A3 and A4.
