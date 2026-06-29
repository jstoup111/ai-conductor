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
- Do architecture diagrams in `.docs/architecture/` reflect the current architecture?
- If new containers, services, or external integrations have been added, are diagrams updated?
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

**ADR format:** Use `templates/adr.md.template`. Name each ADR
`.docs/decisions/adr-YYYY-MM-DD-<kebab-slug>.md` — date plus a short descriptive slug.
**Do NOT use sequential numbers** (ADR-001, ADR-007, …): parallel worktrees each grabbing
"the next number" collide. The date+slug is the ADR's identifier; cite the filename stem when
superseding or referencing one. If two ADRs land on the same date, the slug disambiguates.
This applies to newly created ADRs only — existing numbered ADRs keep their names (append-only).
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
- DRAFT ADRs are written to `.docs/decisions/` as `adr-YYYY-MM-DD-<kebab-slug>.md` (see §7)
- DRAFT ADRs cannot be cited as justification in code review, evaluator verdicts, or
  implementation decisions — they are proposals, not decisions

**Phase 2: REVIEW**
- All DRAFT ADRs created during architecture-review are presented to the user for approval
  via `review_artifacts` (clear screen, one at a time)
- When an ADR contains a Mermaid diagram and a `mermaid_renderer` is configured
  (`~/.ai-conductor/config.yml`), `review_artifacts` renders it to a visual so the user
  approves what they can see; with no renderer it falls back to the raw Markdown (never blocks)
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

### 11. Signal Review Requirement

Before exiting, decide whether the conductor should prompt the user to review
the architecture report and ADRs. Review mode for this step is **conditional** —
auto-approved unless you write a marker file.

Write `.pipeline/review-required-architecture_review` (any content; the file's
existence is the signal) if ANY of the following is true:

- Verdict is **APPROVED WITH CONDITIONS** or **BLOCKED**
- Any new ADR was drafted (DRAFT ADRs must be approved before they become authoritative)
- Any existing ADR was superseded
- Any risk with Impact=High was entered in the Risk Register
- Batch-boundary review found drift from the approved plan

If the verdict is a clean **APPROVED** with zero new/superseded ADRs and no
High-impact risks, do NOT write the marker — the conductor auto-approves and
moves to the next step.

```bash
# Example: write the marker when review flagged issues
mkdir -p .pipeline
echo "verdict: APPROVED_WITH_CONDITIONS, new ADRs: 2" > .pipeline/review-required-architecture_review
```

### 12. As-Built Compliance Gate (`--as-built` mode)

Invoked at **SHIP**, after `/prd-audit` and before `/retro` and `/finish`, as
`/architecture-review --as-built`. This is the final architectural drift sweep: it checks the
**shipped code** against **APPROVED** ADRs and the approved architecture only. It is lightweight —
it does **no** new design, creates no new feasibility/complexity assessment, and reuses the drift
logic of §10 (Recurring Review) and the ADR lifecycle of §7b.

**Scope (only this):**
- Load only the **APPROVED** ADRs (`.docs/decisions/`, `Status: APPROVED`) and the approved
  architecture diagrams (`.docs/architecture/`). DRAFT/SUPERSEDED ADRs are not authoritative and
  are not gated against (per §7b).
- Compare the as-shipped code to those approved decisions: were new patterns introduced without an
  ADR? Are domain boundaries respected in the actual code? Do diagrams still match reality?
- Do NOT re-run §2/§3/§5 (feasibility/complexity/domain pre-checks) — those belong to the DECIDE
  pass. This is a code-vs-approved-design pattern match, deliberately cheap.

**Verdict:**
- **APPROVED** — shipped code matches the approved architecture. Proceed to retro/finish.
- **APPROVED WITH DRIFT NOTES** — minor, non-violating drift (e.g. a diagram is now slightly stale,
  a pattern was extended consistently). Record the drift; proceed. Note it for a follow-up ADR if
  warranted, but it does not block.
- **BLOCKED** — shipped code **violates an APPROVED ADR**. The loop HALTS. A human must resolve it:
  either fix the code to comply, or supersede the ADR with a new, human-APPROVED ADR
  (`Supersedes: <old>`, old → `Status: SUPERSEDED`). **Never silently downgrade** an APPROVED ADR
  or auto-resolve the violation. After resolution, re-run the as-built gate.

**Artifact:** write the result to `.pipeline/architecture-review-as-built.md`
(run evidence — gitignored, stable filename, overwritten each run; NOT a
committed design artifact. Durable ADRs and the design-time architecture
review remain in `.docs/decisions/`):

> **(Over)writing this file is mandatory on EVERY invocation — make it the final
> action of this step.** Even if a prior run's artifact is already present and you
> judge it still accurate (same HEAD, unchanged tree, identical verdict), do NOT
> keep it as-is and do NOT skip the write. The conductor's gate checks the file's
> mtime against the *current session*: a prior-session artifact you decline to
> rewrite reads as **stale**, fails the gate, and HALTs the SHIP tail — and every
> retry repeats the same reuse decision, so it never clears. Re-emit the full
> verdict every run. The write is unconditional; it is never satisfied by reusing
> an existing artifact, however complete that artifact seems.

```markdown
# As-Built Architecture Review: <Feature Name>
**Date:** YYYY-MM-DD
**Mode:** as-built (SHIP compliance gate)
**APPROVED ADRs checked:** [list]
**Verdict:** APPROVED | APPROVED WITH DRIFT NOTES | BLOCKED

## Drift Notes (if any)
## Blocking Violations (if BLOCKED — which APPROVED ADR, where the code violates it, file:line)
## Resolution (if BLOCKED — code fix OR superseding ADR; human-approved)
```

The conductor's objective gate reads the `Verdict:` line: a verdict of `BLOCKED` keeps the gate
unsatisfied so the SHIP tail cannot reach finish; `APPROVED` and `APPROVED WITH DRIFT NOTES` pass.

**Review marker:** review mode for this step is **conditional**. Write
`.pipeline/review-required-architecture-as-built` (existence = signal) whenever the verdict is not a
clean `APPROVED` — i.e. on `APPROVED WITH DRIFT NOTES` or `BLOCKED`, or when an ADR was superseded
to resolve a violation. On a clean `APPROVED`, do NOT write the marker.

```bash
# Example: write the marker when the as-built sweep was not clean
mkdir -p .pipeline
echo "verdict: BLOCKED, violated adr-2026-06-29-rate-limit-strategy" > .pipeline/review-required-architecture-as-built
```

## Verification

- [ ] All stories assessed for feasibility
- [ ] Complexity rated per story
- [ ] Alignment checked against .docs/decisions/ and CLAUDE.md
- [ ] Domain integrity pre-checked
- [ ] Risk register populated
- [ ] ADR created for every architectural decision made
- [ ] Review written to .docs/decisions/
- [ ] Verdict issued (APPROVED / CONDITIONS / BLOCKED)
- [ ] Architecture diagrams reviewed for accuracy against current implementation
- [ ] BLOCKED verdicts halt pipeline and require human resolution
- [ ] `.pipeline/review-required-architecture_review` marker written IF
      verdict ≠ clean APPROVED, or any ADR was drafted/superseded, or any
      High-impact risk was registered (skip only on truly clean APPROVED)
- [ ] **As-built mode:** at SHIP, shipped code checked against APPROVED ADRs only (no new design)
- [ ] **As-built mode:** verdict written to `.pipeline/architecture-review-as-built.md`
- [ ] **As-built mode:** BLOCKED on any APPROVED-ADR violation; resolved by code fix or
      human-approved superseding ADR (never silent downgrade)
- [ ] **As-built mode:** `.pipeline/review-required-architecture-as-built` marker written when the
      verdict is not a clean APPROVED
