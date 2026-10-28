# Track: build-review accept and findings refuse every stacked-feature child (#3448)

Track: technical

Scope boundary: The desired outcomes of jstoup111/ai-conductor#3448, delivered in the operator
CLI only (`src/conductor/src/engine/build-review-cli.ts` and the `build-review` grammar in
`src/conductor/src/cli.ts`). The changes:
- `build-review findings --feature <slug> --child <k>` reads child k's own review state, the same
  files the live `build_review` gate writes for that child. That means child k's aggregate
  (`.pipeline/children/<k>/build-review.json`), its kickback-ledger `build_review` entry, and its
  remediation case store. It also reads the feature-scoped disposition store, as today.
- `build-review accept` gains an optional `--child <k>`. With it, the lap, the current finding and
  the unchanged-lap recheck all come from child k's aggregate. The acceptance is still written to
  the feature-scoped disposition store, which the live gate already reads for every child.
- Each refusal of both commands names its cause. A missing or malformed artifact is named by its
  pipeline-relative path, along with the reason. When a stacked feature has no root aggregate and
  `--child` was omitted, the refusal lists the children that have one and shows the `--child` form.
- Without `--child`, a flat feature behaves as today, apart from the more specific failure text.

Excluded:
- No execution-child default. Without `--child`, both commands keep reading the root aggregate.
  The refusal hint, not an implicit child choice, makes the stacked form discoverable. This
  matches `resolve-case`, which has no default either.
- Halt text. The rejected-transition halt's `Inspect with ai-conductor build-review findings
  --feature <slug>` hint, and the interim regression-halt text from #3449 (open PR #3491, which says
  `accept` has no `--child` yet), are left as they are. #3491 touches the same coordinator file and
  is not on main. Switching its child form to `accept --child` is a follow-up once it merges.
- `build-review record-reduced-coverage`. It also reads only the root aggregate and the root
  ledger. It is a sibling defect, reported for a separate intake.
- The refusal events keep their existing `reason` values, and the event schema is unchanged.
- Human-facing docs (`docs/reference/cli.md` and the runbooks) are left to the
  `maintain-documentation` pre-finish gate.

Rationale: this is an operator-CLI read-path defect with no product surface. Existing APPROVED
decisions already place per-child review state under `.pipeline/children/<k>/` and keep the
disposition store feature-scoped. Those decisions are `adr-2026-10-07-per-child-build-region` D4,
D9 and D10, and `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9. The two commands
are the readers that do not follow them. Acceptance criteria live in stories.

Approach: explicit child scope on both commands, plus cause-naming refusals. This is the filer's
hypothesis. It won on merits. Rejected alternatives:
- Default `--child` to the execution child, as `kickback-budget` and `rewind` do. That makes an
  inspection command depend on stack-cursor resolution. The cursor refuses on a divergent or
  detached stack, which is exactly when an operator needs to inspect it. It would also give
  `accept` an implicit write target, and it would make `findings` and `accept` disagree with
  `resolve-case`.
- Only replace the generic message, with no child scope. The operator could see why the command
  failed but still could not list or accept a child's findings. That misses outcomes 1 and 2.
- Move child aggregates to the root path, or mirror them there. That conflicts with
  `adr-2026-10-07-per-child-build-region` D4, and a mirror would be a second copy of review
  state that could drift from the original.
