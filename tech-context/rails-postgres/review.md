# Rails + PostgreSQL: Code Review Context

## Linting

- **Linter:** standardrb (`bundle exec standardrb`)
- **Auto-fix:** `bundle exec standardrb --fix`
- **Run at:** Every phase commit (not just at `/finish`)
- Zero-config — no `.rubocop.yml` needed. Do NOT use rubocop-rails-omakase.

## Complexity Threshold

Methods exceeding **15 lines or 3 conditional branches** should be extracted to a service object
at batch boundaries (not during GREEN). Use `standardrb` for style; use judgment for complexity.

## Security Checklist

### Authentication & Authorization
- [ ] `authenticate_user!` (or equivalent) on all protected controllers
- [ ] `authorize` call for resource-level permissions (Pundit/CanCanCan)
- [ ] API endpoints use token auth, not session cookies (unless intentional)
- [ ] Password reset tokens expire and are single-use

### Input Handling
- [ ] Strong parameters defined for every controller action accepting input
- [ ] No `params.permit!` (permits everything — never acceptable)
- [ ] File uploads validated: type, size, content (not just extension)
- [ ] JSON API input validated/coerced before use

### SQL Safety
- [ ] No string interpolation in `where` clauses: `where("name = '#{name}'")`
- [ ] Use parameterized queries: `where(name: name)` or `where("name = ?", name)`
- [ ] No `find_by_sql` with user input without parameterization
- [ ] `ActiveRecord::Base.connection.execute` calls use bind parameters

### XSS Prevention
- [ ] No `raw()` or `html_safe` on user-provided content
- [ ] `sanitize()` used for any user HTML that must be rendered
- [ ] Content Security Policy configured in production
- [ ] API responses set `Content-Type: application/json` (not text/html)

### CSRF
- [ ] `protect_from_forgery` in ApplicationController
- [ ] API controllers using token auth can skip CSRF (with `skip_forgery_protection`)
- [ ] Forms use `form_with` (includes CSRF token automatically)

## Performance Checklist

### Queries
- [ ] List endpoints use `includes`/`preload` for associations (no N+1)
- [ ] List endpoints are paginated (use `kaminari`, `pagy`, or `will_paginate`)
- [ ] `select` used to limit columns when full record not needed
- [ ] Counter caches used for `has_many` count displays
- [ ] Heavy queries use database indexes (check with `EXPLAIN ANALYZE`)

### Database
- [ ] Foreign keys have indexes
- [ ] Columns used in `WHERE`, `ORDER BY`, or `JOIN` have indexes
- [ ] `null: false` on columns that should never be null
- [ ] `unique: true` index on columns that should be unique (email, slug)
- [ ] Large table migrations use `disable_ddl_transaction!` or `safety_assured`

### Caching
- [ ] Fragment caching for expensive view renders
- [ ] Russian doll caching for nested associations
- [ ] Cache keys include `updated_at` for auto-invalidation
- [ ] Background jobs for operations >100ms (email, PDF generation, API calls)

## Antipatterns to Flag

### Business Logic in Controllers
```ruby
# BAD — logic in controller
def create
  @order = Order.new(order_params)
  @order.total = @order.line_items.sum(&:price) * 1.0825
  @order.save
end

# GOOD — logic in model or service
def create
  @order = OrderCreationService.call(order_params)
end
```

### Callbacks for Cross-Cutting Concerns
```ruby
# BAD — callback for side effect
after_create :send_welcome_email
after_create :create_stripe_customer
after_create :enqueue_onboarding

# GOOD — explicit service object
OrderCreationService.call(params)
# internally: create record, then send email, create customer, etc.
```

### default_scope
```ruby
# BAD — almost always wrong
default_scope { where(active: true) }

# GOOD — explicit named scope
scope :active, -> { where(active: true) }
```
Default scopes hide data, break `unscoped` expectations, and make debugging painful.

### `dependent: :destroy` on Large Associations
```ruby
# RISKY — could delete thousands of records synchronously
has_many :events, dependent: :destroy

# BETTER — use background job for bulk deletion
has_many :events, dependent: :restrict_with_error
# Handle deletion in a background job
```

### Floating Point for Money
```ruby
# BAD
add_column :orders, :total, :float

# GOOD
add_column :orders, :total_cents, :integer
# Use the money-rails gem for currency handling
```
