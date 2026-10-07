# Architecture Review: base-inherited protected-artifact deletion deadlocks seal rotation and reseal
**Date:** 2026-10-07
**Mode:** Lightweight (Medium tier). Sections 2 (Feasibility) and 4 (Alignment) only.
**Input:** explore output and technical intent (technical track; stories not yet written).
`.docs/track/base-inherited-artifact-deletion-deadlocks-both-se.md`,
`.docs/architecture/base-inherited-artifact-deletion-deadlocks-both-se.md`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new packages. Only git plumbing already used by the module (`merge-base`, `diff`, `ls-tree`), plus `git log --diff-filter=D`. |
| Prerequisites | None. Seal `version: 2` and `rebaselines[]` already exist (`adr-2026-07-26-protected-artifact-seal-rebaseline` D4). |
| Integration surface | One module (`protected-artifact-seal.ts`), plus additive optional fields on the seal reader, the `protected_artifact_rebaseline` event type (`types/events.ts`), and its two renderers. Fewer than 3 module boundaries. |
| Data implications | `.pipeline/protected-artifact-seal.json` gains an optional `deletedBy` on rebaseline entries. The reader must accept it, and old seals stay valid. No migration. |
| Performance | The probe runs only for sealed paths missing from the workspace. A pruned path is never probed again. |
| Worktree isolation | The seal is per-worktree under the gitignored `.pipeline/`. There is no shared state. |

**Key feasibility claim**: `branchUntouchedInheritance` already returns `inherited` for a sealed
path that the base branch deleted and the feature never touched. A committed feature deletion and an
uncommitted workspace deletion both return `not-inherited`. Confidence about 90%, verified by
reading `protected-artifact-seal.ts` (the three-dot diff, `ls-tree` empty-output, and `ENOENT`
branches). BUILD's red tests settle it.

**Recorded assumption (approved with the ADR)**: a base-inherited deletion always has a findable
deleting commit on the base ref, because the sealed baseline held the path and the merge-base does
not. Impact if wrong: the fail-closed refusal of ADR D5 fires instead of pruning, which is the
current behavior and has no safety loss.

## Alignment

- **Governing ADRs reused:**
  - `adr-2026-08-09-seal-rotation-authorship-predicate`: the same authorship probe, failing closed
    on indeterminate provenance.
  - `adr-2026-07-26-protected-artifact-seal-rebaseline` D4: lineage goes through `rebaselines[]`,
    and telemetry rides existing variants.
  - `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`: no new channel.
- **New ADR:** `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`. The engine-initiated
  prune is a new durable state transition of the seal, and the existing ADRs do not cover it.
- **Event spine:** the change extends the existing `protected_artifact_rebaseline` variant with an
  optional field. It adds no new variant, sidecar, or poller. This passes the schema-not-file test.
- **State:** the trigger is a string, and its values are already open-ended (`proactive-rebase`,
  `defensive-history-rewrite`, `operator-reseal`). `deletedBy` is keyed by path, so a prune entry
  cannot carry a path without its deleting commit.
- **Security boundary:** a prune can only remove paths that the base branch (an authority the build
  agent cannot write to) removed and the feature never touched. Feature-authored and uncommitted
  deletions keep halting. A prune is persisted only on an `ok` composed verdict, including rotation (ADR D4).
- **Consumers of `rebaselines`:** `readOperatorReseals` filters on `operator-reseal`, so it is
  unaffected. `coverage-binding-void.ts` uses its own per-path rebaseline type and does not read seal
  `rebaselines` directly.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Deletion-loop authorship check in `inspectSeal` | Existing callers: `verifyProtectedArtifactSeal` (conductor BUILD/SHIP step guard in `conductor.ts`; `performRebase` pre-rebase verify in `rebase.ts`), and `resealProtectedArtifactSeal`. |
| Prune persistence (inherited deletions dropped and lineage entry written) | `verifyExistingProtectedArtifactSeal` once the composed verdict (inspection plus rotation) is `ok`, folded into the rotation write when rotation is permitted; and `resealProtectedArtifactSeal` before its scoped reseal write. |
| `deletedBy` on the `protected_artifact_rebaseline` event | Emitted through the existing `onRebaseline` observer. Rendered by the existing `daemon-cli.ts` `protected_artifact_rebaseline` case and the conductor log line. |
| Attribution lines in refusal reasons | Surfaced by existing consumers: conductor HALT reason, `ProtectedArtifactSealRejection` in `rebase.ts`, and `reseal-cli.ts` `reseal_refused.condition`. |

**Overlap scan (advisory):** `ai-conductor overlap-scan` reports an overlap with
`origin/spec/self-host-phase6-wiring` on `src/conductor/src/daemon-cli.ts` only. The only edit this
feature makes there is additive rendering in the `protected_artifact_rebaseline` case. The risk is
low and is flagged for `/plan`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Probe misclassifies a feature-authored deletion as inherited and prunes it | Security | Low | High | The three-dot diff detects committed deletions and HEAD-tree presence detects uncommitted ones. Stories pin both refusals with red tests. Fail closed on any probe error (ADR D2). |
| Prune written while another path refuses, silently shrinking the seal | Data | Low | Medium | ADR D4: prune only on an `ok` composed verdict (inspection and rotation). Tested. |
| Renderers print a confusing `from..to` for prune entries | Knowledge | Medium | Low | The trigger label disambiguates it, and the renderer shows the pruned paths and their deleting commits. |

## ADRs Created
- `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`, APPROVED by operator 2026-10-07.

## Conditions
None.
