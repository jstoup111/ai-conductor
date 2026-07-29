# ADR: Feature-aware artifact contracts resolve step outputs for every generic consumer

**Date:** 2026-07-28
**Status:** APPROVED
**Deciders:** James Stoup and the ai-conductor architecture review
**Feature:** step-completion-globs-are-feature-unscoped-so-anot (issue #993)

## Context

`STEP_ARTIFACT_GLOBS` declares directory-wide patterns and `findArtifactFiles` expands them without feature identity. The same unscoped result feeds generic completion, interactive artifact review, and dashboard status. In a repository with multiple feature documents, an unrelated prior artifact can therefore satisfy a current feature's gate.

The registry also mixes three legitimate lifecycles: feature-authored `.docs` documents, repository/workspace-wide sources such as acceptance specs and assessments, and run-local `.pipeline` evidence. A blanket stem filter would fix some false passes while introducing false failures for intentionally non-feature artifacts and historical naming variants.

Existing code already provides feature identity inputs (`featureDesc`, `planPath`, `.pipeline/engine-state.json` `activePlanPath`) and scoped plan/story resolvers. The engineer land gate also proves that the current feature's changed/untracked `.docs` set can be derived without a new manifest. The selected approach must reuse those seams, preserve legacy work when identity is unambiguous, and never guess among several foreign candidates.

## Options Considered

### Option A: Typed artifact contracts with one shared resolver

- **Pros:** Makes scope visible at the declaration site; closes the defect for completion, review, and dashboard together; preserves repository/run-wide artifacts; needs no new persisted artifact.
- **Cons:** Requires a compatibility ladder for historical names and coordinated migration of three consumers.

### Option B: Gate-only custom predicates

- **Pros:** Smaller immediate diff and direct protection for selected gates.
- **Cons:** Leaves review/dashboard inconsistent, duplicates identity policy, and lets the declaration map continue hiding which entries are feature-scoped.

### Option C: Per-feature execution manifest

- **Pros:** Strongest explicit provenance after the manifest exists.
- **Cons:** Adds a new state artifact, writer lifecycle, migration/backfill contract, and loss recovery path that are unnecessary while current feature identity can be derived.

## Decision

### D1 — A typed contract is authoritative; the glob map becomes a derived projection

Introduce `STEP_ARTIFACT_CONTRACTS` in `src/conductor/src/engine/artifacts.ts`. Each pattern declares its lifecycle scope and, for feature-scoped entries, its identity strategy. Keep `STEP_ARTIFACT_GLOBS` as a mechanically-derived compatibility projection so existing callers and configuration documentation do not break while migration proceeds. The typed contract is the sole hand-authored registry.

Scope is declared per pattern rather than assumed for the whole step, because a multi-output step may have a feature-primary report plus supplemental files resolved by a different strategy.

### D2 — Artifact lifecycle scopes are `feature`, `repository`, and `run`

- `feature`: output belongs to the active plan/feature and must be associated before it counts.
- `repository`: the declared corpus intentionally applies to the checkout as a whole; feature filtering is not applied.
- `run`: stable worktree-local evidence under `.pipeline`; its existing freshness or custom predicate remains authoritative.

No default scope is allowed in the contract. Adding a pattern requires an explicit classification, making the negative path—legitimate repository-wide artifacts—visible and testable.

### D3 — `resolveArtifactFiles` owns a deterministic, no-manifest identity ladder

Add a public `resolveArtifactFiles(dir, step, context)` beside the registry and existing plan/story helpers. It invokes the raw matcher, then applies the contract:

1. Prefer explicit current-feature inputs: `planPath`, `activePlanPath`, and `featureDesc`.
2. Include current-feature files proven by the worktree change set (tracked changes since the feature/base merge-base plus untracked files), using the same evidence shape already enforced by engineer land.
3. Apply the pattern's declared canonical identity strategy, including exact plan stem and a shared normalization for established dated/prefixed filenames.
4. When only one candidate exists, accept it as the legacy singleton fallback.
5. When several candidates remain and none is provably current, return an ambiguous resolution with no satisfying file. Never choose alphabetically, by newest mtime, or by first glob result.

The resolver returns both files and a diagnostic reason so a completion failure or dashboard can name ambiguity rather than report a generic absence. It does not write `.pipeline`, `.docs`, or any new manifest.

### D4 — Generic consumers share resolution; raw globbing remains policy-free

`checkStepCompletion`, the interactive artifact-review path, and `getArtifactStatus` consume `resolveArtifactFiles`. `findArtifactFiles` remains the low-level pattern expander for callers that explicitly need a repository-wide corpus and for resolver internals.

The conductor threads its existing feature context into completion and review. Both renderers already hold `featureDesc`; they pass it to status resolution. A missing identity is not silently manufactured: repository/run patterns behave as today, while ambiguous feature patterns report unsatisfied.

Step-specific custom completion predicates retain authority over semantic/freshness checks. The migration must inventory them so a typed contract does not weaken an existing stronger predicate.

### D5 — Compatibility is verified against both live two-feature behavior and historical corpus shapes

Tests must cover two simultaneous feature artifacts for every feature-scoped resolver family: feature A's file cannot satisfy feature B, while B's own canonical file passes. Compatibility cases cover current worktree changes, dated/prefixed historical names, and singleton legacy artifacts. Repository- and run-scoped entries keep their current matching behavior.

`docs/reference/artifacts.md` becomes the canonical reader-facing scope table and explains the resolution ladder and ambiguity result.

## Consequences

### Positive

- An ambiguous multi-candidate foreign corpus cannot satisfy a feature-scoped generic completion gate; a lone unmatched candidate remains eligible through the explicit legacy singleton fallback.
- Completion, review, and dashboard cannot drift into three definitions of artifact identity.
- Repository-wide and run-local artifacts remain intentionally broad rather than surviving through accidental exceptions.
- Existing imports of `STEP_ARTIFACT_GLOBS` remain source-compatible during migration.
- No new state artifact, backfill ledger, or recovery lifecycle is introduced.

### Negative

- `artifacts.ts` gains a richer registry and resolver policy in an already central module.
- Historical filename normalization must be explicit and tested; unknown ambiguous legacy corpora now fail closed instead of receiving an arbitrary match.
- Dashboard collection may perform feature-identity/change-set work repeatedly unless callers reuse one resolution context per refresh.
- `artifacts.ts` is a high-contention file across queued specs, so implementation may need a finish-time rebase and focused conflict resolution.

### Follow-up Actions

- [ ] Define typed contracts and derive `STEP_ARTIFACT_GLOBS` from them.
- [ ] Implement and unit-test the shared resolver and diagnostic result.
- [ ] Migrate completion, interactive review, and both dashboard renderers.
- [ ] Add two-feature negative-path, historical compatibility, and scope-preservation tests.
- [ ] Update `docs/reference/artifacts.md` and the notable-change changelog if implementation meets the repository's release threshold.
