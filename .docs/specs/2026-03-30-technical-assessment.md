# Design: Technical Assessment (/assess)

**Date:** 2026-03-30
**Status:** Approved

## Problem

Current harness gates (architecture-review, code-review, domain-reviewer) are task-scoped — they
check individual diffs and stories but miss systematic issues that span the whole codebase.
Evidence from retros: best-stock-picker had 11 modules all using InMemoryEventStore, zero auth
on any endpoint, event versioning bugs replicated across 3 modules, and silent exception
swallowing — none caught by existing gates because each task looked fine in isolation.

A fractional CTO walking into a codebase would catch these in the first assessment. The harness
needs the same capability.

## Solution

New `/assess` skill with 9 specialist agents + 1 CTO orchestrator. Each specialist deeply
evaluates one dimension of code health. The CTO agent synthesizes all findings into a
prioritized assessment report with opinionated recommendations.

**Invocation:**
- **Onboarding:** Runs as part of conduct after bootstrap for existing projects
- **On-demand:** User invokes `/assess` anytime for a health check
- **Selective:** `/assess --area security` runs only the security specialist

**Flow:**
```
9 specialist agents (3 parallel batches of 3)
  → 9 dimension reports in .pipeline/assessment/
    → CTO orchestrator reads all 9, cross-references, synthesizes
      → Final report: .docs/decisions/technical-assessment-YYYY-MM-DD.md
```

## Specialist Agents (9)

### Batch 1 (parallel)

**1. Security Auditor** (`agents/cto-security.md`) — Opus
- Auth coverage: every route needing auth has the dependency?
- Input validation: params validated at boundary, not repeated internally
- SQL injection, XSS, CSRF: parameterized queries, escaped output, protected forms
- Secret management: no hardcoded secrets, env vars used correctly
- Rate limiting: unbounded endpoints protected
- OWASP top 10 scan across all routes

**2. Data Integrity Reviewer** (`agents/cto-data-integrity.md`) — Opus
- Transaction boundaries: multi-step state changes wrapped in transactions?
- Event sourcing correctness: versioning, idempotency, replay safety
- Race conditions: concurrent access patterns, locking strategy
- Data migration safety: reversible migrations, backfill strategy
- Backup/recovery: strategy exists and is tested

**3. Dependency Auditor** (`agents/cto-dependencies.md`) — Sonnet
- Outdated packages: major versions behind, known CVEs
- Framework EOL: language/framework version support status
- License compliance: incompatible licenses in dependency tree
- Upgrade paths: blocking upgrades, deprecation warnings

### Batch 2 (parallel)

**4. Architecture Coherence Reviewer** (`agents/cto-architecture.md`) — Opus
- Implementation matches documented decisions (.docs/decisions/)?
- Cross-module consistency: same pattern used everywhere or inconsistent?
- Domain boundaries respected at data and API level
- No new patterns introduced without ADR
- Coupling analysis: god classes, circular dependencies

**5. Code Duplication Detector** (`agents/cto-duplication.md`) — Sonnet
- Boilerplate patterns across module boundaries (CRUD, validators, error handlers)
- Copy-paste code appearing 3+ times → extraction candidate
- Similar-but-different implementations of the same behavior
- Severity based on blast radius (how many places to change if logic changes)

**6. Test Strategy Reviewer** (`agents/cto-testing.md`) — Sonnet
- Coverage gaps: source files without any test
- Test layer balance: unit vs integration vs acceptance
- Assertion quality: testing behavior or implementation details?
- Fragile tests: coupled to internals, break on refactor
- Missing negative paths: error scenarios untested

### Batch 3 (parallel)

**7. Infrastructure Reviewer** (`agents/cto-infrastructure.md`) — Sonnet
- Database: pooling configured, connection limits, index coverage
- Caching: Redis/Memcached configured if needed, TTLs set
- Background jobs: timeout/retry configured, dead letter handling
- Production parity: same code works in dev and production
- Secrets: environment-based, not hardcoded defaults

**8. Observability Reviewer** (`agents/cto-observability.md`) — Sonnet
- Error handling: consistent patterns, no silent swallowing
- Logging: structured logging, appropriate levels, no sensitive data logged
- Monitoring: health checks, alerting on failures
- Debugging: error context preserved (stack traces, request IDs)

**9. Developer Experience Reviewer** (`agents/cto-devex.md`) — Sonnet
- Onboarding: README accurate, setup instructions work
- CI/CD: pipeline exists, tests run on PR, deploy process documented
- Local dev: docker-compose or equivalent, seed data available
- Documentation: inline comments where needed, API docs if public
- Debugging tooling: console access, log tailing, test isolation

### CTO Orchestrator (`agents/cto-orchestrator.md`) — Opus

Reads all 9 specialist reports. Cross-references findings. Produces:

1. **Executive summary** — 3-5 sentences on overall code health
2. **Critical findings** — issues that would block a production deploy or cause data loss
3. **Systemic patterns** — findings that appear across multiple specialist reports
   (e.g., "auth gaps + no rate limiting + silent errors = security posture problem")
4. **Prioritized roadmap** — ordered list of what to fix first, with reasoning
5. **Quick wins** — low-effort, high-impact fixes that can be done immediately

The CTO agent is opinionated — it doesn't just list findings, it says what matters most and why.

## Scope

### In Scope
- 9 specialist agent persona files
- 1 CTO orchestrator agent file
- 1 `/assess` skill file (SKILL.md)
- Integration into conduct flow (after bootstrap for existing projects)
- On-demand invocation support
- Assessment report template

### Out of Scope
- Story conversion (stays in `/stories`)
- Implementation fixes (assessment identifies, doesn't fix)
- Frontend-specific assessment (covered by existing code-review)
- Performance benchmarking (assessment flags risks, doesn't measure)

## Key Decisions
- **9 agents, not 3 composites** — depth over speed. Each agent is an expert.
- **CTO orchestrator synthesizes** — the value is prioritization, not just listing findings
- **Opus for reasoning-heavy (security, data integrity, architecture, CTO), Sonnet for checklist-based (deps, duplication, testing, infra, observability, devex)**
- **3 parallel batches of 3** — balances token cost with wall-clock time
- **Report is the output, not stories** — assessment feeds brainstorm/stories, doesn't replace them
- **On-demand + onboarding** — not a recurring gate in the conduct loop (too expensive)

## Open Questions
None — scope and approach are clear.
