# DOMAIN Review — Detailed Guidance

## Purpose

The domain reviewer ensures that both tests and implementation respect domain integrity.
The reviewer has **veto authority** — they can reject and send back to the previous phase.

## What to Check

### Primitive Obsession

**Definition:** Using raw language types (strings, integers, booleans) where a domain concept
should have its own type.

| Smell | Should Be | Why |
|-------|-----------|-----|
| `user_id: "abc123"` | `UserId` type | Prevents mixing user IDs with other string IDs |
| `status: "active"` | `Status` enum | Prevents invalid status values |
| `amount: 1999` | `Money` value object | Prevents mixing cents with dollars, currency confusion |
| `email: "user@example.com"` | `Email` type with validation | Prevents invalid emails deep in the system |
| `starts_at: "2024-01-01"` | Proper datetime with timezone | Prevents timezone bugs |

**When to flag:** If the same primitive represents a domain concept in 2+ places.
**When to allow:** At system boundaries (HTTP params, DB columns) primitives are fine —
they get parsed into domain types at the boundary.

### Invalid State Representability

**Principle:** The type system should make invalid states impossible to construct.

| Smell | Problem | Fix |
|-------|---------|-----|
| `{confirmed: true, cancelled: true}` | Both can't be true | Use enum: `pending \| confirmed \| cancelled` |
| `{admin: true, role: "viewer"}` | Contradictory | Single `role` field with proper values |
| `{start_date: nil, end_date: "2024-12-31"}` | End without start | Require both or neither |

### Boundary Violations

- Is the test or implementation reaching into another domain's internals?
- Is it querying another domain's database tables directly instead of through an API?
- Is it depending on another domain's internal data structures?

### Domain Language

- Do names use ubiquitous language from the problem domain?
- Are technical terms used where business terms should be?
- `process_thing()` → `confirm_order()`, `approve_application()`

## Making a Veto Decision

**Veto when:**
- Primitive obsession will compound (the same raw type is used in 3+ places)
- Invalid states are representable and will cause bugs
- Boundary violations will create coupling that's expensive to fix later

**Allow when:**
- The primitive is only used once at a boundary
- The domain type would be trivial (a newtype wrapper with no behavior)
- The team has explicitly decided this is acceptable (check `.memory/decisions/`)

## Veto Format

```
DOMAIN VETO: [Phase being vetoed — RED or GREEN]
Issue: [What's wrong]
Severity: [blocking — must fix | advisory — recommend fix]
Suggestion: [Specific change to make]
Return to: [RED or GREEN phase]
```
