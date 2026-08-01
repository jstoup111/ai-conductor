# Plan: park-reconciliation refusal observability

Feature: park-reconciliation-refusal-observability-1114
Refs: jstoup111/ai-conductor#1114
Tier: M
Governing ADR: `adr-2026-08-01-multi-proof-park-deletion-authority`

All source paths are relative to `src/conductor/`.

---

### Task 1 — Characterization test pinning the current delete/refuse partition

**Story:** S5

Before changing any reason string, add `test/engine/park-reconciliation-decision-partition.test.ts`
that drives `reconcileMergedPark` across the full evidence matrix (ancestor; head-identity match;
head ahead of tip; head behind tip; no merged PR; git failure; no branch; record missing) and asserts
only the **decision** — did it delete, or refuse — plus the `steps` array. It must not assert reason
strings. This is the safety net every later task is checked against.

**Dependencies:** none

---

### Task 2 — Introduce the `RefusalReason` union

**Story:** S1

In `src/engine/park-reconciliation.ts`, replace the inline refusal string literals with an exported
`RefusalReason` union adding `no-merge-proof`, `unmerged-commits`, `branch-behind-merged-head` and
retaining `invalid-slug`, `ancestry-check-failed`, `branch-missing`, `record-missing`,
`worktree-remove-failed`, `branch-delete-failed`, `unpark-failed`. Do not yet change which reason is
returned where — types only, so the compiler enumerates every site to update.

**Dependencies:** Task 1

---

### Task 3 — Widen the head-identity probe to return a diagnosis

**Story:** S1

Change `isSquashMergedAtTip` (`park-reconciliation.ts:206-246`) into `proveByMergedPrHead`, returning
a discriminated result rather than a bare boolean: `{ kind: 'proven' }`, `{ kind: 'no-pr' }`,
`{ kind: 'ahead', headRefOid }`, `{ kind: 'behind', headRefOid }`, `{ kind: 'indeterminate' }`.
Ahead/behind is decided with `git merge-base --is-ancestor <headRefOid> <ref>` after a
`git cat-file -e <headRefOid>^{commit}` existence guard; an unresolvable oid is `indeterminate`.
Keep the identical `gh` argv the existing test at `:251` asserts.

**Dependencies:** Task 2

---

### Task 4 — Map the diagnosis onto refusal reasons in the deletion gate

**Story:** S1

In the `unproven` loop (`park-reconciliation.ts:456-464`), map `no-pr` → `no-merge-proof`,
`ahead` → `unmerged-commits`, `behind` → `branch-behind-merged-head`, `indeterminate` →
`ancestry-check-failed`, `proven` → continue. The gate's *strength* is unchanged: only `proven`
passes, exactly as today. Update the pre-loop refusal at `:439` to `no-merge-proof`.

**Dependencies:** Task 3

---

### Task 5 — Verify Task 1's partition still holds

**Story:** S5

Run the characterization test from Task 1 unchanged. Any diff in the delete/refuse partition is a
defect in Tasks 3–4, not a test to update.

**Dependencies:** Task 4

---

### Task 6 — Collect the commits an `unmerged-commits` refusal would drop

**Story:** S2

Add a helper that runs `git log --oneline --no-decorate <headRefOid>..<ref>` through the injected
`GitRunner`, parses short sha + subject, caps the list at 10, and reports an overflow count. A
failing range returns `null`, which the caller maps to `ancestry-check-failed`. Attach the result to
the outcome as `unmergedCommits`.

**Dependencies:** Task 4

---

### Task 7 — Unit tests for the refusal taxonomy

**Story:** S1

Extend `test/engine/park-reconciliation.test.ts`'s refusal table to cover all four unproven reasons
with mocked git/gh. Re-pin the four existing squash-merge cases (`:294`, `:321`, `:349`, `:225`) to
their specific new reasons per conflict-check C1. Do not loosen any assertion to a wildcard.

**Dependencies:** Task 6

---

### Task 8 — Unit tests for the unmerged-commit listing

**Story:** S2

Cover: two commits listed in range order; over-cap list emits `… and M more`; failing `git log` →
`ancestry-check-failed` with no commit list; every non-`unmerged-commits` reason carries no list.

**Dependencies:** Task 6

---

### Task 9 — Add `refused` and `refusedByReason` to the sweep counters

**Story:** S3

In `reconcileParkedFeatures` (`park-reconciliation.ts:327`, `:369-390`), initialise `refused: 0` and
a `refusedByReason` record. Increment when `reconcileMergedPark` returns a refusal that is not
`record-missing` (which keeps counting as `deferred`). Leave the existing `parked++` accounting for
refused merged slugs exactly as-is.

**Dependencies:** Task 4

---

### Task 10 — Emit refusals in the summary line and guidance

**Story:** S3

Extend the summary at `:394-406` with `refused=N` and, when N > 0, a per-reason breakdown. Add a
`nextSteps` phrase for refusals so the guidance names the dominant cause. Zero refusals adds nothing.

**Dependencies:** Task 9

---

### Task 11 — Include refusals in the log de-duplication signature

**Story:** S4

Extend the `signature` string at `:394` to incorporate `refused` and the sorted `refusedByReason`
entries, so a refusal-mix change re-logs even when the visible counters are equal.

**Dependencies:** Task 10

---

### Task 12 — Sweep-level tests for counting and de-duplication

**Story:** S3

Cover `refused=3` across three refused slugs; per-reason breakdown; `refused=0` adds no noise;
`record-missing` counts `deferred` and not `refused`; refused merged slug's `parked` accounting
unchanged.

**Dependencies:** Task 11

---

### Task 13 — Negative test: refusal-mix change is never suppressed

**Story:** S4

Two consecutive sweeps with equal visible counters but different refusal reasons must re-log; two
fully identical sweeps must not. Assert cache pruning for no-longer-parked slugs is unchanged.

**Dependencies:** Task 11

---

### Task 14 — Render the new reasons through the operator verb

**Story:** S2

In `src/engine/daemon-park-cli.ts` (`:168-193`), print the refusal reason and, for
`unmerged-commits`, the commit lines. Preserve the non-zero exit code and emit no force-path
language.

**Dependencies:** Task 6

---

### Task 15 — Re-pin the acceptance suite

**Story:** S5

Update `test/acceptance/parked-feature-reconciliation.acceptance.test.ts:862` from `/ancestor/i` to
the specific reason its raced-branch scenario now produces, keeping every other assertion (branch
sha unchanged, marker survives, no force path) intact. Confirm the single-slug guard test at `:939`
and `test/engine/park-marker-invariant.test.ts` pass untouched.

**Dependencies:** Task 14

---

### Task 16 — Amend the 07-27 ADR in place

**Story:** S6

Add the established inline-italic amendment note to `adr-2026-07-27-ancestry-proven-park-reconciliation`
§3 and §1, pointing at `adr-2026-08-01-multi-proof-park-deletion-authority`, following the pattern at
`.docs/specs/2026-07-04-operator-park.md:37`. Add a one-line pointer in that spec's Non-Goals
amendment per conflict-check C3. Change no other clause.

**Dependencies:** Task 5

---

### Task 17 — Update operator documentation

**Story:** S6

`docs/reference/cli.md:242-278` — replace `not-ancestor` in the refusal table with the new reasons
and describe the commit listing. `docs/guides/running-the-daemon.md:350-411` — document the taxonomy
and the `refused=N` summary field, noting the dashboard's observational pass always reports 0 per
conflict-check C4.

**Dependencies:** Task 16

---

### Task 18 — Changelog and validation

**Story:** S6

Add a `CHANGELOG.md` `[Unreleased]` entry for the reader-visible refusal and summary change. Do not
touch `VERSION` (locked pre-v1). Run `test/test_harness_integrity.sh` and the conductor suite; fix
any failure before commit.

**Dependencies:** Task 17

---

## Task Dependency Graph

```
T1 ─▶ T2 ─▶ T3 ─▶ T4 ─┬─▶ T5 ──────────────▶ T16 ─▶ T17 ─▶ T18
                      │
                      ├─▶ T6 ─┬─▶ T7
                      │       ├─▶ T8
                      │       └─▶ T14 ─▶ T15
                      │
                      └─▶ T9 ─▶ T10 ─▶ T11 ─┬─▶ T12
                                            └─▶ T13
```

T1 gates everything: the partition must be pinned before the taxonomy moves. T5 re-runs it after the
gate rewrite and gates the documentation arm. The test arms (T7/T8, T12/T13) are independent of each
other and may run in parallel.

## Integration Points

- `src/engine/park-reconciliation.ts` — taxonomy, probe, gate, counters, summary
- `src/engine/daemon-park-cli.ts` — operator-verb rendering
- `src/daemon-cli.ts` — dashboard annotation map (read-only for this change; verify no drift)
- `.docs/decisions/`, `.docs/specs/2026-07-04-operator-park.md` — governance
- `docs/reference/cli.md`, `docs/guides/running-the-daemon.md`, `CHANGELOG.md`

## Verification

1. `npm test` in `src/conductor/` — unit, engine, and acceptance suites green.
2. Task 1's characterization test green **unchanged** — proves no branch crossed the delete/refuse line.
3. `test/test_harness_integrity.sh` green.
4. Manual: on a repo with parked slugs, `conduct daemon reconcile-parked <slug>` for a branch carrying
   a commit past its merged head prints `unmerged-commits` plus that commit and exits non-zero.
5. Manual: a daemon sweep with at least one refusal logs `refused=N` with a reason breakdown, and a
   second sweep with an unchanged mix does not re-log.
