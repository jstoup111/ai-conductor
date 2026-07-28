**Status:** Accepted

# Rebased features stop halting on a stale protected-artifact seal (#976)

Track: technical (no PRD — acceptance criteria live here)
Tier: M

## Context

`.pipeline/protected-artifact-seal.json` fingerprints the committed content of `.docs/architecture`,
`.docs/plans`, `.docs/specs`, and `.docs/stories` at the first BUILD-phase step attempt, using the
feature worktree's HEAD as `baselineCommit`. Every later BUILD or SHIP attempt re-fingerprints the
workspace copies and refuses to dispatch on any difference, emitting `Protected artifact changed:
<path>`; at attempt ≥ 2 the conductor writes an `unclassified` `.pipeline/HALT`. The seal is
immutable — `createProtectedArtifactSeal` returns the existing seal even when handed a newer commit.

The SHIP-phase `rebase` step rebases the worktree onto `origin/<default>` and translates sibling
`.pipeline` state (`task-evidence.json`, `task-status.json`, `rebase-rewrites.json`) but leaves the
seal alone. The rebase therefore pulls the base branch's newer `.docs/**` into the worktree while
the seal still holds pre-rebase fingerprints.

Live evidence, #254 canary, 2026-07-26: the daemon halted with `Protected artifact changed:
.docs/architecture/2026-06-30-harness-self-host-guardrails.md` while `git diff
origin/main..HEAD -- <that path>` produced no output. The seal's `baselineCommit` is **not** an
ancestor of the rebased HEAD; every other active worktree's baseline is. Because the seal is
immutable, re-entry could not recover — the operator had to delete generated pipeline state by hand.

**What changes, precisely.** The boundary's *purpose* is unchanged: a BUILD/SHIP agent still cannot
edit DECIDE artifacts. What changes is that a seal which can no longer be evaluated against the
current history may be **rebaselined**, and only when every differing protected path is provably
inherited from the base branch rather than authored by the feature. Resealing at a later commit on
the same history stays forbidden.

Out of scope: broadening the sealed directory set, making the seal tracked state, and any change to
the docs-guard classifier (`classifyMutationTarget`) or its allowlist.

---

## Story ST-976-1 — A clean engine rebase rebaselines the seal in the same operation

**Requirement:** #976 desired outcome 1

As the SHIP-phase rebase step, when I rebase a feature worktree onto a newer base, I want the
protected-artifact seal re-anchored to the post-rebase HEAD as part of that operation, so the very
next BUILD or SHIP attempt does not fail on a baseline that no longer describes this history.

### Acceptance Criteria

#### Happy Path
- Given a sealed worktree whose workspace matches its seal, and a base branch that has since changed
  a file under `.docs/architecture`, when the rebase step completes cleanly, then the seal on disk
  records `baselineCommit` equal to the post-rebase HEAD and fingerprints matching the post-rebase
  committed content, and the next BUILD/SHIP attempt verifies `ok` and dispatches.
- Given the same conditions, when the seal is rotated, then a `rebaselines[]` entry is appended
  recording `fromCommit`, `toCommit`, the trigger, and the protected paths re-anchored, and the
  pre-existing entries are preserved.
- Given a rebase that is classified `noop` (base unchanged), when the step completes, then the seal
  is left byte-for-byte unchanged and no rotation entry is appended.

#### Negative Paths
- Given a worktree whose seal ALREADY fails verification before the rebase begins (a protected
  artifact was edited during BUILD), when the rebase step runs, then the seal is **not** rotated and
  the pre-existing `Protected artifact changed: <path>` refusal still blocks dispatch — a rebase can
  never launder a pre-existing violation.
- Given a rebase that ends in `conflict_halt`, when the step halts, then the seal is left unrotated,
  so the halted worktree is not left with a baseline describing a half-applied history.

---

## Story ST-976-2 — A resumed feature recovers from a seal stranded by a history rewrite

**Requirement:** #976 desired outcome 1 & 4

As a resumed daemon build whose worktree was rebased outside the engine — or which halted under the
old behaviour before this change shipped — I want the stale seal detected and rebaselined at
verification time, so the feature proceeds through normal gates without an operator deleting or
rewriting generated seal state.

### Acceptance Criteria

#### Happy Path
- Given a seal whose `baselineCommit` is not an ancestor of the current HEAD, and where every
  protected path whose fingerprint differs has workspace bytes equal to that path's blob at HEAD and
  that blob equal to the same path's blob at the base-branch tip, when a BUILD or SHIP step verifies
  the seal, then the seal is rebaselined at HEAD, verification returns `ok`, the step dispatches, and
  no operator action was required.
- Given the worktree from the #254 canary (seal baseline `c53c55fe…`, HEAD `f36b1a62…`, no diff for
  the reported architecture path against `origin/main`), when verification runs, then it returns `ok`
  by the rotation path rather than `Protected artifact changed`.
- Given a protected path that the base branch **deleted** or **added** since the baseline, when the
  divergence is otherwise fully inherited, then the rotation re-anchors to the current set and the
  `Protected artifact deleted/added` refusals do not fire.

#### Negative Paths
- Given a seal whose `baselineCommit` IS an ancestor of the current HEAD, when a protected artifact
  differs, then no rotation is attempted and the existing `Protected artifact changed: <path>`
  refusal stands — same-history resealing remains forbidden, including when HEAD has advanced past
  the baseline by ordinary commits.
- Given a seal whose `baselineCommit` object cannot be resolved in the repository (missing or
  garbage-collected), when verification runs, then the result is an indeterminate, fail-closed
  refusal with its own distinct reason — it is never treated as "rewritten, therefore rotatable".
- Given the base-branch tip cannot be resolved (no remote, or the ref is absent), when a
  non-ancestor seal is verified, then rotation is refused and the pre-existing failure is preserved —
  never rotate on a comparison that could not be made.

---

## Story ST-976-3 — A feature-authored mutation still blocks, across a rebase

**Requirement:** #976 desired outcome 2

As the protected-artifact boundary, when a BUILD/SHIP agent changes a DECIDE artifact, I want that
change to keep blocking dispatch with an actionable reason even if the history is subsequently
rewritten, so a rebase cannot be used to launder a mutation into a new baseline.

### Acceptance Criteria

#### Happy Path
- Given a feature that commits an edit to `.docs/plans/<stem>.md` and is then rebased onto a newer
  base, so the seal's baseline is no longer an ancestor of HEAD, when verification runs, then the
  rotation is **refused** because that path's blob at HEAD differs from its blob at the base tip,
  and the step fails with a reason naming the path and identifying the change as feature-authored.
- Given a mixed worktree where one protected path is inherited from the base and another is
  feature-authored, when verification runs, then rotation is refused as a whole and the reason names
  the feature-authored path — a single unexplained path is sufficient to refuse.

#### Negative Paths
- Given a protected artifact modified in the working tree but **not committed**, and a seal whose
  baseline is not an ancestor of HEAD, when verification runs, then rotation is refused because the
  workspace bytes do not equal the blob at HEAD, and the existing refusal stands.
- Given a protected artifact replaced by a symlink pointing outside the workspace, when verification
  runs, then the existing `Indeterminate protected artifact target: <path>` fail-closed refusal is
  returned unchanged and no rotation is attempted.

---

## Story ST-976-4 — The daemon log distinguishes a stale seal from a real mutation

**Requirement:** #976 desired outcome 3

As an operator reading `.daemon/daemon.log` after a halt, I want to tell a stale pre-rebase seal
apart from a genuine protected-artifact mutation without reading the seal JSON and reasoning about
shas, so I can act on the halt directly.

### Acceptance Criteria

#### Happy Path
- Given a seal rotation occurs by either trigger, when it completes, then a telemetry event records
  the trigger, `fromCommit`, `toCommit`, and the re-anchored paths, and the daemon log line names it
  as a rebaseline rather than a failure.
- Given a rotation is refused, when the refusal is recorded, then the event states which condition
  failed — feature-authored path, unresolvable baseline, or unresolvable base tip — and names the
  path where applicable.

#### Negative Paths
- Given a genuine protected-artifact violation reaches attempt ≥ 2, when the conductor writes
  `.pipeline/HALT`, then it is written with an explicit halt class identifying a protected-artifact
  violation, not today's `unclassified`, so the halt is machine-distinguishable from a stale seal.
- Given a v1 seal written before this change, when it is read, then it is accepted and upgraded to
  the versioned shape in place, and a malformed seal still throws `Protected artifact seal is
  invalid` exactly as today.
