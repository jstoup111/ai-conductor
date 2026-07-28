**Status:** Accepted

## Story: Operator's tracked-file edit during a self-host build does not halt the build

**Requirement:** Technical intent — git-aware classification (see `.memory/decisions/live-boundary-halts-self-host-builds-when-the-oper.md`)

As the operator running interactive sessions alongside the self-host daemon, I want editing a
tracked source file in the live checkout mid-build to be recognized as my own normal work, not a
sandbox escape, so that the build keeps running instead of halting and getting misattributed as a
feature-level failure.

### Acceptance Criteria

#### Happy Path
- Given a self-host build has fingerprinted the live-checkout surface and dispatch is in flight,
  when the operator modifies the content of a tracked file already in the live checkout's git
  index (e.g. edits a line in `README.md`), then `verifyLiveBoundary` classifies that path via git
  as a normal working-tree change and returns `{ ok: true }` — the build does not halt.
- Given the same in-flight build, when the operator deletes a tracked file in a way `git status`
  reports as a tracked deletion, then that path also classifies as an operator edit and
  `verifyLiveBoundary` returns `{ ok: true }`.
- Given multiple tracked files are all edited by the operator during the same dispatch window,
  when `verifyLiveBoundary` runs, then every differing path classifies as an operator edit and the
  surface returns `{ ok: true }` (classification is evaluated per differing path, not just the
  first one found).

#### Negative Paths
- Given the operator edits a tracked file AND, in the same window, a new file appears in the live
  checkout that git reports as untracked (`??`), when `verifyLiveBoundary` runs, then the surface
  still returns `{ ok: false }` naming the untracked path — one tracked, explicable change does not
  amnesty an inexplicable one in the same batch.

### Done When
- [ ] `verifyLiveBoundary`'s live-checkout branch classifies each differing path via a real `git`
      invocation against the live checkout (no mock/fake git — this repo treats local git as
      deterministic, not a third-party boundary) and only reports `{ ok: true }` when every
      differing path is git-tracked and git-explicable.
- [ ] A vitest case using a real `mkdtemp` + `git init` live checkout (mirroring the existing
      fixture style in `src/conductor/test/engine/self-host/live-boundary.test.ts`) exercises the
      tracked-edit happy path and asserts `{ ok: true }`.
- [ ] A vitest case exercises the tracked-edit-plus-untracked-file mix and asserts `{ ok: false }`
      with the untracked path named in the reason.

---

## Story: A sandbox-escape-shaped diff in the live checkout still halts, with paths named

**Requirement:** Technical intent — git-aware classification

As the operator relying on this guard to catch a sandboxed self-host build writing into my live
repo, I want any change that git cannot explain as my own tracked edit to still halt the build
immediately, exactly as it does today, so the guard's core detection power is preserved.

### Acceptance Criteria

#### Happy Path
- Given an in-flight self-host build, when a file appears in the live checkout at a path git
  reports as untracked (simulating a sandbox escape writing an artifact outside the live
  checkout's git index), then `verifyLiveBoundary` returns `{ ok: false, reason }` and `reason`
  names that path (via the existing `diffManifests`/`describeDiff` reporting shared with the
  `provider state` surface — not a duplicated formatter).
- Given an in-flight build, when a path git reports as a deletion of a tracked file whose deletion
  git itself does not attest to (i.e. classification cannot confirm it via git), then the surface
  still halts with that path named.

#### Negative Paths
- Given a halt reason has more than `MAX_REPORTED_PATHS` differing entries, when
  `verifyLiveBoundary` builds the reason string, then it still elides to the existing bounded/
  redacted format (regression: git-aware classification must not bypass the existing
  bounding/redaction in `describeDiff`).

### Known limitation (documented, not testable in isolation)
Git cannot attribute *who* modified an already-tracked file's content — only whether the path is
tracked. A sandbox escape that overwrites an *existing* tracked file's content is therefore
indistinguishable from an operator edit under this classification and is NOT caught by this guard
(accepted trade-off — see `.memory/decisions/live-boundary-halts-self-host-builds-when-the-oper.md`,
"Known residual gap"). This must be documented in the `live-boundary.ts` module comment and in
`docs/guides/self-hosting.md`, not silently left implicit.

### Done When
- [ ] A vitest case creates an untracked file in a real tmp live checkout and asserts
      `verifyLiveBoundary` returns `{ ok: false }` with the path named in `reason`.
- [ ] No new path-formatting logic is introduced outside `diffManifests`/`describeDiff` — the
      git-aware branch only decides whether to short-circuit to `{ ok: true }`, it does not
      re-implement diff reporting.
- [ ] Existing `describeDiff` bounding/redaction tests (if any) still pass unchanged.

---

## Story: Git classification failure fails closed

**Requirement:** Technical intent — git-aware classification (fail-closed requirement)

As the operator, I want any error or ambiguity while classifying a live-checkout diff (git
command failure, live checkout not being a git repository, or any other indeterminate result) to
still halt the build exactly as it does today, so that a classification bug can never silently
suppress a real sandbox escape.

### Acceptance Criteria

#### Happy Path
- Given the live checkout is a git repository and classification succeeds cleanly, when
  `verifyLiveBoundary` runs, then it behaves as described in the two stories above (no change to
  the fail-closed default when classification is unambiguous).

#### Negative Paths
- Given the live checkout is NOT a git repository (e.g. `git status` fails with "not a git
  repository"), when a file differs and `verifyLiveBoundary` attempts classification, then it
  treats the result as indeterminate and returns `{ ok: false }` — identical to today's
  behavior before this change, not a new failure mode.
- Given the live checkout IS a git repository but the `git` classification invocation itself
  errors for any other reason (non-zero unexpected exit, thrown exception, timeout), when
  `verifyLiveBoundary` runs, then it treats that path (and the surface) as still-halting rather
  than defaulting to `{ ok: true }`.
- Given classification is ambiguous for at least one differing path in a batch where other paths
  classify cleanly as operator edits, when `verifyLiveBoundary` runs, then the surface halts (a
  batch is only amnestied when every differing path classifies unambiguously as an operator edit).

### Done When
- [ ] A vitest case runs `verifyLiveBoundary` against a live-checkout root that is not a git
      repository (or has git classification stubbed to throw) and asserts `{ ok: false }`.
- [ ] A vitest case confirms behavior is unchanged (still `{ ok: false }`) for the pre-existing
      "rejects terminal success when either live surface drifts" scenario in
      `live-boundary.test.ts`, run unmodified against the new code.
- [ ] The `#985` bookkeeping-exclusion test and the `#1113` provider-state tests in
      `live-boundary.test.ts` continue to pass unmodified — this change touches only the
      live-checkout surface's halt decision, not the provider-state surface or the volatile-path
      exclusion lists.
