---
name: remediate
description: "Use at SHIP when prd-audit (or the as-built architecture review) blocks. Reasons over the blocking gaps and emits per-gap remediation dispositions + concrete tasks, routing each to the right step (build/acceptance_specs/architecture_review/plan) — and HALTs only for architectural-clarity or product-scope gaps that need a human."
enforcement: gating
phase: ship
standalone: true
requires: []
model: opus
---

## Purpose

Turns a **blocking SHIP audit into action**. When `prd-audit` (or `architecture-review --as-built`)
reports gaps the daemon would otherwise HALT on, this skill reasons over each blocking gap and
decides *how the daemon should proceed* — autonomously where it can, human-in-the-loop only where it
must.

The daemon should be autonomous. So the default is to **remediate**: translate each gap into
concrete, file-scoped work and route it back to the right SDLC step. A **HALT** is reserved for the
two cases a machine genuinely cannot close:

1. **architectural-clarity** — an architectural gap that needs a human *decision* (ambiguous trade-off,
   missing ADR, conflicting constraints), not just a code change.
2. **product-scope** — functionality the **initial design never accounted for** (a real product gap),
   which needs a human DECIDE amendment.

If a gap can be turned into concrete work, it is **not** a HALT. This skill plans only — it assigns
dispositions and writes tasks. It does **not** edit code, write tests, or amend the PRD; the step it
kicks back to does that.

**Run at SHIP, only when a prior audit BLOCKED — dispatched by the conductor on the blocking path.**

## Practices

### 1. Load Input

Read the blocking gaps and their per-gap evidence from whichever audit blocked:
- `.pipeline/prd-audit.md` — the per-FR verdict table + Per-FR Detail (verdict, gap-class,
  `file:line` evidence). Blocking rows are the `FR-N` rows that are `MISSING`/`PARTIAL`/`DIVERGED`
  and **not** `ACCEPTED`.
- `.pipeline/architecture-review-as-built.md` — present when the as-built compliance gate blocked
  (verdict `BLOCKED`, with the violated APPROVED ADR(s) and evidence).

Consider **only the blocking gaps**. Each gap already carries `file:line` evidence — use it; do not
re-audit from scratch.

### 2. Dispatch `remediation-planner`

Dispatch the **`remediation-planner`** agent with the blocking gaps + their evidence. The agent
returns, per gap, a **disposition** and (for autonomous dispositions) concrete file-scoped **tasks**.
Keep context tight: feed the agent the blocking gaps and their evidence, not the whole codebase.

### 3. Disposition Decision

Each blocking gap gets exactly one disposition. **HALT is reserved for `architectural-clarity` and
`product-scope` only** — every other gap must be turned into concrete work:

| Disposition | When | Daemon effect |
|---|---|---|
| `build` | impl / test / wiring bug with clear evidence (the fix is obvious from the gap) | inject the emitted tasks → kick to **build** |
| `acceptance_specs` | the gap exists because acceptance coverage is missing or too weak to pin the behavior | kick to **acceptance_specs** (regenerate failing specs), then build |
| `architecture_review` | **fixable** ADR drift — the shipped code violates an APPROVED ADR but the correct fix is clear and needs no decision | kick to **architecture_review** |
| `plan` | functionality that **is in scope** but the plan simply missed (a planning omission, not a design gap) | kick to **plan** (re-plan), then build |
| `halt` + `category: architectural-clarity` | an architectural gap that needs a human *decision* before any code can be right | **HALT** for human |
| `halt` + `category: product-scope` | functionality the **initial design never covered** | **HALT** for human DECIDE |

Judgment rules:
- **Prefer autonomous.** If the daemon can produce concrete tasks that close the gap, it must — even
  for `DIVERGED`/ADR-drift gaps, as long as the *correct* fix is determinable from the evidence.
- **HALT is the exception, not the default.** Only the two human categories above HALT. "I'm not sure
  how to fix it" is not a HALT category — if the gap is an impl bug you can describe as a task, it is
  `build`.
- A gap that is an `impl-gap` in the audit is almost always `build` (or `acceptance_specs` when the
  real miss is coverage).
- An `intended-drift` is `halt: product-scope` **only** if it reflects unplanned product
  functionality; if it's a fixable code/ADR mismatch with a clear correct answer, it is `build` or
  `architecture_review`.

### 4. Output Contract

Write the plan to **`.pipeline/remediation.json`** (run evidence — gitignored, overwritten each run).
The conductor reads this file to route, so the shape is exact:

```json
{
  "dispositions": [
    {
      "id": "FR-10",
      "disposition": "build",
      "category": null,
      "rationale": "kids/[id].tsx:119 reads .data.attributes.name, but apiFetch normalizes to .data.name (api-client.ts:108); the cold-link test mock returns an un-normalized envelope that masks the runtime break.",
      "tasks": [
        {
          "id": "rem-fr10-1",
          "title": "kids/[id].tsx:119 — read kidIdentityQuery.data?.data?.name (the normalized shape), not .attributes.name; realign KidDetailScreen-coldlink mock to the normalized envelope { data: { id, type, name, birthdate }, meta }",
          "status": "pending"
        }
      ]
    },
    {
      "id": "FR-4",
      "disposition": "halt",
      "category": "product-scope",
      "rationale": "The PRD never specified multi-currency wallets; supporting them is new product scope, not a bug — needs a human DECIDE amendment.",
      "tasks": []
    }
  ]
}
```

Field rules:
- `id` — the blocking FR id (`FR-N`) or, for an as-built finding, the violated ADR id (its filename stem, e.g. `adr-2026-06-29-rate-limit-strategy`).
- `disposition` — one of `build` | `acceptance_specs` | `architecture_review` | `plan` | `halt`.
- `category` — **only** when `disposition == "halt"`: `architectural-clarity` | `product-scope`.
  Otherwise `null`.
- `rationale` — one sentence citing the gap's `file:line` evidence and justifying the disposition.
- `tasks` — **required, non-empty** when `disposition == "build"` (and recommended for
  `acceptance_specs`/`plan`); each task is concrete and **file-scoped** (`file:line` + exactly what to
  change), drawn from the audit evidence. **`[]` for `halt`.** A `build` disposition with empty
  `tasks` is invalid — the kicked-back step would have nothing to do.

Emit one disposition per **blocking** gap. Non-blocking (`ALIGNED` / `ACCEPTED`) FRs are not included.

## Verification

- [ ] Read the blocking gaps from `.pipeline/prd-audit.md` (and `.pipeline/architecture-review-as-built.md` if present)
- [ ] One disposition per blocking gap — nothing blocking omitted
- [ ] HALT used ONLY for `architectural-clarity` or `product-scope`; every other gap routed to a step
- [ ] Every `build` disposition has ≥1 concrete, file-scoped task drawn from the evidence
- [ ] `category` set iff `disposition == "halt"`; `tasks` empty iff `disposition == "halt"`
- [ ] Valid JSON written to `.pipeline/remediation.json` matching the contract exactly
