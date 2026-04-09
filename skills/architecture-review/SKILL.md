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

### Lightweight Mode (Medium Complexity Tier)

When the feature is classified as **Medium** by `/conduct`'s complexity assessment, run only:
- **Section 2: Technical Feasibility** — full check
- **Section 4: Architectural Alignment** — full check

Skip:
- Section 3 (Complexity Assessment) — already done by `/conduct`
- Section 5 (Domain Integrity Pre-Check) — handled by TDD domain reviewer per-cycle
- Section 7 (mandatory ADR creation) — only create ADRs for genuinely novel architectural decisions

**Explore agent limits for Medium tier:** Max 2 agents with non-overlapping scopes:
- Agent 1: stories + plan files (`.docs/stories/`, `.docs/plans/`)
- Agent 2: relevant source files for the feature area
- Do NOT dispatch agents to read `.memory/` (auto-loaded at session start)
- Do NOT dispatch a third agent for decisions/ADRs (read `.docs/decisions/` directly if needed)

For **Small** features, architecture-review is skipped entirely by `/conduct`.
For **Large** features, run the full review (all sections).

## Practices

### 1. Load Architecture Context

Read in order of authority (higher overrides lower):

1. `.docs/decisions/` — ADRs are the authoritative architecture reference
2. `.docs/architecture/` — C4 diagrams (system context, containers, components, ERD, sequences)
3. `CLAUDE.md` — Project conventions and constraints
4. `.memory/decisions/` — Prior architectural decisions
5. Existing code structure — `config/routes.rb`, model relationships, directory layout

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
| **Worktree isolation** | Can this run in parallel worktrees without conflicts? | New Docker services, ports, databases, or shared state without `.env` boundary pattern |

### 3. Complexity Assessment

| Level | Criteria | Action |
|---|---|---|
| **Low** | 1 model, 1 endpoint, no external deps | Proceed |
| **Medium** | 2–3 models, cross-model logic, background jobs | Proceed with boundary attention |
| **High** | 4+ models, external APIs, complex state machines | Consider splitting |
| **Spike** | Unknown tech, unclear requirements, novel patterns | Time-box spike before planning |

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

**Diagram accuracy:**
- Do architecture diagrams in `.docs/architecture/` reflect the proposed changes?
- If the plan introduces new containers, services, or external integrations, are diagrams updated?
- Reference diagrams when assessing domain boundaries and coupling.

**Worktree isolation:**
- Does the new infrastructure use the `.env` / `.env.local` boundary pattern?
- Are new services added to shared infrastructure (Docker) or per-worktree?
- If new ports or databases are introduced, are they parameterized via environment variables?
- Would two worktrees running simultaneously conflict on any resource (port, DB name, file path, queue name)?

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

```markdown
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Concurrent moves corrupt positions | Data | Medium | High | Row-level locking in transaction |
```

Risk types: **Technical**, **Integration**, **Data**, **Performance**, **Security**, **Knowledge**

### 7. ADR Creation — Triggers and Decision Categories

An ADR is required when a change touches any of these decision categories. This checklist
defines what constitutes an "architectural decision" — if a change fits a category below and
no existing ADR covers it, one must be created before implementation proceeds.

**Technology Stack:**
- Language/runtime selection or version change
- Framework adoption or replacement
- Database or event store selection
- Messaging, queuing, or caching layer changes

**Domain Architecture:**
- Bounded context boundary definition or change
- New aggregate identification
- Service decomposition or merging
- New domain type that crosses module boundaries

**Integration Patterns:**
- New external API integration (sync or async)
- Anti-corruption layer design
- Data import/export mechanisms
- New webhook or callback pattern

**Cross-Cutting Concerns:**
- Authentication/authorization strategy changes
- Observability approach (logging, metrics, tracing)
- Error handling and resilience patterns
- New middleware or interceptor patterns

**Infrastructure:**
- Deployment topology changes
- New background job framework or queue
- Database connection pooling or caching strategy
- CI/CD pipeline structural changes
- Worktree isolation boundary changes (new shared services, new per-worktree resources)

**ADR format:** Use `templates/adr.md.template`. Sequential numbering in `.docs/decisions/`.
ADRs are append-only — supersede, don't delete. Every claim about external dependency behavior
must cite specific evidence (documentation, tested behavior, or source code).

**Lightweight mode (Medium tier):** Create ADRs only for categories marked above — do not skip
ADR creation just because the feature is medium-sized. The threshold is the decision category,
not the feature complexity.

**GATE: If a change touches a decision category above and no ADR exists, architecture-review
MUST create one. An architecture review that approves without documenting decisions is
incomplete.**

### 7b. ADR Approval Lifecycle

ADRs follow a three-phase lifecycle. No ADR becomes authoritative without human approval.

**Phase 1: DRAFT**
- Architecture-review creates the ADR with `Status: DRAFT` in the frontmatter
- DRAFT ADRs are written to `.docs/decisions/` with the standard naming convention
- DRAFT ADRs cannot be cited as justification in code review, evaluator verdicts, or
  implementation decisions — they are proposals, not decisions

**Phase 2: REVIEW**
- All DRAFT ADRs created during architecture-review are presented to the user for approval
  via `review_artifacts` (clear screen, one at a time)
- The user approves, rejects (launches interactive Claude to revise), or requests changes
- On approval, status is updated to `Status: APPROVED` and the ADR becomes authoritative
- On rejection, the ADR is revised in-place and re-presented until approved

**Phase 3: AUTHORITATIVE**
- Only `Status: APPROVED` ADRs are binding on downstream work
- Pipeline evaluators, code review, and `/finish` gates may cite APPROVED ADRs
- If a subsequent feature conflicts with an APPROVED ADR, the conflict must be resolved by
  either superseding the ADR (new ADR with `Supersedes: <old>`) or changing the implementation
- Superseded ADRs get `Status: SUPERSEDED` and a `Superseded by:` reference

**HARD GATE: No feature proceeds past architecture-review with DRAFT ADRs. All ADRs created
during the review must reach APPROVED status before `/writing-system-tests` can begin.**

### 8. Output

Write the review to `.docs/decisions/architecture-review-YYYY-MM-DD-<feature>.md`:

```markdown
# Architecture Review: [Feature Name]
**Date:** YYYY-MM-DD
**Stories reviewed:** [list]
**Verdict:** APPROVED | APPROVED WITH CONDITIONS | BLOCKED

## Feasibility
## Complexity
## Alignment
## Domain Integrity
## Risks
## ADRs Created
## Conditions (if APPROVED WITH CONDITIONS)
## Blocking Issues (if BLOCKED)
```

### 9. Verdict Enforcement

**APPROVED** — Proceed to `/writing-system-tests`.

**APPROVED WITH CONDITIONS** — Proceed; conditions tracked in the plan. Evaluator checks at code review. Unmet conditions at `/finish` are blocking.

**BLOCKED** — Pipeline HALTS. Present to the user: what is violated, resolution options with trade-offs, and which ADRs are in conflict. The user must explicitly approve a resolution. Do not auto-resolve. Capture the resolution as a new ADR and re-run the review.

### 10. Recurring Review (Pipeline Batch Boundaries)

At pipeline batch boundaries, perform a lightweight architecture check:

- Has the implementation drifted from the approved plan?
- Have new patterns been introduced without an ADR?
- Are domain boundaries being respected in the actual code?
- Are architecture diagrams still accurate after this batch's changes?
- Escalation: non-blocking findings that appear in 2+ consecutive reviews become blocking

If drift is detected at a batch boundary:
1. Write a new ADR documenting what changed and why (or that it was unintentional)
2. If the drift violates a prior ADR: BLOCK — human must decide whether to update the ADR
   or revert the code

## Verification

- [ ] All stories assessed for feasibility
- [ ] Complexity rated per story
- [ ] Alignment checked against .docs/decisions/ and CLAUDE.md
- [ ] Domain integrity pre-checked
- [ ] Risk register populated
- [ ] ADR created for every architectural decision made
- [ ] Review written to .docs/decisions/
- [ ] Verdict issued (APPROVED / CONDITIONS / BLOCKED)
- [ ] Architecture diagrams reviewed for accuracy against plan/implementation
- [ ] BLOCKED verdicts halt pipeline and require human resolution
