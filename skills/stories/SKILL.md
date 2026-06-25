---
name: stories
description: "Use after design doc approval or when adding stories to an existing system. Generates user stories with mandatory happy and negative paths as Given/When/Then scenarios."
enforcement: gating
phase: decide
standalone: true
requires: []
---

## Purpose

Extracts granular user stories from the approved PRD's enumerated functional requirements
(`FR-N`), with both happy and negative path scenarios. Stories describe **behavior (WHAT)** —
the technical *how* is the plan's job. Negative paths are mandatory — they directly feed TDD
RED phases as test cases, ensuring error handling and edge cases are tested first, not bolted
on later.

## Practices

### 1. Load Input

- Read the approved PRD from `.docs/specs/`; work through its **Functional Requirements
  (`FR-N`)** — each FR is the unit you extract stories from
- Reference tech-context from session if loaded (e.g., Rails-specific negative paths)
- Review existing stories in `.docs/stories/` for this feature area (avoid duplicates)
- **Check for DRAFT stories from `/bootstrap`** — if stories have `Status: DRAFT`, review and
  complete them rather than generating from scratch. Fill in `TODO` negative paths, verify happy
  paths match actual behavior, and mark as accepted when done.
- Recall relevant `.memory/` entries

### 2. Generate Stories

Work through the PRD's functional requirements in order. For **each `FR-N`**, write **one or
more granular stories** — split a requirement into multiple stories when it spans distinct
behaviors, so each story stays small and independently verifiable. Tag every story with the
`FR-N` it came from (traceability: PRD → story → plan task). Every `FR-N` must be covered by
at least one story.

```markdown
## Story: [Descriptive Title]

**Requirement:** FR-N

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

### Done When
- [ ] [Concrete, verifiable output — e.g., POST /contacts returns 201 with contact JSON including `id`, `name`, `email`]
- [ ] [Persistent side effect confirmed — e.g., contact row exists in database with correct attributes]
- [ ] [Contract/format verified — e.g., response envelope matches API contract]
```

> **"Done When" is the primary success gate.** Acceptance criteria describe *behavior*; "Done When"
> defines the measurable outputs the evaluator checks to confirm the story is complete. Every story
> MUST have a "Done When" section. Checkboxes must be concrete and independently verifiable — not
> restatements of acceptance criteria.

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
| **Exception class hierarchy** | Code rescues/catches specific exception types | Verify rescue clauses match the actual exception tree — e.g., `Stripe::AuthenticationError` is NOT a subclass of `Stripe::CardError`. Test that the right exception type is caught, not a parent or sibling. |
| **Dedup/idempotency key analysis** | Any idempotency or deduplication criterion | Verify the dedup key correctly identifies duplicates without false positives (blocking legitimate operations) or false negatives (allowing true duplicates through). Test with edits that should NOT trigger dedup. |

**If tech-context is loaded**, also include stack-specific categories. For Rails:
- N+1 queries on list endpoints
- Unsafe migrations on large tables
- Mass assignment via unexpected params
- Missing database indexes
- Background job failure and retry behavior

**Complexity-Aware Depth:** When the feature is classified as **Small** by `/conduct`'s
complexity assessment, negative paths are required per STORY (at least 1 per story), not per
criterion. Focus on the highest-risk negative path for each story (typically validation/auth).
For **Medium** and **Large** features, the full per-criterion rule applies.

### 4. Quality Gates

**GATE: No story is accepted without at least one negative path per acceptance criterion.**

Each negative path MUST be:
- **Concrete** — "Given a user with expired JWT, when they request /api/orders, then they receive 401 with error body `{error: 'token_expired'}`"
- **NOT vague** — Reject: "handle errors gracefully" / "return appropriate error" / "fail safely"
- **Testable** — Each Given/When/Then maps directly to a test assertion

### 5. Save Stories

Save to `.docs/stories/<feature-name>.md` (one file per feature area).

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
- [ ] Every story has a "Done When" section with concrete, verifiable output checkboxes
- [ ] Stack-specific negative paths included if tech-context loaded
- [ ] Stories saved to `.docs/stories/<feature-name>.md`
- [ ] No duplicate stories with existing content
