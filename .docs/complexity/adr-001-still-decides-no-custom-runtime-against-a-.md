# Complexity: ADR-001 still decides "No custom runtime" against a 106k-LOC runtime

Tier: M

## Rationale

- One new engine module: a decision-corpus classifier that derives each record's kind from its
  filename prefix, then its content (`Status:` → decision, `Verdict:` → review, otherwise
  unclassified), and its disposition through the existing `adrApprovalStatus`. Corpus locations come
  from `MANIFEST_KIND_LOCATIONS`, not hard-coded paths.
- One new read-only CLI subcommand (`ai-conductor decisions`), an additive `bin/conduct` surface that
  needs a migration block or release waiver.
- One land-gate extension: newly added files under the decision corpus must match a recognized
  prefix. Existing records in every repository are grandfathered.
- One record deletion (`001-harness-architecture.md`) plus citation repair in four on-main records,
  which rides the spec PR because `.docs/decisions` is a protected-artifact directory.
- One new ADR recording the classification and disposition rule and the query-over-committed-index
  choice.
- No new state, events, config keys, HALT classes or schema. Must stay compatible with the manifest
  layout work (#3418 building; #3419 not yet specified) and the ADR-relocation proposal (#782).

Not Large: the query is read-only, touches no gate's verdict logic beyond one added-file filename
rule, and has no cross-feature runtime coupling.
