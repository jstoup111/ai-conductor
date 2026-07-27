**Status:** Accepted

# Technical Stories: Documentation-Only Delivery (#933)

Track: technical  
Complexity: Small  
Source issue: jstoup111/ai-conductor#933

## Story 1 — Documentation-only work resolves without SDLC artifacts

As an operator, I want a documentation-only request completed during exploration so that prose
changes do not generate stories, plans, or TDD cycles.

### Acceptance Criteria

#### Happy Path

- **Given** exploration confirms that a request changes only human-facing documentation,
  **when** the requested content is created or updated, **then** the change proceeds directly to
  delivery without creating a PRD, story, plan, architecture artifact, acceptance spec, or TDD
  test.

#### Negative Path

- **Given** a request includes any functional code or configuration behavior in addition to
  documentation, **when** exploration classifies the work, **then** it does not use the
  documentation-only route and continues through the normal product or technical SDLC.

### Done When

- [ ] A documentation-only request can reach delivery with none of the skipped SDLC artifacts.
- [ ] A mixed functional/documentation request cannot be falsely completed through this route.

## Story 2 — Projects can own documentation creation

As a project operator, I want documentation work delegated to project-specific guidance when it
exists so that the resulting content follows the target repository's conventions.

### Acceptance Criteria

#### Happy Path

- **Given** the target project defines a documentation skill for the requested work, **when** a
  documentation-only request is resolved, **then** that skill handles content creation and
  delivery.
- **Given** no project documentation skill is defined, **when** the operator or auto mode has
  enough information to make the requested edit, **then** exploration performs the documentation
  edit inline without generating SDLC artifacts.

#### Negative Path

- **Given** the configured documentation skill is missing, invalid, or fails, **when** delivery
  cannot be verified, **then** the request remains incomplete and reports the failure rather than
  emitting a successful terminal result.

### Done When

- [ ] A configured project documentation skill is preferred over generic inline editing.
- [ ] The inline fallback completes an unambiguous documentation request.
- [ ] Failed or unverifiable documentation delivery cannot be marked complete.

## Story 3 — Documentation delivery remains linked to its issue

As an operator, I want directly delivered documentation linked to its source issue so that normal
review and closure semantics are preserved.

### Acceptance Criteria

#### Happy Path

- **Given** a documentation-only request came from a tracked issue, **when** delivery succeeds,
  **then** the change is committed on an isolated branch and a pull request carries a closing
  reference to that issue.
- **Given** that pull request is merged, **when** the tracker processes the closing reference,
  **then** the source issue closes through the normal merge-linked workflow.
- **Given** auto mode successfully opens the linked pull request, **when** the conductor resumes,
  **then** it recognizes documentation delivery as terminal and does not dispatch downstream SDLC
  steps.

#### Negative Path

- **Given** commit, push, or pull-request creation fails, **when** the documentation route reports
  its result, **then** it does not emit terminal success and does not close the source issue.

### Done When

- [ ] Successful documentation delivery produces an isolated commit and linked pull request.
- [ ] The conductor stops after verified delivery in both interactive and auto modes.
- [ ] Delivery failures preserve the open issue and an incomplete feature state.

## Story 4 — Shared authoring policy excludes documentation obligations

As a maintainer, I want shared story, plan, and TDD guidance to exclude documentation obligations
so that downstream projects do not accumulate prose-coupled tests or documentation tasks.

### Acceptance Criteria

#### Happy Path

- **Given** functional work also implies documentation updates, **when** shared stories and plans
  are authored, **then** they omit documentation requirements, acceptance criteria, tasks,
  subtasks, and notes.
- **Given** an implementation changes ordinary prose such as `README.md` or `docs/**`, **when**
  BUILD applies its testing policy, **then** no test is created for wording, headings, formatting,
  placement, or explanatory content.

#### Negative Path

- **Given** a document is machine-consumed, such as OpenAPI input used to generate runtime
  behavior, **when** that behavior changes, **then** tests may verify the generated or runtime
  behavior but do not assert incidental prose or formatting.

### Done When

- [ ] Shared skill guidance explicitly omits documentation work from stories and plans.
- [ ] Shared TDD guidance rejects prose- and structure-coupled documentation tests.
- [ ] The policy preserves behavior-focused testing of machine-consumed documents.

## Story 5 — Existing prose-coupled tests are identified without removing functional coverage

As an ai-conductor maintainer, I want existing documentation assertions classified by functional
significance so that obsolete prose tests can be removed without weakening executable contracts.

### Acceptance Criteria

#### Happy Path

- **Given** an existing test asserts only README content, documentation headings, wording,
  formatting, or project explanations, **when** the repository is audited under the new policy,
  **then** the assertion is classified as violating the policy and eligible for removal.
- **Given** an existing test covers machine-consumed behavior involving `HARNESS.md`,
  `CHANGELOG.md`, `.docs/**`, or another document, **when** it is audited, **then** it is retained
  or rewritten to assert only the functional outcome.

#### Negative Path

- **Given** a test reads a documentation file as fixture input while asserting unrelated runtime
  behavior, **when** it is audited, **then** the file reference alone does not classify the test
  as a violation.

### Done When

- [ ] The audit distinguishes prose/structure assertions from behavior assertions.
- [ ] Identified prose-only assertions can be removed without deleting functional coverage.
- [ ] Merely mentioning or reading a documentation path is not treated as sufficient evidence of
  a violation.
