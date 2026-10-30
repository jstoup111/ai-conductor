# Track: build-review record-reduced-coverage refuses every stacked-feature child (#3498)

Track: technical

Scope boundary: The desired outcomes of jstoup111/ai-conductor#3498. The operator chose the
"CLI + halt text" breadth. The changes:
- `build-review record-reduced-coverage` gains an optional `--child <k>`. With it, the initial read
  and the in-lease recheck both use child k's aggregate (`.pipeline/children/<k>/build-review.json`).
  The mechanical-fault allowance precondition reads child k's kickback-ledger `build_review` entry,
  which is the count the child's halt reported. The decision is still written to the
  feature-scoped disposition store. The live gate already reads that store for every child.
- Each refusal names its cause. A missing or malformed artifact is named by its pipeline-relative
  path, along with the reason. The `aggregate-unreadable` hint that #3448 added applies too: when a
  stacked feature has no root aggregate and `--child` was omitted, the refusal lists the children
  that have one.
- The exhausted-allowance halt for a stacked child prints a `record-reduced-coverage` command that
  carries `--child <k>`, so it works for that child as printed.
- Without `--child`, a flat feature behaves as today, apart from the more specific failure text.

Excluded:
- Child-scoping the reduced-coverage record itself. Records stay feature-scoped and do not
  expire (`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D6 and D9;
  `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9). A decision recorded through
  `--child k` therefore also covers a later sibling child with the same rubric and closed cause.
  The operator accepted this and declined the Medium-tier schema change.
- No execution-child default. Without `--child`, the command reads the root aggregate, matching
  `findings`, `accept` and `resolve-case`.
- The `read-only-review-unavailable` halt text. It prints no command, so no `--child` form is
  wrong there.
- The event schema is unchanged. The refusal and acceptance events keep their `type`, and
  existing refusal reasons keep their values. Refusals that used to fall into the catch-all now
  record specific reasons. They reuse `accept`'s existing `invalid-child`, `aggregate-unreadable`,
  `requested-lap-not-current` and `disposition-store-<kind>`, and add
  `kickback-ledger-unreadable`. The event's `reason` is a free-form string.
- Human-facing docs (`docs/reference/cli.md` and the runbooks) are left to the
  `maintain-documentation` pre-finish gate.

Rationale: this is an operator-CLI read-path defect with no product surface. It is the sibling of
#3448 (shipped in PR #3513), which fixed `findings` and `accept` for the same root-only read.
Existing APPROVED decisions already place per-child review state under `.pipeline/children/<k>/`
(`adr-2026-10-07-per-child-build-region` D4, D9 and D10). Acceptance criteria live in stories.

Approach: explicit `--child` on the command, reusing #3448's child-scoped aggregate reader
(`readCliBuildReviewAggregate`, `describeCliAggregateFailure`). The renderer receives the active
child and prints it. This is the filer's hypothesis. It won on merits. Rejected alternatives:
- Default to the execution child through the stack cursor. The cursor refuses on a divergent or
  detached stack. It would also give a state-changing command an implicit write target, and it
  would diverge from #3448's rejection of the same default.
- Change only the halt text, telling the operator to edit state by hand. That misses outcomes 1,
  2 and 4.
