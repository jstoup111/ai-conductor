# Track: Amendment notes in common header forms are invisible to coverage_binding

Track: technical

Scope boundary: Widen the amendment-note recognizer that feeds `coverage_binding`'s D18 amendment claims (`amendmentBlocks` in `src/conductor/src/engine/coverage-binding-inputs.ts`) so every amendment-note form present in the default-branch corpus is read, while fenced code examples and blockquotes that are not amendment notes stay excluded. Included: quoted notes at any indentation, unquoted bold-`Amended` notes, wrapped headers, consecutive notes, the merge-base inheritance exclusion for widened forms, and the D18 ADR amendment recording the widened rule. Excluded: a land-time refusal of non-canonical headers (no corpus form is left unread, so there is nothing to refuse), the D21 inherited-amendment paragraph matcher in `coverage-binding-conflict-inputs.ts`, reformatting legacy notes, and any change to the HARNESS.md authoring form.

Internal engine input parsing with no product requirements; acceptance criteria live in stories (intake jstoup111/ai-conductor#2982).

## Approach decision

- **Chosen — structural recognizer.** A note starts at any line, outside fenced code, whose text after optional indentation and an optional `>` begins with bold `Amended`. Reads all 482 quoted headers in the corpus (281 canonical, 201 not, counted at e6b56fe3da over `.docs/specs/*.md`, `.docs/decisions/adr-*.md`, `.docs/decisions/architecture-review-*.md`) plus the unquoted forms. Est. effort ~1-2h; impact: no amendment note in a DECIDE set is skipped silently.
- **Rejected — "date plus `#N`" grammar (filer hypothesis 1).** Leaves every reference-less form unread (`by operator decision`, `during conflict-check`, `by the operator`), which the corpus uses dozens of times.
- **Rejected — land refuses non-canonical headers in changed files (filer hypothesis 2).** It reads nothing new and pushes every author into reformatting. Land also stages only untracked `.docs/`, so it would need new diff-against-base machinery to see amendments to existing artifacts. With the structural recognizer, no corpus form is left to refuse.
