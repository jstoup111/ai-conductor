**Status:** Accepted

# Stories: bounded build_review convergence and removal-anchored Tautology grading

**Issue:** #1521
**Track:** technical — there is no PRD, so these stories are the acceptance-criteria artifact.
**Tier:** M (full per-criterion negative-path rule applies).

Requirements are cited against the two APPROVED ADRs rather than PRD `FR-N` ids, since the
technical track has no PRD:

- `adr-2026-08-12-cumulative-build-review-convergence-bound.md` → cited as **CB-D1**..**CB-D6**
- `adr-2026-08-12-removal-anchored-tautology-exemption.md` → cited as **RT-D1**..**RT-D5**

Issue outcomes these serve:

- **O1** — repeated `build_review` semantic failures reach a bounded, operator-visible terminal
  state even when each remediation lap changes the tree.
- **O2** — compatibility-only fixture maintenance stays support work without requiring unrelated
  behavioral assertions, while tests claiming new/changed behavior stay mutation-sensitive.
- **O3** — a remediation that actually clears the blocking finding continues normally.
- **O4** — daemon evidence makes the cumulative review/rework history and terminal reason
  observable.

---

## Story 1: The cumulative counter survives tree movement

**Requirement:** CB-D1 (O1)

As an operator whose feature is failing `build_review` for the fifth time, I want the ledger to
count every lap regardless of whether the tree changed, so that a feature which never converges is
distinguishable from one that has failed once.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` ledger entry with `cumulative: 2` and `treeHash: "aaa"`, when a kickback
  is consumed with `treeHash: "bbb"` (a changed tree), then the returned entry has `cumulative: 3`
  and `count: 1`.
- Given a `build_review` ledger entry with `cumulative: 2` and `treeHash: "aaa"`, when a kickback
  is consumed with the same `treeHash: "aaa"` and an unchanged resolved count, then the returned
  entry has `cumulative: 3` and `count: 2`.
- Given no prior ledger entry for `build_review`, when the first kickback is consumed, then the
  entry has `cumulative: 1`.
- Given a sequence of eight kickbacks each supplying a distinct `treeHash`, when all eight are
  consumed in order, then `cumulative` reads 1,2,3,4,5,6,7,8 across them while `count` reads 1 on
  every one.

#### Negative Paths
- Given a ledger file on disk whose `build_review` entry has no `cumulative` key at all (written by
  a prior engine version), when the ledger is read, then the ledger is accepted as valid and the
  entry's `cumulative` resolves to `0` — it is not rejected as corrupt and does not fall back to an
  empty ledger.
- Given a ledger file whose `build_review` entry has `cumulative` set to a non-number such as
  `"3"` or `null`, when the ledger is read, then the entry is rejected by the type guard and the
  tolerant-read path returns an empty ledger with a warning, exactly as it does for any other
  malformed field.
- Given a ledger entry with `cumulative: 4`, when a kickback is consumed for a *different* gate
  such as `test_suite`, then the `build_review` entry's `cumulative` is unchanged at 4.
- Given a kickback is consumed and the ledger write fails mid-operation, when the ledger is read
  back, then it contains either the complete prior state or the complete new state and never a
  partially written entry.

### Done When
- [ ] `KickbackGateEntry` declares `cumulative: number` and the exported type guard accepts an
      entry missing that key, resolving it to `0`.
- [ ] `bumpKickbackGate` increments `cumulative` on both the `madeProgress` and no-progress
      branches, with a unit test asserting the eight-changed-tree sequence above yields
      `cumulative: 8` and `count: 1`.
- [ ] The existing `kickback-ledger` unit suite still passes unmodified in its assertions about
      `count`, `treeHash`, `resolvedBefore`, and `priorVerdict`.

---

## Story 2: A passing build_review clears the cumulative count

**Requirement:** CB-D2 (O3)

As an operator, I want a `build_review` PASS to wipe the accumulated lap count, so that a feature
which converged and is later re-reviewed after a rebase does not inherit laps it already resolved.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` ledger entry with `cumulative: 4`, when `build_review` returns a PASS
  verdict, then the entry's `cumulative` is `0`.
- Given a `build_review` ledger entry with `cumulative: 4` and `count: 2`, when `build_review`
  returns a PASS verdict, then `count` is still `2` — the PASS reset touches `cumulative` only.
- Given a feature that passed `build_review` with `cumulative` reset to `0`, when a later rebase
  invalidates the verdict and `build_review` runs again and FAILs, then the new kickback records
  `cumulative: 1` rather than `5`.

#### Negative Paths
- Given a `build_review` FAIL verdict, when the verdict is recorded, then `cumulative` is NOT
  reset — only a PASS clears it.
- Given no ledger file exists at all, when `build_review` returns a PASS, then the reset is a
  no-op that completes without error and creates no spurious entry.
- Given a `build_review` PASS, when the reset runs, then no other gate's entry in the `gates`
  record is modified.
- Given the ledger file is unreadable (permissions or corruption) at the moment of a PASS, when
  the reset is attempted, then the failure does not interrupt the run or fail the passing step.

### Done When
- [ ] A `build_review` PASS path calls the cumulative reset, verified by a test asserting the
      entry reads `cumulative: 0, count: 2` afterwards.
- [ ] A test asserts a FAIL verdict leaves `cumulative` untouched.
- [ ] A test asserts the reset is a safe no-op against a missing ledger.

---

## Story 3: Exceeding the cumulative cap halts for a human

**Requirement:** CB-D3 (O1, O4)

As an operator, I want a feature that has failed `build_review` more times than the cap to stop and
name why, so that it cannot consume unbounded review/rework laps while I am not watching.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` ledger entry with `cumulative: 5` and the cap set to 5, when another
  `build_review` FAIL consumes a kickback taking `cumulative` to 6, then the loop writes a halt
  marker and returns instead of navigating back to `build`.
- Given that halt is written, when the halt class sidecar is read, then it reports `needs-human`.
- Given that halt is written, when the halt reason text is read, then it names the gate
  (`build_review`), the cumulative lap count, the cap, and the last recorded reason.
- Given that halt is written, when `.pipeline/events.jsonl` is read, then it contains a
  `loop_halt` event carrying that same reason.

#### Negative Paths
- Given a `build_review` ledger entry with `cumulative: 4` and the cap set to 5, when a FAIL
  consumes a kickback taking `cumulative` to 5, then NO halt is written and the loop navigates
  back to `build` as it does today — the cap bounds laps beyond 5, and lap 5 itself still runs.
- Given a feature at `cumulative: 3` whose next remediation actually clears the finding, when
  `build_review` then PASSes, then no halt is ever written and the feature proceeds to the next
  step.
- Given the cumulative cap is exceeded on the same lap that the per-tree `count` is also
  exhausted, when the FAIL is handled, then exactly one halt is written, not two, and its reason
  is unambiguous about which bound terminated the run.
- Given a `needs-human` cap halt exists, when the daemon's re-kick sweep runs after a base
  advance, then the halt is NOT cleared and the feature is NOT re-dispatched.
- Given the cap halt path runs, when a gate other than `build_review` exhausts its budget, then
  that gate's existing halt behavior and reason text are byte-for-byte unchanged.

### Done When
- [ ] A named exported cap constant equal to `5` exists and is the single source consulted.
- [ ] A test drives six `build_review` FAIL laps with a distinct tree hash each and asserts a halt
      is written on the sixth and not on the fifth.
- [ ] A test asserts the halt class sidecar reads `needs-human`.
- [ ] A test asserts the halt reason contains the gate name, the cumulative count, the cap, and the
      last reason string.
- [ ] A test asserts a `loop_halt` event carrying that reason reaches the event ledger.

---

## Story 4: The bound can be switched off

**Requirement:** CB-D4 (O1)

As an operator whose repository is being halted by a cap that is too tight for its work, I want a
config switch that restores the prior behavior, so that a wrong cap value is a one-line revert
rather than an engine downgrade.

### Acceptance Criteria

#### Happy Path
- Given no config block for this feature is present at all, when the cumulative bound is
  consulted, then it resolves to enabled — the absent block defaults on.
- Given the config block is present with `enabled: true`, when six FAIL laps occur, then the cap
  halt is written on the sixth.
- Given the config block is present with `enabled: false`, when ten FAIL laps occur each with a
  changed tree, then no cumulative cap halt is ever written and the loop keeps navigating back to
  `build`, matching pre-feature behavior exactly.

#### Negative Paths
- Given the config block is present with `enabled: false`, when the laps run, then the
  `cumulative` counter is still incremented and still emitted on the `kickback` event — the switch
  disables the *halt*, not the observability.
- Given the config block contains an unexpected key alongside `enabled`, when the config is
  resolved, then the unknown key is ignored and `enabled` is honored, matching how the existing
  kickback-escalation block behaves.
- Given the config file is absent or unreadable, when the bound is consulted, then it resolves to
  enabled rather than throwing or silently disabling the guard.
- Given `enabled: false`, when the per-tree `count` bound exhausts, then that existing halt still
  fires — the switch governs only the new cumulative bound.

### Done When
- [ ] A config interface with a single optional `enabled` field is declared and documented, with a
      doc comment stating that an absent block resolves to enabled.
- [ ] A test asserts absent block → halt fires at the cap.
- [ ] A test asserts `enabled: false` → ten changed-tree laps produce no cap halt.
- [ ] A test asserts `enabled: false` still increments `cumulative` and still populates the event
      field.

---

## Story 5: The kickback event carries the cumulative count

**Requirement:** CB-D5 (O4)

As an operator reading `.pipeline/events.jsonl` after a churn incident, I want each kickback to
report how many laps this gate has taken in total, so that eight non-converging laps do not all
read as `count: 1`.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` FAIL that consumes a kickback bringing `cumulative` to 3, when the
  `kickback` event is emitted, then the event carries `cumulativeCount: 3` alongside its existing
  `count`.
- Given eight successive `build_review` kickbacks each with a changed tree, when the event ledger
  is queried for `type == "kickback" and from == "build_review"`, then the eight rows report
  `cumulativeCount` 1 through 8 while `count` reports 1 on each.
- Given the cap halt fires, when the `loop_halt` event is read, then its reason states the
  cumulative lap count.

#### Negative Paths
- Given an event consumer written before this field existed, when it reads a `kickback` event
  carrying `cumulativeCount`, then it continues to parse the event and read `count` without error —
  the field is additive and optional.
- Given a kickback for a gate the cumulative bound does not cover, when its event is emitted, then
  the absence of `cumulativeCount` does not break the event schema or any reader.
- Given the cumulative bound is switched off, when a kickback event is emitted, then
  `cumulativeCount` is still present and accurate.
- Given the ledger write for `cumulative` failed, when the event is emitted, then the event is not
  emitted with a fabricated or stale cumulative figure.

### Done When
- [ ] The `kickback` member of the event union declares an optional `cumulativeCount: number` with
      a doc comment distinguishing it from `count`.
- [ ] A test asserts the emitted `kickback` event for a `build_review` FAIL carries the cumulative
      figure from the ledger.
- [ ] A test reproduces the eight-lap sequence and asserts the emitted events read
      `cumulativeCount` 1..8 with `count` 1 throughout — the exact history the incident could not
      show.

---

## Story 6: The engine derives removal evidence from the diff

**Requirement:** RT-D1 (O2)

As the `build_review` grader, I want the engine to tell me exactly what this diff removes, so that
I can distinguish removal maintenance from a tautological test without taking the maker's word for
it.

### Acceptance Criteria

#### Happy Path
- Given a diff that deletes a source file entirely, when removal evidence is derived, then the
  deleted file's path appears in the evidence.
- Given a diff that removes an exported declaration from a file that still exists, when removal
  evidence is derived, then that declaration's name appears in the evidence.
- Given a diff that removes a member from an exported interface, type alias, or enum in a file
  that still exists, when removal evidence is derived, then that member appears in the evidence,
  attributed to its declaring type.
- Given a diff with all three kinds of removal, when removal evidence is derived, then all three
  are present in one evidence set.

#### Negative Paths
- Given a purely additive diff that removes nothing, when removal evidence is derived, then the
  evidence set is empty and rendering it produces the same `(none)` placeholder the sibling
  evidence blocks use — not a missing section or a crash.
- Given a diff that renames a file, when removal evidence is derived, then the rename is not
  reported as a deletion of behavior that would license exempting unrelated tests.
- Given a diff that removes a line which merely *mentions* an exported name inside a comment or
  string, when removal evidence is derived, then no removed declaration is reported for it.
- Given a diff containing a declaration spanning multiple lines that the text parse cannot fully
  resolve, when removal evidence is derived, then that removal is simply absent from the evidence
  set — the deriver never throws, and the omission causes the ordinary mutation-sensitivity check
  to apply, which is the pre-feature behavior.
- Given a diff so large that parsing is expensive, when removal evidence is derived, then it is
  computed from the diff string the engine has already assembled, issuing no additional `git`
  subprocess.

### Done When
- [ ] A deriver module exports a function taking the assembled diff and returning a structured
      removal set with the three kinds distinguished.
- [ ] Unit tests cover: deleted file, deleted exported declaration, removed type member, all
      three together, empty result on an additive diff, and no-throw on an unparseable declaration.
- [ ] A test asserts the deriver issues no `git` invocation of its own.

---

## Story 7: The grader receives removal evidence and applies a per-test exemption

**Requirement:** RT-D2, RT-D3, RT-D4 (O2)

As an operator shipping a cleanup, I want a fixture updated because a type lost a member to pass
Tautology, while any test claiming behavior the diff does not introduce still fails it, so that
removal work stops paying a review tax without weakening the gate.

### Acceptance Criteria

#### Happy Path
- Given a derived removal set, when the grader prompt is assembled, then it contains a removal
  evidence block rendered beside the existing repair-context, accepted-widenings, and gate-
  instruction blocks.
- Given that block is rendered, when its framing text is read, then it states that the removals are
  evidence and not an exemption, matching the framing the sibling blocks already use.
- Given the Tautology rubric text, when it is read, then it states all three conditions required
  for a changed test to count as removal maintenance: the evidence contains a specific removal, the
  test's changed lines reference that specific removal, and the change adds no assertion about
  behavior that still exists.
- Given an empty removal set, when the prompt is assembled, then the removal block renders its
  `(none)` placeholder and the Tautology rubric is otherwise unchanged from today.

#### Negative Paths
- Given the rubric text, when it is read, then it explicitly states that a diff which deletes
  something does not exempt every test it touches — the exemption is evaluated per changed test,
  never per diff.
- Given the rubric text, when it is read, then it states that a test which both drops a removed
  assertion and adds a new behavioral assertion is still measured on the added assertion.
- Given the rubric text, when it is read, then it contains no host-specific tool name, path, or
  invocation syntax, so a Codex grader session reads it identically to a Claude one.
- Given the removal evidence block, when it is assembled, then it is derived only from the diff and
  the resolved merge base — it introduces no reference to the maker's transcript, summary, or
  `.pipeline/task-status.json`, preserving the grader's input isolation.
- Given a removal set containing a value with backticks or other prompt-breaking characters, when
  the block is rendered, then the characters are escaped the same way the existing gate-instruction
  block escapes them.
- Given the other three rubric items, when the prompt is assembled, then their text is unchanged
  and the all-or-FAIL rule is unchanged.

> **Amended 2026-08-12 by #1521:** the criterion above is restated so it does not count rubric
> items. `adr-2026-08-11-wiring-judged-in-build-review` is APPROVED and extends the all-or-FAIL
> rule from four items to five; its implementation is unmerged (PR #1517), so a criterion phrased
> as "the other three" and "unchanged" is true against main and false once #1517 lands. The
> replacement criterion is item-count agnostic and asserts what the story actually means:
>
> - Given every rubric item other than Tautology, when the prompt is assembled, then each one's
>   text is unchanged and the all-or-FAIL rule still requires every rubric item to pass.
>
> Sequencing was resolved by the operator: this spec lands first and PR #1517 rebases onto it.

### Done When
- [ ] `BuildReviewInputs` declares an optional removal-context field with a doc comment stating it
      is evidence, not an exemption.
- [ ] The prompt assembler renders the block, with a test asserting both the populated and
      `(none)` renderings.
- [ ] A test asserts the assembled prompt contains all three exemption conditions and the explicit
      per-test (not per-diff) statement.
- [ ] A test asserts that every rubric item other than Tautology has unchanged text, and that the
      all-or-FAIL rule still requires every rubric item to pass — asserted without hard-coding how
      many rubric items exist.
- [ ] A test asserts the removal block escapes prompt-breaking characters.
- [ ] The Tautology exceptions are rendered as an explicitly enumerated, closed list — the existing
      rebase-repair exception and this removal exemption, each naming its own evidence block —
      followed by a statement that a changed test qualifying under neither is measured normally. A
      test asserts the closing statement is present. (Conflict-check Conflict 2, Option 1.)

> **Amended 2026-08-15 by #1579:** the closed list has since grown — fixture relocation (third)
> and verify-only maintenance (fourth, `adr-2026-08-15-verify-only-anchored-tautology-exemption.md`).
> The list remains explicitly enumerated and closed with the same measured-normally closing
> statement; only the entry count changed.


---

> **Note on scope.** The documentation updates this change owes — `docs/explanation/gates.md` and
> `docs/runbooks/stalled-or-stuck-feature.md` — deliberately carry no story. Ordinary documentation
> is not a behavioral requirement; it travels with the functional work as plan tasks.
