---
name: prd
description: "Use on the PRODUCT track after /explore, when a feature has user-facing requirements. Authors a product-only design doc (PRD) with enumerated functional requirements. Convergent half of the old brainstorm. Skipped on the technical track (no product requirements to spec)."
enforcement: gating
phase: decide
standalone: true
requires: []
model: fable
---

## Purpose

Author the **product requirements document** for a product-track feature: the *what* and *why*,
enumerated as testable functional requirements that stories extract from directly. Runs only when
`/explore` set `Track: product`; technical-track features skip this step entirely.

## Boundaries

`prd` produces a single artifact — a design doc in `.docs/specs/` — and nothing else.

Do NOT:
- Write code, migrations, configs, tests, stubs, plans, or stories
- Create files outside `.docs/specs/`
- Invoke `/plan`, `/stories`, or any other skill

### Product-only — the hard rule

A PRD states goals and requirements. It MUST NOT name the **new internal mechanism** by which
*this* feature is built. These are leaks no matter how convenient:
- command names, subcommands, or CLI flags
- file paths, directory layouts, config-file names, or config keys
- function / class / module / type names, signatures, or pseudocode
- the library / protocol / service / mechanism chosen for this feature (e.g. "via an MCP server",
  "a symlink", "SQLite", "a post-checkout hook", a named algorithm)
- data schemas, table/column names, wire formats, ports

Name the **capability or behavior** ("the operator can adopt a platform in one action"), never the
mechanism. **Carve-out:** a *pre-existing external* constraint or dependency the feature must live
within (an existing API it must call, "must run offline", a mandated datastore) MAY be named as a
requirement under **Dependencies** or **Non-Functional Requirements** — that is product reality, not
a leaked internal mechanism. The distinction: *choosing a new internal mechanism* = leak; *stating an
external constraint we don't control* = requirement.

**Where the "how" goes:** if a load-bearing technical choice surfaces, record it as a one-line
**Open Questions** entry framed as a trade-off for `/architecture-review` to weigh and capture as an
ADR — never as a decided mechanism in the PRD.

After the design doc is saved and approved, **exit the session immediately** — the conductor handles
the handoff.

## Practices

### 1. Write the Design Document

Using `templates/design-doc.md.template`, write a **PRD-grade** doc, clear enough that stories extract
directly from it. Required sections: Problem/Background, Goals & Non-Goals, Users/Personas,
**Functional Requirements (enumerated `FR-1, FR-2, …` — each atomic and testable, including the
negative/edge behavior)**, Non-Functional Requirements (only those that apply), Acceptance Criteria /
Success Metrics, Scope (In/Out), Key Decisions & Rationale (product decisions only), Dependencies,
Open Questions.

The enumerated `FR-N` are the hinge: stories extract granular scenarios per FR. Keep each FR to a
single verifiable capability.

Save to `.docs/specs/YYYY-MM-DD-<topic>.md`. After writing, verify the file exists (`ls`). Archive any
prior design doc for the same feature by prepending `SUPERSEDED-`.

### 2. Product-Only Audit (GATE — before presenting for approval)

Re-read the draft and scan every section — especially Functional Requirements and Key Decisions — for
the technical "hows" listed in Boundaries. For each one found: either **restate it as a
capability/behavior**, or **move it to Open Questions** as a trade-off for architecture-review (unless
it is a pre-existing external constraint, which may stay under Dependencies/NFR per the carve-out). A
PRD that names a new internal mechanism has FAILED this gate — fix it before presenting. (If the
operator says the PRD is leaking technical detail, this gate was skipped — re-run it.)

### 3. Scope Check

Compare the design against the user's **original request**. Count models/endpoints/features; if the
design significantly exceeds the request, surface it explicitly and get confirmation. Do NOT silently
expand scope.

### 4. Get Approval, Then Exit

Present the design doc; do not proceed until the user explicitly approves ("looks good"/"yes" counts).
On approval: set Status to "Approved" and **exit immediately** — do not suggest any other skill.

### 5. API Contract (API Projects Only)

If the project exposes an API, ensure `.docs/decisions/api-response-contract.md` exists (generate from
`templates/api-response-contract.md.template` if not), present it for review, and save the approved
contract. This MUST happen before stories — stories reference it for response-format assertions.

## Constraints

- **HARD CONSTRAINT: `prd` MUST NEVER call `ExitPlanMode`.** It produces a design document, not an
  implementation plan; calling it makes `/conduct` mark the step failed. Write the doc and return.

### Memory Checkpoint

After approval, persist to `.memory/decisions/` only a non-obvious product trade-off not apparent from
the doc itself. Do NOT persist the design-doc contents.

## Verification

- [ ] Design document written with all required sections, saved to `.docs/specs/`
- [ ] **Product-only audit passed — NO new-internal-mechanism "hows"** (commands/flags, paths, config
      keys, function/type names, library/protocol/mechanism choices, schemas); every requirement is a
      capability/behavior, load-bearing technical choices deferred to architecture-review under Open
      Questions; external constraints allowed only under Dependencies/NFR
- [ ] **No files written outside `.docs/specs/`**; no code, plans, stories, or migrations produced
- [ ] Scope checked against the original request
- [ ] User explicitly approved; Status set to "Approved"
- [ ] `ExitPlanMode` was NOT called; session exited immediately after approval
