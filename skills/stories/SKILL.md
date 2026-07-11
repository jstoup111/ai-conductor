---
name: stories
description: "Use after architecture-review, when the design is approved. Generates user stories with mandatory happy and negative paths as Given/When/Then scenarios — from the PRD's FRs (product track) or the technical intent (technical track)."
enforcement: gating
phase: decide
standalone: true
requires: [verify-claims]
---

## Purpose

Generates granular stories with happy and negative path scenarios, and is the **always-present
acceptance-criteria artifact** for both tracks:
- **Product track** — extract stories from the approved PRD's enumerated functional requirements
  (`FR-N`); each FR is a unit.
- **Technical track** — no PRD; write *technical stories* (Given/When/Then against the technical
  change) from the technical intent + the approved architecture.

Stories run **after** architecture-review (the design is known), so they describe **behavior
(WHAT)** grounded in the agreed design — but they state observable behavior/acceptance, NOT the
mechanism (architecture *informs which scenarios exist*; it is not copied as mechanism into story
text — the *how* is the plan's job). Negative paths are mandatory — they feed TDD RED phases.

**Correctness gate:** acceptance criteria become the definition of done. Apply the `/verify-claims`
protocol — if a scenario encodes an assumption about expected behavior that was never confirmed
(against the FR, the ADR, or the operator), flag it with its confidence and HARD-BLOCK for approval
(HALT if autonomous) rather than baking the guess into a Given/When/Then.

**Architecture-induced negatives (do not miss these):** because stories follow architecture, every
failure mode a design decision introduces (an external call that times out, a queue that drops/dupes,
a lock that contends) MUST appear as a negative-path story. These are exactly the cases that were
missed when stories preceded the design.

If writing stories reveals a genuine *structural* gap the design lacks (a missing component/seam), do
not paper over it in story text — kick back to `architecture` (which re-opens in amendment mode).

## Practices

### 1. Load Input

- **Product track:** read the approved PRD from `.docs/specs/`; work through its **Functional
  Requirements (`FR-N`)** — each FR is the unit you extract stories from. **Technical track** (no
  PRD): derive acceptance criteria from the technical intent + the approved architecture/ADRs.
- Reference tech-context from session if loaded (e.g., Rails-specific negative paths)
- Review existing stories in `.docs/stories/` for this feature area (avoid duplicates)
- **Check for DRAFT stories from `/bootstrap`** — if stories have `Status: DRAFT`, review and
  complete them rather than generating from scratch. Fill in `TODO` negative paths, verify happy
  paths match actual behavior, and change `**Status:** DRAFT` to `**Status:** Accepted` when done.
- Recall relevant `.memory/` entries

### 2. Generate Stories

Work through the PRD's functional requirements in order. For **each `FR-N`**, write **one or
more granular stories** — split a requirement into multiple stories when it spans distinct
behaviors, so each story stays small and independently verifiable. Tag every story with the
`FR-N` it came from (traceability: PRD → story → plan task). Every `FR-N` must be covered by
at least one story.

```markdown
**Status:** Accepted

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
| **Invariant side-effect on alternate branches** | A happy path delegates a critical side effect (record/ledger write, cleanup, metric, cache invalidation) to a helper, and an alternate branch (error path, no-remote/offline, degraded mode, early return) can bypass that helper | A no-remote authoring path returns before the helper that writes the authored-ledger entry → the ledger silently misses the key. Write a negative-path scenario asserting the side effect STILL occurs on each alternate branch — do not assume the happy-path test covers it. |

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

**Stamp the canonical approval marker.** Every stories file MUST begin with a `**Status:**`
line. Once the operator approves the stories, the file carries `**Status:** Accepted` — this is
the single canonical approval token the downstream gates require. A file still pending review
carries `**Status:** DRAFT`. This is non-negotiable: the engineer land gate
(`landSpec`/`runAuthoring`) rejects stories lacking `Status: Accepted`, and the daemon backlog
**skips a merged spec forever** unless its stories declare `Status: Accepted` (no DRAFT). A
missing status line is treated as **not approved** — never leave it off.

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
- [ ] File ends with the canonical `Status: Accepted` marker and contains no `Status: DRAFT`
      anywhere — daemon discovery refuses merged specs whose stories are not approved
- [ ] No duplicate stories with existing content
- [ ] Stories file carries the canonical `**Status:** Accepted` marker on approval (not DRAFT, not missing)
