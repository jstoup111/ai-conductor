---
name: architecture-review
description: "Use before implementation to review stories through a technical feasibility and architectural alignment lens. Also use at batch boundaries to catch architectural drift."
enforcement: gating
phase: decide
standalone: true
requires: []
model: opus
---

## Purpose

Reviews stories and implementation plans through an architectural lens BEFORE code is written.
Catches technical infeasibility, hidden complexity, architectural drift, and domain violations
early — when they're cheap to fix.

**Run after `/plan` and before `/writing-system-tests`.**

Also invocable at pipeline batch boundaries to verify implementation stays architecturally sound.

## Practices

### 1. Load Architecture Context

Read in order of authority (higher overrides lower):

1. `docs/decisions/` — ADRs are the authoritative architecture reference
2. `CLAUDE.md` — Project conventions and constraints
3. `.memory/decisions/` — Prior architectural decisions
4. Existing code structure — `config/routes.rb`, model relationships, directory layout

**Convention over precedent:** Written decisions override observed patterns. Existing code that
violates a documented decision is tech debt, not precedent. Never downgrade a finding because
"the codebase already does it this way."

### 2. Technical Feasibility

For each story in the plan, assess:

| Check | Question | Flag If |
|---|---|---|
| **Stack compatibility** | Can this be built with the current stack? | Requires new gems/packages, external services, or infrastructure changes |
| **Prerequisites** | What must exist before this can start? | Migrations, config changes, external account setup needed |
| **Integration surface** | What other systems/modules does this touch? | Crosses 3+ module boundaries or hits external APIs |
| **Data implications** | Schema changes, migrations, data backfills? | Large table migrations, breaking schema changes, data loss risk |
| **Performance risk** | Will this create N+1s, unbounded queries, heavy computation? | List endpoints without pagination, missing indexes on query paths |

### 3. Complexity Assessment

Rate each story:

| Level | Criteria | Action |
|---|---|---|
| **Low** | 1 model, 1 endpoint, no external deps | Proceed |
| **Medium** | 2-3 models, cross-model logic, background jobs | Proceed with attention to boundaries |
| **High** | 4+ models, external APIs, complex state machines | Consider splitting into smaller stories |
| **Spike** | Unknown technology, unclear requirements, novel patterns | Recommend a time-boxed spike before planning |

### 4. Architectural Alignment

Check stories and plan against documented architecture:

**Domain boundaries:**
- Does the story respect existing module/domain boundaries?
- Does it introduce coupling between domains that should be independent?
- Are database queries staying within their domain, or reaching across to other domains' tables?

**Pattern consistency:**
- Does the implementation approach match existing patterns (service objects, concerns, etc.)?
- If it introduces a NEW pattern, is there an ADR justifying the departure?

**State management:**
- Can invalid states be represented in the proposed data model?
- Are state transitions explicit (enum/state machine) or implicit (boolean flags)?
- Does the proposal use `is_*` boolean flags where an enum would prevent invalid combinations?

**Security boundaries:**
- Are new endpoints authenticated and authorized?
- Does the data model expose sensitive fields that should be filtered?
- Are there new user inputs that need validation at the boundary?

### 5. Domain Integrity Pre-Check

Before implementation begins, check the plan for domain modeling issues:

| Principle | Check | Veto If |
|---|---|---|
| **No primitive obsession** | Plan uses domain types, not raw strings/ints | IDs, statuses, money, or email stored as primitives |
| **Parse, don't validate** | Validation at construction, trusted types throughout | Plan validates same field in multiple places |
| **Invalid states unrepresentable** | Type system prevents impossible combinations | Booleans where enums should exist, nullable fields that must be present |
| **Semantic types** | Types answer "what IS this?" not "what is this LIKE?" | `NonEmptyString` instead of `UserName` |
| **Exhaustive matching** | No catch-all defaults for domain states | `else` / `default` on status/type switches |

### 6. Risk Register

For each identified risk:

```markdown
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Concurrent card moves corrupt positions | Data | Medium | High | Row-level locking in transaction |
| External API timeout blocks request | Integration | High | Medium | Async job with retry, timeout at 5s |
```

Risk types: **Technical**, **Integration**, **Data**, **Performance**, **Security**, **Knowledge**

### 7. ADR for Every Architectural Decision

Every decision made during architecture review MUST be captured as an ADR using
`templates/adr.md.template`. This includes:

- Technology choices (gem/library selection, database features used)
- Pattern decisions (service objects vs. concerns, state machine approach)
- Boundary definitions (which models belong to which domain)
- Security decisions (auth approach, token strategy)
- Trade-offs accepted (e.g., "denormalized for read performance, accepted write complexity")

**Numbering:** Sequential in `docs/decisions/`. Check the highest existing number and increment.
Example: if `003-api-response-contract.md` exists, next is `004-<title>.md`.

**ADRs are append-only.** Never delete an ADR. If a decision changes, write a new ADR with
`Status: Superseded by ADR-N` on the old one.

### 8. Output

Write the review itself to `docs/decisions/architecture-review-YYYY-MM-DD-<feature>.md`:

```markdown
# Architecture Review: [Feature Name]
**Date:** YYYY-MM-DD
**Stories reviewed:** [list]
**Verdict:** APPROVED | APPROVED WITH CONDITIONS | BLOCKED

## Feasibility
[findings per story]

## Complexity
[ratings per story]

## Alignment
[findings — any drift from documented architecture]

## Domain Integrity
[pre-check findings — any primitive obsession, invalid states, etc.]

## Risks
[risk register]

## ADRs Created
- ADR-NNN: [title] — [one-line summary of decision]

## Conditions (if APPROVED WITH CONDITIONS)
- [ ] [specific condition — tracked in plan, verified by evaluator]

## Blocking Issues (if BLOCKED)
- [issue with specific resolution required]
```

### 9. Verdict Enforcement

**APPROVED** — Proceed to `/writing-system-tests`.

**APPROVED WITH CONDITIONS** — Proceed, but conditions are tracked in the plan. The evaluator
checks conditions at code review. Unmet conditions at `/finish` are blocking.

**BLOCKED — Requires human intervention.** The pipeline HALTS. Claude cannot resolve
architectural violations autonomously — they require human judgment about trade-offs, scope
changes, or design pivots. Present the blocking issues to the user with:
1. What is violated and why it matters
2. Options for resolution (with trade-offs per option)
3. Which ADRs or conventions are in conflict

**The user must explicitly approve a resolution.** Do not auto-resolve BLOCKED verdicts.
After the user decides, capture the resolution as a new ADR and re-run the review.

### 10. Recurring Review (Pipeline Batch Boundaries)

At pipeline batch boundaries, perform a lightweight architecture check:

- Has the implementation drifted from the approved plan?
- Have new patterns been introduced without an ADR?
- Are domain boundaries being respected in the actual code?
- Escalation: non-blocking findings that appear in 2+ consecutive reviews become blocking

If drift is detected at a batch boundary:
1. Write a new ADR documenting what changed and why (or that it was unintentional)
2. If the drift violates a prior ADR: BLOCK — human must decide whether to update the ADR
   or revert the code

## Verification

- [ ] All stories assessed for feasibility
- [ ] Complexity rated per story
- [ ] Alignment checked against docs/decisions/ and CLAUDE.md
- [ ] Domain integrity pre-checked
- [ ] Risk register populated
- [ ] ADR created for every architectural decision made
- [ ] Review written to docs/decisions/
- [ ] Verdict issued (APPROVED / CONDITIONS / BLOCKED)
- [ ] BLOCKED verdicts halt pipeline and require human resolution
