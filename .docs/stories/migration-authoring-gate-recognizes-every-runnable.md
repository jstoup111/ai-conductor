**Status:** Accepted

# Stories: Migration authoring gate recognizes every runnable fence

Source: jstoup111/ai-conductor#2152. Technical safety correction under the operator's 2026-09-05 spec-batch authorization.

## Story 1: Runnable formatting variants receive the existing safety checks

**Requirement:** #2152 desired outcomes 1–3.

As a harness maintainer, I want every migration the runner can extract to receive authoring validation so that formatting cannot hide unsafe commands from the release gate.

### Acceptance Criteria

#### Happy Path

- H1: Given a clean, version-attributed migration block recognized by the current extractor, when authoring validation runs, then it passes for canonical formatting and benign accepted spacing or line-ending variants.
- H2: Given multiple runnable blocks separated by Markdown sections or examples, when the runner extracts them and the authoring checker examines the same document, then every extracted block is checked regardless of whether an earlier block closed with whitespace or a longer closing fence.
- H3: Given an existing valid changelog and version interval, when the runner uses the shared recognizer, then extracted scripts, version attribution, and execution order are unchanged.

#### Negative Paths

- N1: Given a runner-recognized block with a forbidden relative harness invocation, destructive Git command, or daemon lifecycle command, when validation runs, then it fails and names the original offending source line and clause, including trailing-space, tab, and CRLF fence variants.
- N2: Given a migration-like snippet inside a longer backtick or tilde example fence, when the document is examined, then it is not promoted into a runnable migration; a subsequent real runnable unsafe block still fails authoring validation.
- N3: Given an unversioned/unattributed migration candidate or an unterminated authored candidate that the existing authoring contract rejects, when validation runs, then the existing rejection remains; the historical `Unversioned` archive exemption remains unchanged.
- N4: Given the shared recognizer is unavailable or cannot parse/emit its expected result, when the authoring checker runs, then it exits nonzero with an explicit diagnostic rather than reporting a pass over an empty block set.

### Done When

- [ ] One shared fence recognizer supplies both extraction and authoring classification, and current parser-order fixtures pass unchanged in meaning.
- [ ] A fixture matrix proves every runner-extracted unsafe script is rejected by the checker at its original source line and every clean runnable counterpart passes.
- [ ] Enclosing-fence, consecutive-block, malformed-candidate, and recognizer-failure fixtures enforce N2–N4 without executing any migration script.

### Coverage disposition

Task 1 owns H3 through existing parser and scratch-consumer fixtures plus focused shared-recognizer tests. Task 2 owns H1, H2, and N1–N4 through the real checker and parser helper over local fixture files. These are local integration tests at the parser/checker boundary; they do not require new acceptance/system specs or external services. All criteria are diff-local to the requested behavior. No story relies on other work landing.

Relevant negatives are malformed input, partial recognition, loss of validation, and executable-content misclassification. Authentication, concurrent writes, networking, resource pools, cascade deletion, and model immutability introduce no new behavior in this scope. Fixtures use bounded temporary directories and preserve original line positions.

Status: Accepted
