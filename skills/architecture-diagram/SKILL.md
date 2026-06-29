---
name: architecture-diagram
description: "Generate and maintain C4 architecture diagrams using Mermaid in Markdown. Runs at bootstrap, plan, and post-implementation. Gating — diagrams must reflect current architecture."
enforcement: gating
phase: all
standalone: true
requires: []
model: sonnet
---

## Purpose

Generates and maintains C4-model architecture diagrams in Mermaid-in-Markdown format.
Diagrams live in `.docs/architecture/` and are consumed by `/architecture-review` as input.
They are text-based (diffable), render natively in GitHub, and require no external tools.

**Engineer validation is required** — diagrams are never auto-approved. Present them for
review after generation or update.

## Diagram Types

Five diagram types, each in its own `.md` file:

| Type | File | C4 Level | Shows |
|------|------|----------|-------|
| System Context | `.docs/architecture/system-context.md` | L1 | Users, external systems, boundaries |
| Containers | `.docs/architecture/containers.md` | L2 | App servers, databases, queues, caches |
| Components | `.docs/architecture/components.md` | L3 | Models, services, controllers, jobs |
| Sequences | `.docs/architecture/sequences/<flow>.md` | — | Request flows through the system |
| ERD | `.docs/architecture/erd.md` | — | Database tables and relationships |

**L4 (code level) is intentionally omitted** — it changes too frequently to maintain and
provides minimal value over reading the source code directly.

## Mermaid Format Convention

Each diagram file follows this structure:

```markdown
# [Diagram Type]: [Project Name]

**Last updated:** YYYY-MM-DD
**Scope:** [what this diagram covers]

## Diagram

` ` `mermaid
[diagram content]
` ` `

## Legend

[explanation of boundaries, color coding, abbreviations]

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| YYYY-MM-DD | Initial generation | Created during /bootstrap |
```

Use appropriate Mermaid diagram types:
- System Context / Containers / Components → `graph TD` or `graph LR`
- Sequences → `sequenceDiagram`
- ERD → `erDiagram`

## Practices

### 1. Bootstrap Generation

When invoked from `/bootstrap` (existing projects), scan the codebase to generate initial
diagrams. Use the inventory from bootstrap Step 4 — do not re-scan.

**System Context (L1):**
- Detect external APIs from: config files, environment variables, HTTP client gems/packages
- Detect user types from: authentication setup, role definitions
- Detect system boundaries from: Procfile, deployment config

**Containers (L2):**
- Detect from: Procfile, docker-compose.yml, database.yml, Redis/cache config, job queue config
- Each container gets a node with technology annotation

**Components (L3):**
- Detect from: directory structure — `app/models/`, `app/controllers/`, `app/services/`, `app/jobs/`
- Group by domain if module structure is apparent
- Show dependencies between component groups

**Sequences:**
- Generate for the 3-5 most important request flows
- Detect from: routes + controllers (highest traffic or most complex)
- Include: HTTP request → controller → service → model → response

**ERD:**
- Generate from: model definitions (ActiveRecord associations, Prisma schema, etc.)
- Show: tables, primary keys, foreign keys, relationship types (has_many, belongs_to, etc.)

For **new/fresh projects**, generate skeleton diagrams with placeholder components from the
scaffold output. These populate as the design develops.

Present all diagrams to the engineer for validation before proceeding.

> **Render diagrams for review.** When a mermaid renderer is configured (set at
> install, stored as `mermaid_renderer` in `~/.ai-conductor/config.yml`), the
> engineer should review the diagrams as visuals, not raw Mermaid. Under
> `conduct-ts` this happens automatically at the approval gate. Otherwise run
> `conduct render-diagrams .docs/architecture/*.md` to render and open them. If no
> renderer is configured the diagrams fall back to raw Markdown — never a blocker.

### 2. Plan Update

When invoked from `/plan` (Step 8b), read the implementation plan and stories, then
**update the existing diagrams in place** to reflect the planned architecture. Do not
create separate proposed-state files — mutate the current diagrams directly.

Update the change log in each modified diagram file with the date and reason.

Present updated diagrams to the engineer for validation before proceeding.

### 3. Post-Implementation Verification

During `/architecture-review` at batch boundaries, compare the current code structure
against diagrams. Flag discrepancies:

| Change Type | Diagram Impact |
|-------------|---------------|
| New model/controller/service | Update component diagram |
| New external integration | Update system context + containers |
| New database table | Update ERD |
| New relationship between tables | Update ERD |
| New request flow | Add sequence diagram |
| New background job queue | Update containers |

### 4. Diagram Scope Rules

Not every code change requires a diagram update. Apply these rules:

**Update required:**
- New model, controller, service, or job added
- New external API integration
- New database table or changed table relationships
- New message queue or cache layer
- New user-facing interface type

**No update needed:**
- Adding a field to an existing model (unless it changes relationships)
- Adding a method to an existing service (unless it creates a new dependency)
- Refactoring internals of an existing component
- Bug fixes that don't change architecture
- Test changes

### 5. C4 Model Guidelines

**Level 1 (System Context):** Show YOUR system as a single box. Show external systems,
users, and how they interact with your system. Keep it high-level — non-technical stakeholders
should understand this.

**Level 2 (Containers):** Zoom into your system. Show the major runtime components: web app,
API server, database, cache, job queue, etc. Each container is separately deployable.

**Level 3 (Components):** Zoom into a container. Show the internal modules: models, services,
controllers, jobs. Group by domain when possible.

**When to stop:** L3 is usually sufficient. Only go to L4 (code) for genuinely complex
algorithms or state machines that benefit from a visual representation — and even then,
prefer a sequence diagram over a class diagram.

### 6. Large Diagram Handling

If a component or ERD diagram becomes too large to render cleanly (>30 nodes), split it
into sub-diagrams by domain boundary:

```
.docs/architecture/components.md           → overview (domain groups as single nodes)
.docs/architecture/components-auth.md      → auth domain detail
.docs/architecture/components-billing.md   → billing domain detail
```

Reference the overview diagram from the detail diagrams and vice versa.

## Output

Generated files:
- `.docs/architecture/system-context.md`
- `.docs/architecture/containers.md`
- `.docs/architecture/components.md`
- `.docs/architecture/sequences/<flow-name>.md` (one per flow)
- `.docs/architecture/erd.md`

## Verification

- [ ] System context diagram reflects all external systems and user types
- [ ] Container diagram shows all major runtime components
- [ ] Component diagram covers models, services, controllers, jobs
- [ ] ERD matches current schema (tables, relationships, key columns)
- [ ] Sequence diagrams cover 3-5 primary request flows
- [ ] All diagrams use valid Mermaid syntax in `.md` files
- [ ] Diagrams stored in `.docs/architecture/`
- [ ] Change log updated when diagrams are modified
- [ ] Engineer validation requested and received
