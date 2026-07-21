**Status:** Accepted

# Stories: sidecar-stamp-reachability-guard (#766)

Technical track. Acceptance criteria for reachability-gating the sidecar
evidence-stamp pin in `deriveCompletionInternal` (`src/conductor/src/engine/autoheal.ts`,
the `matchingCommits.length === 0` branch). Behavior (WHAT) only; the mechanism
(HOW) is the plan's job.

Shared context for every story below: a plan task `T` has an entry in the
task-evidence sidecar (`evidence.evidenceStamps.has(T)` is true) but **no commit
in the current evidence range carries a resolvable `Task: T` trailer** — i.e.
derivation reaches the pin branch. The question each story pins down is what the
gate does with the stamp's cited sha in that state.

---

## Story: Reachable stamp keeps the task pinned completed

**Requirement:** Preserve legitimate pins — a stamp whose cited commit is still
present in history must continue to credit the task.

As the evidence gate, I want to keep crediting a task whose sidecar stamp cites a
commit that is still reachable, so that a genuinely-done task is never demoted or
re-run just because its `Task:` trailer isn't the corroboration path this cycle.

### Acceptance Criteria

#### Happy Path
- Given task `T` has a sidecar stamp citing sha `X`, and `X` (after rewrite-map
  resolution) both exists via `git rev-parse --verify` and is an ancestor of HEAD,
  when `deriveCompletionInternal` runs, then `result[T].completed` is `true`,
  `result[T].status` is `'completed'`, and `result[T].evidencedBy` is the resolved
  sha `X`.

#### Negative Paths
- Given task `T`'s stamp cites sha `X` that resolves (unchanged) but is **not** an
  ancestor of HEAD (dangling/off-branch), when derivation runs, then `T` is NOT
  pinned completed by this branch (it falls through to demotion — see the demote
  story), i.e. `result[T].completed` is `false`.

### Done When
- [ ] A unit test in `src/conductor/test/engine/autoheal*.test.ts` constructs a
      commits list with no `Task: T` trailer, a sidecar stamp for `T` citing a sha
      that IS an ancestor of HEAD, and asserts `result[T].completed === true` and
      `result[T].evidencedBy` equals the resolved sha.
- [ ] The existing "pinned completed / preventing demotion" behavior for reachable
      stamps is preserved (no regression in existing autoheal pin tests).

---

## Story: Unreachable stamp demotes loudly so the task re-runs

**Requirement:** #766 core — a stamp citing a commit absent from history without a
rebase must NOT wedge the build; the task is demoted and re-run.

As the evidence gate, I want to stop trusting a sidecar stamp whose cited commit is
absent from current history and unexplained by any rebase rewrite-map, so that the
build re-runs the task and produces real evidence instead of parking in an
uncreditable-undemotable state.

### Acceptance Criteria

#### Happy Path
- Given task `T` has a sidecar stamp citing sha `X`, and `X` (after rewrite-map
  resolution) is absent from history (`git rev-parse --verify` fails) OR resolves
  but is not an ancestor of HEAD, and there is no rewrite-map entry translating `X`
  to a reachable sha, when `deriveCompletionInternal` runs, then `result[T].completed`
  is `false`, `result[T].status` is not `'completed'`, `result[T].auditEntry` names
  the stamp's cited sha as unreachable, and a warning is emitted (once, via
  `warnOnce`) describing the demotion.
- Given the same task `T` is demoted, when the next build cycle dispatches, then `T`
  is eligible to re-run (its task-status row is no longer pinned completed by the
  sidecar), so the build can progress past the wedge.

#### Negative Paths
- Given the stamp form is `semantic-verified` (judge-confirmed) but its cited sha is
  unreachable and not rewrite-translated, when derivation runs, then `T` is STILL
  demoted (a stamp form cannot rescue a commit that no longer exists) — the work is
  gone regardless of who verified it, so `result[T].completed` is `false`.

### Done When
- [ ] A unit test constructs a commits list with no `Task: T` trailer and a sidecar
      stamp for `T` citing a sha absent from HEAD's history, then asserts
      `result[T].completed === false` and `result[T].auditEntry` is a non-empty
      string mentioning the unreachable sha.
- [ ] A test asserts the demotion warning is emitted for the unreachable case and is
      distinguishable from the reachable-pin log line.
- [ ] A test with a `semantic-verified` stamp form and an unreachable sha asserts the
      task is demoted (`completed === false`), proving no stamp form is exempt from
      the reachability requirement in this branch.

---

## Story: Rebase-translated stamp stays pinned (#535 no-regression)

**Requirement:** The fix must not re-open #535 — a sanctioned engine rebase that
moved the cited commit must still credit the task.

As the evidence gate, I want a stamp whose cited commit was moved by a sanctioned
rebase to keep crediting the task, so that reachability-gating the pin does not
demote correctly-rebased evidence and regress #535.

### Acceptance Criteria

#### Happy Path
- Given task `T`'s stamp cites the pre-rebase sha `X`, the persisted rewrite-map maps
  `X -> X'`, and `X'` exists and is an ancestor of HEAD, when derivation runs, then
  `result[T].completed` is `true` and `result[T].evidencedBy` is the resolved sha
  `X'` (not the stale `X`).

#### Negative Paths
- Given a sha `Y` that was NEVER a rewrite-map key (unrelated/forged) and is not
  reachable, when derivation resolves it through the map, then it resolves to itself
  (`Y`), fails the reachability check, and the task is demoted — confirming the
  rewrite-map cannot launder an off-branch citation into a pin.

### Done When
- [ ] A unit test seeds a rewrite-map `X -> X'` where `X'` is an ancestor of HEAD and
      `X` is not, with a sidecar stamp citing `X`, and asserts `result[T].completed
      === true` and `result[T].evidencedBy === X'`.
- [ ] A unit test confirms a sha absent from the rewrite-map that is also unreachable
      demotes the task (`completed === false`), proving the map is not a bypass.
