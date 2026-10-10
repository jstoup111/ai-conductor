# Complexity: ATX-numbered ADR decision headings are citable

Tier: S

## Rationale

- **One regex in the single parsing authority.** `parseAdrDecisions`
  (`src/conductor/src/engine/artifacts.ts:4181`) recognizes a numbered decision with
  `/^\s*\*{0,2}(\d+)\.\s+\S/` (`artifacts.ts:4204`), which cannot step over a leading `###`. Allowing an
  optional `#{1,6}\s+` prefix is strictly additive: every line the current pattern matches still
  matches, so no id any consumer resolves today is lost.
- **Every consumer inherits the fix.** The land citability rung (`engineer/land-spec.ts:629`), the
  coherence obligation-id set (`engineer/coherence-validator.ts:1593`), coverage_binding's required
  decision ids (`step-runners.ts:4912`), the conflict claims (`coverage-binding-conflict-inputs.ts:128`),
  and as-built reference resolution (`as-built-contract.ts:412`) all read ids from that parser.
- **One parallel grammar.** The as-built projection's `decisionText`
  (`src/conductor/src/engine/as-built-projection.ts:88-121`) has its own declaration regexes; they gain
  the same optional ATX prefix so a cited decision projects its own text rather than the
  `Decision <n>` placeholder.
- **No new ADR.** APPROVED adr-2026-09-02-adr-decision-citability-contract decision 2 already lists
  ATX `###`-heading decisions among the accepted shapes; this delivers that decision, it does not
  change it. No new module, state, event, schema, CLI, hook, or settings surface.
- **Blast radius measured.** A replay of current and proposed patterns over all 339
  `.docs/decisions/adr-*.md` files changes the parse of exactly 16 ADRs, every one of them by adding
  heading starts; the id set grows for three
  (`adr-2026-08-13-stable-build-review-finding-dispositions` {4} -> {1..6},
  `adr-2026-08-13-engine-managed-build-review-rubric-branches` {1,2} -> {1..9},
  `adr-2026-08-09-operator-only-scoped-artifact-reseal` {1,2,3} -> {1..4}) and is unchanged for the
  other thirteen, which already carry a #2140 `D<n>` index. No unshipped plan cites the three.

Ceremony for Tier S: track + stories + plan; no architecture doc, no decisions doc, no conflict-check.
