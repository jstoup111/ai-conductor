---
name: stories
description: "Use after design doc approval or when adding stories to an existing system. Generates user stories with mandatory happy and negative paths as Given/When/Then scenarios."
enforcement: gating
phase: decide
standalone: true
requires: []
---

## Purpose

Translates an approved design document into structured user stories with both happy and negative
path scenarios. Negative paths are mandatory — they directly feed TDD RED phases as test cases,
ensuring error handling and edge cases are tested first, not bolted on later.

## Practices

### 1. Load Input

- Read the approved design document from `docs/specs/`
- Check tech-context if loaded (e.g., `tech-context/rails-postgres/stories.md` for Rails-specific negative paths)
- Review existing stories in `docs/stories/` for this feature area (avoid duplicates)
- Recall relevant `.memory/` entries

### 2. Generate Stories

For each requirement in the design, write a user story:

```markdown
## Story: [Descriptive Title]

As a [role], I want [action] so that [outcome].

### Acceptance Criteria

#### Happy Path
- Given [specific precondition], when [specific action], then [specific expected result]
- Given [specific precondition], when [specific action], then [specific expected result]

#### Negative Paths
- Given [precondition], when [invalid input submitted], then [specific error handling]
- Given [precondition], when [unauthorized access attempted], then [specific rejection]
- Given [precondition], when [dependency times out], then [specific graceful degradation]
- Given [precondition], when [concurrent modification occurs], then [specific conflict resolution]
```

### 3. Mandatory Negative Path Categories

Every story MUST consider these categories. Not all apply to every story — but each must be
explicitly evaluated and included when relevant:

| Category | Applies When | Example |
|----------|-------------|---------|
| **Invalid input** | User-facing endpoints, form submissions | Malformed email, empty required fields, SQL injection attempts |
| **Auth/permission failures** | Protected resources | Unauthenticated access, wrong role, expired token |
| **Timeouts & network errors** | External API calls, DB queries | API unreachable, connection pool exhausted |
| **Concurrent access** | Shared mutable state | Two users editing same record, race conditions |
| **Resource exhaustion** | File uploads, batch processing | Disk full, memory limit, connection pool depleted |
| **Partial failure & rollback** | Multi-step operations | Step 3 of 5 fails — are steps 1-2 rolled back? |
| **Dependency unavailability** | DB, cache, queue, external APIs | Redis down, database unreachable, S3 outage |
| **Data integrity** | Writes, updates, deletes | Orphaned records, constraint violations, cascade effects |
| **Cascade deletion effects** | Entity has dependents (direct or transitive) | User deleted → what happens to their assigned cards, authored comments, owned teams? Test at every FK reference, not just direct parent |
| **Model-level immutability** | Record should be read-only after creation | Audit log entry, completed transaction — enforce at model layer (readonly!, validation), not just by omitting API endpoints |

**If tech-context is loaded**, also include stack-specific categories. For Rails:
- N+1 queries on list endpoints
- Unsafe migrations on large tables
- Mass assignment via unexpected params
- Missing database indexes
- Background job failure and retry behavior

### 4. Quality Gates

**GATE: No story is accepted without at least one negative path per acceptance criterion.**

Each negative path MUST be:
- **Concrete** — "Given a user with expired JWT, when they request /api/orders, then they receive 401 with error body `{error: 'token_expired'}`"
- **NOT vague** — Reject: "handle errors gracefully" / "return appropriate error" / "fail safely"
- **Testable** — Each Given/When/Then maps directly to a test assertion

### 5. Save Stories

Save to `docs/stories/<feature-name>.md` (one file per feature area).

If stories already exist for this feature area, append new stories to the existing file.
Note any stories that supersede or modify existing ones.

### 6. Suggest Next Step

After stories are written, suggest invoking the `conflict-check` skill to verify no conflicts
with existing stories.

## Verification

- [ ] Every requirement in the design doc has at least one story
- [ ] Every story has both happy AND negative paths
- [ ] At least one negative path per acceptance criterion
- [ ] All negative paths are concrete Given/When/Then (not vague)
- [ ] Stack-specific negative paths included if tech-context loaded
- [ ] Stories saved to `docs/stories/<feature-name>.md`
- [ ] No duplicate stories with existing content
