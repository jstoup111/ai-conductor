---
name: writing-system-tests
description: "Use BEFORE implementing any feature that has stories in docs/stories/ — generates failing acceptance specs from acceptance criteria as the RED phase of TDD. Generates integration request specs for API projects, system specs for full-stack projects."
---

# Writing Acceptance Tests

## Overview

Generate failing acceptance specs from user stories in `docs/stories/*.md`. Each acceptance
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
- New story files added to `docs/stories/`
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

**API projects:** Compare `docs/stories/*.md` against `spec/integration/*_spec.rb`
**Full-stack:** Compare `docs/stories/*.md` against `spec/system/*_spec.rb`

Generate specs for any story file that lacks a corresponding spec.

### 3. Parse Acceptance Criteria

Extract from each story file:
- Feature area name (H1 or filename)
- Story titles (H2)
- Happy path criteria (Given/When/Then under Happy Path heading)
- Negative path criteria (Given/When/Then under Negative Paths heading)

**Both happy AND negative paths become tests.** Negative paths are not optional.

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

**File mapping:** `docs/stories/links.md` → `spec/integration/links_spec.rb`

```ruby
require "rails_helper"

RSpec.describe "Links", type: :request do
  describe "Story: Create a short link" do
    context "happy path" do
      it "creates a link and returns the short URL" do
        post "/links", params: { link: { original_url: "https://example.com" } },
                        headers: auth_headers
        expect(response).to have_http_status(:created)
        expect(json_body["link"]["short_code"]).to match(/\A[a-zA-Z0-9]{6}\z/)
      end
    end

    context "negative: invalid URL" do
      it "rejects a blank URL with 422" do
        post "/links", params: { link: { original_url: "" } },
                        headers: auth_headers
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json_body["error"]).to be_present
      end
    end
  end
end
```

**Rules for integration specs:**
- Test the full HTTP contract: method, path, params, headers, status, body
- One `describe` per story, `context` per happy/negative path
- Each test is independent — creates own data via factories
- Assert against the API response contract (from `docs/decisions/api-response-contract.md` if it exists)
- Auth uses helper methods, not hardcoded tokens
- No mocking external services in integration specs — test the real flow

**Helpers to create if missing:**

```ruby
# spec/support/request_helpers.rb
module RequestHelpers
  def json_body
    JSON.parse(response.body)
  end

  def auth_headers(user = nil)
    user ||= create(:user)
    token = user.sessions.create!.token
    { "Authorization" => "Bearer #{token}" }
  end
end

RSpec.configure do |config|
  config.include RequestHelpers, type: :request
end
```

### 5b. Generate System Specs (Full-Stack Projects)

**File mapping:** `docs/stories/auth.md` → `spec/system/auth_spec.rb`

```ruby
require "rails_helper"

RSpec.describe "Authentication", type: :system do
  before do
    driven_by :selenium, using: :headless_chrome
  end

  describe "Story: User Registration" do
    context "happy path" do
      it "registers with valid email and password" do
        visit new_registration_path
        fill_in "Email", with: "user@example.com"
        fill_in "Password", with: "secure_password"
        click_button "Sign Up"
        expect(page).to have_text("Welcome")
      end
    end

    context "negative: duplicate email" do
      it "shows error for existing email" do
        create(:user, email: "taken@example.com")
        visit new_registration_path
        fill_in "Email", with: "taken@example.com"
        fill_in "Password", with: "secure_password"
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
- `RoutingError` — route doesn't exist yet
- `NameError` / `UndefinedTable` — model/class doesn't exist yet
- `404 Not Found` — endpoint not implemented

**Unacceptable failures (fix the spec):**
- Test passes when it shouldn't — behavior already exists or assertion is wrong
- Test fails with wrong error — e.g., `can't be blank` when you expected `not found`
- Syntax errors or typos in the spec itself

**A test that fails for the wrong reason is not RED — it's broken.** The failure message must
align with what the test is asserting. If a collision-exhaustion test fails with "can't be blank"
instead of "unable to generate unique code," the stub is wrong.

### Stubbing Rules for Pre-Implementation Specs

**Stub at system boundaries, not internal methods:**
- **Good:** `allow(SecureRandom).to receive(:alphanumeric).and_return("aaa")` — stable public API
- **Bad:** `allow(model).to receive(:generate_short_code)` — method doesn't exist yet, will couple to implementation

Internal methods (private callbacks, service internals) don't exist pre-implementation. Stubs
targeting them will silently break when the implementation takes a different shape. Stub at the
edges: `SecureRandom`, `Time.zone.now`, external API clients, `ENV` values.

### 7. Commit the Failing Tests

```bash
git add spec/integration/ spec/support/   # or spec/system/
git commit -m "test: add failing acceptance specs for [feature area]"
```

Failing tests get committed. They represent the acceptance criteria.
Implementation (via `/pipeline` or `/tdd`) makes them pass.

## How This Relates to Other Test Types

```
Acceptance specs (this skill)     — Story-level, multi-endpoint/multi-page flows
  ↕ generated from docs/stories/
Request specs (TDD per-controller) — Single endpoint HTTP contract
  ↕ generated during RED phase of TDD
Unit specs (TDD per-model)         — Model logic, validations, associations
  ↕ generated during RED phase of TDD
```

All three layers are required. This skill handles the top layer.
TDD handles the bottom two.

## Common Mistakes

- **Skipping acceptance tests** — jumping straight to unit tests leaves story coverage unverified
- **Testing implementation details** — assert what the user/client sees, not internal state
- **Shared state between tests** — each `it` block sets up its own data
- **Mocking in acceptance tests** — these test the real stack, end to end
- **Only testing happy paths** — every negative path in the story gets a test too
- **Accepting wrong failure reason as RED** — a test that fails with `can't be blank` when you expected `not found` is broken, not RED
- **Stubbing internal methods pre-implementation** — stub boundaries (`SecureRandom`, `Time.zone.now`), not methods that don't exist yet
