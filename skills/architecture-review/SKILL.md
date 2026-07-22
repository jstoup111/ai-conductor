---
name: architecture-review
description: "Use before implementation to review stories through a technical feasibility and architectural alignment lens. Also use at batch boundaries to catch architectural drift."
enforcement: gating
phase: decide
standalone: true
requires: [verify-claims]
---

## Purpose

Reviews the design through an architectural lens BEFORE stories are written and before any code.
Catches technical infeasibility, hidden complexity, architectural drift, and domain violations
early — when they're cheap to fix. This is where the *how* is resolved (so the PRD stays
product-only) and captured as APPROVED ADRs.

**Run after `/prd` (product track) or `/explore` (technical track), and BEFORE `/stories`** (adr-2026-06-29-architecture-before-stories-convergent-kickback).
The review's input is the PRD's functional requirements (product) or the explore output + technical
intent (technical) — stories and the plan do not exist yet at this point.

Also invocable at pipeline batch boundaries to verify implementation stays architecturally sound.

**Correctness gate:** an ADR is the most load-bearing artifact in the flow — everything downstream
builds on it. Apply the `/verify-claims` protocol before writing any APPROVED ADR: state each
technical claim with a grounded confidence % and its basis (verified vs inferred), surface every
assumption the design rests on, and HARD-BLOCK (operator approval interactive, HALT if autonomous)
on any unconfirmed assumption that would change the decision. Do not record a decision as APPROVED
while it rests on an unconfirmed load-bearing assumption.

### Full vs amendment mode (convergence — adr-2026-06-29-architecture-before-stories-convergent-kickback)

- **Full pass** — the pre-stories run above: full feasibility/alignment, produces APPROVED ADRs.
- **Amendment pass** — when a later step (`stories` or `conflict-check`) re-opens architecture with a
  specific **structural** gap, address ONLY that gap; do not re-derive the design from scratch. This
  is what makes the loop converge instead of oscillate.

Only a genuine structural gap (a missing component/seam/boundary) may re-open architecture — never a
story-phrasing nit or a coverage gap. The conductor caps re-openings and HALTs for a human on excess.

### Lightweight Mode (Medium Complexity Tier)

When the feature is classified as **Medium** by `/conduct`'s complexity assessment, run only:
- **Section 2: Technical Feasibility** — full check
- **Section 4: Architectural Alignment** — full check

Skip:
- Section 3 (Complexity Assessment) — already done by `/conduct`
- Section 5 (Domain Integrity Pre-Check) — handled by TDD domain reviewer per-cycle
- Section 7 (mandatory ADR creation) — only create ADRs for genuinely novel architectural decisions

**Explore agent limits for Medium tier:** Max 2 agents with non-overlapping scopes:
- Agent 1: the PRD/spec (`.docs/specs/`) — its FRs are the review input (stories/plan don't exist yet)
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

**Production DI defaults:**
- Verify that production dependency injection defaults use persistent stores (PostgreSQL,
  Redis, filesystem) — not in-memory implementations
- Flag any `InMemory*`, `Fake*`, or `Stub*` class registered as a production default
- **BLOCKED if production DI defaults use in-memory stores for stateful data** — this means
  data loss on restart and test/prod divergence when acceptance tests override DI

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
`.docs/decisions/adr-YYYY-MM-DD-<kebab-slug>.md` — date plus a short descriptive slug — and title it
`# ADR: <title>` (the heading carries **no** number). **Never use a sequential number, in the
filename or the heading:**

- ❌ WRONG: `adr-0001-ci-fix.md` with heading `# ADR-0001: …`
- ✅ RIGHT: `adr-2026-07-20-ci-fix.md` with heading `# ADR: …`

Sequential numbers collide when parallel worktrees each grab "the next number"; the date+slug never
collides and IS the ADR's identifier — cite the **filename stem** (never a number) when superseding
or referencing one. If two ADRs land on the same date, the slug disambiguates. This applies to newly
created ADRs only — existing numbered ADRs keep their names (append-only). (A deterministic gate to
reject number-named ADRs is tracked in intake #705.)
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
## Wiring Surface (required for Medium/Large tier — see below; omit for Small)
## Risks
## ADRs Created
## Conditions (if APPROVED WITH CONDITIONS)
## Blocking Issues (if BLOCKED)
```

**Wiring Surface (design-time, Medium/Large tier only):** For each new production surface
the feature introduces (exported function/module, hook script, config key, emitted event,
scheduled job, CLI subcommand, etc.), state at design time where/how it will be called from
in production — e.g. "invoked from the daemon loop's step dispatcher," "wired into
`conduct-ts`'s CLI command table," "consumed by the existing event bus subscriber in
`src/x.ts`." This is a design-time commitment, not a code citation — no `file:line` is
required yet since the code doesn't exist. It is the precursor `/plan` later derives its
`Wired-into:` contract from for each task.

This is **DESIGN-TIME ONLY**. It does not affect, duplicate, or substitute for the §12
As-Built Compliance Gate's production reachability sweep, which independently verifies the
*shipped* code against real `file:line` callers after implementation. Leave §12 untouched —
the two checks run at different phases against different evidence (a stated intent here vs.
an observed caller there).

Not required for **Small** tier features (architecture-review is skipped entirely for Small
per the Lightweight Mode section above).

**Early overlap scan (Medium/Large tier):** Before `/plan` runs, run `conduct-ts overlap-scan
--files <Wiring Surface candidate paths>` over the paths named in `## Wiring Surface` above.
Surface the rendered report to the author alongside the review output. This is **advisory
only** — it never blocks the verdict or the review — it exists to flag unmerged dependent
work touching the same files before `/plan` locks in a task breakdown that could collide
with it.

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

Invoked at **SHIP** as `/architecture-review --as-built`, a member of the concurrent
validation group — fanned out alongside `/manual-test` and `/prd-audit` in daemon/auto
runs; in interactive runs it runs serially, after `/prd-audit` and before `/retro` and
`/finish`. This is the final architectural drift sweep: it checks the
**shipped code** against **APPROVED** ADRs and the approved architecture only. It is lightweight —
it does **no** new design, creates no new feasibility/complexity assessment, and reuses the drift
logic of §10 (Recurring Review) and the ADR lifecycle of §7b.

**Scope (only this):**
- Load only the **APPROVED** ADRs (`.docs/decisions/`, `Status: APPROVED`) and the approved
  architecture diagrams (`.docs/architecture/`). DRAFT/SUPERSEDED ADRs are not authoritative and
  are not gated against (per §7b).
- Compare the as-shipped code to those approved decisions: were new patterns introduced without an
  ADR? Are domain boundaries respected in the actual code? Do diagrams still match reality?
- **Production reachability sweep (green-but-unwired guard).** For each primitive this
  feature's diff introduces or materially changes — exported functions/modules, hook scripts,
  config keys, emitted events, ADR-promised log lines — trace ONE invocation path from a real
  production entry point (`conduct-ts` CLI dispatch, the daemon loop, hook/settings provisioning,
  a wired step runner) and cite the caller as `file:line`. Test files, fixtures, and the
  primitive's own module do not count as callers.
  - **No production caller exists** → this is a **BLOCKED** violation ("unreachable rung"), same
    severity as an ADR violation: shipped-tested-green code nothing invokes is not shipped
    behavior. Name the primitive and what was searched.
  - **Statically reachable but not yet observed running** (e.g. a new log line no production log
    shows yet) → record it under Drift Notes as `UNEXERCISED: <primitive> — signature: <the
    greppable line/event that will prove it live>`. Not blocking; the signature tells a later
    observer exactly what proves the behavior live in production.
  - The failure shapes this exists to catch: an event callback shipped with no caller anywhere;
    a capability wired into one of its several consumers while the rest silently kept the old
    behavior; a primary code path whose fallback carries 100% of production traffic because the
    primary's precondition is never produced. All are green under unit tests and invisible to a
    conformance-only review.
- Do NOT re-run §2/§3/§5 (feasibility/complexity/domain pre-checks) — those belong to the DECIDE
  pass. This is a code-vs-approved-design pattern match plus the reachability sweep above,
  deliberately cheap.

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

## Production Reachability (every new/changed primitive → its production caller, file:line;
## UNEXERCISED entries carry their observation signature)
## Drift Notes (if any)
## Blocking Violations (if BLOCKED — which APPROVED ADR or unreachable rung, file:line)
## Resolution (if BLOCKED — code fix OR superseding ADR; human-approved)
```

The conductor's objective gate reads the `Verdict:` line and is **fail-closed**: only an explicit
`APPROVED` or `APPROVED WITH DRIFT NOTES` passes. `BLOCKED`, a missing `Verdict:` line, or any
other verdict keeps the gate unsatisfied so the SHIP tail cannot reach finish — always write a
clean, recognizable verdict. (The conductor also skips this gate entirely when the DECIDE-phase
`architecture_review` was skipped — Small tier, or config/`when:` skip — since there are no
APPROVED ADRs to audit.)

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
- [ ] **Medium/Large tier:** `## Wiring Surface` section present, naming where each new
      production surface will be called from — BLOCKS approval if missing (not required
      for Small; design-time only, does not affect §12 as-built reachability sweep)
- [ ] ADR created for every architectural decision made
- [ ] Review written to .docs/decisions/
- [ ] Verdict issued (APPROVED / CONDITIONS / BLOCKED)
- [ ] Architecture diagrams reviewed for accuracy against current implementation
- [ ] BLOCKED verdicts halt pipeline and require human resolution
- [ ] `.pipeline/review-required-architecture_review` marker written IF
      verdict ≠ clean APPROVED, or any ADR was drafted/superseded, or any
      High-impact risk was registered (skip only on truly clean APPROVED)
- [ ] **As-built mode:** at SHIP, shipped code checked against APPROVED ADRs only (no new design)
- [ ] **As-built mode:** every diff-introduced primitive cites a production caller (`file:line`)
      from a real entry point; no caller ⇒ BLOCKED as an unreachable rung
- [ ] **As-built mode:** statically-reachable-but-unobserved behavior recorded as `UNEXERCISED`
      with its greppable observation signature
- [ ] **As-built mode:** verdict written to `.pipeline/architecture-review-as-built.md`
- [ ] **As-built mode:** BLOCKED on any APPROVED-ADR violation; resolved by code fix or
      human-approved superseding ADR (never silent downgrade)
- [ ] **As-built mode:** `.pipeline/review-required-architecture-as-built` marker written when the
      verdict is not a clean APPROVED
