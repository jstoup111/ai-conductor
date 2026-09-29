**Status:** Accepted

# Stories: Stage wrapped Desired-outcome bullets in full (#2620)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). A continuation line is a non-blank line that follows a staged bullet (or its earlier continuation) and is not a heading, a list-marker line, or an inbound armor line; it is folded into that bullet with single spaces. A nested sub-bullet (an indented dash line) remains its own outcome, as it is counted today.

## Story 1: Stage and commit wrapped bullets with their full text

### Acceptance Criteria

#### Happy Path

- Given an intake body whose Desired-outcome bullet continues over several following lines, when the outcomes are staged, then the staged file carries that bullet as one line holding its full text with each line break replaced by a single space, and the staged reader returns that full text.
- Given an intake body whose Desired-outcome bullets are each written on a single line, when the outcomes are staged, then the staged file is byte-identical to what the current extractor produces.
- Given outcomes staged from an issue with a wrapped bullet, when the spec lands, then the committed intake marker carries the full bullet text.

#### Negative Paths

- Given a Desired-outcome section with a lead-in sentence before the first bullet and a paragraph separated from a bullet by a blank line, when the outcomes are staged, then neither prose block appears in any staged bullet.
- Given a bullet with an indented dash sub-bullet beneath it, when the outcomes are staged, then the sub-bullet is staged as its own outcome and the outcome count equals the number of dash lines, as today.
- Given an armored intake body whose closing armor line directly follows the last wrapped bullet, when the outcomes are staged, then the armor line is not folded into the bullet and still closes the staged block.

### Done When

- [ ] Unit tests in the outcome-staging test file pin folding, single-line byte identity, prose exclusion, sub-bullet counting, and armor preservation.
- [ ] A landSpec acceptance case staged by the real worktree writer commits the full wrapped text to the intake marker.

## Story 2: Coherence outcome rows judge the full bullet

### Acceptance Criteria

#### Happy Path

- Given outcomes staged from an issue with a wrapped bullet and a coherence outcome row quoting that bullet's full text, when the spec lands, then the land is accepted.

#### Negative Paths

- Given outcomes staged from an issue with a wrapped bullet and a coherence outcome row quoting only the bullet's first physical line, when the spec lands, then the land is refused naming that outcome id.
- Given a committed intake marker whose bullets were truncated before this change, when its outcomes are read back, then the reader returns the same bullets as before so its existing outcome rows still match.

### Done When

- [ ] The coherence acceptance file lands a full-text quote and refuses a first-line fragment quote against real-writer staging.
- [ ] A unit test pins the committed-marker reader's output for a truncated legacy marker.

## Negative-category review

Input integrity is covered by prose exclusion, sub-bullet counting, armor-boundary preservation, and the fragment-quote refusal. Backward compatibility is covered by single-line byte identity and the unchanged reading of truncated legacy markers. The change is a pure text transform at an existing writer: no permission, network, concurrency, deletion, idempotency, queue, or storage category is introduced, so those are inapplicable.
