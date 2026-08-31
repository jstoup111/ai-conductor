# ADR: A coverage claim is grounded by a verbatim quote, not re-judged at land

**Date:** 2026-08-23
**Status:** APPROVED
**Deciders:** James Stoup (operator), DECIDE architecture review for intake #1799

## Context

The defect in intake #1799 is not a missing check but an ungrounded one. The coherence row

    | story | story-2 | task-3, task-10 | covered | ... three-lap acceptance proof with at-cap,
      mixed, and all-infra variants (10, verify-only). |

asserted in prose that task-10 carried a third variant. The committed plan text assigned two. The
row's claim and the artifact it describes disagreed, and nothing compared them, so a `covered`
verdict survived a mapping the plan contradicts. The cost landed two steps later as a needs-human
halt at `acceptance_specs`.

"Does task-10 genuinely carry this criterion?" is a judgement. Two APPROVED ADRs constrain where it
may be answered:

- `adr-2026-07-22-coherence-gate-placement-and-validation-split` — semantic judgement happens at
  authoring; the land rung is deterministic, offline, and **model-free**. No LLM may run at land.
- `adr-2026-08-22-one-owner-per-review-question` — "does the feature satisfy its criteria" is owned
  by `prd_audit`. A new check must not re-ask an owned question.

CLAUDE.md's design principle names both failure modes directly: prompt-level rules drift under long
builds, but forcing a judgement through rigid mechanical shapes produces its own failure class where
the mechanism cannot recognize a legitimate answer. A pure string match between criterion text and
task text would be the second failure — a task that genuinely covers a criterion in different words
would be rejected, and authors would learn to copy criterion text verbatim into tasks to satisfy the
matcher, which restores the prose problem in a new place.

The codebase already contains the resolution pattern. `acceptance_specs` accepts an authored
judgement — a coverage disposition — but requires it to carry a `file:line` citation, and
`resolveDispositionCitation` (`src/conductor/src/engine/artifacts.ts:1785`) mechanically verifies
the cited file exists and the line is in range. The judgement stays with the author; the engine
verifies the evidence the judgement rests on.

## Options Considered

### Option A: Re-judge coverage at land with a model
- **Pros:** Directly answers the real question with the faculty suited to it.
- **Cons:** Forbidden by adr-2026-07-22 — land must stay deterministic and offline. Also duplicates
  a question `prd_audit` owns.

### Option B: Mechanical text match between criterion and task text
- **Pros:** Fully deterministic; no new authored field.
- **Cons:** False-rejects tasks that cover a criterion in different words, and trains authors to
  paste criterion text into tasks to appease the matcher. Over-mechanizes a judgement, the exact
  failure CLAUDE.md warns against.

### Option C: Keep the prose claim, strengthen the skill's instructions
- **Pros:** No engine change; cheapest.
- **Cons:** The claim being unvalidated prose *is* the defect. Restates the status quo.

### Option D: Authored judgement grounded by a verbatim quote the engine verifies
- **Pros:** Keeps the judgement where the ADRs require it while making it falsifiable. The author
  decides which task carries the criterion and quotes the span of that task's text they relied on;
  the engine mechanically confirms the quote occurs verbatim in that task's body. A claim about a
  task that says nothing of the kind cannot be authored, because there is no span to quote. Mirrors
  the `file:line` citation pattern already proven in `acceptance_specs`.
- **Cons:** Adds an authored field per criterion row. A quote can be copied from an unrelated part
  of the cited task, so the check bounds the claim rather than proving it.

## Decision

**Option D.** Each `criterion` row carries the id(s) of the owning task and a verbatim quote drawn
from that task's own text. At land, `runCoherenceGate` extracts the cited task's body and confirms
the quote occurs in it verbatim. A row whose quote is absent from the cited task is rejected, naming
both the criterion and the task it was attributed to — the two facts #1799 asks the rejection to
carry.

> **Amended 2026-08-31 by #2088:** "drawn from that task's own text" is narrowed to "drawn from that task's `Done when` block". The engine still only proves the quoted text is real; the bound it establishes is now "the author pointed at a completion check", because a quote from Steps prose grounded two claims on 2026-08-30 whose cited tasks' `Done when` never asserted the criterion (#2088). The division of labour gains one row: a default-off pre-BUILD judge (`coverage_binding`) re-judges whether the cited `Done when` asserts the criterion — never whether the implementation satisfies it, which stays `prd_audit`'s. See `adr-2026-08-31-coverage-binding-judge-step` D2, D4–D6.

The division of labour is explicit and is the point of this ADR:

- **The author judges** which task carries a criterion. That is a judgement and stays at authoring.
- **The engine verifies** that the text the judgement cited really exists in the artifact cited.
  That is bookkeeping and stays mechanical.
- **Neither re-judges** whether the implementation satisfies the criterion. That remains
  `prd_audit`'s, per adr-2026-08-22-one-owner-per-review-question.

The check is deliberately a **bound, not a proof**. It cannot establish that a task truly covers a
criterion; it establishes that the author read the task and pointed at real text in it. That is
sufficient for the defect at hand — the failing row cited a variant count the plan never contained,
which no quote could have supported.

Quote matching is exact on the quoted span after normalizing surrounding whitespace, so a claim
cannot be grounded by paraphrase. A task legitimately covering a criterion in different words is
still accepted: the author quotes those different words.

## Consequences

### Positive
- A coverage claim becomes falsifiable at DECIDE without a model at the landing boundary.
- The rejection message names the criterion and the attributed task, satisfying #1799's first
  desired outcome directly.
- Reuses a citation-grounding pattern already load-bearing in `acceptance_specs`, so the repo gains
  no new concept.

### Negative
- One more authored field per criterion row; M/L specs carry more DECIDE ceremony.
- A determined author can quote an irrelevant span of the correct task and pass. This is accepted:
  the check bounds sloppiness, not bad faith, and `prd_audit` remains the satisfaction authority.
- Editing a plan task's wording can invalidate a previously valid quote, so plan edits during DECIDE
  require re-checking affected rows.

### Follow-up Actions
- [ ] Add a task-body extractor to `plan-task-parse.ts` reusing the existing `TASK_HEADER_PATTERN` split
- [ ] Implement quote grounding in `runCoherenceGate` with a rejection naming criterion + task
- [ ] Document the quote field and its exactness rule in `skills/coherence-check/SKILL.md`
