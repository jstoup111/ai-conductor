---
name: brainstorm
description: "Use when starting any new feature, enhancement, or significant change. Explores requirements, asks clarifying questions, proposes approaches with trade-offs, and produces a design document."
enforcement: advisory
phase: decide
standalone: true
requires: []
---

## Purpose

Explores the user's intent, gathers requirements, and produces a design document before any
implementation begins. Prevents building the wrong thing by ensuring alignment on what and why
before discussing how.

## Practices

### 1. Explore Project Context

Before asking questions, understand what exists. If the conversation already contains
exploration results (e.g., from a prior Explore agent or `/bootstrap`), summarize what's
known and only explore gaps — do not re-explore files already in context.

When dispatching Explore agents:
- **Max 2 agents** with explicitly partitioned search spaces (no file overlap)
- Agent 1: feature-relevant source files (routes, models, services in the affected area)
- Agent 2: existing tests and stories for the affected area
- Do NOT dispatch agents to read `.memory/` (auto-loaded at session start)

Checklist:
- Read relevant code, routes, models, and tests
- Check `.memory/` for prior decisions and context about this area
- Review existing stories in `.docs/stories/` for related features
- Note existing patterns and conventions

### 2. Ask Clarifying Questions

Ask questions **one at a time**, not batched. Each question should build on the previous answer.

Focus on:
- **What** the user wants (not how to build it)
- **Who** uses this feature and their expectations
- **Why** this matters (business context, user pain, compliance, etc.)
- **Scope boundaries** — what is explicitly NOT included
- **Constraints** — performance, security, compatibility requirements

Stop asking when you have enough context to propose approaches. Don't over-question.

### 3. Propose Approaches

Present 2-3 approaches with clear trade-offs:

```markdown
### Approach A: [Name]
**How:** [Brief description]
**Pros:** [What's good about this]
**Cons:** [What's risky or costly]
**Best when:** [Conditions that favor this approach]

### Approach B: [Name]
...
```

Include a recommendation with reasoning. The user decides.

### 4. Write Design Document

After the user selects an approach, write a design document using `templates/design-doc.md.template`.

Required sections: Problem, Solution, Scope (In/Out), Key Decisions, Open Questions.
```

Save to `.docs/specs/YYYY-MM-DD-<topic>.md`

### 5. Scope Check

Before presenting for approval, compare the design against the user's **original request**:

1. Count models, endpoints, and major features in the design
2. Compare against what the user actually asked for
3. If the design significantly exceeds the request (e.g., user asked for 2 models, design has 10),
   surface this explicitly:

```
Scope check: You asked for [original request summary].
This design includes [N models, M endpoints, K features].
This is [larger/smaller/aligned] with your request.
Confirm you want the expanded scope, or should I trim to [specific suggestion]?
```

Do NOT silently expand scope. The user must explicitly approve any expansion beyond their request.

### 6. Get Approval

Present the design document to the user. Do NOT proceed to stories until the user explicitly
approves. "Looks good" or "yes" counts as approval. Ambiguous responses → ask for clarification.

After approval, update the document status to "Approved" and suggest invoking the `stories` skill.

### 7. API Contract (API Projects Only)

If the project exposes an API (detected by: `--api` flag, API-only controllers, JSON responses):

1. Check if `.docs/decisions/api-response-contract.md` already exists
2. If not, generate one from `templates/api-response-contract.md.template`
3. Present to user for review — the contract defines: success/error envelopes, HTTP status
   conventions, pagination structure, timestamp format
4. Save approved contract to `.docs/decisions/api-response-contract.md`
5. All controllers must conform. Deviations require an ADR amendment.

This MUST happen before stories — stories reference the contract for response format assertions.

## Constraints

- **HARD CONSTRAINT: Brainstorm MUST NEVER call `ExitPlanMode`.** This skill produces a design
  document, not an implementation plan. Calling ExitPlanMode will cause `/conduct` to mark
  brainstorm as "failed" in conduct-state because plan mode was already exited when brainstorm
  was invoked mid-conversation. Write the design doc and return — plan mode is not active.

### Memory Checkpoint

After the user approves the design document, persist:
- **Category: `decisions/`** — The selected approach and why alternatives were rejected
- Only if: the decision involves a non-obvious trade-off that would not be apparent from reading the design doc alone

Do NOT persist: the design doc contents (that is in `.docs/specs/`).

## Verification

- [ ] Project context explored before asking questions
- [ ] Questions asked one at a time (not batched)
- [ ] 2-3 approaches presented with trade-offs
- [ ] Design document written with all required sections
- [ ] Design document saved to `.docs/specs/`
- [ ] User explicitly approved before proceeding
- [ ] `ExitPlanMode` was NOT called
- [ ] Architectural decision persisted to `.memory/decisions/` (if non-obvious trade-off made)
