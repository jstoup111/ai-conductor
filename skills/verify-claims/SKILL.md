---
name: verify-claims
description: "Use whenever a statement, theory, or assumption is about to become load-bearing for a spec, plan, ADR, or code. Attaches grounded confidence estimates to claims, always surfaces assumptions, and HARD-BLOCKS work built on unconfirmed assumptions until the operator approves them."
enforcement: gating
phase: all
standalone: true
requires: []
---

## Purpose

Decisive skills routinely state things as fact, or spec and build on assumptions, without ever
marking them as uncertain or getting them confirmed. A wrong assumption that slips into a PRD, an
ADR, a plan, or code is discovered late and is expensive to unwind.

This skill is the correctness discipline other skills apply at their decision points. It does two
things:

1. **Calibrates claims.** Non-trivial statements and theories carry a grounded confidence estimate
   (a %) with the basis for it. No confident-sounding prose hiding an unverified guess.
2. **Gates assumptions.** Every assumption is surfaced explicitly. Any assumption that is
   *load-bearing* — one that, if wrong, changes what gets specced or built — is a **hard block**:
   the work does not proceed on it until the operator explicitly approves it.

It is deliberately cheap and quiet on high-certainty, low-stakes output, and loud exactly where a
mistake would cascade. It does not replace domain review, conflict-check, or prd-audit — it sits
*before* them, keeping unverified foundations out of the artifacts they inspect.

## When This Applies

Apply the protocol whenever output is **load-bearing** — it will drive downstream work:

- A PRD functional requirement, an approach recommendation, or a track decision (`explore`, `prd`)
- An architectural claim or ADR (`architecture-review`)
- A story's acceptance criteria or a plan task (`stories`, `plan`)
- A statement about how existing code, an API, a schema, or a dependency behaves, when that
  statement decides what to build (`tdd`, `debugging`, `manual-test`)
- Any answer to the operator that they may act on as fact

**Skip it** for casual conversation, restating something the operator just said, or trivially
verifiable mechanics with no downstream blast radius. Ceremony on low-stakes output is noise —
correctness matters *at the load-bearing points*, not everywhere.

## Practices

### 1. Separate Claims From Assumptions

For the output under review, split its load-bearing content into two buckets:

- **Claims / theories** — statements presented as true ("the `orders` table has a `status`
  column", "this endpoint is unauthenticated", "the daemon polls every 30s").
- **Assumptions** — things taken as true *without having confirmed them* to fill a gap ("I'm
  assuming orders are immutable after payment", "assuming the operator wants soft-delete").

If something is an assumption, it is NOT a claim — do not launder it into confident prose. Name it
as an assumption.

### 2. Ground Every Claim With a Confidence Estimate

Each non-trivial claim gets a confidence % **and the basis for it**. The basis is mandatory — a
number with no grounding is decoration.

| Confidence | How to present it |
|---|---|
| **≥ 90%** | State it plainly. Add the basis if non-obvious. A verified fact (you read the file, ran the code) can omit the % — say "verified: …". |
| **70–89%** | State it *with* the % and the basis ("~80%, inferred from the migration but not the running schema"). |
| **50–69%** | State it, mark it **tentative**, and say what would confirm it. Do not let it drive irreversible work unverified. |
| **< 50%** | Do not present as fact. Label it **speculation**, or verify before relying on it. |

Grounding vocabulary — always say which:
- **verified** — you directly observed it (read the file, ran it, saw the output). Highest confidence.
- **inferred** — derived from adjacent evidence, not observed directly. Medium.
- **unverified** — plausible but unchecked. Treat as an assumption (Practice 3).

Prefer cheap verification over a confidence estimate. If a `Read`, a `grep`, or one command would
turn a 70% inference into a 99% verified fact, **do that instead of guessing** — the estimate is
for what you genuinely cannot cheaply confirm right now.

### 3. Surface Every Assumption

List every assumption feeding the output, each with:

- **The assumption**, stated plainly.
- **Confidence** it holds (a %).
- **Impact if wrong** — what specced/built work it changes. This determines whether it is
  load-bearing.
- **How to confirm** — the cheapest way to settle it (ask the operator, read a file, run a probe).

An assumption is **load-bearing** if a wrong value changes a requirement, a design decision, a
schema/API, a task, or code behavior. Cosmetic or easily-reversible assumptions are not.

### 4. GATE — Hard-Block on Unconfirmed Load-Bearing Assumptions

**No load-bearing assumption may drive specced or built work until the operator explicitly
approves it.** This is a blocking gate, not advice.

- **Interactive run:** Present the load-bearing assumptions (Practice 3 format), ask the operator
  to confirm, correct, or decide each one, and **wait**. Do not spec or build on the unconfirmed
  value. Ask one decision at a time when they are independent.
- **Autonomous / daemon run:** Do **not** silently pick the most likely value. Write a HALT
  (`.pipeline/HALT` with the assumption ledger as its body) so a human resolves it. A false pass
  here is the exact failure this skill exists to prevent.
- **Non-load-bearing assumptions** may proceed — state them with their % and move on; they are
  recorded (Practice 5), not gated.

Once approved, an assumption becomes a confirmed input: record the approval (Practice 5). If the
approval reflects an architectural or product decision, the calling skill routes it to the right
artifact (an ADR via `architecture-review`, an FR via `prd`) — this skill records; it does not
author those.

### 5. Record the Ledger

Write the claims/assumptions ledger so the decision is auditable and later steps can see what was
assumed vs verified:

```markdown
## Verify-Claims Ledger — <artifact / step> — <date>

### Claims
- [verified] orders.status column exists — read db/schema.rb:42
- [~80%, inferred] payment webhook is idempotent — implied by retry config, not tested

### Assumptions
- [load-bearing, 60%] Orders are immutable after payment.
  - Impact if wrong: the edit-order story is invalid.
  - Confirm by: operator decision.
  - **Status: APPROVED by operator 2026-07-05** | (or) **PENDING — blocking**
```

Write it to `.pipeline/verify-claims-<step>.md` when invoked inside a pipeline/engine step, or
inline in the artifact/response otherwise. Overwrite on re-run — it reflects the current state;
git holds history.

### 6. Verdict

Emit one verdict so the calling skill knows whether it may proceed:

| Verdict | Condition | Action |
|---|---|---|
| **CLEAR** | No unconfirmed load-bearing assumptions remain. All claims carry a grounded confidence. | Proceed. |
| **ASSUMPTIONS_PENDING** | One or more load-bearing assumptions are unconfirmed. | **Block.** Interactive → get approval. Autonomous → HALT. Do not proceed. |

## How Other Skills Invoke This

This skill is a discipline applied *within* the calling skill's context (its model), not a
separately dispatched agent. A skill invokes it by running the protocol above at its decision
point — for example, `plan` before finalizing tasks, `architecture-review` before writing an ADR,
`prd` before locking FRs. The HARNESS.md "Correctness & Assumption Gate" rule arms it at every
load-bearing point; the DECIDE/BUILD skills cite it where their assumptions get baked in.

## Verification

- [ ] Load-bearing content split into claims vs assumptions
- [ ] Every non-trivial claim carries a confidence % AND its basis (verified / inferred / unverified)
- [ ] Cheap verification preferred over an estimate wherever one read/command would settle it
- [ ] Every assumption listed with confidence, impact-if-wrong, and how-to-confirm
- [ ] Load-bearing assumptions identified (wrong value changes spec/design/schema/task/code)
- [ ] No unconfirmed load-bearing assumption drove specced/built work
- [ ] Interactive: operator approved each load-bearing assumption; Autonomous: HALT written (no silent pick)
- [ ] Ledger recorded (`.pipeline/verify-claims-<step>.md` or inline)
- [ ] Verdict emitted (CLEAR / ASSUMPTIONS_PENDING)
