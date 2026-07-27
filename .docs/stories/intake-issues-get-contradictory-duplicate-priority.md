**Status:** Accepted

# Stories: Intake label authority — no contradictory duplicate priority:/size: labels (#889)

Technical track — no PRD. Requirements (TR-N) derive from
`adr-2026-07-23-intake-label-authority-scoped-replace` (APPROVED) and Conditions 1–4 in
`architecture-review-2026-07-23-intake-label-authority.md`. Source:
jstoup111/ai-conductor#889.

Vocabulary used throughout: a **namespace** is the set of labels on an issue matching
`^priority: ` or `^size: `. **Explicit** = a value passed to the seam in the closed
vocabulary. **Default** = `priority: medium` / `size: M`.

---

## Story: The seam resolves a single winner by authority tier

**Requirement:** TR-1

As the intake automation, I want one rule that ranks an explicitly-chosen value above a
label already on the issue, and both above my own fallback, so that a default can never
contradict or overwrite what a human actually chose.

### Acceptance Criteria

#### Happy Path
- Given the seam is called with `priority: 'high'` and the issue already carries
  `priority: medium`, when the sync runs, then the resolved winner is `priority: high` and
  the result reports its authority as `explicit`.
- Given the seam is called with no parsed priority and the issue already carries
  `priority: low`, when the sync runs, then the resolved winner is `priority: low`, the
  authority is `existing`, and no default is introduced.
- Given `priority:` and `size:` resolve at different tiers on the same issue (e.g. size
  explicit, priority existing), when the sync runs, then each namespace resolves
  independently and neither influences the other.

#### Negative Paths
- Given the seam is called with no parsed value and the issue carries **no** label in the
  namespace, when the sync runs, then the default (`priority: medium` / `size: M`) is
  applied and the authority is reported as `default` — the negative path in #889 that must
  keep working.
- Given the seam is called with an out-of-vocabulary value (`priority: 'urgent'`,
  `size: 'XL'`, empty string, or a case variant such as `'High'`/`'m'`), when the sync
  runs, then it is treated as unparsed and resolution falls to the `existing` tier, then
  `default` — never applied as a label.
- Given a namespace already holds two or more **non-default** labels (e.g.
  `priority: high` + `priority: low`) and no explicit value is supplied, when the sync
  runs, then that namespace is left untouched and surfaced as unresolvable in the result —
  the seam never picks between two operator-plausible values.
- Given a namespace holds exactly one non-default label plus the default, when no explicit
  value is supplied, then the non-default label is the winner.

### Done When
- `syncIssueLabels` returns, per namespace, the winning label and its authority
  (`explicit` | `existing` | `default`), plus any namespace it declined to resolve.
- The existing `priorityDefaulted` / `sizeDefaulted` result fields remain populated and
  consistent with the new authority field (no caller breakage).

---

## Story: Applying the winner collapses the namespace without touching other labels

**Requirement:** TR-2

As a repo maintainer, I want the sync to leave exactly one `priority:` and one `size:`
label behind while preserving every other label, so that triage is unambiguous and no
dependency or workflow label is destroyed.

### Acceptance Criteria

#### Happy Path
- Given an issue carrying `size: S` and `size: M` and a resolved winner of `size: S`, when
  the sync applies, then `size: M` is removed via the REST label-delete endpoint and
  `size: S` remains — exactly one `size:` label on the issue afterwards.
- Given the winner is already the only label in its namespace, when the sync applies, then
  no delete call is issued for that namespace.
- Given the sync runs twice in a row with identical inputs, when the second run completes,
  then the issue's label set is byte-identical to after the first run and no additional
  labels exist.

#### Negative Paths
- Given the issue also carries `engineer:handled`, `blocked_by:#123`, and an unrelated
  hand-applied label, when the sync applies, then all three are still present afterwards —
  removal is scoped to `^priority: ` / `^size: ` and no code path calls the set-labels
  (`PUT`) endpoint. (Condition 2)
- Given the label-read call fails (auth, rate limit, network), when the sync runs, then it
  does not throw, it does not delete anything, and it degrades to at most an additive apply
  of the explicit value — a read failure must never remove a label.
- Given a label-delete call fails, when the sync runs, then the failure is logged, the
  remaining namespaces are still processed, the process exits 0, and the workflow stays
  green (the labels-only isolation rule is preserved).

### Done When
- Removal uses `restRemoveLabelArgs` from `pr-labels.ts` (URL-encoded name); no new REST
  idiom is introduced and no `PUT .../labels` call exists in the codebase.
- A test pins survival of a co-resident `engineer:handled` + `blocked_by:#N` across a sync.

---

## Story: A CLI-filed issue and the workflow agree on the same value

**Requirement:** TR-3

As an operator filing with `bin/intake-file --size S --priority high`, I want the labels
the CLI reports at filing time to be the labels the issue still has once all automation has
settled, regardless of which writer finishes last.

### Acceptance Criteria

#### Happy Path
- Given `bin/intake-file` resolves size `S` and priority `high`, when it creates the issue,
  then the submitted body contains `### Priority` followed by `high` and `### Size`
  followed by `S`, in the exact shape `extractField` already parses.
- Given that body, when `extractField` is applied to it for `Priority` and `Size`, then it
  returns `high` and `S` — so the workflow independently derives the same values the CLI
  applied, and its default is never reached.
- Given the CLI's apply and the workflow's apply run in either order against the same
  issue, when both have completed, then the final label set is identical in both orderings.
  (Condition 3 — the property that retires the race.)
- Given the resulting issue body, when a human reads it, then the original
  `## Observed` / `## Impact` / `## Desired outcome` content is intact and the added
  headings are appended, not interleaved.

#### Negative Paths
- Given a body submitted through the **GitHub issue form**, when the apply script parses
  it, then behavior is bit-identical to today: the `extractField` regex is unchanged, the
  Priority/Size/Depends-on headings resolve as before, and `_No response_` still yields
  `undefined`.
- Given an operator edits the issue-form Priority dropdown from `low` to `critical` and
  saves, when the `edited` run fires, then the issue ends with `priority: critical` only —
  the explicit tier overrides the existing label rather than being suppressed by it (the
  regression the "skip if already labelled" alternative would have caused).
- Given an intake issue filed before this change whose body has no `### Priority` heading,
  when the workflow re-runs on an edit, then its current labels are preserved via the
  `existing` tier and no default is added.

### Done When
- `extractField`'s regex in `intake-label-sync-apply.mts` is unmodified in the diff.
- The issue-form acceptance tests pass **unmodified**.

---

## Story: The 23 already-affected issues are cleaned up in one sweep

**Requirement:** TR-4

As a repo maintainer, I want a one-shot sweep that collapses every existing duplicated
namespace to the value that was actually chosen, so the open issue list is triageable
without hand-editing 23 issues.

### Acceptance Criteria

#### Happy Path
- Given open issues whose `priority:` or `size:` namespace holds more than one label, when
  the sweep runs, then each such namespace is collapsed to its single winner per TR-1's
  existing-tier rule (drop the default, keep the non-default).
- Given the sweep is run without an explicit write flag, when it completes, then it reports
  the per-issue before/after plan and makes **zero** mutating `gh` calls.
- Given the sweep is re-run after a successful write pass, when it completes, then it finds
  nothing to do and makes zero mutating calls.
- Given an issue with exactly one `priority:` and one `size:` label, when the sweep runs,
  then it is skipped entirely.

#### Negative Paths
- Given an issue whose namespace holds two or more non-default labels, when the sweep runs,
  then it is left untouched and listed in an `unresolved` section of the report for human
  resolution — never auto-resolved. (Condition 4)
- Given one issue's label-delete fails mid-sweep, when the sweep continues, then remaining
  issues are still processed and the failure is reported per-issue (matching
  `backfill.ts`'s existing single-issue failure isolation).
- Given the existing `backfill.ts` skip logic (an issue with a parsed size **and** priority
  is skipped with no `gh` calls), when the dedupe sweep selects candidates, then it selects
  on namespace **cardinality > 1**, not on that predicate — otherwise it would no-op over
  every affected issue. (Condition 4 / F4)

### Done When
- The sweep reuses the seam's resolution rule rather than reimplementing it.
- Running it against a fixture reproducing all 23 observed label combinations yields
  exactly one `priority:` and one `size:` label per issue, with the non-default value
  retained in every case, and zero `unresolved` entries.

---

## Story: The documented behavior matches the code

**Requirement:** TR-5

As the next maintainer of this workflow, I want the header comment to describe what the
code actually does, so I do not implement the destructive full replace it currently
prescribes.

### Acceptance Criteria

#### Happy Path
- Given `.github/workflows/intake-label-sync.yml`, when its header is read, then the
  idempotency paragraph describes a namespace-scoped replace and the explicit > existing >
  default ladder, and no longer claims a "set labels" full-replace REST call.
- Given the header, when the defaults paragraph is read, then it states that defaults apply
  only to an **empty** namespace and never override an existing or explicit value.
- Given `docs/` and `src/conductor/README.md`, when the intake-labelling behavior is
  described, then the authority ladder and the dedupe sweep's flag are documented (repo
  rule: docs track features, same PR).
- Given `CHANGELOG.md`, when `## [Unreleased]` is read, then it carries a `### Fixed` entry
  for #889.

#### Negative Paths
- Given the false-green acceptance test "re-edit with identical values is idempotent", when
  the change lands, then that test has been rewritten to use **differing** values and was
  demonstrated failing against pre-fix `main`. (Condition 1)
- Given `test/test_harness_integrity.sh`, when it runs on the resulting tree, then it
  passes.

### Done When
- No statement in the workflow header, `backfill.ts`'s header, or the seam's module doc
  contradicts the implemented behavior.
