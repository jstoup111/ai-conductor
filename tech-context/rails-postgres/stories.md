# Rails + PostgreSQL: Story Negative Path Categories

## Stack-Specific Negative Paths

These categories supplement the generic negative path list in the `stories` skill. Include
them when the story touches the relevant area.

### N+1 Queries
**Applies to:** Any endpoint returning a list with associations.
```
Given a list of 100 orders each with a customer and line items,
When the /api/orders endpoint is requested,
Then the total query count is bounded (≤ 5 queries, not 100+).
```
Detection: Use `bullet` gem in test, or `assert_queries` from ActiveSupport.

### Unsafe Migrations
**Applies to:** Any story that adds/removes columns, indexes, or changes types.
```
Given a production users table with 10M rows,
When a migration adds a new column with a default value,
Then the migration uses `add_column` without a default + backfill (or uses `safety_assured`).
```
Tool: `strong_migrations` gem.

### Missing Validations
**Applies to:** Any model with required fields.
```
Given a User model with a required email field,
When a record is saved with email: nil,
Then ActiveRecord validation prevents the save (not just a DB constraint error).
```
Ensure validations exist at BOTH model and database level.

### Mass Assignment
**Applies to:** Any controller accepting user input.
```
Given a user update endpoint,
When the request includes params[:user][:role] = "admin",
Then strong parameters reject the unpermitted role param.
```

### Missing Indexes
**Applies to:** Foreign keys and frequently queried columns.
```
Given an orders table with a user_id foreign key,
When orders are queried by user_id,
Then a database index exists on orders.user_id.
```

### Transaction Safety
**Applies to:** Multi-step operations that must be atomic.
```
Given an order creation that charges payment and creates the order record,
When the order record creation fails after payment is charged,
Then the payment charge is rolled back within the same transaction.
```

### Background Job Failures
**Applies to:** Any async processing.
```
Given a SendWelcomeEmailJob,
When the email service is temporarily unavailable,
Then the job retries with exponential backoff (max 3 attempts).
```
```
Given a ProcessPaymentJob,
When the job is retried after a transient failure,
Then the operation is idempotent (no double charges).
```

### Enum Consistency
**Applies to:** Models using ActiveRecord enums.
```
Given an Order model with status enum [:pending, :confirmed, :shipped],
When an invalid status value is assigned,
Then an ArgumentError is raised (not silently accepted).
```

### Timezone Handling
**Applies to:** Any date/time display or comparison.
```
Given a user in EST timezone viewing an order created at 11pm PST,
When the order timestamp is displayed,
Then it shows the correct time in the user's timezone (2am EST next day).
```
Rule: Always use `Time.zone.now`, never `Time.now`.

### Connection Pool Exhaustion
**Applies to:** High-concurrency endpoints or background jobs.
```
Given a pool of 5 database connections,
When 10 concurrent requests arrive,
Then requests wait for a connection (with timeout) rather than crashing.
```

### Cascade Deletion Effects
**Applies to:** Any entity referenced by foreign keys (direct or transitive).
```
Given a User who owns boards and is assigned to cards on other boards,
When the User is deleted,
Then owned boards are handled (deleted/transferred) AND card assignee references are nullified.
```
Test every FK path, not just `dependent:` on the direct association. Transitive references
(e.g., User → Card.assignee_id across a different ownership chain) are commonly missed.
Tool: `rails db:migrate:status` + grep for `references` in migration files.

### Model-Level Immutability
**Applies to:** Records that should be read-only after creation (audit logs, events, transactions).
```
Given a CardEvent record that was already created,
When an update is attempted via ActiveRecord,
Then the update is rejected at the model level (not just by absence of an API endpoint).
```
Enforcement: Use `after_initialize { readonly! if persisted? }` or a validation that blocks
updates. Do NOT rely solely on "we don't expose an update endpoint" — internal code and
console access bypass that.
