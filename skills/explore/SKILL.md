---
name: explore
description: "Use at the start of any new feature or change. Explores context, asks clarifying questions one at a time, proposes 2-3 approaches with trade-offs, and decides the work track (product vs technical). Divergent half of the old brainstorm — produces no committed design doc; the product-track PRD is authored by /prd."
enforcement: advisory
phase: decide
standalone: true
requires: [verify-claims]
---

## Purpose

The divergent opening of DECIDE: understand intent, gather context, weigh approaches, and decide
**what kind of work this is** — a *product* feature (needs a PRD) or *technical-only* work
(refactor/infra/deps — no PRD). Exploration is a thinking step; its durable outputs are the chosen
approach (to `.memory/decisions/`) and the **track marker** — not a design doc.

**Correctness gate:** approach recommendations and the track decision are load-bearing. Apply the
`/verify-claims` protocol — attach a grounded confidence % to non-trivial claims about the code or
domain, surface every assumption feeding an approach, and HARD-BLOCK (operator approval interactive,
HALT if autonomous) on any unconfirmed assumption that changes which approach or track you pick.

## Boundaries

`explore` writes **no committed `.docs/` design artifact**. It MAY write exactly one committed
marker: `.docs/track/<slug>.md`.

Do NOT:
- Write code, migrations, configs, tests, stubs, plans, stories, or a PRD/design doc
- Create files in `.docs/specs/`, `.docs/plans/`, `.docs/stories/`, etc.
- Invoke `/prd`, `/plan`, `/stories`, or any other skill

Working notes (approaches considered, scratch reasoning) are **ephemeral** — keep them in
`.pipeline/` (gitignored), never in `.docs/`. The PRD is authored by `/prd` (product track only);
stories carry acceptance criteria on **both** tracks.

After the track is decided and the decision persisted, **exit the session immediately**. The
conductor handles the handoff (to `/prd` on the product track, or straight to architecture on the
technical track).

## Practices

### 1. Explore Project Context

Before asking questions, understand what exists. If the conversation already has exploration
results (from `/bootstrap` or a prior Explore agent), summarize what's known and only fill gaps.

When dispatching Explore agents: **max 2**, directory-partitioned (Agent 1: `app/`+`db/`+`config/`;
Agent 2: `spec/`+`.docs/`). Do NOT read `.memory/` (auto-loaded). Check `.memory/` context and
existing `.docs/stories/` for related work.

### 2. Ask Clarifying Questions

One at a time, each building on the last. Focus on **what** the user wants (not how), **who** uses
it, **why** it matters, scope boundaries, and constraints. Stop when you have enough to propose
approaches. Don't over-question.

### 3. Propose Approaches

Present 2-3 approaches with clear trade-offs and a recommendation; the user decides.

```markdown
### Approach A: [Name]
**Idea:** [Brief description — behavior/strategy, not mechanism]
**Pros:** … **Cons:** … **Best when:** …
**Est. effort:** [very rough implementation time — e.g. "~1-2h", "~half day", or S/M/L tier]
**Impact:** [one line — value added / what it unblocks]
```

**Est. effort** and **Impact** are REQUIRED on every proposed approach. Keep them rough and
one-line each — they inform the operator's pick, they are not commitments and need no analysis
artifact.

**Embedded Design Divergence Rule:** When the incoming idea carries an embedded solution design
(identified as a filer hypothesis from the engineer step):

- The hypothesis enters as **at most one candidate approach** (not privileged, but present)
- At least **one genuine alternative NOT derived from the filer's sketch MUST be generated** and weighed
- The hypothesis **may still be recommended when it wins on merits** — this rule prevents default adoption
  (anchoring bias), not the idea itself

When the idea has no embedded design, behavior is unchanged; no added ceremony.

### 4. Decide the Track (product vs technical)

Classify the work and **get the operator to confirm** — this gates whether a PRD is authored:

- **product** — user-facing capability/behavior with requirements worth a PRD.
- **technical** — refactor, infra, dependency, internal tooling: no product requirements; acceptance
  criteria will live directly in stories. No PRD.

Present it like: `Track: TECHNICAL (dependency upgrade, no user-facing behavior). Override? [product/technical/accept]`

Misclassification is a real risk (a product feature mislabeled technical ships with no requirements),
so do NOT finalize silently — the operator must confirm. On confirmation write
`.docs/track/<slug>.md`:

```markdown
# Track: <feature>

Track: product   # or: technical

<one line of rationale>
```

### 5. Persist the Decision, Then Exit

- **Memory (`.memory/decisions/`)** — persist the **selected approach and why the alternatives were
  rejected**. This is exploration's one durable thinking output; the ephemeral `.pipeline/` notes are
  discarded. Only persist when the trade-off is non-obvious.
- **Exit immediately.** Do NOT suggest the next skill — the conductor routes to `/prd` (product) or
  architecture (technical).

## Constraints

- **HARD CONSTRAINT: `explore` MUST NEVER call `ExitPlanMode`.** It produces no implementation plan;
  calling it makes `/conduct` mark the step failed. Decide the track, persist, and return.

## Verification

- [ ] Project context explored before asking questions
- [ ] Questions asked one at a time (not batched)
- [ ] 2-3 approaches presented with trade-offs + a recommendation
- [ ] Every approach carries **Est. effort** and **Impact** lines
- [ ] Track decided AND operator-confirmed; `.docs/track/<slug>.md` written
- [ ] **No `.docs/` design artifact written (specs/stories/plans); notes kept in `.pipeline/`**
- [ ] Selected approach + rejected alternatives persisted to `.memory/decisions/` (if non-obvious)
- [ ] `ExitPlanMode` was NOT called
- [ ] Session exited immediately after the track decision
