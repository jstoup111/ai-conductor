# Track: stacked-features-cannot-be-published-reviewed-and-

Track: technical

Scope boundary: The ship-path slice of jstoup111/ai-conductor#2945, the publication ticket of the
stacked child-plans chain (chain design in #2940). By operator decision (2026-10-17), this spec
delivers stacked delivery that can be used now, provided the operator merges a stack as one unit.
In scope:
- FINISH publishes a stacked feature as a GitHub native stack, one PR per child, in order. The top
  PR is the retained SHIP draft, which still opens at SHIP entry. Child branches are pushed with
  explicit-SHA leases and child PRs are opened only after the leaf gates pass. Publication is
  idempotent and resumes at the first missing member. Leaf success never implies the stack is
  complete.
- Every member passes `ci-gate`, `release-metadata` and `shipped-record`. `ci.yml` runs on members
  whose base is a child branch.
- Release and shipment contracts are reused unchanged (approach B). Child PRs declare
  `Release-Disposition: no-note` and carry no `Plan:` declaration, so shipment association
  classifies them not-applicable. The leaf alone carries the feature's release note, `Closes`,
  `## Migration` (last), the build-review blocks and the shipped-record.
- Only the leaf merging ships the feature. A merged lower prefix leaves it in flight, with no
  shipped-record, an open intake issue and no teardown. On the leaf merge the feature is recorded
  as shipped exactly once and never re-dispatched, and every member's diff is verified reachable
  from `main`, reporting any missing diff by PR number.
- Each member PR has a reader-facing body describing only its own child, plus stack navigation.
  Project-owned body regions survive on the leaf.
- The leaf owns `pr_url` and the retained draft, and a child-to-PR map records each child's PR.
  finish-record's child refusal is lifted only to the extent these records need.
- Teardown and reclaim remove every child branch and the feature's conductor refs by explicit,
  enumerated name, only after the leaf merges.
- Non-leaf members seen merged, closed or reverted are observable on the event spine.
- Fail-closed concurrency: the daemon writes to a published stack only when every remote tip
  matches its recorded tip. Any mismatch, including the server-side rebase after a partial bottom
  merge, halts with a dedicated sweep-skipped halt class and a documented manual runbook
  recovery. It never re-kicks in a loop.
- The engine never merges a member and never disables, toggles or bypasses a ruleset. Pushes never
  use a plain force-push. Single-PR features (flag off, unsliced, or N=1) publish exactly as today.

Excluded, each filed as its own intake:
- approach A's dedicated contracts: `Release-Disposition: bundled`, a `Stack-Child:` marker, and
  validator, renderer, candidate and shipment-association support (#3267);
- `conduct stack adopt` and verified acceptance of the server-side rebase after a bottom merge, so
  a partial merge no longer halts (#3268);
- a PR comment on a published child that received a routed fix, after #3211 and #3212 (#3269);
- surfacing red CI on an intermediate member for a human decision (#3270).

Technical track: internal harness publication, workflow and lifecycle machinery with no product
requirements; acceptance criteria live in stories, as for every earlier ticket in the chain.
