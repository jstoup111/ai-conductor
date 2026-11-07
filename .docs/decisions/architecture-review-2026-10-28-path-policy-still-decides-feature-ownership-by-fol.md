# Architecture Review: path policy reads feature ownership from the artifact manifest (#3418, spec 2 of 3)

**Date:** 2026-10-28
**Mode:** Full (Tier L)
**Inputs reviewed:**
- `.docs/track/path-policy-still-decides-feature-ownership-by-fol.md`
- `.docs/complexity/path-policy-still-decides-feature-ownership-by-fol.md`
- `.docs/architecture/path-policy-still-decides-feature-ownership-by-fol.md` (operator approved 2026-10-28)
- Governing ADRs:
  - `adr-2026-10-24-per-feature-artifact-manifest`
  - `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
  - `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`
  - `adr-2026-08-09-operator-only-scoped-artifact-reseal`
  - `adr-2026-08-05-provenance-based-protected-artifact-inheritance`
  - `adr-2026-07-22-phase-scoped-docs-write-guard`
  - `adr-2026-09-11-selective-post-rebase-verification`
  - `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`

**Verdict:** APPROVED

## Feasibility

| Intent | Assessment | Basis |
|---|---|---|
| One ownership result | Feasible. Spec 1's parser, kind table and file sources (`feature-manifest.ts`, `feature-manifest-source.ts`) already give typed entries and a per-entry existence probe. Only the reverse direction (unlisted files) is new. | Verified: source read. |
| Step-boundary stop | Feasible. BUILD/SHIP step entry in `conductor.ts` already verifies the seal on every attempt. It returns refusal kind `seal` and writes a protected-artifact HALT from attempt 2. Ownership runs in the same block, before the seal. | Verified: source read. |
| Manifest protection against Bash | Feasible with no new hook surface. The seal inspects files on disk, whatever tool wrote them. The pre-commit hook checks staged paths at commit, whatever tool staged them. Adding the manifest to both covers Bash and Codex. | Verified: source read. |
| In-flight features after upgrade | Safe. A seal created before this change does not list the manifest. `inspectSeal` tolerates a newly protected path that is byte-identical to the base tip. | Verified: source read (assumption A1). |
| Hook reads engine lines | Feasible. The hook already parses `allow:` lines from `.pipeline/phase-active` with `sed`. `own:` and `protect:` use the same shape. With no lines, the hook keeps today's stem branch. | Verified: source read. |
| Invalidation | Feasible. `resolveReviewInputs` already reads the plan, prd, coherence and stories through `resolveFeatureArtifact`. Only the same-stem loop, the empty-identity fallback and the prefix predicate change. | Verified: source read. |
| Keep-both refusal | Feasible. `docsKeepBothResolver` already refuses edit conflicts and hands them on. A manifest path joins that refusal. | Verified: source read. |
| Register command | Feasible. It follows `reseal-cli.ts` (`.worktrees/<slug>` resolution, TTY gate, audit events, seal rotation through `persistProtectedArtifactSealRotation`). It is a separate verb, so `reseal`'s refusal of unsealed paths is untouched. | Verified: source read. |
| Prune | Feasible. `resolveDocsPruneSelection` already reads the full `origin/main` `.docs` tree. A git-ref manifest source over that ref supplies the entries. `readPlanOrPruned` already reads the deleting commit's parent. | Verified: source read. |
| Prerequisites, migration, worktree isolation | No schema migration, service, port or shared state. The phase marker and hook are per-worktree engine files. The new CLI verb needs a release disposition. | Verified. |
| Performance | One manifest parse and one `git diff --name-status` per step entry. Negligible next to the seal's existing fingerprint pass. | Inferred. |

## Complexity

High breadth, moderate depth: one new ownership module, the reverse drift probe, and seven policy
call sites that switch on the ownership result while keeping their legacy branch. The new operator
verb follows `reseal`. Estimate: about 20 plan tasks in three stacked slices. The operator chose one
spec over a 2a/2b split on 2026-10-28 (ADR decision 10).

## Alignment

- **Manifest authority.** This completes manifest ADR decision 7, which deferred drift, protection
  and post-land files to this spec. Decision 6 ("land is the only writer") is falsified by the
  register command and carries an amendment note. Decision 5's lookup outcomes are unchanged:
  ownership reuses the same parser and fails closed on a malformed manifest.
- **Seal lineage.**
  - Protection stays method-blind: the on-disk seal plus the commit-time hook
    (`adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` D1/D2).
  - Base-tip inheritance (`adr-2026-08-05-provenance-based-protected-artifact-inheritance`) is
    reused unchanged.
  - The self-amendment ADR's reported self-amendments (decision 1) keep their meaning; for a
    manifest-backed feature this ADR's decision 4 decides which changed paths they are. Its Scope
    sub-rule (decision 3) was retired with build_review's Scope rubric (#1805), so no build_review
    prompt changes.
- **Operator-only writes.** Registration copies `reseal`'s three independent operator-only
  mechanisms (`adr-2026-08-09-operator-only-scoped-artifact-reseal` decision 4). `reseal` widens
  only to listed protected-kind paths outside the five folders, and never accepts the manifest.
- **Allow entries.** A file-path `allow:` entry matches exactly, so the narrowed `remediate`
  allowlist keeps the existing directory-boundary-safe guarantee
  (`adr-2026-07-22-phase-scoped-docs-write-guard`).
- **Docs write guard.** Unchanged (`adr-2026-07-22-phase-scoped-docs-write-guard`). Its accepted
  Bash gap is now closed by the seal and hook, not by widening the guard.
- **Invalidation.** Review-input identities stay explicit and bounded
  (`adr-2026-09-11-selective-post-rebase-verification` decision 3). The manifest only replaces
  how they are found.
- **Prune.** The retention policy stays one exported constant, with a kind axis added. The stem
  matching in decision 1 and the plan lookup in decision 6 are falsified for manifest-backed stems
  and carry amendment notes.
- **Event spine.** `feature_artifacts_registered` already exists in the `ConductorEvent` union.
  Registration emits it on the worktree's existing `EventPersister`. One refusal event,
  `feature_artifact_registration_refused`, joins the union beside `protected_artifact_reseal_refused`.
  There is no new channel.
- **Focused local pattern basis (register command).**
  - **Precedent role:** the operator-only seal-rotating CLI.
  - **Traits to preserve:** resolve `.worktrees/<slug>` from the root checkout, refuse without a TTY
    and record the refusal on the worktree spine, persist the rotation before any best-effort
    rendering, and offer an optional `--clear-halt`.
  - **Allowed variation:** it adds a manifest entry and commits, which `reseal` never does.
  - **Hints:** `reseal-cli.ts` `dispatchResealCommand`, `protected-artifact-seal.ts`
    `persistProtectedArtifactSealRotation`, and the `reseal` entries in the CLI command table.
- **Diagram.** It matches this design. No container or external integration changes.

## Domain Integrity

- **Ownership result.** It is a discriminated union (`legacy`, `manifest`, `malformed`, `drift`),
  so policies switch on it exhaustively. No boolean `hasManifest` plus nullable lists.
- **Paths.** They reuse spec 1's branded `DocsPath` and `FeatureSlug`. Drift entries carry a closed
  reason (`missing`, `unlisted`), not prose.
- **Protected kinds.** A closed subset of `ArtifactKind`, declared once. The retention policy's
  prunable kinds are declared once in `DOCS_RETENTION_POLICY`.
- **Marker lines.** The engine renders them from the typed result. The hook only matches strings
  and never derives ownership.

## Wiring Surface

| New surface | Production caller |
|---|---|
| Ownership module (compute result, drift probe) | BUILD/SHIP step entry in `conductor.ts`, before `verifyProtectedArtifactSeal`; `performRebase` before HEAD moves; restack seal checks; `resolveDocsPruneSelection`; `resolveReviewInputs`; `assembleBuildReviewInputs`; register command |
| Ownership-aware seal set and self-amendment test | `createProtectedArtifactSeal` and `inspectSeal`, through their existing callers |
| `own:` / `protect:` marker lines | `writePhaseMarker` at step entry; read by the generated pre-commit hook in `.pipeline/git-hooks/` |
| Narrowed `remediate` allowlist | `resolveDocsAllowlist` at step entry |
| Manifest refusal in keep-both | `docsKeepBothResolver`, reached from `autoresolve.ts` Tier 1 |
| Graded-diff and preflight exclusions | `assembleBuildReviewInputs` and `classifyTautologyPaths` in the build_review runner |
| `ai-conductor register-artifact` | The CLI command table, beside `reseal` |
| `feature_artifact_registration_refused` event | Emitted by the register command; persisted by the worktree `EventPersister` |
| Manifest-aware prune selection and pruned-plan lookup | `dispatchDocsPrune`; `readPlanOrPruned` from the shipment audit and shipment evidence |

Advisory overlap scan over these paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| False unlisted-drift stops on stacked children or after rebase | Technical | Medium | High | Origin is the merge base with the base branch (assumption A2); tests cover a stacked child and a rebased feature. |
| A healthy build adds an in-scope file and stops | Technical | Low | Medium | Assumption A4; the stop names the register command as remedy. |
| An in-flight feature halts on its manifest after upgrade | Technical | Low | Medium | Base-tip inheritance tolerance (assumption A1), with a test using a seal without the manifest. |
| An old hook in a long-lived worktree ignores the new lines | Technical | Low | Low | It falls back to the stem rule; the seal still catches a manifest change at the next step entry. |
| A legacy feature changes behavior | Technical | Low | High | Parity tests per policy with no manifest. |
| The register command is reachable by an agent | Security | Low | High | No step definition, pre-pipeline dispatch and the TTY gate, each tested as `reseal`'s are. |
| A prune removes a kept-kind file | Data | Low | High | Retention by kind is one constant; tests assert that stories, prd, decision, architecture and intake entries survive. |

## ADRs Created

- `adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest` (new, APPROVED)

## ADRs Amended

- `adr-2026-10-24-per-feature-artifact-manifest`: decisions 6 and 7
- `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`: decisions 1 and 6
