# Track: Malformed Covers token on a changed test routes back to BUILD instead of exhausting the build_review fault allowance

Track: technical

Scope boundary: Engine-only. `build_review` detects, before any rubric dispatch, a changed test declaration whose only Covers evidence is a token this feature's diff introduced that matches no reference grammar (`task:<id>`, `S<story>.<n>`, `FR-<n>`), and the conductor routes that result to BUILD as a bounded `build_review` kickback naming the file, line, and token. Such a result never consumes the `build_review` mechanical-fault allowance. Excluded: changing the Covers grammar or making `parseCoversMarkers` tolerant of near-miss spellings; any change to how a well-formed but absent reference (`task:<id>` naming no active-plan task) is reviewed; any change to the infrastructure-failure or scope-incomplete mechanical lane; a commit-time or land-time hook (BUILD's own task close stays unchanged); legacy markers already present at the merge-base.

Internal engine routing with no product requirements; acceptance criteria live in stories (intake jstoup111/ai-conductor#2540).

Rationale for the chosen approach (issue hypotheses weighed as candidates):
- Pre-dispatch deterministic gate in `build_review` (chosen). The engine already parses every changed
  test's markers during input assembly (`src/conductor/src/engine/build-review-inputs.ts:701-703`) and
  knows the grammar class of each token (`CoversReference.kind === 'unresolved'`,
  `src/conductor/src/engine/covers-marker.ts:6-7,35-37`). Deciding "this token matches no grammar" is
  mechanical, so it belongs to machinery (CLAUDE.md Design Principle), costs no provider spend, and
  never reaches the reviewer whose `indeterminate` judgement today becomes a `scope-incomplete`
  mechanical fault (`build-review-domain.ts:809-816`, `conductor.ts:12230-12262`).
- Reclassifying the reviewer's scope-incomplete output after the lap (hypothesis 1): rejected. It still
  spends a review lap and depends on string matching an LLM's `obligationReferences` to recover a fact
  the engine already had.
- Land/commit-gate rejection (hypothesis 2): rejected as the sole fix. It does not cover a malformed
  token that reaches `build_review` by any path other than a task commit, and BUILD's task-close gate is
  out of scope here.
- Gating the mechanical charge on an unchanged `snapshotDigest` (hypothesis 3): rejected. It would also
  suppress the legitimate charge for a deterministic infrastructure failure, which the issue requires to
  keep consuming the allowance.
