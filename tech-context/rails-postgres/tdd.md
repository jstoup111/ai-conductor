# Rails + PostgreSQL: TDD Context

## Test Framework

- **Framework:** RSpec
- **Run all:** `bundle exec rspec`
- **Run one file:** `bundle exec rspec spec/path/to_spec.rb`
- **Run one example:** `bundle exec rspec spec/path/to_spec.rb:42`
- **Run by tag:** `bundle exec rspec --tag focus`

## Test Types

| Type | Directory | Use For |
|------|-----------|---------|
| Model specs | `spec/models/` | Validations, scopes, associations, business logic |
| Request specs | `spec/requests/` | API endpoints, controller behavior, auth |
| System specs | `spec/system/` | Full browser flows, JavaScript interactions |
| Service specs | `spec/services/` | Service objects, complex business operations |
| Job specs | `spec/jobs/` | Background job behavior |
| Mailer specs | `spec/mailers/` | Email content and delivery |

**Prefer request specs** for API endpoints (not controller specs — those are deprecated).
**Prefer system specs** for user-facing flows (not feature specs).

### Spec Coverage Rule

Every `app/` file MUST have a corresponding spec:

- `app/models/*.rb` → `spec/models/*_spec.rb` (unit: validations, associations, enums, methods)
- `app/controllers/*.rb` → `spec/requests/*_spec.rb` (request: HTTP contract, auth, response format)
- `app/services/**/*.rb` → `spec/services/**/*_spec.rb` (unit: business logic)
- `app/jobs/*.rb` → `spec/jobs/*_spec.rb` (unit: job behavior, retry, idempotency)

**Unit specs** and **request specs** serve different purposes — both are required.
Request specs alone miss model-level logic. Unit specs alone miss integration issues.

## Factory Patterns

- Use `factory_bot_rails` for test data, NOT fixtures
- `build(:user)` — in-memory only (faster, use when DB not needed)
- `create(:user)` — persisted to DB (use when associations or queries need it)
- `build_stubbed(:user)` — in-memory with fake ID (fastest, use for unit-like tests)
- Define factories in `spec/factories/` — one file per model

```ruby
# spec/factories/users.rb
FactoryBot.define do
  factory :user do
    email { Faker::Internet.email }
    name { Faker::Name.name }

    trait :admin do
      role { :admin }
    end
  end
end
```

## Assertions

- Use `shoulda-matchers` for model validations: `it { should validate_presence_of(:email) }`
- Use `have_http_status` for request specs: `expect(response).to have_http_status(:ok)`
- Use `have_enqueued_job` for background jobs: `expect { action }.to have_enqueued_job(MyJob)`

## Database

- **Cleaning:** `database_cleaner-active_record` with transaction strategy
- **Migrations in test:** `rails db:test:prepare` before first run
- **Test database:** Separate database (typically `<app>_test`)

## System Specs

- Driver: `driven_by(:selenium_chrome_headless)`
- Wait for async: use Capybara's built-in waiting (`have_content`, `have_selector`)
- Do NOT use `sleep` — use Capybara matchers that wait

## Coverage

- Tool: SimpleCov
- Minimum: 95% line coverage
- Config in `spec/spec_helper.rb`:
  ```ruby
  require 'simplecov'
  SimpleCov.start 'rails' do
    minimum_coverage 95
  end
  ```

## Common RSpec Patterns

```ruby
# Shared contexts for common setup
RSpec.shared_context "authenticated user" do
  let(:user) { create(:user) }
  before { sign_in(user) }
end

# Shared examples for common behavior
RSpec.shared_examples "requires authentication" do
  it "returns 401 when not authenticated" do
    expect(response).to have_http_status(:unauthorized)
  end
end
```
