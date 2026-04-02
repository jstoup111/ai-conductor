---
name: writing-system-tests
description: "Use BEFORE implementing any feature that has stories in .docs/stories/ — generates failing acceptance specs from acceptance criteria as the RED phase of TDD. Generates integration request specs for API projects, system specs for full-stack projects."
---

# Writing Acceptance Tests

## Overview

Generate failing acceptance specs from user stories in `.docs/stories/*.md`. Each acceptance
criterion (happy AND negative paths) becomes a concrete test. Tests are generated BEFORE
implementation — they are the RED phase of BDD.

**Detects project type and generates the right kind of spec:**

| Project Type | Spec Type | Location | Tests With |
|---|---|---|---|
| API-only (no views) | Integration request specs | `spec/integration/` | HTTP requests, status codes, JSON responses |
| Full-stack (views exist) | System specs | `spec/system/` | Capybara, browser, UI assertions |

## When to Use

Run this **after `/plan` and before `/pipeline`** (or `/tdd`). The flow is:

```
/stories → /conflict-check → /plan → /writing-system-tests → /pipeline
```

**Trigger when:**
- About to implement a feature and stories exist without corresponding acceptance specs
- New story files added to `.docs/stories/`
- User asks for acceptance tests, integration tests, BDD tests, or system tests

**Skip when:**
- Acceptance specs already exist for the stories
- Writing unit/model specs (that's the TDD skill's job)

## Process

### 1. Detect Project Type

Check for views/frontend to determine spec type:

- `app/views/` with templates OR `app/javascript/` OR frontend framework → **Full-stack** → system specs
- API-only controllers, no views → **API** → integration request specs

### 2. Check for Missing Acceptance Specs

**API projects:** Compare `.docs/stories/*.md` against `spec/integration/*_spec.rb`
**Full-stack:** Compare `.docs/stories/*.md` against `spec/system/*_spec.rb`

Generate specs for any story file that lacks a corresponding spec.

**Skip specs for already-tested behavior:** Before generating, grep the existing test suite
for overlap. For each acceptance criterion, search test files for keywords from the criterion
(e.g., method names, status codes, error messages). If a matching test already exists — unit
test, request spec, or prior integration spec — do not generate a duplicate acceptance spec.

Concrete check: `grep -r "criterion keyword" tests/ spec/` across the existing test directories.
If a test file already asserts the expected behavior, skip that criterion. Log skipped criteria
so the retro can verify nothing was missed.

**End-to-end, not mocked:** Acceptance specs test the real system. Do NOT mock internal
infrastructure (database, queues, caches, background jobs). Only mock **third-party external
services** (payment APIs, email providers, external webhooks) that are outside the project's
control. If a spec requires infrastructure that isn't available in the test environment,
configure the test environment to provide it — don't mock it away.

### 3. Parse Acceptance Criteria

Extract from each story file:
- Feature area name (H1 or filename)
- Story titles (H2)
- Happy path criteria (Given/When/Then under Happy Path heading)
- Negative path criteria (Given/When/Then under Negative Paths heading)

**Both happy AND negative paths become tests.** Negative paths are not optional.

### 3a. Classify Story Flows

Before generating specs, classify each story:

- **Multi-endpoint flow** (2+ endpoints in the happy path): Generate an integration/acceptance spec.
  Examples: "create a contact then assign tags", "search contacts filtered by tag"
- **Single-endpoint operation** (1 endpoint CRUD): Mark as `request-spec-only` — this story will
  be covered by TDD request specs during implementation. Do NOT generate an acceptance spec for it.
  Examples: "create a contact", "delete a tag", "update a contact's email"

**If ALL stories are single-endpoint (pure CRUD with no multi-step business logic), skip
integration spec generation entirely.** Request specs from TDD will cover all acceptance
criteria. Only generate integration specs when at least one story genuinely crosses 2+ endpoints.

This avoids generating integration specs that duplicate request specs for simple CRUD operations.

### 4. Read App Context

For each story, read the relevant:
- `config/routes.rb` — available routes and path helpers
- Controllers — response formats, auth requirements, before_actions
- Models — validations, associations, enums (for factory setup)
- Existing factories in `spec/factories/` — reuse, don't duplicate

If routes/models don't exist yet (pre-implementation), write tests using the expected paths
from the stories. Tests will fail with `RoutingError` or `ActiveRecord` errors — this is
correct RED behavior.

### 5a. Generate Integration Specs (API Projects)

**File mapping:** `.docs/stories/links.md` → `spec/integration/links_spec.rb`

```ruby
RSpec.describe "Link lifecycle", type: :request do
  describe "Story: Create and use a short link" do
    context "happy path" do
      it "creates a link, redirects via short code, and records a click" do
        post "/links", params: { link: { original_url: "https://example.com" } }, headers: auth_headers
        short_code = json_body["link"]["short_code"]
        get "/#{short_code}"
        expect(response).to redirect_to("https://example.com")
      end
    end
    context "negative: expired link" do
      it "returns 410 Gone for an expired link" do
        # create link, travel past expiry, assert :gone
      end
    end
  end
end
```

**Key distinction: acceptance specs test FLOWS, not endpoints.**

An acceptance spec that only hits one endpoint is a request spec wearing a costume. If the test
doesn't cross at least 2 endpoints or verify a multi-step story, it belongs in `spec/requests/`
instead.

| Test hits one endpoint | → `spec/requests/` (request spec) |
| Test hits 2+ endpoints in sequence | → `spec/integration/` (acceptance spec) |
| Test verifies model logic directly | → `spec/models/` (unit spec) |

**This avoids duplication.** Request specs own individual endpoint behavior (status codes, error
formats, params validation). Acceptance specs own the story flow (create → use → verify outcome).
Neither duplicates the other.

**Rules for integration specs:**
- Test multi-step flows that map to stories, not individual endpoints
- One `describe` per story, `context` per happy/negative path
- Each test is independent — creates own data via factories
- Assert outcomes, not intermediate HTTP details (request specs own those)
- Auth uses helper methods, not hardcoded tokens
- No mocking external services in integration specs — test the real flow

**Helpers to create if missing:** Create `spec/support/request_helpers.rb` with `json_body` and `auth_headers` helpers if missing.

### 5b. Generate System Specs (Full-Stack Projects)

**File mapping:** `.docs/stories/auth.md` → `spec/system/auth_spec.rb`

```ruby
RSpec.describe "Authentication", type: :system do
  before { driven_by :selenium, using: :headless_chrome }

  describe "Story: User Registration" do
    context "happy path" do
      it "registers with valid email and password" do
        visit new_registration_path
        fill_in "Email", with: "user@example.com"
        click_button "Sign Up"
        expect(page).to have_text("Welcome")
      end
    end
    context "negative: duplicate email" do
      it "shows error for existing email" do
        create(:user, email: "taken@example.com")
        visit new_registration_path
        fill_in "Email", with: "taken@example.com"
        click_button "Sign Up"
        expect(page).to have_text("already taken")
      end
    end
  end
end
```

**Rules for system specs:**
- Every criterion gets concrete Capybara code — no stubs, no `pending`
- Each test is independent — creates own data, signs in if needed
- No mocking — full stack exercise
- Sign-in uses the actual login form, not a session backdoor
- Use `have_text` for visible content, `have_current_path` for navigation

### 6. Run and Verify RED

```bash
# API projects
bundle exec rspec spec/integration/

# Full-stack projects
bundle exec rspec spec/system/
```

Confirm tests fail for the **right reasons**. This is critical:

**Acceptable pre-implementation failures:**
- `RoutingError`, `NameError`, `UndefinedTable` — infrastructure doesn't exist yet
- `404 Not Found` — endpoint not implemented

**Unacceptable failures (fix the spec):**
- Test passes when it shouldn't, or fails with a wrong error (e.g., `can't be blank` when expecting `not found`)
- Syntax errors or typos in the spec

**A test that fails for the wrong reason is not RED — it's broken.**

### Stubbing Rules for Pre-Implementation Specs

- Stub at system boundaries only: `SecureRandom`, `Time.zone.now`, external API clients, `ENV` values
- Never stub internal methods (private callbacks, service internals) — they don't exist yet and coupling to them breaks on implementation
- Example of correct boundary stub: `allow(SecureRandom).to receive(:alphanumeric).and_return("aaa")`

### 7. Commit the Failing Tests

```bash
git add spec/integration/ spec/support/   # or spec/system/
git commit -m "test: add failing acceptance specs for [feature area]"
```

Failing tests get committed. They represent the acceptance criteria.
Implementation (via `/pipeline` or `/tdd`) makes them pass.

## How This Relates to Other Test Types

```
Acceptance specs (this skill)      — Multi-step story flows across 2+ endpoints
  ↕ generated from .docs/stories/     "Create link → visit → verify click recorded"
  ↕ NO single-endpoint tests here

Request specs (TDD per-controller) — Single endpoint HTTP contract
  ↕ generated during RED phase        "POST /links with blank URL returns 422"
  ↕ owns: status codes, error formats, params validation, headers

Unit specs (TDD per-model)         — Model logic in isolation
  ↕ generated during RED phase        "Link.generate_short_code returns 6 chars"
  ↕ owns: validations, callbacks, business methods
```

**Each layer tests something the others don't.** If a test could live in a lower layer, it should.
Acceptance specs are expensive — only use them for multi-step flows that can't be verified at a
lower level. This skill handles the top layer. TDD handles the bottom two.

