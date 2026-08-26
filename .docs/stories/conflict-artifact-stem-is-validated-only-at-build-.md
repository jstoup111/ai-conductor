**Status:** Accepted

# Stories: land-time feature-scoped artifact stem validation (#1743)

Technical track — no PRD. Requirements derive from the technical intent: `landSpec` must validate
every feature-scoped `.docs/` artifact through the same `STEP_ARTIFACT_CONTRACTS` identity
matching the daemon's forward-walk uses, and the resolver diagnostic must name the naming rule and
expected filename instead of only a candidate count.

## Story 1: Land rejects a feature-scoped artifact whose stem cannot associate with the feature slug

As an operator landing a spec, I want a mismatched artifact stem to fail the land immediately so that the mismatch never merges and HALTs the feature at a later BUILD dispatch.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose `.docs/specs|stories|conflicts|plans|coherence` artifacts all carry stems that associate with the feature slug under their step's contract identity, when `engineer land` runs, then the land succeeds exactly as today
- Given a `.docs/conflicts/2026-08-25-<slug>.md` artifact (date prefix, otherwise exact slug), when `engineer land` runs, then the normalized-stem identity strips the date prefix and the land succeeds

#### Negative Paths
- Given a `.docs/conflicts/2026-08-19-<truncated-slug>.md` artifact whose normalized stem differs from the feature slug, when `engineer land` runs, then the land exits non-zero with a message naming the offending path, the violated contract (`normalized-stem` for `conflict_check`), and the expected stem (the feature slug), and the worktree is kept for inspection
- Given a `.docs/stories/` file whose stem is a rewording of the slug, when `engineer land` runs, then the land fails naming the expected stem for the `stories` contract rather than passing on the loose idea-file match
- Given a `.docs/plans/` file whose stem differs from the plan stem the complexity marker uses, when `engineer land` runs, then the land fails naming the expected plan stem (`plan-stem` identity)
- Given multiple feature-scoped artifacts with mismatched stems in one worktree, when `engineer land` runs, then the failure message enumerates every offending path with its expected stem in a single run, not just the first

### Done When
- [ ] `landSpec` resolves each present feature-scoped artifact through `STEP_ARTIFACT_CONTRACTS` identity matching (the same matcher as `artifacts.ts` forward-walk resolution), not a bespoke reimplementation
- [ ] A land over a fixture worktree reproducing the #1743 filename (`2026-08-19-clean-rubric-judgements.md` vs the full slug) exits non-zero and the error text contains the expected stem verbatim
- [ ] A land over a fully slug-named fixture worktree (with and without date prefixes on normalized-stem artifacts) succeeds
- [ ] Unit tests cover: exact match, date-prefixed match, truncated mismatch, plan-stem mismatch, multi-artifact enumeration

## Story 2: Resolver diagnostic names the naming rule and expected filename

As an operator diagnosing a HALT on an already-merged mismatched artifact, I want the resolution diagnostic to state the naming rule and the expected filename so that the fix is mechanical and needs no engine source reading.

### Acceptance Criteria

#### Happy Path
- Given a feature-scoped contract resolution with a non-empty candidate set and zero associations, when the diagnostic is produced, then it names the identity strategy (e.g. `normalized-stem`, date prefix stripped), the expected stem for the active feature, and an example expected filename (e.g. `.docs/conflicts/<slug>.md`), in addition to the candidate count

#### Negative Paths
- Given a resolution that fails because the candidate set is empty (no artifacts at all), when the diagnostic is produced, then it does not claim a stem mismatch — it reports the empty pattern result unchanged from today
- Given a repository-scoped contract (no feature identity), when resolution fails, then the diagnostic is unchanged — the naming-rule text appears only for feature-scoped identity failures

### Done When
- [ ] The `ambiguous` diagnostic for feature-scoped contracts includes identity strategy, expected stem, and an example expected filename
- [ ] Replaying the #1743 fixture (mismatched conflicts stem among candidates) through the resolver produces a diagnostic containing the expected filename `.docs/conflicts/clean-rubric-judgements-rejected-as-invalid-provid.md`
- [ ] Existing diagnostic consumers (forward-walk HALT rendering) surface the new text without truncation, verified by a unit test on the emitted HALT evidence string
- [ ] Empty-candidate and repository-scoped diagnostics are byte-identical to their current forms in regression tests
