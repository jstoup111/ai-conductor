**Status:** Accepted

# Stories: Ignore Covers markers inside test string literals (#2597)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (option A). Desired outcome 2 is declined because it conflicts with the approved engine-owned test-quality scope ADR; file-level marker rules are unchanged.

## Story 1: Covers text inside a literal is never a marker

### Acceptance Criteria

#### Happy Path

- Given a test file in which a template literal with a substitution contains the text "// Covers: task:8", when Covers marker bindings are computed for that file, then no binding carries a marker whose span lies inside that literal.
- Given a real leading "// Covers: task:7" comment on a test that follows such a template literal in the same file, when Covers marker bindings are computed, then that test is bound to task 7 through a leading-comment association.

#### Negative Paths

- Given string and template literals whose Covers text has an empty or malformed reference list, when Covers marker bindings are computed, then no unresolved-reference or uncertain-association binding is produced from that text.

### Done When

- [ ] A bindings unit fixture with Covers text inside double-quoted, single-quoted, and substituted template literals yields no marker span inside any literal.
- [ ] The same fixture binds the real leading comment that follows the template literal.
- [ ] Literal-only malformed Covers text produces zero unresolved-reference and zero uncertain-association bindings.

## Story 2: An unmarked test stays unbound

### Acceptance Criteria

#### Happy Path

- Given an added test with no leading marker whose body contains Covers text only inside string literals, when test-quality scope is analyzed, then the test is reported as an unbound note and no scope candidate is produced for it.

#### Negative Paths

- Given an unchanged file-level Covers comment above the imports and an added test with no marker of its own, when test-quality scope is analyzed, then the test remains an unbound note and no candidate or target carries the file-level marker's references.

### Done When

- [ ] A scope-analysis fixture reproducing the incident shape reports an unbound note for the added test and an empty candidate list.
- [ ] A scope-analysis fixture with an unchanged file-level marker reports the added unmarked test as unbound with no target or candidate.

## Story 3: A scope-incomplete halt names the test file and line

### Acceptance Criteria

#### Happy Path

- Given build_review halts on an uncovered scope-incomplete testQuality fault, when the HALT marker is written, then its body names each indeterminate candidate's test file path and start line together with its missing-evidence reason.

#### Negative Paths

- Given build_review halts on uncovered infrastructure failure with no scope-incomplete fault, when the HALT marker is written, then the body keeps the existing halt text and contains no scope-incomplete candidate line.

### Done When

- [ ] The conductor adjudication fixture's scope-incomplete HALT marker contains the candidate's path and start line and its missing-evidence reason.
- [ ] The infrastructure-only HALT marker contains no scope-incomplete candidate line.

## Negative-category review

Invalid input is covered by malformed and empty Covers text inside literals and by unmarked tests. Data integrity is covered by the file-level marker fixture, which keeps the ADR's association rules intact. The HALT rendering is covered for the alternate infrastructure-halt branch so no scope detail leaks into unrelated halts. No external call, concurrency, persistence schema, deletion, or resource-bound path is introduced; those categories are inapplicable. Unsupported languages and parser outages keep their existing analyzer diagnostics.
