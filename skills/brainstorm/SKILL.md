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

## Boundaries

Brainstorm produces a single artifact — a design doc in `.docs/specs/` — and nothing else.

Do NOT:
- Write, edit, or create any file outside `.docs/specs/`
- Write code, migrations, configs, tests, or stubs
- Create files in `.docs/plans/`, `.docs/stories/`, or elsewhere — those are downstream skills'
  outputs
- Invoke `/plan`, `/stories`, or any other skill
- Specify **how** anything is built. A PRD states product goals and requirements — the *what* and
  *why* — only. The following are technical "hows" and MUST NOT appear in the design doc; they are
  leaks no matter how convenient or obvious they seem:
  - command names, subcommands, or CLI flags (e.g. `conduct memory install`)
  - file paths, directory layouts, config-file names, or config keys (e.g. `memory.source`, `~/.x/…`)
  - function / class / module / type names, signatures, or pseudocode
  - library, protocol, service, or mechanism choices (e.g. "via an MCP server", "symlink", "SQLite",
    "post-checkout hook", a named processor/algorithm)
  - data schemas, table/column names, wire formats, ports
  Name the **capability or behavior** ("the operator can adopt a platform in one deliberate action";
  "memory survives worktree removal") — never the mechanism ("`conduct memory install`"; "a symlink to
  `~/.x`"). A reader must not be able to tell *how* it will be built from the PRD.

**Where the "how" goes:** if a technical choice is genuinely load-bearing, record it as a one-line
entry under **Open Questions**, framed as a trade-off for `/architecture-review` to weigh and capture
as an ADR — never as a decided mechanism in the PRD. Implementation belongs to `/build`; task
breakdown to `/plan`; the *how* and its trade-offs to `/architecture-review`. Brainstorm is product
requirements + high-level design, period.

After the design doc is saved and approved, **exit the session immediately**. Do not ask what's
next — the conductor handles the handoff.

## Practices

### 1. Explore Project Context

Before asking questions, understand what exists. If the conversation already contains
exploration results (e.g., from a prior Explore agent or `/bootstrap`), summarize what's
known and only explore gaps — do not re-explore files already in context.

When dispatching Explore agents:
- **Max 2 agents** with **directory-based partitioning** (not topic-based — topic partitioning
  causes 30-50% file overlap)
- Agent 1: `app/` + `db/` + `config/` (source files, migrations, routes)
- Agent 2: `spec/` + `.docs/` (tests, stories, specs)
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

After the user selects an approach, write a **PRD-grade design doc** using
`templates/design-doc.md.template`. It must be clear enough that stories can be extracted
directly from it.

Required sections: Problem/Background, Goals & Non-Goals, Users/Personas, **Functional
Requirements (enumerated `FR-1, FR-2, …` — each atomic and testable, including the
negative/edge behavior)**, Non-Functional Requirements (only those that apply), Acceptance
Criteria / Success Metrics, Scope (In/Out), Key Decisions & Rationale, Dependencies, Open
Questions.

The enumerated `FR-N` are the hinge: stories extract one or more granular scenarios per FR,
so vague or missing requirements here produce thin stories downstream. Keep each FR to a
single verifiable capability.
```

Save to `.docs/specs/YYYY-MM-DD-<topic>.md`

**Product-only audit (GATE — before presenting for approval):** Re-read the draft and scan every
section, especially Functional Requirements and Key Decisions, for the technical "hows" listed in
Boundaries (command/flag names, file paths, config keys, function/class/type names, library /
protocol / service / mechanism choices, schemas, ports). For each one found: either **restate it as a
capability/behavior**, or **move it to Open Questions** as a trade-off for architecture-review. A PRD
that names a mechanism has failed this gate — fix it before presenting. (If the operator says the PRD
is leaking technical detail, this gate was skipped — re-run it.)

**Post-write verification:** After writing the design doc, verify the file exists on disk with
`ls`. If prior design docs exist for the same feature in `.docs/specs/`, archive them by
prepending `SUPERSEDED-` to the filename. This prevents competing design docs with
contradictory decisions from coexisting on disk.

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

### 6. Get Approval, Then Exit

Present the design document to the user. Do NOT proceed until the user explicitly approves.
"Looks good" or "yes" counts as approval. Ambiguous responses → ask for clarification.

After approval:
1. Update the document status to "Approved"
2. **Exit the session immediately.** The conductor handles the handoff to the next skill.
   Do NOT suggest running any other skill or command.

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
- [ ] **Product-only audit passed — NO technical "hows" in the doc** (no command/flag names, file
      paths, config keys, function/class/type names, library/protocol/mechanism choices, schemas);
      every requirement is a capability/behavior, and any load-bearing technical choice is deferred to
      architecture-review under Open Questions
- [ ] Design document saved to `.docs/specs/`
- [ ] **No files written outside `.docs/specs/`**
- [ ] **No code, plans, stories, or migrations produced**
- [ ] User explicitly approved before proceeding
- [ ] `ExitPlanMode` was NOT called
- [ ] Session exited immediately after approval (no further suggestions to the user)
- [ ] Architectural decision persisted to `.memory/decisions/` (if non-obvious trade-off made)
